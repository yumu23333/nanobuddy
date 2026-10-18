# -*- coding: utf-8 -*-
"""知识库索引进度：is_indexing / get_progress 聚合与清理。"""
import os

from core.document.indexer import FileIndexer


def test_get_progress_idle_is_none():
    idx = FileIndexer(max_workers=1)
    assert idx.get_progress() is None


def test_get_progress_aggregation():
    idx = FileIndexer(max_workers=1)
    with idx._lock:
        idx._progress["/a"] = {"total": 10, "done": 4, "current_file": "x", "phase": "indexing"}
        idx._progress["/b"] = {"total": 20, "done": 5, "current_file": "y", "phase": "scanning"}
    agg = idx.get_progress()
    assert agg["total"] == 30
    assert agg["done"] == 9
    # 存在 indexing 阶段 → 聚合 phase 为 indexing
    assert agg["phase"] == "indexing"
    assert agg["current_file"] == "x"


def test_get_progress_by_path():
    idx = FileIndexer(max_workers=1)
    with idx._lock:
        idx._progress["/a"] = {"total": 5, "done": 2, "current_file": "z", "phase": "indexing"}
    p = idx.get_progress("/a")
    assert p["total"] == 5 and p["done"] == 2


def test_index_directory_empty_dir_cleans_progress(tmp_path):
    # 空目录：total=0，结束后进度被清理
    idx = FileIndexer(max_workers=1)
    res = idx.index_directory(str(tmp_path), recursive=True)
    assert res["total"] == 0
    assert idx.get_progress() is None
    assert not idx.is_indexing()
