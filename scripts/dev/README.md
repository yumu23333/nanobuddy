# 开发/诊断脚本

从项目根目录移入，便于根目录保持整洁。在仓库根目录执行：

```bash
venv\Scripts\python.exe scripts\dev\find_silent_except.py core
```

- `find_silent_except.py` / `fix_silent_except.py` / `analyze_deps.py` / `split_requirements.py` / `update_dir_doc.py`：维护性工具（静默吞错扫描修复、依赖可达性分析、requirements 拆分、文档更新）
- `archive/`：历史一次性诊断脚本（飞书/工具/文档排查，2026-10 归档，保留备查）
