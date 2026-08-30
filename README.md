# ZCode VSCE

<div align="center">

![ZCode VSCE](./assets/logo.png)

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE.md)
[![Version](https://img.shields.io/badge/Version-0.1.5-blue.svg)](./CHANGELOG.md)
[![Type](https://img.shields.io/badge/Type-VSCode_Extension-blue.svg)]()
<img src="https://img.shields.io/endpoint?url=https://raw.githubusercontent.com/xhqing/xhqing/main/traffic/badges/zcode-vsce.json" alt="Visits/day" />

English | [简体中文](README_cn.md)

</div>

Unofficial VSCode extension client for the official agent runtime shipped with
ZCode Desktop — the VSCode sibling of
[zcode-cli](https://github.com/xhqing/zcode-cli).

The backend is unchanged: the extension drives the same official ZCode runtime
(the `resources/glm` bundle extracted by zcode-cli) through its native
`app-server` stdio JSON-RPC protocol — the same protocol the ZCode Desktop UI
itself uses. The frontend is a VSCode webview panel that reimplements the
interaction model of the Claude Code VSCode extension on top of that runtime.

This project is not affiliated with or endorsed by Z.ai. ZCode and its bundled
runtime remain subject to their upstream terms. Confirm that you are allowed
to redistribute the extracted runtime before publishing a release.

> Status: **incubating** — see [PLAN.md](./PLAN.md) for the full
> implementation plan (architecture, milestones, and scope).

## Relationship to zcode-cli

| | zcode-cli | zcode-vsce |
|---|---|---|
| Frontend | Terminal TUI (`@earendil-works/pi-tui`) | VSCode webview panel |
| Backend | Official ZCode runtime (extracted) | Same official ZCode runtime |
| Distribution | npm-installable tarball via GitHub Release | `.vsix` via GitHub Release |

Both projects are maintained by **Atlas** (FullStackEngineerAgent) and share
the runtime-extraction and protocol knowledge; the extension reuses the pure
logic layers (config, key failover, event normalization, projections) rather
than reimplementing them.

## License & Attribution

- Copyright (c) 2026 zcode-app-cli contributors (upstream project).
- Copyright (c) 2026 All Contributors.
- Released under the [MIT License](./LICENSE.md).
- Attribution: when you reuse or redistribute this project, please keep the
  copyright notice and license text, and credit the project by linking back
  to its repository.
- Project URL: https://github.com/xhqing/zcode-vsce
