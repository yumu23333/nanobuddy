#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""一次性数据迁移：旧品牌（科吉 / keji）数据 → nanobuddy。

适用场景：在更名（nanobot/keji → nanobuddy）之前部署过的机器上执行一次。

迁移内容：
  1. SQLite：data/keji.db（含 -wal/-shm）→ data/nanobuddy.db
     —— 仅当旧库存在且新库不存在时改名，绝不覆盖新库。
  2. Chroma 向量集合：keji_documents → nanobuddy_documents
     —— 逐批拷贝（含已存储的嵌入向量，不重新计算，离线可用）；
        校验数量一致后删除旧集合（--keep-old 可保留）。

幂等：可重复执行，已迁移的机器再跑只会报告"无需迁移"。

用法：
    venv/Scripts/python.exe scripts/migrate_legacy_data.py [--keep-old]
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
os.chdir(PROJECT_ROOT)  # 让 data/ 等相对路径落在项目根

OLD_DB_STEM = "keji"
NEW_DB_STEM = "nanobuddy"
OLD_COLLECTION = "keji_documents"
NEW_COLLECTION = "nanobuddy_documents"
BATCH = 500  # Chroma 单批上限


def migrate_db(data_dir: Path) -> bool:
    """迁移 SQLite 主库。返回是否有实际迁移动作。"""
    old = data_dir / f"{OLD_DB_STEM}.db"
    new = data_dir / f"{NEW_DB_STEM}.db"
    if not old.exists():
        print(f"[DB] 无旧数据库 {old.name}，跳过")
        return False
    if new.exists():
        print(f"[DB] 新数据库 {new.name} 已存在，保留新库、不动旧库（如需请手动处理）")
        return False
    for suffix in ("-wal", "-shm"):
        side_old = data_dir / f"{OLD_DB_STEM}.db{suffix}"
        if side_old.exists():
            side_old.rename(data_dir / f"{NEW_DB_STEM}.db{suffix}")
            print(f"[DB] 附带迁移 {side_old.name}")
    old.rename(new)
    print(f"[DB] 已迁移 {old.name} → {new.name}")
    return True


def migrate_chroma(keep_old: bool) -> bool:
    """迁移 Chroma 向量集合。返回是否有实际迁移动作。"""
    from core.rag.vector_store import get_vector_store

    vs = get_vector_store(collection_name=NEW_COLLECTION)
    client = vs.client
    existing = {c.name for c in client.list_collections()}
    if OLD_COLLECTION not in existing:
        print(f"[向量] 无旧集合 {OLD_COLLECTION}，跳过")
        return False
    if NEW_COLLECTION not in existing:
        print(f"[向量] 旧集合存在但新集合不存在，开始拷贝 …")

    old_col = client.get_collection(OLD_COLLECTION)
    old_count = old_col.count()
    new_col = client.get_or_create_collection(NEW_COLLECTION)
    new_before = new_col.count()
    if new_before:
        print(f"[向量] 新集合已有 {new_before} 条，将增量拷贝（按 id 覆盖）")

    copied = 0
    offset = 0
    while True:
        batch = old_col.get(
            limit=BATCH,
            offset=offset,
            include=["embeddings", "documents", "metadatas"],
        )
        ids = batch.get("ids") or []
        if not ids:
            break
        new_col.add(
            ids=ids,
            documents=batch.get("documents"),
            metadatas=batch.get("metadatas"),
            embeddings=batch.get("embeddings"),
        )
        copied += len(ids)
        offset += len(ids)
        print(f"[向量] 已拷贝 {copied}/{old_count}")

    new_after = new_col.count()
    print(f"[向量] 拷贝完成：旧 {old_count} 条 → 新 {new_after} 条（本次新增 {new_after - new_before}）")
    if new_after < old_count:
        print("[向量] 警告：新集合数量少于旧集合，请检查后重跑（幂等安全）")
        return False
    if keep_old:
        print(f"[向量] --keep-old 生效，保留旧集合 {OLD_COLLECTION}")
    else:
        client.delete_collection(OLD_COLLECTION)
        print(f"[向量] 已删除旧集合 {OLD_COLLECTION}")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="keji → nanobuddy 存量数据迁移")
    parser.add_argument("--keep-old", action="store_true", help="保留旧向量集合不删除")
    args = parser.parse_args()

    data_dir = PROJECT_ROOT / "data"
    if not data_dir.exists():
        print(f"数据目录不存在：{data_dir}（无需迁移）")
        return 0

    actions = 0
    actions += migrate_db(data_dir)
    try:
        actions += migrate_chroma(args.keep_old)
    except Exception as e:
        print(f"[向量] 迁移失败：{e}")
        print("提示：向量库迁移失败不影响 SQLite 迁移结果；可修复后重跑本脚本。")
        return 1

    if actions:
        print("\n迁移完成。建议重启软件并验证：对话历史、知识库检索是否正常。")
    else:
        print("\n无需迁移（数据已是 nanobuddy 品牌）。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
