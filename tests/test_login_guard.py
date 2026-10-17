# -*- coding: utf-8 -*-
"""login_guard：登录防爆破（阈值锁定 / 按用户+IP 隔离 / 成功清零 / 窗口过期）。"""
import pytest
from fastapi import HTTPException

from core.security import login_guard


@pytest.fixture(autouse=True)
def _clean():
    login_guard.reset()
    yield
    login_guard.reset()


def test_no_lock_below_threshold():
    for _ in range(login_guard.MAX_ATTEMPTS - 1):
        login_guard.record_failure("alice", "1.2.3.4")
    login_guard.check_lock("alice", "1.2.3.4")  # 未达阈值，不抛异常


def test_lock_at_threshold():
    for _ in range(login_guard.MAX_ATTEMPTS):
        login_guard.record_failure("alice", "1.2.3.4")
    with pytest.raises(HTTPException) as ei:
        login_guard.check_lock("alice", "1.2.3.4")
    assert ei.value.status_code == 429
    assert "Retry-After" in ei.value.headers


def test_lock_scoped_by_user_and_ip():
    for _ in range(login_guard.MAX_ATTEMPTS):
        login_guard.record_failure("alice", "1.2.3.4")
    with pytest.raises(HTTPException):
        login_guard.check_lock("alice", "1.2.3.4")
    # 同用户不同 IP、同 IP 不同用户均不受影响
    login_guard.check_lock("alice", "5.6.7.8")
    login_guard.check_lock("bob", "1.2.3.4")


def test_key_normalization():
    login_guard.record_failure("  Alice ", "1.2.3.4")
    login_guard.record_failure("alice", "1.2.3.4")
    assert login_guard.record_failure("ALICE", "1.2.3.4") == 3


def test_success_clears_counter():
    for _ in range(login_guard.MAX_ATTEMPTS):
        login_guard.record_failure("alice", "1.2.3.4")
    login_guard.record_success("alice", "1.2.3.4")
    login_guard.check_lock("alice", "1.2.3.4")  # 已清零，不锁


def test_window_expiry(monkeypatch):
    fake = {"t": 1000.0}
    monkeypatch.setattr(login_guard, "_now", lambda: fake["t"])
    for _ in range(login_guard.MAX_ATTEMPTS):
        login_guard.record_failure("alice", "1.2.3.4")
    fake["t"] += login_guard._LOCK_SECONDS + 1
    login_guard.check_lock("alice", "1.2.3.4")  # 超出锁定窗口，自动放行
