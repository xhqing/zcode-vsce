# ZCode app-server 协议记录（PROTOCOL.md）

> M0 交付物。以下 schema 均从官方 runtime（`vendor/zcode.cjs`，ZCode Desktop 3.8.1 / cli 0.16.3）逆向提取并经运行时探针（`tmp/proto-probe.ts`）实证。上游版本变化后需重新核对。
> 传输形态：**行分隔 JSON-RPC over stdio**（子进程 `node zcode.cjs app-server`），请求带 `id`、通知只有 `method`、服务端也会下发带 `id` 的请求需要客户端应答。

## 1. 链路实证结论（2026-08-27）

- ✅ `session/create` → 建会话成功，返回 `{session, settings, projection, runtime, messages, slashCommands}` 快照
- ✅ `session/subscribe`（`deliveryKind: "desktop-continuous"`）→ 事件流订阅成功，可带 `afterSeq` 补齐、`includeSnapshot` 带快照
- ✅ `session/send` → 返回 `{accepted: true, sessionId, stateRevision}`，随后 `session/event` 通知流持续推送
- ✅ `session/stop` / `session/list` 正常
- ✅ 服务端请求 `session/requestRuntimePreferences` **必须正确应答**（见 §4），否则 create 直接超时失败（-32022，15 s）
- ⚠️ 完整模型回合：探针期间模型端点返回 429（账号 5 小时限额触顶），协议层事件完整走完 `turn.started → model.request.status → turn.failed`，无协议缺口；额度重置后复验
- 事件双通道：`session/event`（业务事件，payload.type 见 §3）与 `v4/telemetry/event`（遥测）并存；`state.updated` 为独立通知（revision 递增的状态补丁）

## 2. 关键请求-响应 schema（客户端 → runtime）

### session/create

```jsonc
{
  "workspace": { "workspacePath": "/abs/path", "workspaceKey": "/abs/path" },
  "mode": "build",                  // plan | build | edit | yolo | auto
  "model": { "providerId": "...", "modelId": "..." },   // 可选
  "thoughtLevel": "max",            // 可选
  "titleGenerationEnabled": true,   // 可选
  "sessionId": "..."                // 仅 importedHistory 场景
}
```

返回（SessionBootstrap）：`{ session, settings, projection, runtime, messages, slashCommands?, protocol }`。
`session.sessionId` 是会话 id（注意：不在顶层）。

### session/subscribe

```jsonc
{ "sessionId": "...", "deliveryKind": "desktop-continuous", "afterSeq": 12, "includeSnapshot": false }
```

`deliveryKind` 枚举：`desktop-continuous` | `web-remote-replayable`。返回 `{eventSeq, events[], sessionId, snapshot?}`。
**一个会话只能有一条订阅流**；`afterSeq` 用于断线补齐（返回错过的 events）。

### session/send

```jsonc
{
  "sessionId": "...",
  "content": "用户输入",
  "attachments": [ { "ref": "data:image/png;base64,...", "fileName": "x.png", "mime": "image/png", "bytes": 123 } ],
  "inputId": "...", "queryId": "...",        // 可选，幂等键
  "expectedRevision": 3                       // 可选，乐观并发
}
```

`attachments[].ref` 规则（mapAttachmentRef 逆向）：image/* 且 ref 是 data: URL → 直接内嵌；非 data: 的 ref 按文件路径处理（相对 cwd）。运行中再 send 会报 `-32010 A prompt is already running`（排队输入走 steer/queue 机制，M2 再做）。

### session/stop / close / fork / compact

```jsonc
{ "sessionId": "..." }                                    // stop / close
{ "sessionId": "..." }                                    // fork
{ "sessionId": "...", "instructions": "..." }              // compact，instructions 可选
```

### session/setModel / setMode / setThoughtLevel

```jsonc
{ "sessionId": "...", "model": { "providerId", "modelId" }, "persistAsWorkspaceLastUsed": false }
{ "sessionId": "...", "mode": "build" }
{ "sessionId": "...", "thoughtLevel": "max", "persistAsWorkspaceLastUsed": false }
```

`persistAsWorkspaceLastUsed: false` 只影响当前会话（对齐 TUI 的 transient 语义）。

### session/list / messages / usage / read

```jsonc
{ "workspace": {...}, "includeArchived": false, "limit": 50 }   // list → {sessions: [...]}
{ "sessionId": "..." }                                            // messages / usage / read
```

## 3. `session/event` 事件类型（payload.type 全集）

```
session.created | session.resumed | session.updated | session.titleUpdated | session.closed
turn.started | turn.steerQueued | turn.steerDrained | turn.completed | turn.failed
message.upserted | message.removed
part.started | part.delta | part.upserted | part.removed
model.streaming
tool.updated
permission.requested | permission.resolved
userInput.requested | userInput.resolved
checkpoint.created | rewind.triggered | streamRecovery.updated
```

- `part.delta`：流式增量，`field` ∈ `text | reasoning`，`delta` 为增量文本，`messageId`/`partId` 定位
- `part.upserted` / `message.upserted`：恢复 / 快照对齐用（parts 结构见 §5）
- `turn.failed`：`payload.error.{type, code, message, detail}`（例：provider 429 时 code 为 provider 错误码）
- 信封字段：`{sessionId, eventId, seq, timestamp, turnId?, traceId?, deliveryKind, payload}`
- 另有独立通知 `state.updated`（`{patch, reason, revision, scope, sessionId}`），settings/projection 增量更新走这里

## 4. 服务端下发请求（runtime → 客户端，带 id，必须应答）

### session/requestRuntimePreferences

`{sessionId, scope}`，scope ∈ `runtime-materialization` | `user-execution`（create 时和每轮执行前各来一次）。
**应答 schema 是 strict 的**，最少必须含：

```jsonc
{
  "nativeSearchEnhancementsEnabled": false,
  "memoryEnabled": false,
  "askUserQuestionAutoResolutionEnabled": true,
  "modelContextBudgetStrategy": "preflight-v1"   // legacy | preflight-v1
}
```

漏字段 → ZodError（实测第一次探针失败原因）。应答超时（15 s）→ create 失败 -32022。

### interaction/requestPermission

请求参数：`{requestId, sessionId, turnId?, toolCallId, toolName, reason, riskLevel, input?, origin?, options[], requestedAt}`。
`options[]` 每项：`{optionId, kind, name, description?, response}`，典型三项：
`allow_once` / `allow_project`（response 带 permissionUpdates：addRules + behavior allow）/ `deny`。
**应答格式：直接把所选 option 的 `response` 对象作为 result 返回**（`{decision: "allow"|"deny"|"escalate"|"modify", reason?, permissionUpdates?}`）。

### interaction/requestUserInput

请求：`{requestId, prompt, inputType?: "text"|"choice"|"confirm", choices?}`。
应答：`{value?, cancelled?}`。

## 5. messages / parts 数据形态（快照与恢复）

`messages[]`: `{info: {messageId, sessionId, role: "user"|"assistant", ...}, parts[]}`。
`parts[]` 判别联合 `type` ∈ `text | reasoning | file | tool | step-start | step-finish | snapshot | patch | compaction | timeline | subagent | agent | retry`，公共字段 `{partId, sessionId, messageId}`。
tool part：`{type: "tool", callId, tool, state: {status: pending|running|completed|error, input?, output?, title?, error?}}`。
user info 额外带 `tools`/`system`；assistant info 带 `model/cost/tokens/path`。前端展示直接消费该结构（webview store 已适配）。

## 6. 权限模式与模型语义

- mode：`plan | build | edit | yolo | auto`（对齐 CC 的 plan / default / auto-accept edit / auto-accept all）
- settings.model.available：`{ref, label, providerLabel, contextWindow}[]`，来自 provider 配置
- thoughtLevel：`{value, label}[]`，常见 `low | high | max`（随模型能力而定）
- workspaceKey：即持久化 key；runtime session/list 会把它规范化为 workspacePath，统一用绝对路径即可

## 7. 已知边界

- 单订阅：同一 sessionId 重复 subscribe 会切换 delivery 通道，恢复场景用 `afterSeq`
- `session/send` 在 turn 运行中会被拒（-32010）——排队输入需 steer（`turn.steerQueued` 事件族）或前端本地排队后 turn 结束再发（M1 采用后者）
- telemetry（`v4/telemetry/event`）与业务事件有 eventId 重叠，业务消费只认 `session/event`
- OAuth 登录流不在 app-server 协议内（zcode-cli 的 zai-oauth + runtime `login` 子命令链路），vsce M1 复用 `.env` / config.json 配置方式
