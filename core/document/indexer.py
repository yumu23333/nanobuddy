import hashlib
import os
import time
import uuid
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional, Callable, List, Dict, Any

from core.document.parser import (
    parse_document, get_file_type, get_doc_category,
    chunk_text, is_supported, get_file_metadata,
)
from core.database.db import get_db
from core.rag.vector_store import get_vector_store
from core.logger import setup_logger

logger = setup_logger("nanobuddy.indexer")

# ---------- 可调参数（可从 settings 或环境变量读取） ----------
DEFAULT_CHUNK_SIZE = 500
DEFAULT_CHUNK_OVERLAP = 100
DEFAULT_MAX_WORKERS = 4
DEFAULT_BATCH_SIZE = 50          # 每批处理文件数，用于批量提交


class FileIndexer:
    """文件索引器，支持批量提交与快速跳过"""

    def __init__(self, max_workers: int = DEFAULT_MAX_WORKERS):
        self._indexing = set()                # 正在处理的任务路径（用于状态查询）
        self._cancel_flags = {}               # 取消标记
        self._lock = threading.Lock()
        self._executor = ThreadPoolExecutor(max_workers=max_workers)

    # ---------- 状态查询与取消 ----------
    def is_indexing(self, path: str = "") -> bool:
        with self._lock:
            if path:
                return path in self._indexing
            return bool(self._indexing)

    def cancel_indexing(self, path: str = ""):
        with self._lock:
            if path:
                self._cancel_flags[path] = True
            else:
                for p in list(self._indexing):
                    self._cancel_flags[p] = True

    def _is_cancelled(self, task_id: str) -> bool:
        """检查指定任务是否被取消"""
        with self._lock:
            return self._cancel_flags.get(task_id, False)

    # ---------- 核心索引：单个文件（保留原接口） ----------
    def index_file(
        self,
        file_path: str,
        chunk_size: int = DEFAULT_CHUNK_SIZE,
        chunk_overlap: int = DEFAULT_CHUNK_OVERLAP,
        progress_callback: Optional[Callable] = None,
    ) -> Optional[dict]:
        """索引单个文件（立即提交，适合独立使用）"""
        abs_path = os.path.abspath(file_path)

        # 1. 快速跳过检查（基于文件修改时间与大小）
        skip_reason = self._should_skip(abs_path)
        if skip_reason == "unchanged":
            logger.debug("Skipping unchanged: %s", abs_path)
            existing = get_db().get_document_by_path(abs_path)
            return existing
        elif skip_reason == "unsupported":
            return None

        # 2. 解析与向量化（核心逻辑）
        result = self._index_file_core(abs_path, chunk_size, chunk_overlap)
        if result is None:
            return None

        # 3. 提交（单条提交）
        self._commit_document(result, delete_old=True)
        logger.info("Indexed: %s (%d chunks)", result["file_name"], result["chunk_count"])
        if progress_callback:
            progress_callback(abs_path, "ok")
        return result

    # ---------- 批量索引目录 ----------
    def index_directory(
        self,
        dir_path: str,
        recursive: bool = True,
        chunk_size: int = DEFAULT_CHUNK_SIZE,
        chunk_overlap: int = DEFAULT_CHUNK_OVERLAP,
        progress_callback: Optional[Callable] = None,
        batch_size: int = DEFAULT_BATCH_SIZE,
    ) -> dict:
        """
        扫描并批量索引整个目录（支持并行处理+批量提交）
        """
        abs_path = os.path.abspath(dir_path)
        if not os.path.isdir(abs_path):
            return {"total": 0, "success": 0, "failed": 0, "files": []}

        # 注册任务
        with self._lock:
            self._indexing.add(abs_path)
            self._cancel_flags[abs_path] = False

        results = {"total": 0, "success": 0, "failed": 0, "files": []}
        file_generator = self._walk_files(abs_path, recursive)

        # 分批处理
        batch = []
        for file_path in file_generator:
            if self._is_cancelled(abs_path):
                break
            batch.append(file_path)
            if len(batch) >= batch_size:
                self._process_batch(batch, abs_path, chunk_size, chunk_overlap,
                                    progress_callback, results)
                batch.clear()
        # 处理剩余
        if batch:
            self._process_batch(batch, abs_path, chunk_size, chunk_overlap,
                                progress_callback, results)

        # 清理任务状态
        with self._lock:
            self._indexing.discard(abs_path)
            self._cancel_flags.pop(abs_path, None)

        return results

    # ---------- 内部辅助方法 ----------

    def _walk_files(self, dir_path: str, recursive: bool):
        """生成器：逐个产出支持的文件路径，避免大列表占用内存"""
        if recursive:
            for root, _, files in os.walk(dir_path):
                for f in files:
                    file_path = os.path.join(root, f)
                    if is_supported(file_path):
                        yield file_path
        else:
            for f in os.listdir(dir_path):
                file_path = os.path.join(dir_path, f)
                if os.path.isfile(file_path) and is_supported(file_path):
                    yield file_path

    def _should_skip(self, abs_path: str) -> str:
        """
        快速判断是否需要跳过该文件
        返回: 'unchanged' / 'unsupported' / ''（表示需要索引）
        """
        if not os.path.isfile(abs_path) or not is_supported(abs_path):
            return "unsupported"

        db = get_db()
        existing = db.get_document_by_path(abs_path)
        if existing:
            # 如果有 mtime 和 size 字段，优先比较（快速）
            if "mtime" in existing and "size" in existing:
                stat = os.stat(abs_path)
                if existing["mtime"] == stat.st_mtime and existing["size"] == stat.st_size:
                    return "unchanged"
            # 否则回退到哈希比较（较慢）
            else:
                hasher = hashlib.md5()
                with open(abs_path, "rb") as f:
                    for chunk in iter(lambda: f.read(65536), b""):
                        hasher.update(chunk)
                if existing.get("content_hash") == hasher.hexdigest():
                    return "unchanged"
        return ""

    def _index_file_core(
        self,
        abs_path: str,
        chunk_size: int,
        chunk_overlap: int,
    ) -> Optional[Dict[str, Any]]:
        """
        核心解析逻辑：提取内容、分块、生成向量与元数据，但不进行持久化
        返回数据结构：
        {
            "doc_id": str,
            "file_path": str,
            "file_name": str,
            "file_type": str,
            "file_size": int,
            "doc_category": str,
            "content_hash": str,
            "chunk_count": int,
            "chunks": list[str],
            "metadatas": list[dict],
            "mtime": float,
        }
        """
        try:
            # 计算文件哈希
            hasher = hashlib.md5()
            with open(abs_path, "rb") as f:
                for chunk in iter(lambda: f.read(65536), b""):
                    hasher.update(chunk)
            content_hash = hasher.hexdigest()

            # 解析文档
            content = parse_document(abs_path)
            if not content:
                logger.warning("Could not parse: %s", abs_path)
                return None

            # 分块
            chunks = chunk_text(content, chunk_size, chunk_overlap)
            if not chunks:
                return None

            # 生成文档 ID
            doc_id = uuid.uuid5(uuid.NAMESPACE_URL, abs_path).hex[:16]
            stat = os.stat(abs_path)

            # 准备元数据
            metadatas = [
                {
                    "doc_id": doc_id,
                    "file_path": abs_path,
                    "file_name": os.path.basename(abs_path),
                    "chunk_index": i,
                    "file_type": get_file_type(abs_path),
                    "category": get_doc_category(abs_path),
                }
                for i in range(len(chunks))
            ]

            return {
                "doc_id": doc_id,
                "file_path": abs_path,
                "file_name": os.path.basename(abs_path),
                "file_type": get_file_type(abs_path),
                "file_size": stat.st_size,
                "doc_category": get_doc_category(abs_path),
                "content_hash": content_hash,
                "chunk_count": len(chunks),
                "chunks": chunks,
                "metadatas": metadatas,
                "mtime": stat.st_mtime,
            }
        except Exception as e:
            logger.error("Index core error: %s -> %s", abs_path, e)
            return None

    def _commit_document(self, doc_data: Dict, delete_old: bool = True):
        """单条提交到数据库和向量库"""
        db = get_db()
        vs = get_vector_store()
        if delete_old:
            vs.delete_document(doc_data["doc_id"])
        # 删除旧记录（若存在）
        db.remove_document(doc_data["doc_id"])  # 会删除元数据，不影响向量
        # 添加向量
        vs.add_document(
            doc_data["doc_id"],
            doc_data["chunks"],
            doc_data["metadatas"]
        )
        # 添加元数据（包括 mtime 和 size）
        db.add_document(
            doc_id=doc_data["doc_id"],
            file_path=doc_data["file_path"],
            file_name=doc_data["file_name"],
            file_type=doc_data["file_type"],
            file_size=doc_data["file_size"],
            doc_category=doc_data["doc_category"],
            content_hash=doc_data["content_hash"],
            chunk_count=doc_data["chunk_count"],
            mtime=doc_data.get("mtime", 0.0),
        )

    def _batch_commit_documents(self, doc_data_list: List[Dict]):
        """
        批量提交：使用 executemany 插入元数据，向量库使用批量添加接口
        （假设向量库有 add_documents 方法，否则退化为循环）
        """
        if not doc_data_list:
            return

        db = get_db()
        vs = get_vector_store()
        conn = db._get_conn()          # 获取底层连接，用于批量操作

        # 1. 收集所有 doc_id，批量删除旧向量
        doc_ids = [d["doc_id"] for d in doc_data_list]
        # 若向量库支持批量删除
        if hasattr(vs, "delete_documents"):
            vs.delete_documents(doc_ids)
        else:
            for did in doc_ids:
                vs.delete_document(did)

        # 2. 批量添加向量（若支持）
        # 构造 (doc_id, chunks, metadatas) 的三元组列表
        if hasattr(vs, "add_documents"):
            vs.add_documents([
                (d["doc_id"], d["chunks"], d["metadatas"])
                for d in doc_data_list
            ])
        else:
            # 回退为循环
            for d in doc_data_list:
                vs.add_document(d["doc_id"], d["chunks"], d["metadatas"])

        # 3. 批量插入元数据（使用 executemany）
        # 假设表已包含 mtime 列（需提前迁移）
        # 字段顺序：id, file_path, file_name, file_type, file_size, doc_category,
        #          content_hash, chunk_count, indexed_at, created_at, last_accessed_at, mtime
        # 我们使用 INSERT OR REPLACE
        now = time.time()
        rows = []
        for d in doc_data_list:
            rows.append((
                d["doc_id"],
                d["file_path"],
                d["file_name"],
                d["file_type"],
                d["file_size"],
                d["doc_category"],
                d["content_hash"],
                d["chunk_count"],
                now,      # indexed_at
                now,      # created_at
                now,      # last_accessed_at
                d["mtime"],
            ))
        conn.executemany("""
            INSERT OR REPLACE INTO documents
            (id, file_path, file_name, file_type, file_size, doc_category,
             content_hash, chunk_count, indexed_at, created_at, last_accessed_at, mtime)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, rows)
        conn.commit()
        logger.info("Batch committed %d documents", len(doc_data_list))

    def _process_batch(
        self,
        file_paths: List[str],
        task_id: str,
        chunk_size: int,
        chunk_overlap: int,
        progress_callback: Optional[Callable],
        results: Dict,
    ):
        """
        处理一批文件：并行执行 _index_file_core，收集结果后批量提交
        """
        if self._is_cancelled(task_id):
            return

        # 提交并行任务
        futures = {}
        for fp in file_paths:
            if self._is_cancelled(task_id):
                break
            future = self._executor.submit(
                self._index_file_core,
                fp, chunk_size, chunk_overlap
            )
            futures[future] = fp

        # 收集结果
        batch_results = []
        for future in as_completed(futures):
            if self._is_cancelled(task_id):
                # 取消剩余未完成的任务（但不强制终止）
                break
            fp = futures[future]
            try:
                doc_data = future.result()
                if doc_data:
                    batch_results.append(doc_data)
                    results["success"] += 1
                    results["files"].append(doc_data)
                else:
                    results["failed"] += 1
            except Exception as e:
                logger.error("Batch worker error: %s", e)
                results["failed"] += 1

            if progress_callback:
                progress_callback(fp, "done")

        # 批量提交
        if batch_results:
            self._batch_commit_documents(batch_results)

        # 更新总数（会在外层累加，但这里也补上）
        results["total"] += len(file_paths)

    # ---------- 删除与统计（保持不变） ----------
    def remove_from_index(self, file_path: str):
        db = get_db()
        doc = db.get_document_by_path(file_path)
        if doc:
            vs = get_vector_store()
            vs.delete_document(doc["id"])
            db.remove_document(doc["id"])
            logger.info("Removed from index: %s", file_path)

    def get_stats(self) -> dict:
        db = get_db()
        vs = get_vector_store()
        doc_stats = db.get_document_stats()
        return {
            **doc_stats,
            "vector_count": vs.count(),
        }


# ---------- 单例工厂 ----------
_indexer_instance: Optional[FileIndexer] = None

def get_indexer() -> FileIndexer:
    global _indexer_instance
    if _indexer_instance is None:
        _indexer_instance = FileIndexer()
    return _indexer_instance