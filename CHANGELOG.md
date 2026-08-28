# CHANGELOG

本项目所有值得注意的变更都记录在此文件中。每条记录写清楚两件事：**为什么改**（触发原因 / 要解决的问题）和**改了什么**（具体变更内容）。

## 0.1.0 - 2026-08-26

### 新增

- **项目立项：新建 zcode-vsce——ZCode 的非官方 VSCode 扩展客户端**。为什么立项：zcode-cli 已验证 ZCode runtime 原生自带 `app-server` stdio JSON-RPC 协议（ZCode Desktop 图形界面即基于此协议），可以在此基础上做一个 VSCode 扩展形态的客户端——后端继续复用 zcode-cli 提取的官方 runtime（后端功能不变），前端用 webview 重写为类 Claude Code VSCode 扩展的交互形态。为什么单独建仓库而不是塞进 zcode-cli：两个项目的发布产物（tgz vs vsix）、工程链路（TUI vs VSCode 扩展）完全不同，独立仓库避免互相拖累；zcode-vsce 与 zcode-cli 平行，同归 Atlas（FullStackEngineerAgent）负责。
- **`PLAN.md` 项目根实施方案**：完整记录改造可行性结论（后端复用、前端等价的边界）、总体架构、与 zcode-cli 的复用与分工、分阶段实施路线（M0 链路验证 → M1 MVP → M2 对齐 CC 扩展交互 → M3 完整对齐）、风险与决策记录。为什么放项目根：这是项目的顶层设计文档，所有后续开发以此为准。
- **项目标配文件**：`VERSION`（0.1.0）、`CHANGELOG.md`、`LICENSE.md`（MIT，All Contributors）、`.gitignore`（node_modules / out / dist / vendor / vsix / tgz / tmp / .env 系列 / settings.local.json 等）。
- **`.claude/` 脚手架**：按 FullStackEngineerAgent（Atlas）超集规则配置——`settings.json` + `settings.local.json`（与权威源逐字节一致）、`CLAUDE.md`（项目指南 + Atlas CLAUDE.md 全文随附）。
- **README 与品牌**：中英双语 `README.md` / `README_cn.md`（居中 logo + License / Version / Type 三枚标准徽章 + 团队 Visitors 徽章、与 zcode-cli 的关系对照表）；`assets/logo.svg` 沿用 ZCode 家族赛博朋克视觉（同款霓虹 Z + glitch 切片，副标题区分 VSCode Extension 定位）；`AGENTS.md` 软链接指向 `.claude/CLAUDE.md`（与 zcode-cli 同款，多 agent 工具入口共享单一源）。

## 0.1.4 - 2026-08-27

### 变更

- **LICENSE 补上游版权行与 runtime 限定句（修复 MIT 合规缺陷）**（LICENSE.md、README.md、README_cn.md）。为什么：本项目虽非 fork，但复用了源自 zcode-cli（fork 自 kingsword09/zcode-cli，上游原项目名 zcode-app-cli）的大量 MIT 纯逻辑代码（`src/reuse/` 的配置、多 key 容灾、事件归一化等），MIT 许可证要求再分发时保留上游版权声明，本项目此前只有「All Contributors」一行；同时 LICENSE 缺少上游原有的 runtime 限定句（「本许可证只覆盖仓库自身封装代码，不授予 ZCode 及提取出的 runtime 的任何权利」）——这句是防止任何人主张「仓库 MIT 所以 runtime 也随之开源」的保护性声明，必须补回。改了什么：LICENSE.md 版权行改为两行并存（上游「zcode-app-cli contributors」在前、「All Contributors」在后追加），末尾补 runtime 限定句；两版 README 的许可与署名段同步补上游版权行。

### 修复

- **流式输出停在第一个词（Thinking 只显示「The」，正文不出现）**。为什么：0.1.3 只修了快照覆盖的一半，渲染循环本身还有致命缺陷——① 渲染签名只含 transcript **条目数**（不含每条的块数），text 块首次出现在同一条目内时签名不变，不触发全量渲染；② 增量更新函数 `updateStreamingText` 的选择器 `.block.text:last-of-type` **永远命中不了 reasoning 块**（其 class 是 `block reasoning`），且块没有稳定 id，只能靠脆弱的 CSS 选择器定位。两者叠加：每个块只有触发全量渲染的那一个 delta 能上屏，其余全部丢失。改了什么：重写 webview 渲染循环——① 签名加入每条目的块数列表（块增删必触发结构重建）；② 每个块渲染时带稳定 id（`b<entryIdx>-<blockIdx>`），增量更新改为按 id `getElementById` 定位、直接重写 innerHTML，**覆盖 text / reasoning / tool 卡片三类**（工具卡片的状态图标、标题、输出也增量刷新），不再依赖 CSS 选择器。已用单测证明旧选择器对 reasoning 块恒为 null（根因实证），端到端模拟（真实事件流喂入 store）验证完整 transcript 生成。

## 0.1.3 - 2026-08-27

### 修复

- **发送消息后助手输出中断 + 红色报错「Invalid params — model: Invalid input: expected object, received undefined」**。为什么：两个叠加问题。① webview 头部的模型按钮（⌘）发出 `{t:"setModel"}` 时没带 model 对象，ChatTab 原样把 `undefined` 传给 `session/setModel`，runtime 的 Zod 校验直接拒绝并作为错误块渲染到聊天里（截图实证该报错出现两次）；② 每次操作后的 `sendBootstrap` 无条件用 `session/messages` 快照**整段替换** webview 已积累的 transcript，turn 进行中推送的流式增量（如 Thinking 块刚输出的「The」）被快照覆盖掉，看起来就是「输出中断」。改了什么：① `setModel` 消息无 model 载荷时不再调协议，转而打开命令面板的模型选择器（QuickPick）；② webview 收到 bootstrap 时只在**会话切换**时重建 transcript，且 `running` 状态中不用快照覆盖——流式输出全程保留，turn 结束后才会对齐服务端权威消息列表。裸协议复现脚本实证模型回复与工具调用流完全正常，问题均在扩展侧表现层。

## 0.1.2 - 2026-08-27

### 变更

- **布局对齐 CC 扩展：聊天窗口从侧栏视图改为编辑器区标签页**。为什么：用户实测反馈「会话窗口不应该在左边栏，应该在右侧 / 中间栏，和 CC 一致」——聊天是主工作面，挤在侧栏窄列里既不像 CC 也放不下代码块。改了什么：`src/ui/chat-panel.ts`（新）以 `WebviewPanel` 在编辑器区开「ZCode」标签页承载会话（首次打开自动建会话，CC 同款行为）；侧栏（`sessions-tree.ts`）收敛为纯启动器——顶部「New Session」入口 + 可恢复的历史会话列表，点击即在编辑器区打开 / 切换对应会话；`package.json` views 只保留 Sessions 树视图；删除旧的侧栏 Chat 视图（`src/ui/panel.ts` 移除）。
- **全部图标改为简单大写 Z**。为什么：用户裁定「每一个图标都直接用大写 Z，不要太复杂」。改了什么：活动栏图标 [assets/sidebar-icon.svg](assets/sidebar-icon.svg) 改为单笔描边 Z；状态栏前缀由 `$(sparkle)` 改为纯文本 `Z`；会话列表项图标统一为主题 `symbol-constant`（显示为类 Z 记号）。
- **会话切换命令统一驱动编辑器标签页**：`zcode.newSession` / `resumeSession` / `forkSession` 命令完成后自动打开对应会话标签页并刷新侧栏列表；`setModel` / `setMode` / `setThoughtLevel` 变更后向聊天标签页推送新快照。

### 修复

- **「+ 新建会话」点击无反应（`Session is not active`）**。为什么：日志实证每次点击都报 `JsonRpcError: Session is not active`（错误码 -32004）——create 成功后紧接的 `session/subscribe` 被 runtime 拒绝（会话驻留池尚未完成驻留），异常抛出但无任何 UI 反馈，用户侧表现为「点了没反应」。改了什么：`SessionManager` 对 -32004 增加指数退避重试（最多 5 次，覆盖 create/resume 后的 subscribe 以及 send / setModel / setMode / setThoughtLevel / messages / usage / session/read 全部会话态调用）；`ChatTab.onMessage` 所有异常以 notice 消息推送到 webview 展示，不再静默吞掉。

## 0.1.1 - 2026-08-27

### 新增

- **M0 协议链路验证完成 + `docs/PROTOCOL.md`**。为什么：PLAN.md 把 M0 定为证伪点——协议 schema 是最大不确定性，须先证明再动工扩展。改了什么：以探针脚本（`tmp/proto-probe.ts`）对官方 runtime 实测，跑通「spawn app-server → create → subscribe → send → 收 `session/event` 流 → stop → list」全链路；关键发现沉淀进 PROTOCOL.md：① 服务端会在 create 前下发 `session/requestRuntimePreferences` 请求，应答 schema 是 strict 的（`nativeSearchEnhancementsEnabled` 必填布尔），漏答或超时（15 s）会直接导致 create 失败；② `session/event` 的权威判别字段是 `payload.kind`（`text_delta` / `reasoning_delta` / `turn_complete` / `tool_call_*` / `model_request_*` 等，全集已在文档记录）；③ `session/create` 返回的 sessionId 在 `result.session.sessionId` 不在顶层；④ 权限应答格式是「把所选 option 的 response 原样作为 RPC result 返回」。完整模型回合（提问 → 流式回复 → 完成）端到端实测通过。
- **M1 MVP 扩展完整实现**。为什么：PLAN.md M1 里程碑要求「能用的聊天：登录 → 聊天 → 工具 → 权限 → 停止」。改了什么：
  - `src/runtime/protocol.ts`：协议类型定义（消息 / 事件 / 权限 / 会话快照）；
  - `src/runtime/connection.ts`：行分隔 JSON-RPC 双工客户端（请求-响应 id 关联、服务端请求应答、通知分发、64 MB 缓冲上限、超时与关闭清理）；
  - `src/runtime/host.ts`：RuntimeHost——外部 node spawn（`zcode.nodeExecutable` 配置 → `ZCODE_NODE` 环境变量 → PATH，规避 extension host 内置 Node 版本不受控的问题）、SIGTERM→SIGKILL 优雅退出、stderr 落 `~/.zcode/vsce/runtime.log`（2 MB 轮转）；
  - `src/runtime/sessions.ts`：SessionManager——create/resume 自动 subscribe（含 afterSeq 断线补齐）、send/stop/compact/fork/close/list/setModel/setMode/setThoughtLevel/usage 全封装、`requestRuntimePreferences` 自动应答；
  - `src/reuse/`：从 zcode-cli / zcode-tui 拷贝的纯逻辑复用层（`events.ts` 事件归一化、`env-config.ts` .env→config.json 同步、`key-failover.ts` 多 key 回环容灾代理、`model-access.ts` 用户配置读写、`types.ts` 值守卫）；
  - `src/controller.ts`：扩展宿主中枢——runtime 生命周期（崩溃自动指数退避重启）、`.env` 同步 + failover 代理引导、事件路由到 webview、权限 / 用户输入请求的挂起与应答、空闲延迟关停（`zcode.idleShutdownMs`，默认 5 分钟）；
  - `src/ui/panel.ts` 聊天 webview 视图、`src/ui/sessions-tree.ts` 会话树视图（resume / fork 右键菜单）、`src/ui/statusbar.ts` 状态栏（模型 / 模式 / 思考档位）；
  - `src/extension.ts` 激活入口：懒激活、9 个命令（openChat / newSession / stop / setModel / setMode / setThoughtLevel / resumeSession / forkSession / compact）；
  - `webview/` 前端：`store.ts` 事件投影（按实测 `payload.kind` 映射：流式文本 / 思考块 / 工具卡片生命周期 / 错误）、`main.ts` 聊天 UI（流式 Markdown 渲染、工具卡片折叠展开、权限弹窗、用户输入表单、composer）、`markdown.ts` marked + 白名单消毒、`main.css` VSCode 主题变量适配；
  - `scripts/build.mjs` esbuild 构建链（扩展宿主 ESM bundle + webview IIFE）、`scripts/sync-runtime.ts` runtime 提取脚本（从 zcode-cli 改造：提取照搬、去除全部 TUI bridge 注入——扩展纯走协议）；
  - `.vscodeignore`（vendor 随 vsix 分发但不进 git）、`assets/sidebar-icon.svg` 活动栏图标、`assets/logo.png`（vsce 不接受 SVG 图标，由 logo.svg 转换）。
- **单元测试 `test/`（bun test，16 个用例全绿）**。为什么：协议客户端与事件投影是扩展正确性的地基，必须有回归保障。改了什么：`connection.test.ts` 覆盖请求-响应、错误信封、通知分发、服务端请求应答、分块输入、非协议输出容错、close 清理；`store.test.ts` 覆盖流式增量合并、思考 / 文本分块、工具卡片生命周期、turn_complete / turn_error、复用层 normalizeEvent 与 restoredMessages。
- **可安装 vsix 打包验证**。为什么：M1 出口判据要求能产出可安装产物。改了什么：`zcode-vsce-0.1.0.vsix`（242 文件 / 5 MB，含 vendor runtime）打包成功并安装进本机 VSCode 验证布局（out / vendor / assets 齐全，runtime `--version` 可执行）。

### 变更

- **`webview/store.ts` 事件映射按实测修正**。为什么：初版按 `payload.type` 判别事件，实测权威字段是 `payload.kind`（`text_delta` 等），且 text / reasoning 增量带 `assistantMessageId` 而非 `messageId`；不修正则流式输出完全不渲染。改了什么：`applyEvent` 全面改为按 `kind` 分派，工具事件族（scheduled/started/progress/result/error）单独建模，turn_complete 记录 tokenCount。
- **`createSession` / `resumeSession` 自动订阅**。为什么：冒烟测试发现只 create 不 subscribe 时事件流不推送（runtime 不会隐式订阅），webview 收不到任何流式更新。改了什么：两个方法末尾统一调 `session/subscribe`，resume 场景带 `afterSeq` 补齐错过的回放事件。
- **权限应答链路改为按 optionId 解析**。为什么：webview 只知道用户点了哪个按钮（optionId），完整 response（含 permissionUpdates）留在宿主侧，不应让 webview 接触协议细节。改了什么：webview 发 `{t:"permission", requestId, optionId}`，controller 按 optionId 从挂起请求的 options 里查回完整 response 再应答。

### 修复

- **活动栏 ZCode 入口不显示（打包缺陷）**。为什么：`.vscodeignore` 误把 `assets/sidebar-icon.svg` 排除出 vsix——活动栏图标（viewsContainers.icon）按 VSCode 规定**必须**是 SVG，文件缺失导致整个侧边栏容器不渲染、用户看不到 Chat 面板入口；最初排除它是沿袭「扩展主图标不能用 SVG」的规则，但那条限制只针对 `package.json` 的 `icon` 字段，不适用于 viewsContainers 图标。改了什么：`.vscodeignore` 移除该排除项，重新打包（243 文件）并重装，`assets/sidebar-icon.svg` 已随包分发，活动栏入口恢复。
- **（开发期自纠，非用户可见）冒烟测试 fake vscode 模块的 `Disposable` 写错**：初版 fake 的 `Disposable` 构造函数立即执行清理回调，导致刚注册的 panel message listener 被立刻反注册、事件计数恒为 0，一度误导排查方向；修正后扩展三层（connection → manager → controller → listener）事件流全部打通（实测 11~13 条事件完整到达）。
