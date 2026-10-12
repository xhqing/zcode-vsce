# zcode-vsce 项目指南

## 负责工程师：Atlas

本项目由 **Atlas**（FullStackEngineerAgent，用户的全栈开发工程师）负责维护。Atlas 负责本项目的全部开发工作——VSCode 扩展工程（extension host / webview）、runtime 链路接入（`app-server` 协议客户端）、构建发布流水线等。在本项目内的开发 / 维护需求，由 Atlas 统一处理（Atlas 的角色定义与工作原则见 FullStackEngineerAgent 项目的 `CLAUDE.md`）。

zcode-vsce（仅经 GitHub Release 分发 vsix、不上架 Marketplace）是 ZCode 的非官方 VSCode 扩展客户端，与 zcode-cli 平行（姊妹项目）：后端复用 zcode-cli 提取的官方 ZCode runtime（`resources/glm`，功能不变），以原生 `app-server` stdio JSON-RPC 协议驱动；前端为 VSCode webview 面板，重新实现类 Claude Code VSCode 扩展的交互形态。本项目非 Z.ai 官方项目，受上游条款约束。**顶层设计文档为项目根 `PLAN.md`**——架构、协议面清单、里程碑路线、风险与决策记录均以它为准，所有开发先对照 PLAN.md 再动手。


（本文件 2026-10-12 由原 `.claude/CLAUDE.md` 的项目指南迁入；按新规，非 Agent 项目不再保留 CLAUDE.md / AGENTS.md / .claude 等智能体专属文件。）
