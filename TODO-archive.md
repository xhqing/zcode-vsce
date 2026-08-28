# TODO 归档

已处理条目（已完成 / 已更新 / 已放弃），保留供回溯。新归档条目加在最上方。

## 2026-08-27

- ✅**已完成** M0 协议链路验证（完成：2026-08-27 16:05）——探针实证 app-server 全链路可用，schema 沉淀至 docs/PROTOCOL.md；`session/requestRuntimePreferences` 必答、事件判别字段 `payload.kind`、sessionId 取 `result.session.sessionId` 三处关键坑已记录。
- ✅**已完成** M1 MVP 扩展：RuntimeHost + Connection + SessionManager + 复用层 + webview 聊天面板 + 权限弹窗 + 状态栏 + 会话树 + vsix 打包安装（完成：2026-08-27 16:05）——期间修复 createSession 漏 subscribe（事件不推送）、事件映射字段错（type→kind）、权限应答链路（optionId 解析）三个问题；端到端完整回合 E2E_OK 实测通过，16 个单元测试全绿。
