# zcode-vsce 实施方案

> 本文档是 zcode-vsce 项目的顶层设计文档，所有后续开发以此为准。
> 结论先行：**改造可行**。后端复用 zcode-cli 提取的官方 ZCode runtime（功能不变），前端用 VSCode webview 重写为类 Claude Code VSCode 扩展（下称「CC 扩展」）的交互形态；交互体验可做到完全等价，「背后是哪家模型」可感知（模型列表 / 登录体系是后端本体属性，前端无法也不应伪造）。
> 版本：0.1.0（2026-08-26 立项）

---

## 目录

- [1. 背景与可行性结论](#1-背景与可行性结论)
- [2. 总体架构](#2-总体架构)
- [3. 与 zcode-cli 的复用与分工](#3-与-zcode-cli-的复用与分工)
- [4. app-server 协议面清单](#4-app-server-协议面清单)
- [5. 前端功能对照：CC 扩展表面逐项映射](#5-前端功能对照cc-扩展表面逐项映射)
- [6. 工程设计要点](#6-工程设计要点)
- [7. 分阶段实施路线](#7-分阶段实施路线)
- [8. 风险与对策](#8-风险与对策)
- [9. 已定决策记录](#9-已定决策记录)

---

## 1. 背景与可行性结论

### 1.1 项目由来

zcode-cli 已验证一条成熟链路：从 ZCode Desktop 提取 `resources/glm` 官方 runtime（`vendor/zcode.cjs`，约 12 MB），注入本地 `@zcode/tui` 实现后以终端 TUI 形态运行。用户提出新形态需求——**改造成 VSCode 扩展，后端功能不变，前端做成类 CC 扩展的交互**——并接受「交互完全等价、模型品牌可感知」的合理边界。

### 1.2 可行性的根基：runtime 原生自带 app-server 协议

这是整个方案成立的关键事实，已从 `vendor/zcode.cjs`（zcode-cli 3.8.1-20 提取版）中核实：

1. **runtime 支持 `app-server` / `agent-server` 子命令**，进入 stdio JSON-RPC 长连接服务模式（请求-响应 + 通知推送）。runtime 在该模式下自报 `"electron"` 表面（`isProtocolServerInvocation` 分支），说明 **ZCode Desktop 的图形界面本身就是这套协议的客户端**——前后端分离不是逆向 hack，是上游原生支持的用法。
2. **协议面完整覆盖一个图形客户端所需的全部能力**（方法名从 runtime 字符串中逐个提取，完整清单见第 4 节）：会话生命周期、流式事件推送、工具调用、权限交互、模型 / 模式切换、插件 / MCP 管理、用量统计。
3. zcode-cli 的 [src/app-server-client.ts](../zcode-cli/src/app-server-client.ts) 已经在用这套协议跑 `zcode plugins` 命令（单次请求形态），证明链路可用，只差扩成长连接 + 事件订阅。

### 1.3 三个问题的明确回答

| 问题 | 结论 |
|---|---|
| 能否改造成 VSCode 扩展？ | **能**。runtime 原生前后端分离协议 + zcode-cli 已有提取链路，架构上无障碍。 |
| 后端不变、前端做成 CC 扩展式交互是否可行？ | **可行**。`app-server` 协议覆盖聊天、流式、工具、权限、diff、会话管理全部所需。 |
| 前端完全等价于 CC 扩展、用户感知不到后端是 zcode 还是 cc？ | **有边界**。交互范式可完全等价；但模型选择器（GLM vs Claude）、登录体系（Z.AI / BigModel vs Anthropic）、模型行为、CC 独有生态（claude.ai 联动等）必然露馅——这些是后端本体属性。合理定位：**「一个用起来和 CC 扩展一模一样的客户端，背后跑 ZCode runtime」**。 |

### 1.4 为什么单独建 zcode-vsce 仓库（而不是塞进 zcode-cli）

- 产物完全不同：tgz（npm 可装包）vs vsix（VSCode 扩展包）；工程链路完全不同：pi-tui TUI vs VSCode 扩展 API + webview。
- 独立仓库互不拖累：zcode-cli 的发布节奏不被扩展开发影响，反之亦然。
- 共享的东西（runtime 提取产物、纯逻辑层代码、协议知识）通过明确的复用关系解决（见第 3 节），不靠同仓。

---

## 2. 总体架构

```text
┌─ VSCode 扩展进程（extension host，我们的代码）─────────────────────┐
│                                                                      │
│  extension.ts（激活入口）                                             │
│    ├─ RuntimeHost：进程管理                                          │
│    │    spawn <外部 node> vendor/zcode.cjs app-server（stdio 长连接）  │
│    │    （node 路径解析：ZCODE_NODE 环境变量 → PATH 上的 node，       │
│    │      要求 ≥22.19，不依赖 extension host 内置 Node）              │
│    │                                                                  │
│    ├─ AppServerConnection：JSON-RPC 双工通道                          │
│    │    请求-响应（id 关联）+ 服务端通知（session/event 等）           │
│    │    重连 / 心跳 / 输出上限防护                                     │
│    │                                                                  │
│    ├─ 复用 zcode-cli 纯逻辑层（见第 3 节）：                           │
│    │    model-access / env-config / key-failover / usage /            │
│    │    events 归一化 / runtime-projection / …                        │
│    │                                                                  │
│    └─ SessionManager：多会话生命周期（create / resume / fork / stop）  │
│                                                                      │
│  webview（聊天面板 UI，类 CC 扩展交互）                                │
│    ├─ 消息流：postMessage ↔ AppServerConnection 双向转发              │
│    ├─ 会话视图：流式 Markdown / 工具卡片 / diff / 权限请求            │
│    └─ 命令面板：斜杠命令、@ 文件引用、$ skill、模型 / 模式切换         │
└──────────────────────────────────────────────────────────────────────┘
                              │ spawn (stdio: pipe)
                              ▼
              外部 node vendor/zcode.cjs app-server
              （官方 ZCode runtime，与 zcode-cli 同一份提取产物，
                后端功能完全不变：agent / 模型 / 会话 / 工具 /
                plugin / MCP / 凭据 / provider 配置全在 runtime 内）
```

要点：

- **后端零改动**。扩展只做一件事：把 `app-server` 协议接进 VSCode。runtime 的 agent、模型、会话、工具、插件、MCP、凭据库、provider 配置逻辑全部留在提取的官方 runtime 里——与 zcode-cli 的「官方 kernel + 本地界面」原则一致。
- **不依赖 extension host 内置 Node**。runtime 要求 Node ≥22.19，extension host 的内置版本不受我们控制。沿用 zcode-cli launcher 的解析方式（`ZCODE_NODE` → `PATH`），spawn 外部 node。
- **单 runtime 进程多会话**。一个扩展实例管理一个 app-server 进程，多会话走进程内的 `session/*` 方法（协议天然支持），不为每个会话拉一个 runtime。

## 3. 与 zcode-cli 的复用与分工

### 3.1 直接复用（拷贝或抽包，代码级复用）

| zcode-cli 模块 | 作用 | 复用方式 |
|---|---|---|
| `src/model-access.ts` | 用户配置读写、模型接入检测 | 拷贝适配 |
| `src/env-config.ts` | `.env` 扁平配置 → config.json 同步 | 拷贝适配 |
| `src/key-failover.ts` | 多 key 回环容灾代理 | 拷贝适配（扩展启动时同样先起代理再拉 runtime） |
| `src/usage.ts` | SQLite 用量统计 + BigModel monitor 真实积分 | 拷贝适配（树视图「用量」面板的数据源） |
| `src/zai-oauth.ts` + `src/darwin-oauth-callback.ts` | Z.AI OAuth 登录流（macOS 回调桥） | 拷贝适配（登录页数据源） |
| `src/app-server-client.ts` | 单次请求客户端 | 演进为长连接 `AppServerConnection` 的起点 |
| `packages/zcode-tui/src/events.ts` | runtime 事件归一化（`normalizeEvent`） | **直接复用**——webview 收到的原始事件与 TUI 同源，归一化逻辑一模一样 |
| `packages/zcode-tui/src/runtime-projection.ts` | 状态投影（活动工具 / 后台任务 / 上下文用量） | 直接复用 |
| `packages/zcode-tui/src/context-breakdown.ts` 等 | 上下文构成分析等纯逻辑 | 按需复用 |
| `scripts/sync-runtime.ts` | runtime 提取 + TUI bridge 注入 | **改造复用**——提取部分照搬；注入部分对 vsce 场景新增 app-server 桥（见 5.4） |

**TUI 纯逻辑层的判定标准**：不 import pi-tui / 不碰 `process.stdout` 的模块即纯逻辑层。zcode-tui 约 65 个源文件中约一半属于此类，是本次改造最大的省力点。

### 3.2 runtime 提取产物的共享

`vendor/zcode.cjs` 与 `zcode-runtime.lock.json` 的提取源头相同（同一版 ZCode Desktop）。两个项目各自维护提取脚本副本、各自产出 vendor，**用 lock 文件对齐版本**（上游同版本 → 两边 vendor 逐字节一致）。不建共享包（避免把 vendor 发布成可安装依赖的再分发合规复杂度）。

### 3.3 明确不做的

- 不把 zcode-cli 改造成 monorepo 双产物（tgz + vsix）——产物链路差异太大，维护成本高于收益。
- 不在扩展里重实现 agent / 工具 / 会话逻辑——那是对「后端不变」的背叛。

## 4. app-server 协议面清单

以下方法名从 `vendor/zcode.cjs` 3.8.1-20 提取版中逐个核实（字符串匹配提取，非猜测）。**注意：方法名存在但参数 schema 未完全逆向，M0 里程碑第一件事就是把参数面摸清**（方法在 runtime 内的实现都有参数解析器，可继续用字符串分析 + 运行时试探两种手段）。

### 4.1 请求-响应方法（客户端 → runtime）

**会话生命周期与对话**

| 方法 | 用途 |
|---|---|
| `session/create` | 新建会话 |
| `session/resume` | 恢复历史会话 |
| `session/list` | 会话列表（多会话侧边栏） |
| `session/subagents` | 子代理列表 |
| `session/read` | 读会话元信息 |
| `session/messages` | 拉取会话消息（离线恢复 / 补齐） |
| `session/events` | 拉取历史事件（补齐 / 断线恢复） |
| `session/subscribe` | 订阅会话事件流（实时通知的开端） |
| `session/send` | 发送用户输入（对话主通道） |
| `session/stop` | 停止当前 turn / 取消 |
| `session/fork` | 会话分叉 |
| `session/compact` | 上下文压缩 |
| `session/close` | 关闭会话 |
| `session/goal` | 会话目标（goal / todo） |

**模型与模式**

| 方法 | 用途 |
|---|---|
| `session/setModel` | 切模型（当前会话） |
| `session/setThoughtLevel` | 推理深度档位 |
| `session/setMode` | 权限模式（build / edit / yolo / plan ↔ CC 的权限模式） |
| `session/updateRuntimeModelConfig` | 更新运行时模型配置 |
| `session/requestRuntimePreferences` | 请求运行时偏好 |
| `session/usage` | 会话内用量 |
| `workspace/setDefaultModel` / `setDefaultThoughtLevel` / `setDefaultMode` | 工作区级默认值（设置页数据源） |
| `workspace/generateText` / `cancelGenerateText` | 独立文本生成（标题生成等辅助能力） |

**工作区状态**

| 方法 | 用途 |
|---|---|
| `workspace/readState` | 工作区状态（分支 / 目录 / provider 注册表） |
| `workspace/updateProviderRegistry` / `upsertModelProvider` / `removeModelProvider` | provider 配置管理（设置页） |
| `workspace/updateInteractionPreferences` / `updateModelIoPreferences` | 交互与模型 IO 偏好 |

**交互回调（runtime → 客户端，以请求形式下发，客户端响应该请求）**

| 方法 | 用途 |
|---|---|
| `interaction/requestPermission` | 工具权限审批（CC 扩展的「允许 / 拒绝」弹窗） |
| `interaction/requestUserInput` | runtime 主动要用户输入（表单 / 选择） |
| `interaction/requestProviderRuntimeHeaders` | provider 运行时请求头（登录流辅助） |
| `interaction/browserList` / `browserExecute` | 浏览器会话列表与操作（Browser Use 插件配套） |

**管理与统计**

| 方法 | 用途 |
|---|---|
| `mcp/list` | MCP 服务器列表 |
| `plugins/list` / `referenceCatalog` / `setEnabled` / `overview` / `install` / `uninstall` / `update` / `restoreBuiltin` / `configure` / `validate` / `describe` / `cancelOperation` | 插件全生命周期（zcode-cli plugins CLI 已验证可用） |
| `automation/*`（create / update / checkTaskBinding / list / delete） | 后台自动化任务 |
| `usage/stats` | 用量统计（树视图数据源，协议版） |

### 4.2 服务端通知（runtime → 客户端，推送）

| 通知 | 用途 |
|---|---|
| `session/event` | **会话事件流主通道**——assistant 文本增量、工具调用生命周期、turn 状态、错误等全部经此推送；zcode-cli TUI 的 `subscribeSessionEvents` 消费的同源事件，`normalizeEvent`（events.ts）可直接归一化 |
| `message/global` | 全局消息 |
| `notifications/progress` | 进度通知 |
| `notifications/message` | 消息通知 |

## 5. 前端功能对照：CC 扩展表面逐项映射

以 CC VSCode 扩展的交互表面为对照基准，逐项给出来源（协议直接支持 / 需扩展开发 / 有边界）。

### 5.1 协议直接支持（对接即得）

| CC 扩展功能 | 映射到 |
|---|---|
| 聊天面板流式对话 | `session/create` + `session/send` + `session/subscribe` → `session/event` 流 |
| Markdown / 代码块渲染 | webview 端自行渲染（事件里是原始 Markdown 增量） |
| 工具调用卡片（运行中 / 完成 / 失败） | `session/event` 的 tool_call_* 事件族（events.ts 已归一化） |
| 权限请求弹窗（允许 / 允许本次 / 拒绝 / 始终允许） | `interaction/requestPermission` ↔ 客户端响应 |
| 文件 Edit / Write 的 diff 预览 | tool_call 事件 payload 里的 diff 数据 → VSCode 原生 diff 编辑器或 webview 内嵌 diff 视图 |
| 模型切换器 | `session/setModel` + runtime 模型列表（TUI 的 `listModelOptions` 同源能力） |
| 权限模式切换（CC 的 plan / auto-accept / default） | `session/setMode`（build / edit / yolo / plan） |
| 多会话管理（历史会话列表 / 恢复 / 分叉） | `session/list` / `resume` / `fork` |
| 用量统计面板 | `usage/stats` + 复用 usage.ts |
| MCP / 插件管理面板 | `mcp/list` + `plugins/*`（zcode-cli 已验证） |
| 图片附件 | `session/send` 的多模态参数（M0 摸清 schema；TUI 已验证 Ctrl+V 剪贴板附件链路） |
| 中断 / 停止 | `session/stop` |
| 上下文压缩 | `session/compact` |
| 登录（Z.AI OAuth / API key / 自定义 provider） | 复用 zcode-oauth + darwin-oauth-callback + model-access；`workspace/upsertModelProvider` 提供协议路径 |

### 5.2 需扩展开发（协议没有直接对应，前端工作）

| CC 扩展功能 | 方案 |
|---|---|
| 侧边栏树视图（会话 / 用量 / 设置分组） | VSCode tree view API 自建 |
| `@` 文件引用补全 | workspace 文件枚举 + webview 补全 UI（TUI 的 WorkspaceAutocompleteProvider 逻辑可参考） |
| `$` skill 补全与调用 | runtime skill 目录（`listSkills` 能力）+ webview 补全 UI |
| 斜杠命令补全 | 前端命令表 + runtime 上游命令（TUI 的命令表可直接搬） |
| 编辑器 gutter / 行内变更指示 | VSCode decorations API + 文件变更事件 |
| 终端集成（终端内唤起） | VSCode terminal API + 命令注册 |
| 状态栏（当前模型 / 模式 / token） | VSCode status bar API，数据源 `session/usage` + projection |

### 5.3 有边界（做不到或刻意不做）

| 项 | 说明 |
|---|---|
| 模型品牌不可伪造 | 模型选择器里是 GLM 系列不是 Claude——这是用 ZCode 的意义所在，不屏蔽 |
| 登录页品牌 | Z.AI / BigModel 账号体系，非 Anthropic |
| CC 独有生态 | claude.ai 账号联动、Slack 集成等 CC 生态服务，ZCode runtime 无对应物 |
| CC 的 roadmap 同步 | CC 扩展的功能演进我们只能交互层跟随，底层能力受限于 runtime 版本 |

### 5.4 需沿用 anchor patch 手法补的（协议未暴露、TUI bridge 已有）

zcode-cli 的 `patchRuntimeTuiBridge`（scripts/sync-runtime.ts）往 runtime 里注入了一批 TUI bridge 能力，其中部分在 app-server 协议面没有对应方法，但 CC 扩展体验需要：

| 能力 | TUI bridge 里的对应 | 方案 |
|---|---|---|
| 双击 Esc 式回退（rewind / checkpoint） | `previewFileRewind` / `applyFileRewind` | 在 sync 脚本 vsce 分支里把它们暴露成新 RPC 方法（沿用现有 anchor 注入手法，锚点校验照搬） |
| 上下文构成明细 | `readRuntimeProjection` / context breakdown | 同上，或纯前端按 messages 估算（context-breakdown.ts 已可纯前端算） |
| 后台任务消息 / 恢复 | `subagentPort.sendMessage` / runtimeTaskRegistry | `session/subscribe` 事件 + `automation/*` 可能覆盖大半；缺口部分走 anchor patch |
| 队列输入（queued input） | `promoteQueuedInput` 等 | 评估：CC 扩展的排队输入交互较轻，可先纯前端排队、turn 结束再 send |

**原则**：能用协议就用协议；协议缺口先评估纯前端替代；实在不行才 anchor patch（每个 patch 都是上游版本升级时的维护点，能少一个是一个）。

## 6. 工程设计要点

### 6.1 目录结构（规划）

```text
zcode-vsce/
├─ PLAN.md                    # 本文档
├─ package.json               # 扩展清单（main: out/extension.js）
├─ tsconfig.json
├─ src/
│  ├─ extension.ts            # 激活入口：命令 / 视图 / 状态栏注册
│  ├─ runtime/
│  │  ├─ host.ts              # RuntimeHost：spawn 外部 node + vendor/zcode.cjs app-server
│  │  ├─ connection.ts        # AppServerConnection：JSON-RPC 双工 + 重连 + 防护
│  │  ├─ sessions.ts          # SessionManager：多会话生命周期
│  │  └─ protocol.ts          # 协议类型定义（M0 摸清后固化）
│  ├─ reuse/                  # 从 zcode-cli 拷贝的纯逻辑层（见第 3 节）
│  │  ├─ model-access.ts
│  │  ├─ env-config.ts
│  │  ├─ key-failover.ts
│  │  ├─ usage.ts
│  │  ├─ events.ts            # normalizeEvent（来自 zcode-tui）
│  │  └─ runtime-projection.ts
│  ├─ ui/
│  │  ├─ panel.ts             # webview 面板管理（聊天主面板）
│  │  ├─ tree.ts              # 侧边栏树视图（会话 / 用量 / 设置）
│  │  ├─ statusbar.ts         # 状态栏
│  │  └─ diff.ts              # diff 呈现（原生编辑器 / webview 内嵌）
│  └─ commands/               # 斜杠命令与命令面板
├─ webview/                   # 前端源码（构建产物进 out/webview）
│  ├─ index.html
│  ├─ main.tsx                # 聊天 UI 主组件
│  ├─ components/             # 消息 / 工具卡片 / 权限 / 补全 …
│  └─ store.ts                # 前端状态（事件归一化后的投影）
├─ scripts/
│  └─ sync-runtime.ts         # 从 zcode-cli 改造：提取 + vsce 桥注入
├─ vendor/                    # 提取产物（gitignore，发布时打包进 vsix）
│  ├─ zcode.cjs
│  └─ extraction.json
└─ test/                      # bun test（协议客户端 / 归一化 / 投影的单元测试）
```

### 6.2 进程与生命周期

- **激活时机**：`onStartupFinished` 或首次调用命令时懒激活（倾向于懒激活，不拖慢 VSCode 启动）。
- **runtime 进程管理**：面板首次打开时 spawn；面板全关 + 无后台任务时延迟关闭（比如 5 分钟空闲）；VSCode 退出时 SIGTERM → 超时 SIGKILL。崩溃自动重启 + `session/resume` 恢复现场。
- **多文件夹窗口**：每窗口一个扩展实例、一个 runtime 进程（workspace 为单位），与 CC 扩展一致。
- **stdio 防护**：沿用 app-server-client.ts 的输出上限（16 MB）思路；runtime stderr 落 `~/.zcode/vsce/runtime.log`（轮转），不进 VSCode 输出通道刷屏。

### 6.3 webview 通信协议（扩展 ↔ webview）

自定一层薄消息协议，webview 不直接接触 JSON-RPC 细节：

```text
扩展 → webview：
  { t: "event", event: <归一化后的 session/event> }
  { t: "state", state: <projection 快照> }
  { t: "sessions", sessions: [...] }
webview → 扩展：
  { t: "send", text, attachments?, steer? }
  { t: "permission", requestId, decision }
  { t: "command", name, args }
  { t: "setModel" | "setMode" | ..., ... }
```

事件归一化（events.ts 的 `normalizeEvent`）在扩展进程做、webview 只消费归一化结果——与 TUI 同构，逻辑层代码直接复用。

### 6.4 安全模型

- webview `enableScripts: true` 但 `localResourceRoots` 严格限定 `out/webview`；CSP 锁死；不 eval runtime 来的任何字符串。
- runtime 事件进 webview 前过一层白名单字段过滤（事件是可信度较高的本地进程输出，但按纵深防御处理）。
- API key / 凭据永远不进 webview（权限请求里若带敏感字段先脱敏）。

### 6.5 构建与打包

- 构建：tsdown / esbuild 打扩展主进程；webview 用同一工具链（Vite 或 esbuild）打 IIFE。
- vsix 打包：`@vscode/vsce package`，vendor/zcode.cjs（约 12 MB）随包分发——与 zcode-cli 发 tgz 的再分发条款处境完全相同，不新增合规风险；发布仍仅走 GitHub Release（团队惯例）。
- runtime 同步：`bun scripts/sync-runtime.ts`（从 zcode-cli 改造）——本地需装 ZCode Desktop 才能提取；CI 用 lock 校验（vendor 与 lock 一致才放行打包）。

### 6.6 版本与发布策略

- 版本号独立于 zcode-cli（本仓 VERSION 文件为唯一权威）；CHANGELOG 独立记录。
- vsix 命名 `zcode-vsce-<version>.vsix`；GitHub Release 挂 vsix 资产，README 安装命令指向 Release 下载（与 zcode-cli 同模式）。
- runtime 版本随上游 ZCode Desktop 走：上游发新版 → zcode-cli 与 zcode-vsce 各自（或协同）重新提取、重新验证锚点、各自发版；lock 文件记录提取源版本保证两边对齐。

## 7. 分阶段实施路线

### M0：协议链路验证（先证明，再动工）——预计 2~3 天

**目标**：一条最小脚本链路跑通「spawn runtime app-server → create session → send → 收流式事件 → 完整拿到 assistant 回复」。

- [ ] `tmp/proto-probe.ts`：长连接 JSON-RPC 客户端骨架（请求-响应 + 通知分发）
- [ ] 摸清参数 schema：`session/create` / `session/send` / `session/subscribe` / `interaction/requestPermission` 的入参出参（字符串分析 runtime + 运行时试探双管齐下）
- [ ] 验证事件流：`session/event` 推送频率与 payload 形态与 TUI 的 `subscribeSessionEvents` 是否同源（能否直接喂 `normalizeEvent`）
- [ ] 验证权限回调：触发一个需要审批的工具，确认 `interaction/requestPermission` 交互闭环
- [ ] 产出：`docs/PROTOCOL.md`（参数 schema 记录）+ 可行性实证结论

**M0 出口判据**：脚本能完整跑一轮「提问 → 流式回复 → 工具调用 → 权限审批 → 结果返回」。若协议有重大缺口（如事件流不可订阅），回到本方案修订第 5 节。

### M1：MVP 扩展（能用的聊天）——预计 1~2 周

**目标**：一个可日常使用的最小扩展：登录 → 聊天 → 工具 → 权限 → 停止。

- [ ] 项目工程化：package.json（扩展清单）、构建链、tsconfig、bun test 骨架
- [ ] RuntimeHost + AppServerConnection（含崩溃重启、resume 恢复）
- [ ] 聊天 webview 面板：流式 Markdown、基础工具卡片、停止按钮
- [ ] 权限弹窗（`interaction/requestPermission` → webview 按钮 → 响应）
- [ ] 登录与配置：复用 model-access / env-config / zai-oauth；`.env` 同步在扩展激活时执行
- [ ] 多 key 容灾代理接入（key-failover 复用）
- [ ] 状态栏：当前模型 / 模式 / token 用量
- [ ] sync-runtime.ts vsce 改造（提取照搬，暂不注入任何桥）
- [ ] 打包出第一个可安装的 vsix（内部验证用）

**M1 出口判据**：用户日常编码问答可用；一个真实任务（读代码 + 改文件 + 跑命令）完整走通。

### M2：类 CC 扩展交互对齐——预计 2~4 周

**目标**：交互表面全面对齐 CC 扩展的核心体验。

- [ ] diff 呈现：Edit / Write 的原生 diff 视图或 webview 内嵌 diff（对齐 CC 的文件变更卡片）
- [ ] 多会话管理：会话列表、恢复、分叉（`session/list` / `resume` / `fork`）
- [ ] 斜杠命令体系 + `@` 文件引用 + `$` skill 补全
- [ ] 模型 / 模式 / 推理深度切换器（对齐 CC 的 picker 交互）
- [ ] 编辑器集成：gutter 变更指示、选中代码引用到对话
- [ ] 图片粘贴附件
- [ ] 上下文用量与压缩入口（`session/compact`）
- [ ] 设置页（provider / 模型 / 偏好，走 `workspace/*` 方法）
- [ ] 用量统计面板（usage.ts / `usage/stats`）
- [ ] MCP / 插件管理面板（plugins/* 已验证）

**M2 出口判据**：日常使用中不再需要打开 TUI 或 Desktop 完成任何高频操作。

### M3：完整对齐与长尾——持续

- [ ] rewind / checkpoint（anchor patch 暴露 `previewFileRewind` / `applyFileRewind` 为 RPC）
- [ ] 后台任务中心（长任务 / 子代理输出查看与干预）
- [ ] 终端集成、快捷键全覆盖、主题适配（浅色 / 深色 / 高对比）
- [ ] Browser Use 插件配套 UI（`interaction/browserList` / `browserExecute`）
- [ ] 国际化（至少中英）、无障碍（screen reader 标签）
- [ ] 上游版本跟进机制固化（锚点校验 + lock 对齐的自动化）

### 里程碑之间的纪律

- 每个里程碑结束记 CHANGELOG、打 tag、发 GitHub Release（M1 起发 vsix）。
- M0 是**证伪点**：协议链路验证不通过则方案回炉，不硬闯 M1。
- 各阶段不追求一次做满，先纵向打通再横向铺满。

## 8. 风险与对策

| 风险 | 等级 | 对策 |
|---|---|---|
| **协议参数 schema 未公开**：方法名已知但参数细节需逆向 | 高（M0 集中化解） | M0 双管齐下：字符串分析 runtime 打包产物 + 运行时试探；产出 PROTOCOL.md 沉淀；参数解析器在 runtime 内都有实现，可分析 |
| **上游版本升级破坏锚点**（若依赖 anchor patch） | 中高 | 能协议就不 patch；patch 必带锚点校验（sync-runtime.ts 现有机制照搬），校验失败即阻断 sync 而不是带病发布 |
| **上游条款变化**（runtime 再分发风险） | 中 | 与 zcode-cli 同处境、不新增风险；README 保留免责与署名；持续关注上游态度 |
| **extension host 环境差异**（Node 版本 / API 可用性） | 中 | 外部 node spawn 已规避 Node 版本问题；扩展主进程只用稳定 API |
| **webview 性能**（长会话高频事件） | 中 | 事件归一化后按块聚合推送（TUI 的 bounded-tool-text / 分块渲染经验可搬）；虚拟列表 |
| **多平台**（Windows 路径 / 回调差异） | 中 | OAuth 回调 macOS-only 是现状（zcode-cli 同款限制），README 明示；路径处理统一走 VSCode API |
| **上游协议演进**（方法增删） | 低中 | lock 固定 runtime 版本；升级走完整 M0 式验证流程 |
| **范围蔓延**（对齐 CC 无止境） | 低 | 里程碑纪律：M2 覆盖高频面即算达成，长尾进 M3 按需排期 |

## 9. 已定决策记录

| # | 决策 | 理由 | 时间 |
|---|---|---|---|
| D1 | 单独建仓 zcode-vsce，与 zcode-cli 平行，同归 Atlas | 产物与工程链路差异大；共享靠复用关系不靠同仓 | 2026-08-26 |
| D2 | 后端零改动：只做 `app-server` 协议客户端 | 「后端功能不变」是立项前提；协议是上游原生支持 | 2026-08-26 |
| D3 | 前端定位「交互完全等价、模型品牌可感知」，不伪造 CC 品牌 | 伪造品牌无意义且有害；用户用 ZCode 就是要 GLM | 2026-08-26 |
| D4 | 外部 node spawn，不依赖 extension host 内置 Node | runtime 要求 Node ≥22.19；沿用 zcode-cli launcher 方案 | 2026-08-26 |
| D5 | vendor 各自提取、lock 对齐，不建共享包 | 避免把 runtime 发布成可安装依赖的再分发合规复杂度 | 2026-08-26 |
| D6 | 事件归一化在扩展进程做（复用 events.ts），webview 只消费归一化结果 | 与 TUI 同构，最大化逻辑层复用；webview 保持薄 | 2026-08-26 |
| D7 | 仅 GitHub Release 分发 vsix，不发 Marketplace | 团队惯例（默认渠道规则）；与 zcode-cli 一致 | 2026-08-26 |
| D8 | M0 先协议验证再动工扩展 | 协议 schema 是最大不确定性，证伪前置避免返工 | 2026-08-26 |

---

*本方案的可行性结论基于 zcode-cli 3.8.1-20 提取的 runtime（对应 ZCode Desktop 3.8.1-x）协议面核实。上游版本变化后，第 4 节清单需重新核实。*
