# ZCode VSCE

<div align="center">

![ZCode VSCE](./assets/logo.png)

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE.md)
[![Version](https://img.shields.io/badge/Version-0.1.6-blue.svg)](./CHANGELOG.md)
[![Type](https://img.shields.io/badge/Type-VSCode_Extension-blue.svg)]()
<img src="https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/xhqing/xhqing/main/traffic/badges/zcode-vsce.json" alt="Visits/day" />

[English](README.md) | 简体中文

</div>

ZCode 官方 agent runtime 的非官方 VSCode 扩展客户端——[zcode-cli](https://github.com/xhqing/zcode-cli) 的 VSCode 姊妹项目。

后端不变：扩展驱动的是与 zcode-cli 相同的官方 ZCode runtime（由 zcode-cli 提取的 `resources/glm` 包），走其原生 `app-server` stdio JSON-RPC 协议——与 ZCode Desktop 图形界面所用的同一套协议。前端是 VSCode webview 面板，在该 runtime 之上重新实现类 Claude Code VSCode 扩展的交互形态。

本项目非 Z.ai 官方项目，受上游条款约束。发布前请确认你被允许再分发提取出的 runtime。

> 当前状态：**孵化中**——完整实施方案（架构、里程碑、范围）见 [PLAN.md](./PLAN.md)。

## 与 zcode-cli 的关系

| | zcode-cli | zcode-vsce |
|---|---|---|
| 前端 | 终端 TUI（`@earendil-works/pi-tui`） | VSCode webview 面板 |
| 后端 | 官方 ZCode runtime（提取） | 同一官方 ZCode runtime |
| 分发 | GitHub Release 的 npm 可装 tarball | GitHub Release 的 `.vsix` |

两个项目均由 **Atlas**（FullStackEngineerAgent，全栈开发工程师）维护，共享 runtime 提取与协议层的知识积累；扩展直接复用纯逻辑层（配置、多 key 容灾、事件归一化、状态投影），而不是重新实现一遍。

## 许可与署名

- 版权所有 (c) 2026 zcode-app-cli contributors（上游项目）。
- 版权所有 (c) 2026 All Contributors。
- 以 [MIT 许可证](./LICENSE.md) 发布。
- 署名：复用或再分发本项目时，请保留版权声明与许可文本，并链接回项目仓库以示来源。
- 项目地址：https://github.com/xhqing/zcode-vsce
