import requests
import json
import logging
import os
import time
from typing import Optional, List, Union
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

# 配置日志
logger = logging.getLogger(__name__)

class OllamaEmbedding:
    """通过 Ollama API 生成文本嵌入向量（支持批量、重试、会话复用）"""

    def __init__(
        self,
        base_url: str = "http://localhost:11434",
        model: str = "nomic-embed-text",
        timeout: int = 60,  # 增加超时，批量可能较慢
        max_retries: int = 3,
        batch_size: int = 20,  # 每批最多处理的文本数（Ollama限制）
    ):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.timeout = timeout
        self.batch_size = batch_size
        self._session = self._create_session(max_retries)

    def _create_session(self, max_retries: int) -> requests.Session:
        """创建带重试机制的 Session"""
        session = requests.Session()
        retry = Retry(
            total=max_retries,
            backoff_factor=1,
            status_forcelist=[500, 502, 503, 504],
            allowed_methods=["POST"],
        )
        adapter = HTTPAdapter(max_retries=retry)
        session.mount("http://", adapter)
        session.mount("https://", adapter)
        return session

    def name(self) -> str:
        return f"ollama_{self.model}"

    def __call__(self, input: Union[str, List[str]]) -> List[List[float]]:
        """统一入口，支持单个字符串或列表"""
        if isinstance(input, str):
            texts = [input]
        else:
            texts = input
        return self.embed_documents(texts)

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        """
        批量生成文档嵌入，自动分批处理。
        当 Ollama 返回错误时，抛出异常（避免静默零向量）。
        """
        if not texts:
            return []
        all_embeddings = []
        for i in range(0, len(texts), self.batch_size):
            batch = texts[i:i+self.batch_size]
            try:
                # 检查 Ollama 是否支持批量嵌入（实际上 Ollama 的 /api/embeddings 只支持单个 prompt）
                # 所以这里仍然循环，但使用 Session 复用连接
                for text in batch:
                    embedding = self._embed_single(text)
                    all_embeddings.append(embedding)
            except Exception as e:
                logger.error("嵌入批次失败 (起始索引 %d): %s", i, e)
                raise  # 重新抛出，让上层决定如何处理
        return all_embeddings

    def _embed_single(self, text: str) -> List[float]:
        """单个文本嵌入，带重试"""
        try:
            resp = self._session.post(
                f"{self.base_url}/api/embeddings",
                json={"model": self.model, "prompt": text},
                timeout=self.timeout,
            )
            resp.raise_for_status()
            data = resp.json()
            embedding = data.get("embedding")
            if embedding is None:
                raise ValueError("响应中缺少 'embedding' 字段")
            return embedding
        except requests.exceptions.Timeout:
            logger.error("Ollama 请求超时 (model=%s)", self.model)
            raise
        except requests.exceptions.RequestException as e:
            logger.error("Ollama 请求失败: %s", e)
            raise
        except (json.JSONDecodeError, ValueError) as e:
            logger.error("Ollama 响应解析失败: %s", e)
            raise

    def embed_query(self, input: str) -> List[float]:
        """查询向量（单独方法，与文档嵌入可能使用不同模型，但这里直接复用）"""
        return self._embed_single(input)


class EmbeddingManager:
    """嵌入管理器 —— 单例，支持动态切换后端"""

    _instance: Optional["EmbeddingManager"] = None

    @classmethod
    def get_instance(cls) -> "EmbeddingManager":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    def __init__(self):
        self._ollama: Optional[OllamaEmbedding] = None
        # 从环境变量读取默认配置
        self._default_ollama_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        self._default_ollama_model = os.getenv("OLLAMA_EMBED_MODEL", "nomic-embed-text")

    def get_ollama(
        self,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
        timeout: int = 60,
        max_retries: int = 3,
        batch_size: int = 20,
    ) -> OllamaEmbedding:
        """获取或创建 Ollama 嵌入实例，支持自定义参数覆盖"""
        url = base_url or self._default_ollama_url
        model_name = model or self._default_ollama_model
        # 如果已有实例但参数不同，重建
        if self._ollama is None:
            self._ollama = OllamaEmbedding(
                base_url=url,
                model=model_name,
                timeout=timeout,
                max_retries=max_retries,
                batch_size=batch_size,
            )
        else:
            # 如果参数变化，也可以重新创建（简单起见，此处只创建一次）
            # 若需要动态更新，可扩展
            pass
        return self._ollama

    def check_ollama_available(self, base_url: Optional[str] = None) -> bool:
        """检查 Ollama 服务是否可用"""
        url = (base_url or self._default_ollama_url).rstrip("/")
        try:
            # 使用独立 session 避免干扰主 session
            with requests.Session() as sess:
                resp = sess.get(f"{url}/api/tags", timeout=5)
                return resp.status_code == 200
        except Exception:
            return False

    def ensure_embedding_model(
        self,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
        pull_timeout: int = 300,
    ) -> bool:
        """
        确保指定的嵌入模型已下载。
        返回 True 表示模型可用，False 表示拉取失败。
        """
        url = (base_url or self._default_ollama_url).rstrip("/")
        model_name = model or self._default_ollama_model

        # 先检查是否已存在
        try:
            with requests.Session() as sess:
                resp = sess.get(f"{url}/api/tags", timeout=5)
                if resp.status_code == 200:
                    models = resp.json().get("models", [])
                    for m in models:
                        if model_name in m.get("name", ""):
                            logger.info("模型 %s 已存在", model_name)
                            return True
                # 不存在则拉取
                logger.info("开始拉取模型 %s，可能需要几分钟...", model_name)
                # 使用流式拉取，避免长时间等待无反馈
                with sess.post(
                    f"{url}/api/pull",
                    json={"model": model_name},
                    timeout=pull_timeout,
                    stream=True,
                ) as pull_resp:
                    if pull_resp.status_code != 200:
                        logger.error("拉取模型失败，状态码: %s", pull_resp.status_code)
                        return False
                    # 流式读取进度（可选）
                    for line in pull_resp.iter_lines():
                        if line:
                            try:
                                data = json.loads(line)
                                if "status" in data:
                                    logger.debug("拉取进度: %s", data.get("status"))
                            except json.JSONDecodeError:
                                pass
                    logger.info("模型 %s 拉取完成", model_name)
                    return True
        except Exception as e:
            logger.error("确保模型可用时发生异常: %s", e)
            return False