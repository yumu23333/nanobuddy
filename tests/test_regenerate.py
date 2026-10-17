# -*- coding: utf-8 -*-
"""重新生成/编辑重发：DB 截断（truncate_messages_from）+ 引擎会话截断。"""
import pytest

from core.database.db import Database


@pytest.fixture()
def conv_db(temp_db):
    temp_db.create_conversation("c1", owner_user_id="u1")
    return temp_db


def _add(db, contents):
    for role, content in contents:
        db.add_message("c1", role, content)


def test_truncate_messages_from_keeps_prefix(conv_db):
    _add(conv_db, [("user", "q1"), ("assistant", "a1"), ("user", "q2"), ("assistant", "a2")])
    msgs = conv_db.get_messages("c1", limit=100)
    assert len(msgs) == 4
    assert "id" in msgs[0]  # get_messages 暴露消息 id（锚点用）

    # 截断到第 3 条（q2）起 → 保留 q1/a1
    deleted = conv_db.truncate_messages_from("c1", msgs[2]["id"])
    assert deleted == 2
    left = conv_db.get_messages("c1", limit=100)
    assert [m["role"] for m in left] == ["user", "assistant"]
    assert [m["content"] for m in left] == ["q1", "a1"]
    assert conv_db.get_conversation("c1")["message_count"] == 2


def test_truncate_messages_from_first_keeps_nothing(conv_db):
    _add(conv_db, [("user", "q1"), ("assistant", "a1")])
    msgs = conv_db.get_messages("c1", limit=100)
    deleted = conv_db.truncate_messages_from("c1", msgs[0]["id"])
    assert deleted == 2
    assert conv_db.get_messages("c1", limit=100) == []
    assert conv_db.get_conversation("c1")["message_count"] == 0


def test_truncate_engine_session(tmp_path):
    from types import SimpleNamespace

    from nanobuddy.session.manager import SessionManager

    from core.context.chat_persist import truncate_engine_session

    sm = SessionManager(tmp_path)
    s = sm.get_or_create("user:u1:c1")
    s.add_message("user", "q1")
    s.add_message("assistant", "a1")
    s.add_message("user", "q2")
    s.add_message("assistant", "a2")
    sm.save(s)
    adapter = SimpleNamespace(session_manager=sm)

    # 截断到第 2 条用户消息（ordinal=1）之前 → 保留 q1/a1
    assert truncate_engine_session(adapter, "user:u1:c1", 1) is True
    s2 = sm.get_or_create("user:u1:c1")
    assert [m["content"] for m in s2.messages] == ["q1", "a1"]

    # ordinal 超出范围 → False 且不改动
    assert truncate_engine_session(adapter, "user:u1:c1", 5) is False
    s3 = sm.get_or_create("user:u1:c1")
    assert [m["content"] for m in s3.messages] == ["q1", "a1"]


def test_truncate_engine_session_adjusts_last_consolidated(tmp_path):
    from types import SimpleNamespace

    from nanobuddy.session.manager import SessionManager

    from core.context.chat_persist import truncate_engine_session

    sm = SessionManager(tmp_path)
    s = sm.get_or_create("user:u1:c2")
    s.add_message("user", "q1")
    s.add_message("assistant", "a1")
    s.add_message("user", "q2")
    s.last_consolidated = 3  # 模拟已压缩到第 3 条
    sm.save(s)
    adapter = SimpleNamespace(session_manager=sm)

    assert truncate_engine_session(adapter, "user:u1:c2", 1) is True
    s2 = sm.get_or_create("user:u1:c2")
    assert len(s2.messages) == 2
    assert s2.last_consolidated <= len(s2.messages)
