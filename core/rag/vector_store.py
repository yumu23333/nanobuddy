import os
import time
import logging
import threading
from typing import Optional, List, Dict, Any, Union

import chromadb
from chromadb.config import Settings as ChromaSettings

from core.rag.embeddings import EmbeddingManager

# ---------- 日志配置 ----------
logger = logging.getLogger("nanobuddy.vector_store")

# ---------- 单例变量 ----------
_vector_store_instance: Optional["VectorStore"] = None
_vs_lock = threading.Lock()

# ---------- 可配置常量（支持环境变量覆盖） ----------
DEFAULT_PERSIST_DIR = os.path.join(
    os.path.dirname(__file__), "..", "..", "data", "vector_db"
)
DEFAULT_COLLECTION_NAME = os.getenv("VECTOR_COLLECTION", "nanobuddy_documents")
DEFAULT_SPACE = os.getenv("VECTOR_SPACE", "cosine")  # cosine, l2, ip
DEFAULT_MAX_RETRIES = 3


def get_vector_store(
    persist_dir: Optional[str] = None,
    collection_name: str = DEFAULT_COLLECTION_NAME,
    space: str = DEFAULT_SPACE,
) -> "VectorStore":
    """
    获取 VectorStore 单例，首次初始化时可传入自定义配置。
    后续调用忽略参数，返回已有实例。
    """
    global _vector_store_instance
    if _vector_store_instance is None:
        with _vs_lock:
            if _vector_store_instance is None:
                if persist_dir is None:
                    persist_dir = DEFAULT_PERSIST_DIR
                _vector_store_instance = VectorStore(
                    persist_dir=persist_dir,
                    collection_name=collection_name,
                    space=space,
                )
    return _vector_store_instance


class VectorStore:
    """
    向量存储 —— 基于 ChromaDB 的文档向量检索

    优化点：
    1. 配置外部化（支持环境变量）
    2. 完善的异常处理与重试机制
    3. 详细的日志记录
    4. 懒加载 embedding 函数（避免启动时阻塞）
    5. 支持批量添加文档
    6. 增强类型注解
    7. 支持集合重建（reset）
    8. 返回相似度分数（1 - distance），符合直觉
    """

    def __init__(
        self,
        persist_dir: str,
        collection_name: str = DEFAULT_COLLECTION_NAME,
        space: str = DEFAULT_SPACE,
    ):
        """
        Args:
            persist_dir: 向量库持久化目录
            collection_name: 集合名称
            space: 距离度量，支持 'cosine', 'l2', 'ip'
        """
        self.persist_dir = persist_dir
        self.collection_name = collection_name
        self.space = space
        self._embedding_fn = None  # 懒加载，首次使用时初始化

        # 确保目录存在
        try:
            os.makedirs(persist_dir, exist_ok=True)
            logger.info("VectorStore persist directory: %s", persist_dir)
        except OSError as e:
            logger.error("Failed to create persist directory %s: %s", persist_dir, e)
            raise RuntimeError(f"Unable to create vector store directory: {persist_dir}") from e

        # 创建 Chroma 客户端
        try:
            self.client = chromadb.PersistentClient(
                path=persist_dir,
                settings=ChromaSettings(
                    anonymized_telemetry=False,
                    # 可增加其他配置
                ),
            )
            logger.debug("ChromaDB client created successfully")
        except Exception as e:
            logger.error("Failed to create ChromaDB client: %s", e, exc_info=True)
            raise RuntimeError("Failed to initialize vector database client") from e

        # 获取或创建集合（embedding_function 延迟加载）
        self._init_collection()

    def _get_embedding_function(self):
        """懒加载嵌入函数，带异常处理"""
        if self._embedding_fn is None:
            try:
                self._embedding_fn = EmbeddingManager.get_instance().get_ollama()
                logger.info("Embedding function loaded: %s", self._embedding_fn.name())
            except Exception as e:
                logger.error("Failed to load embedding function: %s", e, exc_info=True)
                raise RuntimeError("Embedding function unavailable") from e
        return self._embedding_fn

    def _init_collection(self, retry: int = 0):
        """初始化集合，支持重试"""
        max_retries = DEFAULT_MAX_RETRIES
        try:
            embedding_fn = self._get_embedding_function()
            self.collection = self.client.get_or_create_collection(
                name=self.collection_name,
                embedding_function=embedding_fn,
                metadata={"hnsw:space": self.space},
            )
            logger.info(
                "Collection initialized: name=%s, space=%s, count=%d",
                self.collection_name,
                self.space,
                self.collection.count(),
            )
        except Exception as e:
            if retry < max_retries:
                logger.warning(
                    "Collection init failed (attempt %d/%d): %s, retrying...",
                    retry + 1, max_retries, e
                )
                time.sleep(1 * (retry + 1))  # 递增等待
                self._init_collection(retry + 1)
            else:
                logger.error(
                    "Failed to initialize collection after %d attempts: %s",
                    max_retries, e, exc_info=True
                )
                raise RuntimeError("Failed to initialize vector collection") from e

    def _ensure_collection(self):
        """确保集合存在，若不存在则重新初始化"""
        try:
            # 尝试获取集合，检查是否可用
            self.collection.count()
        except Exception as e:
            logger.warning("Collection may be corrupted, reinitializing: %s", e)
            self._init_collection()

    # ================= 核心写入方法 =================

    def add_document(
        self,
        doc_id: str,
        chunks: List[str],
        metadatas: Optional[List[Dict[str, Any]]] = None,
        chunk_ids: Optional[List[str]] = None,
    ) -> int:
        """
        添加文档的所有块到向量库

        Returns:
            成功添加的块数量
        """
        if not chunks:
            logger.warning("add_document called with empty chunks for doc_id=%s", doc_id)
            return 0

        self._ensure_collection()

        # 生成默认 chunk_ids
        if chunk_ids is None:
            chunk_ids = [f"{doc_id}_{i}" for i in range(len(chunks))]

        # 确保 chunk_ids 数量匹配
        if len(chunk_ids) != len(chunks):
            raise ValueError(f"chunk_ids length ({len(chunk_ids)}) must match chunks length ({len(chunks)})")

        # 填充 metadatas
        if metadatas is None:
            metadatas = [{"doc_id": doc_id} for _ in chunks]
        else:
            # 确保每个 metadata 都包含 doc_id
            for m in metadatas:
                m.setdefault("doc_id", doc_id)
            # 若 metadata 数量不足，补齐
            if len(metadatas) < len(chunks):
                metadatas.extend([{"doc_id": doc_id}] * (len(chunks) - len(metadatas)))

        # 执行添加
        try:
            self.collection.add(
                documents=chunks,
                metadatas=metadatas,
                ids=chunk_ids,
            )
            logger.debug("Added %d chunks for doc_id=%s", len(chunks), doc_id)
            return len(chunks)
        except Exception as e:
            logger.error("Failed to add document %s: %s", doc_id, e, exc_info=True)
            raise RuntimeError(f"Failed to add document {doc_id} to vector store") from e

    def add_documents_batch(
        self,
        documents: List[Dict[str, Any]],
    ) -> Dict[str, int]:
        """
        批量添加文档（每个字典包含 doc_id, chunks, metadatas, chunk_ids）

        Args:
            documents: 文档列表，每项格式：
                {
                    "doc_id": str,
                    "chunks": List[str],
                    "metadatas": Optional[List[Dict]],
                    "chunk_ids": Optional[List[str]],
                }

        Returns:
            {"success": 成功数, "failed": 失败数}
        """
        success_count = 0
        failed_count = 0

        for doc in documents:
            try:
                self.add_document(
                    doc_id=doc["doc_id"],
                    chunks=doc["chunks"],
                    metadatas=doc.get("metadatas"),
                    chunk_ids=doc.get("chunk_ids"),
                )
                success_count += 1
            except Exception as e:
                logger.error("Batch add failed for doc %s: %s", doc.get("doc_id"), e)
                failed_count += 1

        logger.info("Batch add complete: success=%d, failed=%d", success_count, failed_count)
        return {"success": success_count, "failed": failed_count}

    # ================= 核心检索方法 =================

    def search(
        self,
        query: str,
        n_results: int = 5,
        filter_doc_id: Optional[str] = None,
        where: Optional[Dict[str, Any]] = None,
        return_similarity: bool = True,
    ) -> List[Dict[str, Any]]:
        """
        向量语义检索

        Args:
            query: 查询文本
            n_results: 返回结果数
            filter_doc_id: 按文档ID过滤（快捷方式）
            where: 自定义过滤条件，会与 filter_doc_id 合并
            return_similarity: 是否返回相似度（1-distance），默认 True

        Returns:
            结果列表，每个元素包含：
                - id: 块ID
                - content: 文本内容
                - score: 相似度（0~1，越大越相似）或距离值
                - metadata: 元数据
        """
        self._ensure_collection()

        try:
            # 手动计算查询向量
            embedding_fn = self._get_embedding_function()
            query_emb = embedding_fn.embed_query(query)

            # 构造过滤条件
            where_clause = where.copy() if where else {}
            if filter_doc_id:
                if "doc_id" in where_clause:
                    logger.warning("Overriding doc_id filter: %s -> %s", where_clause["doc_id"], filter_doc_id)
                where_clause["doc_id"] = filter_doc_id

            kwargs = {
                "query_embeddings": [query_emb],
                "n_results": n_results,
            }
            if where_clause:
                kwargs["where"] = where_clause

            results = self.collection.query(**kwargs)

            # 解析结果
            items = []
            if results["ids"] and results["ids"][0]:
                for i in range(len(results["ids"][0])):
                    distance = results["distances"][0][i] if results.get("distances") else 0
                    score = 1 - distance if return_similarity else distance
                    items.append({
                        "id": results["ids"][0][i],
                        "content": results["documents"][0][i],
                        "score": round(score, 4),
                        "metadata": results["metadatas"][0][i] if results.get("metadatas") else {},
                    })
            return items

        except Exception as e:
            logger.error("Search failed for query '%s': %s", query[:50], e, exc_info=True)
            return []  # 降级返回空列表

    # ================= 删除与维护方法 =================

    def delete_document(self, doc_id: str) -> bool:
        """删除指定文档的所有块"""
        try:
            self._ensure_collection()
            self.collection.delete(where={"doc_id": doc_id})
            logger.info("Deleted document: %s", doc_id)
            return True
        except Exception as e:
            logger.error("Failed to delete document %s: %s", doc_id, e)
            return False

    def delete_by_ids(self, ids: List[str]) -> bool:
        """根据块ID列表删除"""
        if not ids:
            return True
        try:
            self._ensure_collection()
            self.collection.delete(ids=ids)
            logger.debug("Deleted %d chunks by IDs", len(ids))
            return True
        except Exception as e:
            logger.error("Failed to delete by IDs: %s", e)
            return False

    def delete_by_where(self, where: Dict[str, Any]) -> bool:
        """根据条件删除"""
        try:
            self._ensure_collection()
            self.collection.delete(where=where)
            logger.debug("Deleted chunks by where: %s", where)
            return True
        except Exception as e:
            logger.error("Failed to delete by where %s: %s", where, e)
            return False

    def reset_collection(self) -> bool:
        """重置集合（删除所有数据）"""
        try:
            self.client.delete_collection(self.collection_name)
            self._init_collection()
            logger.warning("Collection reset: %s", self.collection_name)
            return True
        except Exception as e:
            logger.error("Failed to reset collection: %s", e)
            return False

    # ================= 查询与统计方法 =================

    def count(self) -> int:
        """获取集合中的总向量数"""
        try:
            return self.collection.count()
        except Exception as e:
            logger.error("Failed to get count: %s", e)
            return -1

    def get_document_chunks(self, doc_id: str) -> List[Dict[str, Any]]:
        """获取某个文档的所有分块"""
        try:
            self._ensure_collection()
            results = self.collection.get(where={"doc_id": doc_id})
            if not results["ids"]:
                return []

            items = []
            for i in range(len(results["ids"])):
                items.append({
                    "id": results["ids"][i],
                    "content": results["documents"][i],
                    "metadata": results["metadatas"][i] if results.get("metadatas") else {},
                })
            return items
        except Exception as e:
            logger.error("Failed to get chunks for doc %s: %s", doc_id, e)
            return []

    def get_all_documents(self, limit: int = 1000) -> List[Dict[str, Any]]:
        """获取所有文档的摘要信息（用于管理端展示）"""
        try:
            results = self.collection.get(limit=limit)
            if not results["ids"]:
                return []

            # 按 doc_id 分组统计
            doc_stats = {}
            for i in range(len(results["ids"])):
                meta = results["metadatas"][i] if results.get("metadatas") else {}
                doc_id = meta.get("doc_id", "unknown")
                if doc_id not in doc_stats:
                    doc_stats[doc_id] = {"chunk_count": 0, "sample_content": ""}
                doc_stats[doc_id]["chunk_count"] += 1
                if not doc_stats[doc_id]["sample_content"]:
                    doc_stats[doc_id]["sample_content"] = results["documents"][i][:100]

            return [
                {
                    "doc_id": doc_id,
                    "chunk_count": info["chunk_count"],
                    "sample_content": info["sample_content"],
                }
                for doc_id, info in doc_stats.items()
            ]
        except Exception as e:
            logger.error("Failed to get all documents: %s", e)
            return []


# 为了方便导入，保留原函数名
get_vector_store.__doc__ = "获取 VectorStore 单例"