# TODO

活跃待办（只放未完成条目；已完成 / 已更新 / 已放弃的条目移入 `TODO-archive.md`）。

## 🟢 绿色紧急度

### 代码 / 机制

- [ ] **T1** 在 VSCode 里人工实测扩展：打开 ZCode 活动栏 → Chat 面板 → 跑一轮真实对话（含一次需要权限审批的工具调用），确认流式渲染、权限弹窗、停止按钮、状态栏的实际观感；发现的问题按红色 / 橙色紧急度补录（记录：2026-08-27 16:05）
- [ ] **T2** M2 交互对齐第一批（2026-08-29 更新）：Edit / Write 工具的 diff 预览（tool_call_result payload 里的 diff 数据 → webview 内嵌 diff 视图）、`@` 文件引用补全升级（输入侧最小实现已落地——composer `+` QuickPick 插入 `@path`；剩补全下拉 UI）、图片粘贴附件（session/send attachments，协议已验证 data: URL 形态）（记录：2026-08-27 16:05）
- [ ] **T3** M2 交互对齐第二批（2026-08-30 更新）：斜杠命令补全（快照里的 slashCommands 数据源已就位；composer `/` 按钮插入光标已落地，剩补全下拉）、上下文用量与压缩入口（session/compact 已封装）；模型 / 思考档切换器 2026-08-30 已由 composer 下拉真正落地（此前 CHANGELOG 声称的 chip 从未进代码），权限模式（build/edit/yolo/plan）切换器仍待补（记录：2026-08-27 16:05）
- [ ] **T6** composer `+` 附件升级：当前是 QuickPick 选文件插入 `@path` 引用的最小实现，升级为真正的多模态附件（粘贴图片 → session/send attachments 的 data: URL 形态，协议已验证）+ 文件附件上翻（记录：2026-08-29 11:19）
- [ ] **T7** 侧边栏删除语义对齐 Desktop：当前「删除」= `session/close` + 扩展侧 hidden 记录（协议面无 delete RPC，历史留磁盘）；后续若上游把 v4 网关的 deleteSession 暴露进 app-server 方法面，改为真删除（记录：2026-08-29 11:19）
- [ ] **T8** 欢迎页引导语实测：AGENTS.md 指引是否被 runtime 实际消费待人工验证（字符串统计支持但未跑通链路）；验证不过再补 CLAUDE.md 措辞（记录：2026-08-29 11:19）
- [ ] **T4** 会话列表树视图的实测与打磨：resume 后 webview 恢复历史消息的完整性（session/messages 数据源）、fork 后新会话跳转（记录：2026-08-27 16:05）
- [ ] **T5** 打包脚本收尾：`npm run package` 前 CI 用 lock 校验 vendor（vendor 与 zcode-runtime.lock.json 一致才放行打包，PLAN.md 6.5 节要求）（记录：2026-08-27 16:05）
