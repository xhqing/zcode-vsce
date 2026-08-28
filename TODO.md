# TODO

活跃待办（只放未完成条目；已完成 / 已更新 / 已放弃的条目移入 `TODO-archive.md`）。

## 🟢 绿色紧急度

### 代码 / 机制

- [ ] **T1** 在 VSCode 里人工实测扩展：打开 ZCode 活动栏 → Chat 面板 → 跑一轮真实对话（含一次需要权限审批的工具调用），确认流式渲染、权限弹窗、停止按钮、状态栏的实际观感；发现的问题按红色 / 橙色紧急度补录（记录：2026-08-27 16:05）
- [ ] **T2** M2 交互对齐第一批：Edit / Write 工具的 diff 预览（tool_call_result payload 里的 diff 数据 → webview 内嵌 diff 视图）、`@` 文件引用补全（workspace 文件枚举 + 补全 UI）、图片粘贴附件（session/send attachments，协议已验证 data: URL 形态）（记录：2026-08-27 16:05）
- [ ] **T3** M2 交互对齐第二批：斜杠命令补全（快照里的 slashCommands 数据源已就位）、模型 / 模式 / 思考档位切换器迁入 webview 内（对齐 CC 的 picker 交互，替代目前只走命令面板的入口）、上下文用量与压缩入口（session/compact 已封装）（记录：2026-08-27 16:05）
- [ ] **T4** 会话列表树视图的实测与打磨：resume 后 webview 恢复历史消息的完整性（session/messages 数据源）、fork 后新会话跳转（记录：2026-08-27 16:05）
- [ ] **T5** 打包脚本收尾：`npm run package` 前 CI 用 lock 校验 vendor（vendor 与 zcode-runtime.lock.json 一致才放行打包，PLAN.md 6.5 节要求）（记录：2026-08-27 16:05）
