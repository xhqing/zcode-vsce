# CHANGELOG

本项目所有值得注意的变更都记录在此文件中。每条记录写清楚两件事：**为什么改**（触发原因 / 要解决的问题）和**改了什么**（具体变更内容）。

## 0.1.6 - 2026-08-30

### 新增

- **composer 输入框下方模型选择器与思考等级选择器**。为什么：用户要求输入框下面要有能选择模型和调节思考等级的功能；0.1.4 声称落地的「模型 / 模式 chip」经 git 历史核实从未真正进入代码（commit 3983521 的 diff 里 composer 只有 `+` `/` 和发送按钮），此前切模型 / 思考档只能走命令面板 QuickPick，交互成本高。改了什么：
  - **webview 侧**（[webview/main.ts](webview/main.ts) + [webview/store.ts](webview/store.ts) + [webview/main.css](webview/main.css)）：composer 底栏右侧新增两个 chip——当前模型短名（modelId 末段，如 `glm-4.7` → `4.7`）与思考档标签（`settings.thoughtLevel.available` 里的 label，低频模型无思考能力时 `enabled: false` 自动隐藏）；点击 chip 在输入框与工具条之间展开内嵌下拉（模型项显示 label + provider · 上下文窗口，当前项高亮带 ✓；思考档项显示 label），点选即切换、再点 chip 或点击外部区域收起。store 新增 `modelRef` / `modelOptions` / `thoughtEnabled` / `thoughtLevel` / `thoughtOptions` 状态；渲染签名纳入 picker 开合与档位变化；结构重建时保留输入框草稿（文字 + 光标位置，`restoreDraft`），picker 开合不清空已输入内容。
  - **消息链路**（[src/controller.ts](src/controller.ts) + [src/ui/chat-panel.ts](src/ui/chat-panel.ts)）：新增 `settingsChanged` PanelMessage——`setModel` / `setThoughtLevel` 完成后宿主只回推新 settings（不再走完整 bootstrap），webview 据此刷新 chip 与下拉，不触碰会话记录；模型数据源为会话 settings 快照里的 `model.available` + `thoughtLevel.available`（bootstrap 时一并下发，无需额外请求）。
  - 切换走既有协议封装 `session/setModel` / `session/setThoughtLevel`（`persistAsWorkspaceLastUsed: false`，仅当前会话生效），命令面板 QuickPick 入口保留不变。

### 变更

- **package 脚本加固：打包前强制重新构建**。为什么：Release v0.1.5 曾把陈旧 `out/` 产物打进 vsix（`npm run package` 只跑 `vsce package`、不先 build；该次事故的排查过程与 Release 产物替换记录见 0.1.5 条目）。改了什么：`package.json` 的 `package` 脚本改为 `npm run build && vsce package --allow-missing-repository`——打包前强制重新构建，从脚本层面杜绝「源码已改、产物未跟」再次发生。

## 0.1.5 - 2026-08-30

### 变更

- **修复 Release v0.1.5 的 vsix 陈旧产物 + package 脚本加固**。为什么：用户发布重装后发现欢迎页吉祥物 Z 仍是橙色——排查确认 git 提交（bd26e22）与源码均正确，但 Release 上传的 vsix 是 14:49 打的旧包（当时 `out/` 里还是品牌橙 CSS），发布时未重新打包；本机安装副本即装自此旧包。深层原因：`npm run package` 只跑 `vsce package`、不先 build，打包的是 `out/` 里现存的陈旧内容，存在「源码已改、产物未跟」的结构性风险。改了什么：
  - 重新 `npm run build` + 打包 0.1.5 vsix（校验包内 `out/webview/main.css` 的 mascot 已是 `--zcode-fg`），`gh release upload --clobber` 替换 Release v0.1.5 产物并回验下载内容正确；
  - `package.json` 的 `package` 脚本改为 `npm run build && vsce package --allow-missing-repository`——打包前强制重新构建，杜绝再发陈旧 `out/`。
- **欢迎页吉祥物 Z 改为黑色**。为什么：用户对照截图指出——聊天面板欢迎页中央的大写 Z（mascot）原为品牌橙色（`--zcode-brand`，浅橙 #d97757），要求换成黑色。改了什么：[webview/main.css](webview/main.css) 的 `.welcome-hero .mascot` 颜色从 `var(--zcode-brand)` 改为 `var(--zcode-fg)`（主题前景色：深色主题下近黑、浅色主题下纯黑，与顶部「ZCode」标题字色一致，随主题自适应而非写死 #000，避免深色主题下黑字融进黑背景）。

### 新增

- **编辑器标签栏右侧新增 Z 按钮（new session 入口）**。为什么：用户对照 Claude Code 扩展截图要求——CC 在编辑器标签栏右侧（editor actions 区、`...` 菜单左侧）有橙色星形按钮可一键开新会话，ZCode 扩展在同样位置也要有一个 Z 按钮，点击即 new session。改了什么：
  - 新增 [assets/title-icon.svg](assets/title-icon.svg)：16×16 单笔大写 Z（`currentColor` 描边，随主题明暗自适应；与活动栏 [assets/sidebar-icon.svg](assets/sidebar-icon.svg) 同形态，笔画按 16px 尺寸减细到 1.6）。为什么用 SVG 文件而非 codicon：命令 `icon` 属性支持相对扩展根的 SVG 路径（官方文档推荐形态，16×16、单色、1px 内边距），而 codicon 集里没有 Z 形图标。
  - `package.json`：`zcode.newSession` 命令的 `icon` 从 `$(add)` 换为该 SVG；新增 `menus.editor/title` 贡献点（`navigation@9` 组、`when: editorIsOpen`）——有图标的命令进 navigation 组即渲染为编辑器标签栏右侧的实体按钮（非 navigation 组只能进 `...` 折叠菜单）；`@9` 排序值把它放到该区域扩展按钮的末位、紧邻原生 split / `...` 按钮（CC 的星形按钮也在这个位置）。
  - 点击行为复用既有 `zcode.newSession` 命令链路（[src/extension.ts](src/extension.ts)）：新建会话 → 编辑器区新开「ZCode」标签页 → 侧栏列表刷新，与侧栏「+ New session」按钮、命令面板完全一致，无新增逻辑分支。

### 变更

- **项目 logo 重设计为简约风大写 Z**。为什么：用户认为原 logo（赛博朋克风：深底网格 + 霓虹辉光 Z + 品红重影 + glitch 切片 + "ZCodeVSCE_" 文字）元素堆砌、不好看，要求换成简约风的大写字母 Z。改了什么：
  - [assets/logo.svg](assets/logo.svg) 整体重写：从 640×200 赛博朋克横幅改为 512×512 简约方形图标——圆角方形（`rx=112`）深色对角渐变底（#0C1024 → #1C1238，延续原深色调）+ 居中青色垂直渐变（#67E8F9 → #22D3EE，延续原 zgrad 品牌色）粗笔画（`stroke-width=96`）圆头大写 Z；去掉全部装饰元素（网格、辉光、重影、glitch、文字），几何与 [assets/sidebar-icon.svg](assets/sidebar-icon.svg)（侧栏单色 Z，本就简约、未动）形态呼应。
  - [assets/logo.png](assets/logo.png)（扩展图标 `package.json` `"icon"` + README 头图）从新 SVG 用 `rsvg-convert` 重新导出 256×256、保留圆角外透明（与旧 png 工艺一致）。渲染工具备注：`qlmanage` 渲染 SVG 会把透明区铺白且命中缩略图缓存（首次导出即因此作废重渲），不可用于本任务；`rsvg-convert` 渲染正确。
  - 版本号同步 bump 至 0.1.5（0.1.4 已发布，本变更进新条目）：[VERSION](VERSION)、`package.json` `version`、README.md / README_cn.md 的 Version 徽章。

## 0.1.4 - 2026-08-27

### 新增

- **Thinking 实时 token 计数 + 会话字号设置（侧栏设置面板）**。为什么：用户要求 ①会话输出的 Thinking 块标题后带 token 实时计数、超 999 用千位分隔（如 `1,000`）；②输出内容与输入框文字字号可调；③左侧栏 New session 按钮上方右侧加小设置图标，点开可做一系列设置（字号放这里）。改了什么：
  - **Thinking token 计数**（新文件 [webview/tokens.ts](webview/tokens.ts) + `webview/main.ts`）：reasoning 块 summary 显示 `Thinking · N`，流式增量更新时同步刷新计数，数字用等宽字形（`tabular-nums`）防抖动。计数为**客户端估算**——协议在流式阶段不提供逐 delta 的 token 计数（仅 `turn_complete` 带总 `tokenCount`，见 docs/PROTOCOL.md），估算口径：CJK 字符每字 1 token、其余文本每 4 字符 1 token；tooltip 标注 "Estimated token count"。千位分隔用 `toLocaleString("en-US")`（999 → `999`、1000 → `1,000`）。计数刷新走 0.1.4 已修复的按稳定块 id 增量更新路径（在其上追加 summary 内 span 刷新，不动原 innerHTML 更新逻辑，无回归）。
  - **字号设置链路**（`src/controller.ts` / `src/ui/chat-panel.ts` / `src/ui/sidebar-view.ts` / `webview/main.ts` / `main.css`）：新增 `UiSettings`（`globalState` 键 `zcode.uiSettings` 持久化、跨窗口共享），`controller.setFontSize` 做 10–24px clamp 后经新增 `uiSettings` PanelMessage 广播到所有已打开聊天 tab（复用 ChatTab 广播路由）；各 webview `ready` 时宿主回发当前值（webview 脚本加载完成前的 postMessage 不保证送达，故不走 spawn 后直发）。前端以 CSS 变量 `--zcode-font-size`（默认 13px）作用于 `.transcript`（输出内容）与 `#composer-input`（输入框），Thinking 块 / 工具卡 / 行内代码按 `-1px` 相对缩放保持层级对比。
  - **侧栏设置面板**（`webview/sidebar.ts` + `sidebar.css`）：New session 按钮上方右侧新增小齿轮图标（内联 SVG、currentColor 随主题），点击展开 Settings 卡片——设计为可扩展设置容器，首项「Font size (chat & input)」−/+ 步进器（1px 步进、范围 10–24px、到边界自动禁用按钮），调整即时生效于所有聊天 tab 并持久化。
  - **单测**（新文件 `test/tokens.test.ts`）：token 估算（拉丁 / CJK / 混排 / 空串）与千位分隔（999 / 1,000 / 12,345 / 1,234,567）8 个用例。

### 变更

- **侧栏设置按钮移到视图标题栏（原生 view/title 齿轮）**。为什么：用户对照截图指出——设置按钮原来放在 webview 内部「New session」按钮上方（自绘 SVG，视觉上像太阳图标，位置也偏），要求移到「ZCODE」视图标题行右端（原生标题栏区域），并明确用齿轮图标。改了什么：① `package.json` 新增 `zcode.openSettings` 命令（codicon `$(gear)` 原生齿轮）并经 `view/title` 菜单贡献挂在 `zcode.sessions` 视图标题栏 navigation 组——按钮随 VSCode 原生标题栏渲染，位置、悬停、主题跟随系统；② `src/extension.ts` 注册该命令 → `SidebarView.toggleSettings()` → webview `toggleSettings` 消息翻转设置卡片展开状态；③ `webview/sidebar.ts` 移除 webview 内自绘齿轮按钮与 `gearSvg`（点击外区域关闭设置卡片的逻辑保留、改为 webview 本地处理）；④ `webview/sidebar.css` 删除不再使用的 `.sidebar-top` / `.icon-btn` 样式。设置面板本体（字号步进器）不变，仅入口位置与图标更换。
- **聊天面板与侧边栏交互对齐 CC VSCode 扩展（用户对照 CC 截图逐项提出）**。为什么：用户要求把本项目前端做成与 CC 扩展一致的两块交互——①点 New session 后的会话页（欢迎页 + 底部 composer 输入框），②活动栏侧边栏（「+ New session」大按钮 + 会话搜索框 + 会话列表行内操作）。改了什么：
  - **会话页欢迎视图**（`webview/main.ts` `welcomeView` + `main.css`）：空会话时不再显示一行灰字，改为顶部「Z ZCode」品牌字标、中部像素风吉祥物（内联 SVG，主题色）+ 引导语「Create an AGENTS.md file with instructions ZCode reads every single time.」（CC 的 CLAUDE.md 引导语做了等价改写——runtime 实际读取 AGENTS.md，从 `vendor/zcode.cjs` 字符串统计核实），底部即 composer，与 CC 布局一致；移除旧顶部 header 条（模型 / 模式信息改由 composer chip 与状态栏承载）。
  - **CC 式 composer**：从「裸 textarea + Send 按钮」改为单圆角容器内嵌输入区 + 底部工具条——左侧 `+`（附件：现接 QuickPick 选工作区文件插入 `@path` 引用，真实多模态附件后续再补）与 `/`（斜杠命令：向输入框光标处插入 `/`）；右侧模型 chip（`Z` + 当前模型短名，点击唤起模型选择）、`⚡ 模式` chip（build/edit/yolo/plan 映射为 Ask/Edit/Full Access/Plan/Plan，点击唤起模式选择）、圆角发送按钮（turn 运行中变红色 ■ 停止按钮）；输入框自动随内容增高（上限 160px）。
  - **侧边栏从原生 TreeView 换成 webview view**（`src/ui/sidebar-view.ts` + `webview/sidebar.ts` / `sidebar.css`，对齐 CC 侧栏样式）：顶部大号「+ New session」按钮、搜索框（前端实时过滤会话标题）、会话列表每行显示标题 + 相对时间（`13h` / `1d`）+ 悬停浮现「重命名 ✎ / 删除 🗑」行内操作 + turn 运行中的会话带蓝色「● Running」徽标。
  - **协议边界结论（重命名 / 删除）**：runtime 的 stdio `app-server` 方法面（`rr={...}` 完整 map 已提取核实）**没有** rename / delete RPC——`renameSession` / `deleteSession` 只存在于 runtime 内部 v4 网关层（host capability），stdio 客户端不可达。按 PLAN.md「能用协议就用协议、缺口纯前端替代」原则：**重命名**为扩展侧显示名覆盖（workspaceState 持久化 `zcode.sessionNames`，不改 runtime 存储）；**删除**走协议内 `session/close` + 扩展侧 hidden 记录，确认弹窗如实说明「历史保留在磁盘（~/.zcode）但不再列出」。
  - **Running 徽标数据源**：`turn_started` / `turn_complete` / `turn_error` 事件驱动 `SidebarView.setRunning` + 列表刷新（extension.ts 事件监听扩展）。
  - 构建链同步：`scripts/build.mjs` webview 入口改双入口（main + sidebar），新增 sidebar.css 拷贝；`package.json` 侧栏视图类型 tree→webview、移除失效的 view/title 与 view/item/context 菜单（行内操作已进 webview）；删除无引用的 `src/ui/sessions-tree.ts`。

### 修复

- **CHANGELOG 版本条目排序错误（0.1.0 立项条目错置顶部）**。为什么：0.1.0 条目被排在文件最顶部，导致「最新一条版本标题」读出来是 0.1.0，与 VERSION（0.1.4）不一致，也会误导读者以为项目最新版是 0.1.0。改了什么：把 0.1.0 条目移到文件末尾（0.1.1 之后），全文件恢复时间倒序（0.1.4 → 0.1.3 → 0.1.2 → 0.1.1 → 0.1.0），顶部最新版本标题与 VERSION 对齐；条目内容一字未改。

### 变更

- **LICENSE 补上游版权行与 runtime 限定句（修复 MIT 合规缺陷）**（LICENSE.md、README.md、README_cn.md）。为什么：本项目虽非 fork，但复用了源自 zcode-cli（fork 自 kingsword09/zcode-cli，上游原项目名 zcode-app-cli）的大量 MIT 纯逻辑代码（`src/reuse/` 的配置、多 key 容灾、事件归一化等），MIT 许可证要求再分发时保留上游版权声明，本项目此前只有「All Contributors」一行；同时 LICENSE 缺少上游原有的 runtime 限定句（「本许可证只覆盖仓库自身封装代码，不授予 ZCode 及提取出的 runtime 的任何权利」）——这句是防止任何人主张「仓库 MIT 所以 runtime 也随之开源」的保护性声明，必须补回。改了什么：LICENSE.md 版权行改为两行并存（上游「zcode-app-cli contributors」在前、「All Contributors」在后追加），末尾补 runtime 限定句；两版 README 的许可与署名段同步补上游版权行。

### 修复

- **流式输出停在第一个词（Thinking 只显示「The」，正文不出现）**。为什么：0.1.3 只修了快照覆盖的一半，渲染循环本身还有致命缺陷——① 渲染签名只含 transcript **条目数**（不含每条的块数），text 块首次出现在同一条目内时签名不变，不触发全量渲染；② 增量更新函数 `updateStreamingText` 的选择器 `.block.text:last-of-type` **永远命中不了 reasoning 块**（其 class 是 `block reasoning`），且块没有稳定 id，只能靠脆弱的 CSS 选择器定位。两者叠加：每个块只有触发全量渲染的那一个 delta 能上屏，其余全部丢失。改了什么：重写 webview 渲染循环——① 签名加入每条目的块数列表（块增删必触发结构重建）；② 每个块渲染时带稳定 id（`b<entryIdx>-<blockIdx>`），增量更新改为按 id `getElementById` 定位、直接重写 innerHTML，**覆盖 text / reasoning / tool 卡片三类**（工具卡片的状态图标、标题、输出也增量刷新），不再依赖 CSS 选择器。已用单测证明旧选择器对 reasoning 块恒为 null（根因实证），端到端模拟（真实事件流喂入 store）验证完整 transcript 生成。

### 修复

- **点击 New session 不再新开窗口（已有窗口时被复用）**。为什么：`ChatTab` 是单 panel 设计——只持有一个 `WebviewPanel`，`open()` 发现已有窗口时仅 `reveal()` 并把旧窗口重绑到新 session，导致「不管开几个窗口、点 New session 永远只有一个窗口」，与 CC 扩展「每次 New session 新开一个 tab」的行为不符。改了什么：重构 `src/ui/chat-panel.ts` 为多 panel 架构——① 内部改为 `Set<ChatEntry>`（每个 tab 绑定自己的 sessionId），新增 `openNew()`（无条件创建新窗口）与重定义的 `open()`（优先聚焦绑定该 session 的已有 tab，没有才新开）；② controller 广播消息按 session 路由：`event` 与 `permission`（协议带 sessionId）精确投递到绑定该 session 的 tab（permission 找不到绑定 tab 时广播兜底防悬置），`userInput`（协议不带 sessionId）/ `runtimeExit` / `notice` 广播所有 tab；③ webview 回程消息按来源 tab 处理（`ready` 时无 session 则就地建 session 绑定该 tab，`newSession` 一律新开 tab，`insert` 回投来源 tab）；④ tab 获得焦点时同步 `controller.setActiveSession`，多窗口下状态栏与命令面板（setModel 等）作用于当前聚焦 tab 的 session；⑤ 最后一个 tab 关闭后才启动 idle 关停倒计时（原来关窗口不触发）。`src/extension.ts` 的 `zcode.newSession` 命令改用 `openNew()`；`openChat` / `resumeSession` / `forkSession` 保持 `open()`（聚焦已有 tab 或新开）。

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

## 0.1.0 - 2026-08-26

### 新增

- **项目立项：新建 zcode-vsce——ZCode 的非官方 VSCode 扩展客户端**。为什么立项：zcode-cli 已验证 ZCode runtime 原生自带 `app-server` stdio JSON-RPC 协议（ZCode Desktop 图形界面即基于此协议），可以在此基础上做一个 VSCode 扩展形态的客户端——后端继续复用 zcode-cli 提取的官方 runtime（后端功能不变），前端用 webview 重写为类 Claude Code VSCode 扩展的交互形态。为什么单独建仓库而不是塞进 zcode-cli：两个项目的发布产物（tgz vs vsix）、工程链路（TUI vs VSCode 扩展）完全不同，独立仓库避免互相拖累；zcode-vsce 与 zcode-cli 平行，同归 Atlas（FullStackEngineerAgent）负责。
- **`PLAN.md` 项目根实施方案**：完整记录改造可行性结论（后端复用、前端等价的边界）、总体架构、与 zcode-cli 的复用与分工、分阶段实施路线（M0 链路验证 → M1 MVP → M2 对齐 CC 扩展交互 → M3 完整对齐）、风险与决策记录。为什么放项目根：这是项目的顶层设计文档，所有后续开发以此为准。
- **项目标配文件**：`VERSION`（0.1.0）、`CHANGELOG.md`、`LICENSE.md`（MIT，All Contributors）、`.gitignore`（node_modules / out / dist / vendor / vsix / tgz / tmp / .env 系列 / settings.local.json 等）。
- **`.claude/` 脚手架**：按 FullStackEngineerAgent（Atlas）超集规则配置——`settings.json` + `settings.local.json`（与权威源逐字节一致）、`CLAUDE.md`（项目指南 + Atlas CLAUDE.md 全文随附）。
- **README 与品牌**：中英双语 `README.md` / `README_cn.md`（居中 logo + License / Version / Type 三枚标准徽章 + 团队 Visitors 徽章、与 zcode-cli 的关系对照表）；`assets/logo.svg` 沿用 ZCode 家族赛博朋克视觉（同款霓虹 Z + glitch 切片，副标题区分 VSCode Extension 定位）；`AGENTS.md` 软链接指向 `.claude/CLAUDE.md`（与 zcode-cli 同款，多 agent 工具入口共享单一源）。
