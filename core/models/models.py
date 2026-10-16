import json
import time
from abc import ABC, abstractmethod
from typing import Generator, Optional
import requests
from core.logger import setup_logger

logger = setup_logger("nanobuddy.models")


class BaseModelAdapter(ABC):
    """模型适配器基类，定义统一接口"""

    def __init__(self, config: dict):
        self.config = config
        self.timeout = config.get("timeout", 60)

    @abstractmethod
    def chat(self, messages: list[dict], **kwargs) -> str:
        """非流式对话，返回完整回复"""
        ...

    @abstractmethod
    def chat_stream(self, messages: list[dict], **kwargs) -> Generator[str, None, None]:
        """流式对话，逐 token yield"""
        ...

    def _retry(self, func, max_retries: int = 2):
        """带重试的请求"""
        last_error = None
        for attempt in range(max_retries + 1):
            try:
                return func()
            except Exception as e:
                last_error = e
                if attempt < max_retries:
                    time.sleep(1.5 ** attempt)
        raise last_error


class OllamaAdapter(BaseModelAdapter):
    """Ollama 本地模型适配器"""

    def __init__(self, config: dict):
        super().__init__(config)
        self.base_url = config.get("base_url", "http://localhost:11434")
        self.model = config.get("model", "qwen2.5:7b")
        self.api_url = f"{self.base_url}/api/chat"

    def chat(self, messages: list[dict], **kwargs) -> str:
        def _call():
            resp = requests.post(
                self.api_url,
                json={
                    "model": self.model,
                    "messages": messages,
                    "stream": False,
                    "options": {"temperature": kwargs.get("temperature", 0.7)},
                },
                timeout=self.timeout,
            )
            resp.raise_for_status()
            return resp.json()["message"]["content"]

        logger.debug("Ollama chat: model=%s msg_count=%d", self.model, len(messages))
        result = self._retry(_call)
        logger.debug("Ollama response: %d chars", len(result))
        return result

    def chat_stream(self, messages: list[dict], **kwargs) -> Generator[str, None, None]:
        logger.debug("Ollama stream: model=%s msg_count=%d", self.model, len(messages))
        for attempt in range(3):
            try:
                resp = requests.post(
                    self.api_url,
                    json={
                        "model": self.model,
                        "messages": messages,
                        "stream": True,
                        "options": {"temperature": kwargs.get("temperature", 0.7)},
                    },
                    timeout=self.timeout,
                    stream=True,
                )
                resp.raise_for_status()
                for line in resp.iter_lines():
                    if not line:
                        continue
                    chunk = json.loads(line)
                    if "message" in chunk and "content" in chunk["message"]:
                        yield chunk["message"]["content"]
                    if chunk.get("done"):
                        return
                return
            except Exception as e:
                if attempt < 2:
                    time.sleep(1.5 ** attempt)
                else:
                    raise e


class OpenAIAdapter(BaseModelAdapter):
    """OpenAI 兼容 API 适配器（支持 GPT / 国产大模型 / DeepSeek 等）"""

    def __init__(self, config: dict):
        super().__init__(config)
        self.base_url = config.get("base_url", "https://api.openai.com/v1")
        self.api_key = config.get("api_key", "")
        self.model = config.get("model", "gpt-4o-mini")
        self.api_url = f"{self.base_url}/chat/completions"

    def _build_headers(self) -> dict:
        return {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {self.api_key}",
        }

    def chat(self, messages: list[dict], **kwargs) -> str:
        def _call():
            resp = requests.post(
                self.api_url,
                headers=self._build_headers(),
                json={
                    "model": self.model,
                    "messages": messages,
                    "temperature": kwargs.get("temperature", 0.7),
                    "stream": False,
                },
                timeout=self.timeout,
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"]

        logger.debug("OpenAI chat: model=%s msg_count=%d", self.model, len(messages))
        result = self._retry(_call)
        logger.debug("OpenAI response: %d chars", len(result))
        return result

    def chat_stream(self, messages: list[dict], **kwargs) -> Generator[str, None, None]:
        logger.debug("OpenAI stream: model=%s msg_count=%d", self.model, len(messages))
        for attempt in range(3):
            try:
                resp = requests.post(
                    self.api_url,
                    headers=self._build_headers(),
                    json={
                        "model": self.model,
                        "messages": messages,
                        "temperature": kwargs.get("temperature", 0.7),
                        "stream": True,
                    },
                    timeout=self.timeout,
                    stream=True,
                )
                resp.raise_for_status()
                for line in resp.iter_lines():
                    if not line or line == b"data: [DONE]":
                        continue
                    if line.startswith(b"data: "):
                        chunk = json.loads(line[6:])
                        delta = chunk["choices"][0].get("delta", {})
                        if "content" in delta and delta["content"] is not None:
                            yield delta["content"]
                return
            except Exception as e:
                if attempt < 2:
                    time.sleep(1.5 ** attempt)
                else:
                    raise e


class ModelRouter:
    """模型路由器：根据配置自动选择适配器"""

    _adapters = {
        "ollama": OllamaAdapter,
        "openai": OpenAIAdapter,
    }

    def __init__(self, config: dict):
        models_config = config.get("models", {})
        self.default = models_config.get("default", "ollama")
        self.adapters: dict[str, BaseModelAdapter] = {}

        for name, adapter_cls in self._adapters.items():
            if name in models_config:
                self.adapters[name] = adapter_cls(models_config[name])

    def get(self, name: Optional[str] = None) -> BaseModelAdapter:
        """获取指定模型适配器，不指定则用默认"""
        target = name or self.default
        if target not in self.adapters:
            raise ValueError(f"未知模型: {target}，可用: {list(self.adapters)}")
        return self.adapters[target]

    @classmethod
    def register_adapter(cls, name: str, adapter_cls):
        """注册自定义适配器"""
        cls._adapters[name] = adapter_cls
# ---------------------------------------------------------------------------
# 设置页模型配置叠加（页面填写的 API Key 存于软件自身 SQLite，不写后端配置文件）
# ---------------------------------------------------------------------------

# 前端模型类型标识 → config.yaml models 下的提供商 key
_PROVIDER_NAME_MAP = {
    "openai": "openai",
    "deepseek": "deepseek",
    "anthropic": "anthropic",
    "google": "google",
    "qwen-cloud": "qwen",
    "ernie": "ernie",
    "hunyuan": "hunyuan",
    "doubao": "doubao",
    "xinghuo": "xinghuo",
    "huggingface": "huggingface",
}


def _db_model_setting(db, user, key: str, default: str = "") -> str:
    """读取模型相关设置：先当前用户个人设置，再全局设置（设置页填写）。"""
    if user is not None and getattr(user, "id", "") not in ("", "anonymous", "localhost", "service"):
        pref = db.get_setting(f"user:{user.id}:{key}", "")
        if pref:
            return pref
    return db.get_setting(key, default)


def apply_model_settings_from_db(config: dict, include_user_prefs: bool = True) -> dict:
    """把设置页保存的模型配置叠加到 config 上（就地修改并返回）。

    页面填写的 API Key / 接口地址 / 模型名存于软件自身数据库，不写入 .env 或
    config.yaml，部署者无需在后端放置密钥；.env 中已配置的密钥作为兜底仍然
    有效（仅当数据库中没有对应值时才使用）。

    优先级：当前用户个人设置 > 全局设置（设置页填写）> config.yaml / .env
    """
    try:
        from core.database.db import get_db
        from core.security.permissions import resolve_current_user

        db = get_db()
        user = resolve_current_user() if include_user_prefs else None

        def get_setting(key: str, default: str = "") -> str:
            return _db_model_setting(db, user, key, default)

        models = config.setdefault("models", {})
        model_type = get_setting("model_type", "")
        api_provider = get_setting("api_provider", "")

        if model_type == "ollama":
            models["default"] = "ollama"
            oc = models.setdefault("ollama", {})
            url = get_setting("ollama_url", "")
            if url:
                oc["base_url"] = url
            m = get_setting("chat_model", "")
            if m:
                oc["model"] = m
            return config

        # ── API 提供商（OpenAI 兼容协议）──
        # 与 model_type 解耦：即使从未保存过模型类型，仅填写 API Key 也能生效
        if api_provider:
            provider_key = _PROVIDER_NAME_MAP.get(api_provider, api_provider)
            if not provider_key or provider_key == "openai-compat":
                provider_key = "openai"
            models["default"] = provider_key
        else:
            provider_key = models.get("default") or "openai"
            if provider_key == "ollama" and model_type == "openai":
                provider_key = "openai"
        if provider_key == "ollama":
            return config  # 本地 Ollama 无需 API Key

        pc = models.setdefault(provider_key, {})
        url = get_setting("openai_base_url", "")
        if url:
            pc["base_url"] = url
        key = get_setting("openai_api_key", "")
        if key:
            pc["api_key"] = key
        m = get_setting("openai_model", "")
        if m:
            pc["model"] = m
    except Exception:
        logger.warning("读取数据库模型设置失败，回退 config.yaml 配置", exc_info=True)
    return config
