"""会话上下文压缩：工具结果剪枝 + LLM 摘要（手动/自动）。"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime
from functools import lru_cache
from typing import Any, Optional

from loguru import logger

from core.context.context_prune import prune_tool_results, should_prune_messages

# 尝试导入 tiktoken 用于精确 Token 计数
try:
    import tiktoken

    _TIKTOKEN_AVAILABLE = True
except ImportError:
    _TIKTOKEN_AVAILABLE = False
    tiktoken = None


def _get_tiktoken_encoder():
    """获取 tiktoken 编码器（缓存）"""
    if not _TIKTOKEN_AVAILABLE:
        return None
    try:
        # 使用与主流模型兼容的编码器
        return tiktoken.encoding_for_model("gpt-4o")
    except Exception:
        try:
            return tiktoken.get_encoding("cl100k_base")
        except Exception:
            return None


def estimate_messages_tokens(messages: list[dict]) -> int:
    """
    估算消息列表的 Token 数。
    优先使用 tiktoken（精确），不可用则回退到字符估算（中英混合系数 3）。
    """
    if not messages:
        return 0

    enc = _get_tiktoken_encoder()
    if enc is not None:
        try:
            # 将消息序列化为 JSON 字符串后编码
            text = json.dumps(messages, ensure_ascii=False)
            return len(enc.encode(text))
        except Exception as e:
            logger.debug("tiktoken 编码失败，回退到估算: {}", e)

    # 回退估算：中英混合约 3 字符/Token
    total_chars = 0
    for m in messages:
        total_chars += len(str(m.get("content", "")))
        for tc in m.get("tool_calls") or []:
            fn = tc.get("function", {}) if isinstance(tc, dict) else {}
            total_chars += len(str(fn.get("arguments", "")))
    return total_chars // 3


def get_context_settings(config: dict) -> dict[str, Any]:
    """从配置中提取上下文压缩相关设置（无状态，直接计算）"""
    agent = config.get("agent") or {}
    return {
        "prune_tool_results": agent.get("context_prune_tool_results", True),
        "auto_compact_enabled": agent.get("context_auto_compact_enabled", True),
        "auto_compact_threshold": int(agent.get("context_auto_compact_threshold", 60000)),
        "compact_keep_recent": int(agent.get("context_compact_keep_recent", 8)),
        "compact_summary_max_messages": int(agent.get("context_compact_summary_max_messages", 40)),
    }


def prune_history_messages(history: list[dict], enabled: bool = True) -> list[dict]:
    """剪枝历史消息中的冗余工具结果"""
    if not enabled or not history:
        return history
    if not should_prune_messages(history):
        return history
    return prune_tool_results(history)


async def summarize_dialog(
    provider: Any,
    messages: list[dict],
    *,
    max_messages: int = 40,
) -> str:
    """
    调用 LLM 生成对话摘要（带异常降级）
    """
    dialog = []
    for m in messages[-max_messages:]:
        role = m.get("role", "?")
        content = str(m.get("content", ""))[:800]
        if not content.strip():
            continue
        dialog.append(f"{role}: {content}")

    if not dialog:
        return "[无有效对话内容]"

    dialog_text = "\n\n".join(dialog)
    summary_prompt = (
        "请用简洁的中文概括以下对话的核心内容（400字以内），"
        "包括：用户需求、关键结论、已完成的操作、未解决的问题。\n\n"
        f"对话记录：\n{dialog_text}"
    )

    try:
        resp = await provider.chat([{"role": "user", "content": summary_prompt}])
        result = (resp.content or "").strip()
        if result:
            return result
    except Exception as e:
        logger.warning("LLM 摘要失败，使用规则降级: {}", e)

    # 降级方案：取最后 3 条消息的简短拼接
    fallback_lines = []
    for m in messages[-3:]:
        role = m.get("role", "?")
        content = str(m.get("content", ""))[:150]
        if content.strip():
            fallback_lines.append(f"{role}: {content}")
    if fallback_lines:
        return "[摘要失败，保留最近片段]\n" + "\n".join(fallback_lines)
    return "[无可用摘要]"


# ----- 数据库同步辅助函数（解决 SQLite 与 JSONL 不一致） -----

def _parse_session_user_and_conv(session_key: str) -> tuple[str | None, str]:
    """从 session_key 解析 user_id 和 conv_id（与 persist.py 保持一致）"""
    if session_key.startswith("user:") and session_key.count(":") >= 2:
        parts = session_key.split(":", 2)
        return parts[1], parts[2]
    return None, session_key


def _sync_messages_to_db(session_key: str, messages: list[dict]) -> None:
    """
    将消息列表同步到 SQLite 数据库（替换该会话的所有历史消息）
    仅对登录用户生效（session_key 格式为 user:uid:conv）
    """
    user_id, conv_id = _parse_session_user_and_conv(session_key)
    if not user_id:
        return  # 非用户会话（如匿名/服务），不同步

    try:
        from core.database.db import get_db

        db = get_db()
        # 确保 conversation 存在且属于该用户
        db.ensure_conversation_owned(conv_id, user_id, title="摘要会话")

        # 删除该会话的所有旧消息
        conn = db._get_conn()
        conn.execute("DELETE FROM messages WHERE conversation_id = ?", (conv_id,))

        # 插入新消息
        now = time.time()
        for msg in messages:
            role = msg.get("role", "user")
            content = str(msg.get("content", ""))
            # 截断过长的内容防止数据库溢出
            if len(content) > 10000:
                content = content[:10000] + "…(已截断)"
            conn.execute(
                "INSERT INTO messages (conversation_id, role, content, created_at) "
                "VALUES (?, ?, ?, ?)",
                (conv_id, role, content, now),
            )
            now += 0.001  # 微调时间戳保证顺序

        # 更新 message_count 和 updated_at
        conn.execute(
            "UPDATE conversations SET message_count = ?, updated_at = ? WHERE id = ?",
            (len(messages), time.time(), conv_id),
        )
        conn.commit()
        logger.debug("已同步 {} 条消息到 SQLite (conv={})", len(messages), conv_id)
    except Exception as e:
        logger.warning("同步消息到 SQLite 失败: {}", e)


# ----- 核心压缩函数 -----

async def compact_session_new(
    session_manager: Any,
    session_id: str,
    provider: Any,
    *,
    keep_recent: int = 8,
    max_summary_messages: int = 40,
) -> dict[str, str]:
    """LLM 摘要后创建新会话（原 /api/compact 行为），并同步到 SQLite"""
    data = session_manager.read_session_file(session_id)
    if not data:
        return {"text": "错误: 未找到会话", "new_session_id": ""}

    msgs = data.get("messages", [])
    if len(msgs) < 2:
        return {"text": "对话太短，无需压缩", "new_session_id": ""}

    summary = await summarize_dialog(provider, msgs, max_messages=max_summary_messages)

    new_key = f"compact:{session_id}:{datetime.now().strftime('%Y%m%d%H%M%S')}"
    new_session = session_manager.get_or_create(new_key)

    # 构造新会话消息（将摘要作为 system 消息，提示继续）
    new_messages = [
        {
            "role": "system",
            "content": f"[对话摘要 · 手动压缩]\n\n{summary}\n\n---\n请在下方继续提问，我会基于以上上下文回答。",
            "timestamp": datetime.now().isoformat(),
        },
        {
            "role": "assistant",
            "content": f"✅ 历史对话已压缩！原会话仍可查看。\n\n**对话摘要**：\n{summary}\n\n请在下方继续提问。",
            "timestamp": datetime.now().isoformat(),
        },
    ]
    new_session.messages = new_messages
    session_manager.save(new_session)

    # 同步到 SQLite
    _sync_messages_to_db(new_key, new_messages)

    return {
        "text": f"✅ 对话已压缩，切换到新会话。\n\n**摘要**：{summary}",
        "new_session_id": new_key,
    }


async def compact_session_inplace(
    session_manager: Any,
    session_id: str,
    provider: Any,
    *,
    keep_recent: int = 8,
    max_summary_messages: int = 40,
) -> bool:
    """
    在原会话内压缩：摘要 + 保留最近消息。
    返回是否执行了压缩。
    压缩后自动同步到 SQLite。
    """
    session = session_manager.get_or_create(session_id)
    msgs = list(session.messages or [])
    if len(msgs) < keep_recent + 2:
        return False

    old_part = msgs[:-keep_recent]
    recent = msgs[-keep_recent:]

    summary = await summarize_dialog(provider, old_part, max_messages=max_summary_messages)

    # 构造压缩后的消息列表
    new_messages = [
        {
            "role": "system",
            "content": f"[对话摘要 · 自动压缩]\n\n{summary}",
            "timestamp": datetime.now().isoformat(),
        },
        {
            "role": "assistant",
            "content": "已自动压缩较早的对话，保留最近几轮原文。请继续。",
            "timestamp": datetime.now().isoformat(),
        },
        *recent,
    ]

    session.messages = new_messages
    session_manager.save(session)

    # 同步到 SQLite
    _sync_messages_to_db(session_id, new_messages)

    logger.info(
        "会话 {} 自动压缩: {} 条 → 摘要 + {} 条最近消息",
        session_id,
        len(msgs),
        len(recent),
    )
    return True


async def maybe_auto_compact_before_chat(
    session_manager: Any,
    session_id: str,
    provider: Any,
    config: dict,
) -> str | None:
    """
    若超过阈值则原地压缩。返回提示文案（供 SSE）或 None。
    """
    if not session_id:
        return None

    opts = get_context_settings(config)
    if not opts["auto_compact_enabled"]:
        return None

    session = session_manager.get_or_create(session_id)
    history = session.get_history(max_messages=200, include_timestamps=False)
    tokens = estimate_messages_tokens(history)

    if tokens < opts["auto_compact_threshold"]:
        return None

    # 执行压缩（带异常保护，压缩失败不阻塞对话）
    try:
        ok = await compact_session_inplace(
            session_manager,
            session_id,
            provider,
            keep_recent=opts["compact_keep_recent"],
            max_summary_messages=opts["compact_summary_max_messages"],
        )
        if ok:
            return f"📦 对话较长（约 {tokens:,} tokens），已自动压缩历史上下文。"
    except Exception as e:
        logger.error("自动压缩失败: {}", e)
    return None