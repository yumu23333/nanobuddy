# -*- coding: utf-8 -*-
"""adapter：provider 指纹与设置页保存后的热替换（免重启）。"""
import hashlib
import threading

import pytest

from nanobuddy.adapter import NanoBuddyAdapter

STUB_CONFIG = {
    "models": {
        "default": "deepseek",
        "deepseek": {"base_url": "https://api.deepseek.com", "model": "deepseek-v4-flash"},
    }
}


@pytest.fixture()
def stub_config(monkeypatch):
    """固定 load_config 返回值，使测试不依赖本机 config.yaml（CI 环境无该文件）。"""
    import nanobuddy.adapter as adapter_mod

    monkeypatch.setattr(adapter_mod, "load_config", lambda: dict(STUB_CONFIG))


def _make_stub_adapter():
    """绕过 __init__（不加载完整运行时），仅装配热替换所需属性。"""
    a = NanoBuddyAdapter.__new__(NanoBuddyAdapter)
    a._provider_lock = threading.Lock()
    a._provider_fp = "stale-fingerprint"
    return a


def test_fingerprint_stable_and_nonempty(temp_db, clean_ctx, stub_config):
    a = _make_stub_adapter()
    fp1 = a._provider_fingerprint()
    fp2 = a._provider_fingerprint()
    assert fp1 and fp1 == fp2


def test_fingerprint_changes_with_page_key(temp_db, clean_ctx, stub_config):
    """设置页保存 Key 后，指纹必须变化（热替换的触发依据）。"""
    a = _make_stub_adapter()
    fp0 = a._provider_fingerprint()
    temp_db.set_setting("openai_api_key", "sk-test-fingerprint-123")
    fp1 = a._provider_fingerprint()
    assert fp1 != fp0
    kfp = hashlib.sha1("sk-test-fingerprint-123".encode()).hexdigest()[:10]
    assert f"k{kfp}" in fp1  # 指纹含 Key 摘要


def test_ensure_provider_current_hot_reload(temp_db, clean_ctx, stub_config):
    """保存新 Key 后调用 _ensure_provider_current：provider 被重建且指纹更新。"""
    a = _make_stub_adapter()
    temp_db.set_setting("openai_api_key", "sk-hot-reload-test")
    a._ensure_provider_current()
    assert a._provider_fp != "stale-fingerprint"
    assert a.provider is not None
    assert a.model
    # 无变化时第二次调用不重复构建（指纹不变）
    fp_after = a._provider_fp
    a._ensure_provider_current()
    assert a._provider_fp == fp_after
