# -*- coding: utf-8 -*-
"""db_tools：SQL 标识符白名单（防注入）。"""
import pytest

from core.tools.db_tools import _is_safe_sql_identifier


@pytest.mark.parametrize("name,expected", [
    ("users", True),
    ("_private", True),
    ("Table123", True),
    ("a" * 64, True),
    # 注入 / 非法字符
    ("users; DROP TABLE users--", False),
    ("users--", False),
    ("1users", False),
    ("", False),
    ("users table", False),
    ("users)", False),
    ("schema.users", False),
    ("用户表", False),
    ("users\n", False),
    ("*", False),
])
def test_sql_identifier(name, expected):
    assert _is_safe_sql_identifier(name) is expected
