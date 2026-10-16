"""工具结果剪枝（无 LLM），供 nanobot 与 legacy agent 共用。"""

from __future__ import annotations

import json
import os
import re

# 可配置的字符/Token 系数（默认 2.5，适合中英混合）
# 可通过环境变量 KEJI_CHARS_PER_TOKEN 覆盖，如 export KEJI_CHARS_PER_TOKEN=2
_CHARS_PER_TOKEN = float(os.environ.get("KEJI_CHARS_PER_TOKEN", "2.5"))

# 尾部保留的 Token 预算（与语言无关，目标值）
_TAIL_TOKEN_BUDGET = 20000
_HEAD_PROTECT_COUNT = 4

# 简单的中文字符正则（用于语言检测）
_CHINESE_RE = re.compile(r"[\u4e00-\u9fff]")


def _estimate_tokens(text: str) -> int:
    """
    估算文本的 Token 数，对中文按 1.8 字符/Token，英文按 4 字符/Token 加权。
    若无法区分，则使用全局 _CHARS_PER_TOKEN。
    """
    if not text:
        return 0
    # 统计中文字符数量
    chinese_chars = len(_CHINESE_RE.findall(text))
    total_chars = len(text)
    if total_chars == 0:
        return 0
    # 如果中文字符占比 > 30%，视为中文为主，动态调整系数
    if chinese_chars / total_chars > 0.3:
        # 中文字符按 1.8，其余按 4
        other_chars = total_chars - chinese_chars
        return int(chinese_chars / 1.8 + other_chars / 4)
    else:
        # 否则使用全局系数
        return int(total_chars / _CHARS_PER_TOKEN)


def summarize_tool_result(tool_name: str, result: str, args: dict | None = None) -> str:
    if not result:
        return f"[{tool_name}] 返回空"

    content_len = len(result)
    line_count = result.count("\n") + 1 if result.strip() else 0
    args = args or {}

    if tool_name == "get_time":
        return f"[get_time] {result[:60]}"
    if tool_name == "calculator":
        return f"[calculator] {result[:80]}"
    if tool_name == "read_file":
        return f"[read_file] 读取 {args.get('filename', '?')} ({content_len:,} 字符)"
    if tool_name == "web_search":
        return f"[web_search] 搜索 '{args.get('query', '?')}' ({content_len:,} 字符结果)"
    if tool_name == "browse_files":
        return f"[browse_files] 浏览 {args.get('path', '?')} ({line_count} 项)"
    if tool_name == "search_files":
        return f"[search_files] 搜索 '{args.get('pattern', '?')}' ({line_count} 行)"
    if tool_name == "read_document":
        return f"[read_document] 读取 {args.get('path', '?')} ({content_len:,} 字符)"
    if tool_name == "query_knowledge":
        return f"[query_knowledge] 检索 '{args.get('query', '?')}' ({line_count} 条)"

    first_arg = ""
    for k, v in list(args.items())[:2]:
        first_arg += f" {k}={str(v)[:40]}"
    return f"[{tool_name}]{first_arg} ({content_len:,} 字符, {line_count} 行)"


def should_prune_messages(messages: list[dict]) -> bool:
    total_tokens = 0
    for m in messages:
        total_tokens += _estimate_tokens(str(m.get("content", "")))
        for tc in m.get("tool_calls", []):
            total_tokens += _estimate_tokens(str(tc.get("function", {}).get("arguments", "")))
    return total_tokens > _TAIL_TOKEN_BUDGET * 1.5


def prune_tool_results(messages: list[dict]) -> list[dict]:
    n = len(messages)
    if n <= _HEAD_PROTECT_COUNT + 3:
        return messages

    result = [m.copy() for m in messages]
    call_id_to_tool: dict[str, tuple[str, str]] = {}
    for msg in result:
        if msg.get("role") == "assistant":
            for tc in msg.get("tool_calls", []):
                if isinstance(tc, dict):
                    cid = tc.get("id", "")
                    fn = tc.get("function", {})
                else:
                    cid = getattr(tc, "id", "") or ""
                    fn = getattr(tc, "function", None) or {}
                name = fn.get("name", "unknown") if isinstance(fn, dict) else "unknown"
                args_str = fn.get("arguments", "") if isinstance(fn, dict) else ""
                if cid:
                    call_id_to_tool[cid] = (name, args_str)

    accumulated = 0
    cut_idx = n
    min_tail = 3
    for i in range(n - 1, _HEAD_PROTECT_COUNT - 1, -1):
        msg = result[i]
        raw = msg.get("content") or ""
        if isinstance(raw, str):
            msg_tokens = _estimate_tokens(raw)
        else:
            msg_tokens = _estimate_tokens(str(raw))
        for tc in msg.get("tool_calls", []):
            if isinstance(tc, dict):
                args = tc.get("function", {}).get("arguments", "")
                msg_tokens += _estimate_tokens(str(args))
        if accumulated + msg_tokens > _TAIL_TOKEN_BUDGET and (n - i) >= min_tail:
            break
        accumulated += msg_tokens
        cut_idx = i

    for i in range(_HEAD_PROTECT_COUNT, cut_idx):
        msg = result[i]
        if msg.get("role") != "tool":
            continue
        content = msg.get("content", "")
        if not content or not isinstance(content, str) or len(content) < 200:
            continue
        call_id = msg.get("tool_call_id", "")
        tool_name, tool_args_str = call_id_to_tool.get(call_id, ("unknown", "{}"))
        try:
            args = json.loads(tool_args_str) if tool_args_str else {}
        except (json.JSONDecodeError, TypeError):
            args = {}
        summary = summarize_tool_result(tool_name, content, args)
        result[i] = {**msg, "content": summary}

    return result