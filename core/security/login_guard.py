# -*- coding: utf-8 -*-
"""登录防爆破：按 (用户名, IP) 累计失败次数，超限锁定一段时间。

- 失败计数在内存中（重启清零），锁定写入审计日志
- 阈值可用环境变量调整：NANOBUDDY_LOGIN_MAX_ATTEMPTS / NANOBUDDY_LOGIN_LOCK_MINUTES
- 对不存在的用户名同样计数，避免用户名枚举 + 爆破
"""

from __future__ import annotations

import os
import threading
import time

from fastapi import HTTPException

MAX_ATTEMPTS = max(1, int(os.environ.get("NANOBUDDY_LOGIN_MAX_ATTEMPTS", "5")))
LOCK_MINUTES = max(1, int(os.environ.get("NANOBUDDY_LOGIN_LOCK_MINUTES", "15")))
_LOCK_SECONDS = LOCK_MINUTES * 60

_lock = threading.Lock()
_failures: dict[tuple[str, str], list[float]] = {}


def _now() -> float:
    return time.time()


def _key(username: str, client_ip: str) -> tuple[str, str]:
    return ((username or "").strip().lower(), client_ip or "")


def _prune(now: float) -> None:
    """清理超出锁定窗口的失败记录（调用方需持有 _lock）。"""
    for k in list(_failures.keys()):
        recent = [t for t in _failures[k] if now - t < _LOCK_SECONDS]
        if recent:
            _failures[k] = recent
        else:
            del _failures[k]


def reset() -> None:
    """清空全部计数（测试用）。"""
    with _lock:
        _failures.clear()


def check_lock(username: str, client_ip: str) -> None:
    """锁定期内直接拒绝（429 + Retry-After）。"""
    now = _now()
    with _lock:
        _prune(now)
        attempts = _failures.get(_key(username, client_ip), [])
        if len(attempts) >= MAX_ATTEMPTS:
            retry_after = max(1, int(_LOCK_SECONDS - (now - attempts[0])) + 1)
            minutes = retry_after // 60 + 1
            raise HTTPException(
                429,
                f"登录失败次数过多，已锁定，请约 {minutes} 分钟后再试",
                headers={"Retry-After": str(retry_after)},
            )


def record_failure(username: str, client_ip: str) -> int:
    """记录一次失败，返回当前累计次数。"""
    now = _now()
    with _lock:
        _prune(now)
        attempts = _failures.setdefault(_key(username, client_ip), [])
        attempts.append(now)
        return len(attempts)


def record_success(username: str, client_ip: str) -> None:
    """登录成功，清零该 (用户名, IP) 的计数。"""
    with _lock:
        _failures.pop(_key(username, client_ip), None)
