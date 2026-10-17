"""对话持久化：nanobuddy 会话文件 + SQLite（供历史列表与管理页）。"""

from __future__ import annotations
from datetime import datetime

from loguru import logger
from core.database.db import get_db
from core.security.users import parse_session_conversation_id


def truncate_engine_session(adapter, session_key: str, user_ordinal: int) -> bool:
    """把引擎会话截断到第 user_ordinal 条用户消息之前（0 起）。

    DB 消息与引擎 session 的用户消息序列一致（每轮对话各追加一条用户消息），
    因此可按用户消息序数映射截断。返回 False 表示未找到截断点
    （会话文件可能已被清理），调用方应降级处理。
    """
    try:
        manager = adapter.session_manager
        session = manager.get_or_create(session_key)
        seen = -1
        cut = None
        for i, m in enumerate(session.messages):
            if m.get("role") == "user":
                seen += 1
                if seen == user_ordinal:
                    cut = i
                    break
        if cut is None:
            return False
        session.messages = session.messages[:cut]
        session.last_consolidated = min(session.last_consolidated, len(session.messages))
        session.updated_at = datetime.now()
        manager.save(session)
        return True
    except Exception as e:
        logger.warning("截断引擎会话失败 {}: {}", session_key, e)
        return False

def parse_session_user_and_conv(session_key: str) -> tuple[str | None, str]:
    if session_key.startswith("user:") and session_key.count(":") >= 2:
        parts = session_key.split(":", 2)
        return parts[1], parts[2]
    return None, session_key


def sync_session_to_db(session_key: str, query: str, reply: str, thinking: str = "") -> None:
    """将一轮对话写入 SQLite，便于历史列表与管理员查看。"""
    user_id, conv_id = parse_session_user_and_conv(session_key)
    if not user_id:
        return
    db = get_db()
    title = (query or "").strip()[:50] or "新对话"
    db.ensure_conversation_owned(conv_id, user_id, title=title)
    if query:
        db.add_message(conv_id, "user", query)
    content = reply or ""
    if thinking and not content:
        content = f"（思考过程）\n{thinking[:2000]}"
    if content:
        db.add_message(conv_id, "assistant", content)


def persist_chat_turn(
    session_manager,
    session_key: str,
    query: str,
    run_result,
    *,
    thinking: str = "",
) -> None:
    """保存到 nanobuddy JSONL 并同步 DB。"""
    reply = (getattr(run_result, "final_content", None) or "") if run_result else ""
    try:
        session = session_manager.get_or_create(session_key)
        session.add_message("user", query)
        if reply or thinking:
            extra: dict = {}
            if thinking:
                extra["thinking"] = thinking
            usage = getattr(run_result, "usage", None) or {}
            if isinstance(usage, dict) and usage:
                pt = int(usage.get("prompt_tokens", 0) or 0)
                ct = int(usage.get("completion_tokens", 0) or 0)
                if pt or ct or int(usage.get("cached_tokens", 0) or 0):
                    tt = int(usage.get("total_tokens", 0) or 0) or (pt + ct)
                    cached = int(usage.get("cached_tokens", 0) or 0)
                    extra["usage"] = {
                        "prompt_tokens": pt,
                        "completion_tokens": ct,
                        "total_tokens": tt,
                        "cached_tokens": cached,
                        "source": usage.get("source", "api"),
                    }
            session.add_message("assistant", reply, **extra)
        session_manager.save(session)
        sync_session_to_db(session_key, query, reply, thinking=thinking)
    except Exception as e:
        logger.warning("Persist chat session {}: {}", session_key, e)
