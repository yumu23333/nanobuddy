# -*- coding: utf-8 -*-
"""会话重命名与置顶：db.update_conversation + list_conversations 置顶排序。"""
import pytest

from core.database.db import Database


@pytest.fixture()
def conv_db(temp_db):
    temp_db.create_conversation("c1", owner_user_id="u1")
    temp_db.create_conversation("c2", owner_user_id="u1")
    return temp_db


def test_rename_conversation(conv_db):
    conv_db.update_conversation("c1", title="新标题")
    assert conv_db.get_conversation("c1")["title"] == "新标题"
    # 未传 title 不应改变标题
    conv_db.update_conversation("c1", pinned=1)
    assert conv_db.get_conversation("c1")["title"] == "新标题"


def test_pin_and_ordering(conv_db):
    # 显式刷新 c2 时间戳，使其为最新 → 默认排序 c2 在前
    conv_db.update_conversation("c2", pinned=0)
    before = [c["id"] for c in conv_db.list_conversations(owner_user_id="u1")]
    assert before[0] == "c2"

    # 置顶 c1 → 置顶项排在最前
    conv_db.update_conversation("c1", pinned=1)
    after = [c["id"] for c in conv_db.list_conversations(owner_user_id="u1")]
    assert after[0] == "c1"

    # 取消置顶：pinned 复位为 0
    conv_db.update_conversation("c1", pinned=0)
    assert conv_db.get_conversation("c1")["pinned"] == 0
    # 取消置顶后不再有置顶分组
    assert all(c["pinned"] == 0 for c in conv_db.list_conversations(owner_user_id="u1"))


def test_update_conversation_no_fields(conv_db):
    assert conv_db.update_conversation("c1") is False
