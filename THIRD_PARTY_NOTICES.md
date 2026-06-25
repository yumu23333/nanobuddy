# 第三方组件与致谢 (Third-Party Notices)

本仓库在 [MIT License](../LICENSE) 下发布 **nanobuddy 自有部分**（如 `core/`、`web/`、`main.py`、多用户与工作区等）。

以下组件为独立开源项目或附带单独许可，使用时请遵守各自条款。nanobuddy 项目对上游贡献者表示感谢。

---

## 1. nanobot（Agent 引擎，核心依赖）

本项目的 Agent 核心能力源自 **nanobot**，该项目由 HKUDS 团队开发。

| 项目 | 说明 |
|------|------|
| **上游仓库** | https://github.com/HKUDS/nanobot |
| **许可** | [MIT License](../nanobot/LICENSE) |
| **版权** | Copyright (c) 2025 nanobot contributors |
| **本仓库位置** | `nanobot/` 目录（含 Agent 运行时、工具、Provider、会话等） |

**衍生关系说明：**
本项目 (nanobuddy) 是基于 **Keji Agent (Copyright 2026 Zuofeng198)** 进行的二次开发，而 Keji Agent 本身是基于 nanobot 构建的。因此，本仓库的 `nanobot/` 目录及其核心逻辑遵循 nanobot 的原始 MIT 许可。

本仓库在 nanobot 及 Keji Agent 的基础上增加了 Web 界面、多用户鉴权、团队工作区、权限控制与企业部署脚本等增强功能。若你分发本仓库，请务必保留 `nanobot/LICENSE` 及本文件中的署名说明。

---

## 2. Keji Agent（上游派生来源）

为了合规透明，特此声明本项目的直接上游来源：

| 项目 | 说明 |
|------|------|
| **原项目** | Keji Agent |
| **原作者** | Zuofeng198 |
| **许可** | MIT License |
| **关联说明** | 本项目代码库的基础架构继承自 Keji Agent，并在此基础上进行了重构与品牌更名。 |

---

## 3. quack-mcp（MCP 服务，可选）

| 项目 | 说明 |
|------|------|
| **上游** | `mcp/quack-mcp-main/` |
| **许可** | [MIT License](../mcp/quack-mcp-main/LICENSE.md) |
| **本仓库位置** | `mcp/quack-mcp-main/` |

用于 DuckDB 等 MCP 能力，按需启用。

---

## 4. skills/（技能模板，可选）

`skills/` 下各子目录为 bundled 技能示例/模板，**各自目录内可能有独立 `LICENSE.txt`**，常见来源包括 Anthropic 官方 Skills 等。

- 使用前请阅读对应子目录下的许可证文件。
- Anthropic Skills 通常受 Anthropic 服务条款约束，**不得用于训练竞争模型等**（详见各 `LICENSE.txt`）。

---

## 5. Python / Node 运行时依赖

通过 `requirements.txt` 及部署脚本安装的包（如 FastAPI、uvicorn、chromadb、torch 等）由 PyPI / npm 上游各自许可。

完整依赖列表见 `requirements.txt` 与 `offline_packages/`。分发商用产品时，请自行核对各依赖许可证是否满足你的场景。

---

## 6. 模型与 API 服务

nanobuddy 通过配置连接 **DeepSeek、OpenAI、Anthropic** 等第三方 API。这些服务的使用受各平台**服务条款与计费政策**约束，与本仓库 MIT 许可无关。

---

## 致谢摘要

- **[HKUDS/nanobot](https://github.com/HKUDS/nanobot)** — 轻量级 Agent 框架，本项目对话与工具引擎的基础。
- **Keji Agent (Zuofeng198)** — 本项目的直接上游基础架构贡献者。
- 其他开源依赖与技能作者 — 见各目录 LICENSE 文件。

如有遗漏或需更正，欢迎提 Issue。