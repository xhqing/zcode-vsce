# TODO 归档

已处理条目（已完成 / 已更新 / 已放弃），保留供回溯。新归档条目加在最上方。

## 2026-08-29

- ✅**已完成** CC 扩展交互对齐（会话页欢迎视图 + composer 工具条 + 侧边栏 webview 化）（完成：2026-08-29 11:19）——用户对照 CC 截图逐项提出，原 T2 / T3 中「模型 / 模式切换器迁入 webview（composer chip 承载）」部分随之落地；T2 / T3 剩余项更新后保留在 TODO.md。
- ✅**已更新** T2 M2 交互对齐第一批（更新：2026-08-29 11:19）——「`@` 文件引用补全」的输入侧最小实现已随 composer `+` 按钮落地（QuickPick 选文件插入 `@path`）；diff 预览与图片粘贴附件仍待做，条目更新后保留。
- ✅**已更新** T3 M2 交互对齐第二批（更新：2026-08-29 11:19）——「模型 / 模式切换器迁入 webview」已由 composer chip 落地（点击唤起原 QuickPick）；斜杠命令补全与上下文压缩入口仍待做，条目更新后保留。

## 2026-08-27

- ✅**已完成** M0 协议链路验证（完成：2026-08-27 16:05）——探针实证 app-server 全链路可用，schema 沉淀至 docs/PROTOCOL.md；`session/requestRuntimePreferences` 必答、事件判别字段 `payload.kind`、sessionId 取 `result.session.sessionId` 三处关键坑已记录。
- ✅**已完成** M1 MVP 扩展：RuntimeHost + Connection + SessionManager + 复用层 + webview 聊天面板 + 权限弹窗 + 状态栏 + 会话树 + vsix 打包安装（完成：2026-08-27 16:05）——期间修复 createSession 漏 subscribe（事件不推送）、事件映射字段错（type→kind）、权限应答链路（optionId 解析）三个问题；端到端完整回合 E2E_OK 实测通过，16 个单元测试全绿。
