# -*- coding: utf-8 -*-
"""按会话模型覆盖 + 导出（高上限消息读取）的单元测试。"""
import pytest

from core.database.db import Database


@pytest.fixture()
def conv_db(temp_db):
    db = temp_db
    db.create_conversation("c1", title="会话A", owner_user_id="u1")
    return db


def test_update_conversation_stores_model(conv_db):
    conv_db.update_conversation("c1", model="gpt-4o-mini")
    row = conv_db.get_conversation("c1")
    assert row["model"] == "gpt-4o-mini"


def test_update_conversation_clears_model(conv_db):
    conv_db.update_conversation("c1", model="gpt-4o-mini")
    # 空串应清空为 None
    conv_db.update_conversation("c1", model="")
    assert conv_db.get_conversation("c1")["model"] is None


def test_list_conversations_includes_model(conv_db):
    conv_db.update_conversation("c1", model="deepseek-chat")
    rows = conv_db.list_conversations(owner_user_id="u1")
    assert rows[0]["model"] == "deepseek-chat"


def test_export_high_limit_returns_all(conv_db):
    # 写入超过默认 100 条的消息，验证 export 用的高上限读取不截断
    for i in range(150):
        conv_db.add_message("c1", "user", f"消息{i}")
    all_msgs = conv_db.get_messages("c1", limit=100000)
    assert len(all_msgs) == 150
    # 默认上限仍应被限制为 100
    default_msgs = conv_db.get_messages("c1")
    assert len(default_msgs) == 100
