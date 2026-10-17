# -*- coding: utf-8 -*-
"""一次性修复：except Exception: pass → 分级日志记录；loguru 的 exc_info=True 改正确写法。

- stdlib logging 文件：logger.warning/debug("msg", exc_info=True)
- loguru 文件：logger.opt(exception=True).warning/debug("msg")
- 保留原文件行尾（CRLF）；二进制读写。
- 消息按"except 块在文件中出现的顺序"映射（occurrence 序号从 1 开始）。
"""
import re
import sys
from pathlib import Path

# (level, message) 按出现顺序
MAP = {
    "core/path_policy/policy.py": [
        ("warning", "计算文件访问范围失败，回退默认目录"),
        ("warning", "合并工作区策略根目录失败"),
    ],
    "core/presentation.py": [
        ("debug", "写入演讲者备注失败"),
    ],
    "core/routes/routes_admin.py": [
        ("debug", "清理会话文件失败"),
    ],
    "core/routes/routes_api.py": [
        ("warning", "写入文件访问审计日志失败"),
        ("debug", "重建向量索引：删除旧集合失败"),
        ("debug", "补全文件属主信息失败"),
        ("warning", "写入文件访问审计日志失败"),
        ("warning", "写入文件访问审计日志失败"),
        ("warning", "写入文件访问审计日志失败"),
        ("debug", "补全会话属主信息失败"),
        ("debug", "补全会话统计信息失败"),
        ("debug", "读取会话文件失败"),
        ("debug", "组装会话响应失败"),
        ("debug", "删除会话文件失败"),
        ("warning", "运行时配置热加载失败，相关更改需重启后生效"),
        ("warning", "写入上传审计日志失败"),
        ("debug", "清理临时文件失败"),
        ("debug", "获取 Ollama 模型列表失败（Ollama 可能未启动）"),
        ("debug", "读取会话记忆失败"),
        ("debug", "统计数据行数失败"),
    ],
    "core/tools/db_tools.py": [
        ("debug", "清理临时数据库文件失败"),
    ],
    "core/tools/email_tools.py": [
        ("debug", "解析邮件日期失败"),
        ("debug", "解码邮件正文失败"),
        ("debug", "获取邮件 HTML 正文失败"),
    ],
    "core/tools/filetools_organize.py": [
        ("debug", "获取文件状态失败"),
        ("debug", "计算文件 MD5 失败"),
    ],
    "core/tools/new_tools.py": [
        ("debug", "修补 openpyxl cell 方法失败"),
        ("debug", "解析 PPTX 摘要失败"),
        ("debug", "解析 PDF 摘要失败"),
        ("debug", "修改文件只读属性失败"),
    ],
    "core/tools/ocr_tools.py": [
        ("warning", "easyocr 引擎不可用"),
        ("warning", "tesseract 引擎不可用，OCR 功能将受限"),
    ],
    "core/wechat/ilink.py": [
        ("debug", "ilink 请求发送失败（调用方未使用返回值）"),
    ],
    "core/wechat/work.py": [
        ("debug", "关闭 WebSocket 连接失败"),
    ],
    "nanobuddy/adapter.py": [
        ("debug", "SSE 事件入队失败（前端可能已断开）"),
        ("debug", "启动 MCP 连接任务失败"),
        ("debug", "关闭 MCP 栈失败"),
        ("debug", "关闭 MCP 栈失败"),
        ("warning", "加载会话历史失败，本轮对话将无上下文"),
        ("debug", "注入账号权限提示失败"),
    ],
    "nanobuddy/agent/context_governor.py": [
        ("warning", "消息序列修复失败"),
    ],
    "nanobuddy/agent/runner.py": [
        ("warning", "写入工具调用审计日志失败"),
        ("warning", "写入工具调用审计日志失败"),
    ],
    "nanobuddy/agent/tools/registry.py": [
        ("warning", "写入工具调用审计日志失败"),
        ("warning", "写入工具调用审计日志失败"),
        ("warning", "写入工具调用审计日志失败"),
    ],
}

# 需要补 logger 的文件：文件 -> (风格, logger 表达式)
#   stdlib: 需要 import logging + logger = logging.getLogger(...)
#   loguru:  from loguru import logger
NEED_LOGGER = {
    "core/path_policy/policy.py": ("stdlib", 'logging.getLogger(__name__)'),
    "core/routes/routes_admin.py": ("stdlib", 'logging.getLogger(__name__)'),
    "core/routes/routes_api.py": ("stdlib", 'logging.getLogger("nanobuddy.routes_api")'),
    "core/presentation.py": ("stdlib", 'logging.getLogger(__name__)'),
    "core/tools/email_tools.py": ("stdlib", 'logging.getLogger(__name__)'),
    "core/tools/filetools_organize.py": ("stdlib", 'logging.getLogger(__name__)'),
    "core/tools/new_tools.py": ("stdlib", 'logging.getLogger(__name__)'),
    "core/tools/ocr_tools.py": ("stdlib", 'logging.getLogger(__name__)'),
    "nanobuddy/agent/tools/registry.py": ("loguru", None),
}

# loguru 的 exc_info=True 静默丢堆栈，改正确写法（文本级替换）
LOGURU_EXC_INFO_FIXES = {
    "nanobuddy/adapter.py": [
        ('logger.warning("读取数据库模型设置失败，使用 config.yaml 配置", exc_info=True)',
         'logger.opt(exception=True).warning("读取数据库模型设置失败，使用 config.yaml 配置")'),
    ],
    "nanobuddy/session/manager.py": [
        ('logger.warning("Failed to flush session {}", key, exc_info=True)',
         'logger.opt(exception=True).warning("Failed to flush session {}", key)'),
    ],
    "nanobuddy/agent/loop.py": [
        (re.compile(
            r'logger\.debug\(\s*"Could not restore checkpoint for cancelled session \{\}",\s*session_key,\s*exc_info=True,\s*\)',
            re.DOTALL),
         'logger.opt(exception=True).debug(\n                            "Could not restore checkpoint for cancelled session {}",\n                            session_key,\n                        )'),
    ],
}


# 使用 loguru 的文件（logger.opt(exception=True) 才会带堆栈）
LOGURU_FILES = {
    "nanobuddy/adapter.py",
    "nanobuddy/agent/context_governor.py",
    "nanobuddy/agent/runner.py",
    "nanobuddy/agent/tools/registry.py",
    "nanobuddy/session/manager.py",
    "nanobuddy/agent/loop.py",
}


def read_text(p: Path):
    raw = p.read_bytes()
    crlf = b"\r\n" in raw
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("gbk")
        print(f"  [warn] {p} 非 UTF-8，按 GBK 解读")
    return text, crlf


def write_text(p: Path, text: str, crlf: bool):
    if crlf:
        text = text.replace("\r\n", "\n").replace("\n", "\r\n")
    p.write_bytes(text.encode("utf-8"))


def add_logger(lines, style, expr):
    """在首个顶层 import 块之后插入 logger 定义。lines 为去行尾的列表。

    只认顶格（列 0）的 import/from——函数内缩进的 import 不是模块级导入。
    """
    first_import = None
    last_import_in_head = None
    has_logging_import = False
    for i, ln in enumerate(lines[:40]):
        if ln.startswith("from __future__"):
            continue
        if re.match(r"^(import|from)\s", ln):
            if first_import is None:
                first_import = i
            last_import_in_head = i
            if ln.rstrip() == "import logging":
                has_logging_import = True
    if last_import_in_head is None:
        raise RuntimeError("未找到顶层 import 块")
    if style == "stdlib":
        if not has_logging_import:
            lines.insert(first_import, "import logging")
            last_import_in_head += 1
        lines.insert(last_import_in_head + 1, "")
        lines.insert(last_import_in_head + 2, f"logger = {expr}")
    else:  # loguru
        lines.insert(last_import_in_head + 1, "")
        lines.insert(last_import_in_head + 2, "from loguru import logger")


def apply_exc_info_fixes(rel, lines):
    """loguru exc_info=True 历史遗留修正（对 LOGURU_EXC_INFO_FIXES 中所有文件生效）。"""
    for old, new in LOGURU_EXC_INFO_FIXES.get(rel, []):
        if isinstance(old, re.Pattern):
            text = "\n".join(lines)
            text2, n = old.subn(new, text)
            if n != 1:
                print(f"  [ERROR] {rel}: loguru exc_info 正则命中 {n} 次")
                sys.exit(1)
            lines = text2.split("\n")
        else:
            joined = "\n".join(lines)
            n = joined.count(old)
            if n != 1:
                print(f"  [ERROR] {rel}: {old[:40]} 命中 {n} 次")
                sys.exit(1)
            lines = joined.replace(old, new).split("\n")
    return lines


def main():
    total = 0
    # 1) except Exception: pass → 日志
    for rel, msgs in MAP.items():
        p = Path(rel)
        text, crlf = read_text(p)
        lines = text.split("\n")
        # 统一去掉行尾 \r 再处理
        lines = [ln[:-1] if ln.endswith("\r") else ln for ln in lines]

        if rel in NEED_LOGGER:
            style, expr = NEED_LOGGER[rel]
            add_logger(lines, style, expr)
            print(f"  + {rel}: 补充 logger（{style}）")

        # 按顺序替换 except Exception: + pass
        occ = 0
        i = 0
        while i < len(lines) - 1:
            if re.match(r"\s*except Exception:\s*(#.*)?$", lines[i]) and \
               re.match(r"\s*pass\s*(#.*)?$", lines[i + 1]):
                level, msg = msgs[occ]
                occ += 1
                indent = re.match(r"\s*", lines[i + 1]).group(0)
                if rel in LOGURU_FILES:
                    # loguru：opt(exception=True) 才会带堆栈
                    lines[i + 1] = f'{indent}logger.opt(exception=True).{level}("{msg}")'
                else:
                    lines[i + 1] = f'{indent}logger.{level}("{msg}", exc_info=True)'
            i += 1
        if occ != len(msgs):
            print(f"  [ERROR] {rel}: 预期 {len(msgs)} 处，实际替换 {occ} 处")
            sys.exit(1)

        lines = apply_exc_info_fixes(rel, lines)
        write_text(p, "\n".join(lines), crlf)
        total += occ
        print(f"  = {rel}: 替换 {occ} 处")

    # 2) 仅需修 exc_info 的文件（不在 MAP 中）
    for rel in LOGURU_EXC_INFO_FIXES:
        if rel in MAP:
            continue
        p = Path(rel)
        text, crlf = read_text(p)
        lines = [ln[:-1] if ln.endswith("\r") else ln for ln in text.split("\n")]
        lines = apply_exc_info_fixes(rel, lines)
        write_text(p, "\n".join(lines), crlf)
        print(f"  * {rel}: loguru exc_info 修正")

    print(f"\n共替换 {total} 处")


if __name__ == "__main__":
    main()
