# -*- coding: utf-8 -*-
"""更新 docs/项目目录说明.md 的「核心代码」章节到 core/ 子包结构。"""
from pathlib import Path

p = Path("docs/项目目录说明.md")
raw = p.read_bytes()
text = raw.decode("utf-8")
# 该文件历史为 \r\r\n 双重行尾（已提交进 git），统一规范为 LF
text = text.replace("\r\r\n", "\n").replace("\r\n", "\n").replace("\r", "\n")

old = """## 核心代码

| 路径 | 说明 |
|------|------|
| `core/` | 路由、数据库、RAG、技能注册、安全鉴权与审计 |
| `nanobuddy/` | Agent 运行时（基于 [HKUDS/nanobuddy](https://github.com/HKUDS/nanobuddy)，见 `nanobuddy/LICENSE`） |
| `web/` | 前端静态资源（`index.html` + `js/` + `css/`） |
| `prompts/` | 系统提示词模板 |"""

new = """## 核心代码

| 路径 | 说明 |
|------|------|
| `core/agent/` | ReAct 核心引擎（`agent_core.py`）、会话记忆（`memory.py`）、会话管理（`session.py`） |
| `core/context/` | 上下文治理：token 压缩（`context_compact.py`）、工具结果裁剪（`context_prune.py`）、会话持久化（`chat_persist.py`）、调试日志（`debug_logs.py`） |
| `core/database/` | SQLite 存取（`db.py`）与数据库密码加解密 |
| `core/document/` | 文档解析（`parser.py`，PDF/Office/文本等） |
| `core/mcp/` | MCP 路径与配置（`mcp_paths.py`）、filesystem 服务配置 |
| `core/models/` | 模型路由与适配器（`models.py`）；API Key 可存设置页数据库并热替换 |
| `core/path_policy/` | 文件路径沙箱（`policy.py`）与团队工作区（`workspace.py`） |
| `core/rag/` | 向量检索：嵌入（`embeddings.py`）、向量库（`vector_store.py`） |
| `core/routes/` | FastAPI 路由：`routes_api.py`（聊天/文件/设置）、`routes_admin.py`、`routes_auth.py`（鉴权）、`routes_security.py` |
| `core/security/` | 鉴权依赖、用户与角色、密钥解析、审计、权限 |
| `core/skills/` | 应用内技能库定义 |
| `core/tools/` | 工具注册（`registry_tools.py`）与各类工具：数据库（`db_tools.py`）、邮件、压缩包、OCR、文件整理等 |
| `core/wechat/` | 企业微信接入（`ilink.py`、`work.py`） |
| `core/`（顶层） | `logger.py` 日志、`presentation.py` PPT 生成、`smart_query.py` 智能问数 |
| `nanobuddy/` | Agent 运行时（基于 [HKUDS/nanobuddy](https://github.com/HKUDS/nanobuddy)，见 `nanobuddy/LICENSE`） |
| `web/` | 前端静态资源（`index.html` + `js/` + `css/`） |
| `prompts/` | 系统提示词模板 |"""

if text.count(old) != 1:
    raise SystemExit(f"锚点命中 {text.count(old)} 次，终止")
text = text.replace(old, new)

# 开发脚本一节补充两个新脚本说明
old_dev = "| `scripts/dev/` | 飞书/工具等诊断脚本，非生产入口 |"
new_dev = ("| `scripts/dev/` | 飞书/工具等诊断脚本，非生产入口 |\n"
           "| `scripts/dev/find_silent_except.py` | 扫描 `except Exception: pass` 静默吞错 |\n"
           "| `scripts/dev/fix_silent_except.py` | 将静默吞错替换为分级日志（一次性修复脚本） |")
if old_dev in text:
    text = text.replace(old_dev, new_dev)

p.write_bytes(text.encode("utf-8"))
print("项目目录说明.md 已更新（行尾规范为 LF）")
