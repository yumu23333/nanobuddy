# -*- coding: utf-8 -*-
"""模型设置存取：个人 > 全局(页面填写) > config.yaml 的优先级。"""
from core.models.models import _db_model_setting, apply_model_settings_from_db


class FakeUser:
    def __init__(self, uid):
        self.id = uid


def test_db_setting_priority(temp_db):
    temp_db.set_setting("openai_api_key", "global-key")
    temp_db.set_setting("user:alice:openai_api_key", "alice-key")

    # 无用户 → 全局
    assert _db_model_setting(temp_db, None, "openai_api_key") == "global-key"
    # 虚拟用户（localhost/anonymous/service）→ 全局，不查个人前缀
    for vid in ("localhost", "anonymous", "service", ""):
        assert _db_model_setting(temp_db, FakeUser(vid), "openai_api_key") == "global-key"
    # 真实用户 → 个人优先
    assert _db_model_setting(temp_db, FakeUser("alice"), "openai_api_key") == "alice-key"
    # 个人未设置 → 回退全局
    assert _db_model_setting(temp_db, FakeUser("bob"), "openai_api_key") == "global-key"
    # 都没有 → default
    assert _db_model_setting(temp_db, None, "no_such_key", "fallback") == "fallback"


def test_apply_global_key_overlay(temp_db, clean_ctx):
    """无请求上下文（匿名）时，设置页填写的全局 Key 覆盖进 config。"""
    temp_db.set_setting("openai_api_key", "sk-page-global")
    temp_db.set_setting("api_provider", "deepseek")
    cfg = {"models": {"default": "deepseek",
                      "deepseek": {"base_url": "https://api.deepseek.com", "model": "deepseek-v4-flash"}}}
    out = apply_model_settings_from_db(cfg)
    assert out["models"]["default"] == "deepseek"
    assert out["models"]["deepseek"]["api_key"] == "sk-page-global"


def test_apply_user_pref_over_global(temp_db, clean_ctx):
    """已登录用户的个人 Key 优先于全局 Key。"""
    from core.security.context import set_request_context

    temp_db.set_setting("openai_api_key", "sk-global")
    temp_db.set_setting("user:alice:openai_api_key", "sk-alice")
    set_request_context(user_id="alice", role="member", actor="alice")
    cfg = {"models": {"default": "deepseek", "deepseek": {}}}
    out = apply_model_settings_from_db(cfg)
    assert out["models"]["deepseek"]["api_key"] == "sk-alice"


def test_apply_provider_name_mapping(temp_db, clean_ctx):
    temp_db.set_setting("api_provider", "qwen-cloud")
    cfg = {"models": {"default": "openai"}}
    out = apply_model_settings_from_db(cfg)
    assert out["models"]["default"] == "qwen"


def test_apply_keeps_yaml_when_db_empty(temp_db, clean_ctx):
    """数据库无设置时，config.yaml / .env 的值原样保留（兜底仍然有效）。"""
    cfg = {"models": {"default": "deepseek",
                      "deepseek": {"api_key": "${DEEPSEEK_API_KEY}", "model": "m1"}}}
    out = apply_model_settings_from_db(cfg)
    assert out["models"]["deepseek"]["api_key"] == "${DEEPSEEK_API_KEY}"
    assert out["models"]["deepseek"]["model"] == "m1"


def test_apply_ollama_branch(temp_db, clean_ctx):
    temp_db.set_setting("model_type", "ollama")
    temp_db.set_setting("ollama_url", "http://gpu-box:11434")
    temp_db.set_setting("chat_model", "qwen2.5:7b")
    cfg = {"models": {"default": "deepseek"}}
    out = apply_model_settings_from_db(cfg)
    assert out["models"]["default"] == "ollama"
    assert out["models"]["ollama"]["base_url"] == "http://gpu-box:11434"
    assert out["models"]["ollama"]["model"] == "qwen2.5:7b"
