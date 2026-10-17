# -*- coding: utf-8 -*-
"""pytest 公共夹具：隔离的临时数据库 + 请求上下文清理。"""
import sys
from pathlib import Path

import pytest

# 保证测试可 import core / nanobuddy（项目根加入 sys.path）
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import core.database.db as db_mod  # noqa: E402
from core.database.db import Database  # noqa: E402


@pytest.fixture()
def temp_db(tmp_path, monkeypatch):
    """把 get_db() 单例指向临时数据库，避免污染 data/nanobuddy.db。"""
    db = Database(str(tmp_path / "test_nanobuddy.db"))
    monkeypatch.setattr(db_mod, "_db_instance", db)
    yield db
    try:
        conn = getattr(db._local, "conn", None)
        if conn is not None:
            conn.close()
    except Exception:
        pass


@pytest.fixture()
def clean_ctx():
    """清理请求上下文（测试间隔离）。"""
    from core.security.context import clear_request_context

    clear_request_context()
    yield
    clear_request_context()
