"""数据库连接与管理工具 — 支持 SQLite / MySQL / PostgreSQL

提供两个入口：
1. @register_tool 装饰器注册，可通过 CLI 子进程或 nanobuddy 适配器调用
2. 直接 import 函数给 SmartQueryService 使用

连接管理策略：
- nanobuddy 适配器：内存持久化（推荐）
- CLI 子进程：JSON 文件持久化到 data/db_connections/
"""

import json
import os
import time
import uuid
import threading
from typing import Optional

from core.logger import setup_logger

logger = setup_logger("nanobuddy.db_tools")

# 连接持久化目录（CLI 子进程模式）
_CONN_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "db_connections")
_CONN_LOCK = threading.Lock()


def _conn_path(conn_id: str) -> str:
    os.makedirs(_CONN_DIR, exist_ok=True)
    return os.path.join(_CONN_DIR, f"{conn_id}.json")


def _save_conn(conn_id: str, info: dict):
    with _CONN_LOCK:
        with open(_conn_path(conn_id), "w", encoding="utf-8") as f:
            json.dump(info, f, ensure_ascii=False)


def _load_conn(conn_id: str) -> Optional[dict]:
    path = _conn_path(conn_id)
    if not os.path.exists(path):
        return None
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def _remove_conn(conn_id: str):
    path = _conn_path(conn_id)
    try:
        if os.path.exists(path):
            os.remove(path)
    except Exception:
        logger.debug("清理临时数据库文件失败", exc_info=True)


def _get_mysql_connection(config: dict):
    """创建 MySQL 连接"""
    import pymysql
    return pymysql.connect(
        host=config["host"],
        port=int(config.get("port", 3306)),
        user=config["username"],
        password=config.get("password", ""),
        database=config["database"],
        charset="utf8mb4",
        connect_timeout=10,
    )


def _get_pg_connection(config: dict):
    """创建 PostgreSQL 连接"""
    import psycopg2
    return psycopg2.connect(
        host=config["host"],
        port=int(config.get("port", 5432)),
        user=config["username"],
        password=config.get("password", ""),
        dbname=config["database"],
        connect_timeout=10,
    )




def _get_mssql_connection(config: dict):
    """创建 SQL Server 连接"""
    import pyodbc
    port = config.get('port', 1433)
    conn_str = f'DRIVER={{ODBC Driver 17 for SQL Server}};SERVER={config["host"]},{port};DATABASE={config["database"]};UID={config["username"]};PWD={config.get("password", "")}'
    return pyodbc.connect(conn_str)


def _get_sqlite_connection(config: dict):
    """创建 SQLite 连接"""
    import sqlite3
    db_path = config.get('database', '')
    return sqlite3.connect(db_path)


def _create_connection(config: dict):
    db_type = config.get("db_type", "mysql").lower()
    if db_type == "mysql":
        return _get_mysql_connection(config)
    elif db_type == "postgresql":
        return _get_pg_connection(config)
    elif db_type == "sqlserver":
        return _get_mssql_connection(config)
    elif db_type == "sqlite":
        return _get_sqlite_connection(config)
    raise ValueError(f"不支持的数据库类型: {db_type}")




def _mssql_list_tables(conn) -> list[dict]:
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT TABLE_NAME, TABLE_TYPE, TABLE_SCHEMA FROM INFORMATION_SCHEMA.TABLES ORDER BY TABLE_NAME")
        return [{"table_name": r[0], "table_type": r[1], "table_schema": r[2]} for r in cursor.fetchall()]
    finally:
        cursor.close()


def _sqlite_list_tables(conn) -> list[dict]:
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT name, 'TABLE' as table_type, 'main' as table_schema FROM sqlite_master WHERE type='table' ORDER BY name")
        return [{"table_name": r[0], "table_type": r[1], "table_schema": r[2]} for r in cursor.fetchall()]
    finally:
        cursor.close()

def _mysql_list_tables(conn) -> list[dict]:
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT table_name, table_type, table_schema FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name")
        return [{"table_name": r[0], "table_type": r[1], "table_schema": r[2]} for r in cursor.fetchall()]
    finally:
        cursor.close()


def _pg_list_tables(conn) -> list[dict]:
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT table_name, table_type, table_schema FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name")
        return [{"table_name": r[0], "table_type": r[1], "table_schema": r[2]} for r in cursor.fetchall()]
    finally:
        cursor.close()


def db_connect(db_type: str = "mysql", host: str = "localhost", port: int = 3306,
               database: str = "", username: str = "", password: str = "") -> str:
    """连接数据库，返回连接ID"""
    config = {"db_type": db_type, "host": host, "port": port,
              "database": database, "username": username, "password": password}
    try:
        conn = _create_connection(config)
        conn_id = uuid.uuid4().hex[:12]
        _save_conn(conn_id, config)
        conn.close()
        if db_type == "sqlite":
            return f"✅ 数据库连接成功！连接ID: {conn_id}\n类型: {db_type} | 文件: {database}"
        return f"✅ 数据库连接成功！连接ID: {conn_id}\n类型: {db_type} | 主机: {host}:{port} | 数据库: {database}"
    except Exception as e:
        return f"❌ 数据库连接失败: {str(e)}"


def db_test_connection(db_type: str = "mysql", host: str = "localhost", port: int = 3306,
                       database: str = "", username: str = "", password: str = "") -> str:
    """测试数据库连接是否可用"""
    config = {"db_type": db_type, "host": host, "port": port,
              "database": database, "username": username, "password": password}
    try:
        conn = _create_connection(config)
        conn.close()
        return "✅ 连接测试成功！数据库连接可用。"
    except Exception as e:
        return f"❌ 连接测试失败: {str(e)}"




def _mssql_describe_table(conn, table_name: str) -> dict:
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = ? ORDER BY ORDINAL_POSITION", (table_name,))
        columns = [{"column_name": r[0], "data_type": r[1], "is_nullable": r[2] == "YES", "column_default": r[3]} for r in cursor.fetchall()]
        
        cursor.execute("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE WHERE TABLE_NAME = ? AND CONSTRAINT_NAME IN (SELECT CONSTRAINT_NAME FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS WHERE TABLE_NAME = ? AND CONSTRAINT_TYPE = 'PRIMARY KEY')", (table_name, table_name))
        primary_keys = [r[0] for r in cursor.fetchall()]
        
        return {"table_name": table_name, "columns": columns, "primary_keys": primary_keys, "foreign_keys": [], "table_comment": ""}
    finally:
        cursor.close()


def _is_safe_sql_identifier(name: str) -> bool:
    """仅允许标准 SQL 标识符（字母/下划线开头，且仅含字母数字下划线），杜绝注入。"""
    import re
    return bool(re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name or ""))


def _sqlite_describe_table(conn, table_name: str) -> dict:
    if not _is_safe_sql_identifier(table_name):
        raise ValueError(f"非法的表名: {table_name!r}")
    cursor = conn.cursor()
    try:
        cursor.execute(f"PRAGMA table_info({table_name})")
        columns = []
        for row in cursor.fetchall():
            col_name, col_type, not_null, dflt_value, pk = row[1], row[2], row[3], row[4], row[5]
            columns.append({
                "column_name": col_name,
                "data_type": col_type,
                "is_nullable": not not_null,
                "column_default": dflt_value,
                "comment": ""
            })
        
        primary_keys = [col["column_name"] for col in columns if col.get("primary_key", False) or ("PRIMARY KEY" in str(col.get("data_type", "")))]
        if not primary_keys:
            cursor.execute(
                "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql LIKE '%PRIMARY KEY%'",
                (table_name,),
            )
            idx_result = cursor.fetchone()
            if idx_result:
                cursor.execute(f"PRAGMA index_info({idx_result[0]})")
                for row in cursor.fetchall():
                    primary_keys.append(row[2])
        
        return {"table_name": table_name, "columns": columns, "primary_keys": list(set(primary_keys)), "foreign_keys": [], "table_comment": ""}
    finally:
        cursor.close()

def db_list_tables(connection_id: str = "") -> str:
    """列出数据库中的表"""
    info = _load_conn(connection_id)
    if not info:
        return "❌ 连接ID无效或已过期，请重新连接"
    try:
        conn = _create_connection(info)
        db_type = info.get("db_type", "mysql")
        if db_type == "mysql":
            tables = _mysql_list_tables(conn)
        elif db_type == "postgresql":
            tables = _pg_list_tables(conn)
        elif db_type == "sqlserver":
            tables = _mssql_list_tables(conn)
        elif db_type == "sqlite":
            tables = _sqlite_list_tables(conn)
        else:
            tables = _mysql_list_tables(conn)
        conn.close()
        if not tables:
            return "数据库中没有表"
        lines = [f"📋 共 {len(tables)} 个表："]
        for t in tables:
            lines.append(f"  - {t['table_name']}  ({t.get('table_type', 'TABLE')})")
        return "\n".join(lines)
    except Exception as e:
        return f"❌ 获取表列表失败: {str(e)}"


def _mysql_describe_table(conn, table_name: str) -> dict:
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT column_name, data_type, is_nullable, column_default, character_maximum_length, column_comment FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = %s ORDER BY ordinal_position", (table_name,))
        columns = [{"column_name": r[0], "data_type": r[1], "is_nullable": r[2] == "YES", "column_default": r[3], "max_length": r[4], "comment": r[5] or ""} for r in cursor.fetchall()]

        cursor.execute("SELECT column_name FROM information_schema.key_column_usage WHERE table_schema = DATABASE() AND table_name = %s AND constraint_name = 'PRIMARY'", (table_name,))
        primary_keys = [r[0] for r in cursor.fetchall()]

        cursor.execute("SELECT column_name, referenced_table_name, referenced_column_name FROM information_schema.key_column_usage WHERE table_schema = DATABASE() AND table_name = %s AND referenced_table_name IS NOT NULL", (table_name,))
        foreign_keys = [{"column": r[0], "ref_table": r[1], "ref_column": r[2]} for r in cursor.fetchall()]

        cursor.execute("SELECT table_comment FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = %s", (table_name,))
        table_comment = (cursor.fetchone() or [""])[0] or ""

        return {"table_name": table_name, "columns": columns, "primary_keys": primary_keys, "foreign_keys": foreign_keys, "table_comment": table_comment}
    finally:
        cursor.close()


def _pg_describe_table(conn, table_name: str) -> dict:
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = %s AND table_schema = 'public' ORDER BY ordinal_position", (table_name,))
        columns = [{"column_name": r[0], "data_type": r[1], "is_nullable": r[2] == "YES", "column_default": r[3]} for r in cursor.fetchall()]

        cursor.execute("SELECT column_name FROM information_schema.key_column_usage WHERE table_name = %s AND table_schema = 'public' AND constraint_name IN (SELECT constraint_name FROM information_schema.table_constraints WHERE table_name = %s AND constraint_type = 'PRIMARY KEY')", (table_name, table_name))
        primary_keys = [r[0] for r in cursor.fetchall()]

        cursor.execute("SELECT column_name, referenced_table_name, referenced_column_name FROM information_schema.key_column_usage WHERE table_name = %s AND table_schema = 'public' AND referenced_table_name IS NOT NULL", (table_name,))
        foreign_keys = [{"column": r[0], "ref_table": r[1], "ref_column": r[2]} for r in cursor.fetchall()]

        return {"table_name": table_name, "columns": columns, "primary_keys": primary_keys, "foreign_keys": foreign_keys, "table_comment": ""}
    finally:
        cursor.close()


def db_describe_table(connection_id: str = "", table_name: str = "") -> str:
    """获取表结构详情"""
    info = _load_conn(connection_id)
    if not info:
        return "❌ 连接ID无效或已过期，请重新连接"
    try:
        conn = _create_connection(info)
        db_type = info.get("db_type", "mysql")
        if db_type == "mysql":
            schema = _mysql_describe_table(conn, table_name)
        elif db_type == "postgresql":
            schema = _pg_describe_table(conn, table_name)
        elif db_type == "sqlserver":
            schema = _mssql_describe_table(conn, table_name)
        elif db_type == "sqlite":
            schema = _sqlite_describe_table(conn, table_name)
        else:
            schema = _mysql_describe_table(conn, table_name)
        conn.close()

        lines = [f"📋 表: {schema['table_name']}"]
        if schema.get("table_comment"):
            lines.append(f"  注释: {schema['table_comment']}")

        lines.append("\n  字段:")
        for col in schema["columns"]:
            nullable = "NULL" if col["is_nullable"] else "NOT NULL"
            comment = f" — {col.get('comment', '')}" if col.get('comment') else ""
            lines.append(f"    {col['column_name']}  ({col['data_type']})  {nullable}{comment}")

        if schema.get("primary_keys"):
            lines.append(f"\n  主键: {', '.join(schema['primary_keys'])}")
        if schema.get("foreign_keys"):
            lines.append("  外键:")
            for fk in schema["foreign_keys"]:
                lines.append(f"    {fk['column']} → {fk['ref_table']}.{fk['ref_column']}")

        return "\n".join(lines)
    except Exception as e:
        return f"❌ 获取表结构失败: {str(e)}"


def _has_real_limit(sql: str) -> bool:
    """判断 SQL 是否已包含真正的 LIMIT/TOP 子句（忽略注释与字符串字面量中的同名词）。"""
    import re
    cleaned = re.sub(r"--[^\n]*", " ", sql)
    cleaned = re.sub(r"/\*.*?\*/", " ", cleaned, flags=re.DOTALL)
    cleaned = re.sub(r"'[^']*'", "''", cleaned)
    cleaned = re.sub(r'"[^"]*"', '""', cleaned)
    up = cleaned.upper()
    if re.search(r"\bLIMIT\s+\d+", up):
        return True
    if re.search(r"\bTOP\s+\d+", up):
        return True
    return False


def db_execute_query(connection_id: str = "", sql: str = "", limit: int = 100) -> str:
    """执行 SQL 查询并返回结果"""
    info = _load_conn(connection_id)
    if not info:
        return "❌ 连接ID无效或已过期，请重新连接"
    try:
        conn = _create_connection(info)
        cursor = conn.cursor()
        db_type = info.get("db_type", "mysql")
        try:
            final_sql = sql
            if limit > 0 and not _has_real_limit(final_sql) and final_sql.strip().upper().startswith("SELECT"):
                if db_type == "sqlserver":
                    final_sql = final_sql.replace("SELECT", f"SELECT TOP {limit}", 1)
                else:
                    final_sql = final_sql.rstrip(";") + f" LIMIT {limit}"
            cursor.execute(final_sql)

            if cursor.description:
                columns = [desc[0] for desc in cursor.description]
                rows = cursor.fetchall()
                # 格式化结果
                result_lines = [f"📊 查询结果 ({len(rows)} 行, {len(columns)} 列):"]
                result_lines.append("  " + " | ".join(f"{c[:20]}" for c in columns))
                result_lines.append("  " + "-" * min(80, len(columns) * 22))
                for row in rows[:50]:
                    vals = []
                    for v in row:
                        if v is None:
                            vals.append("NULL")
                        elif isinstance(v, (int, float)):
                            vals.append(str(v))
                        else:
                            s = str(v)[:30]
                            vals.append(s)
                    result_lines.append("  " + " | ".join(vals))
                if len(rows) > 50:
                    result_lines.append(f"  ... 仅显示前 50 行, 共 {len(rows)} 行")
                return "\n".join(result_lines)
            else:
                rowcount = cursor.rowcount if hasattr(cursor, 'rowcount') else 0
                return f"✅ 查询执行成功，影响 {rowcount} 行"
        finally:
            cursor.close()
            conn.close()
    except Exception as e:
        return f"❌ 查询执行失败: {str(e)}"


def db_disconnect(connection_id: str = "") -> str:
    """断开数据库连接"""
    _remove_conn(connection_id)
    return f"✅ 连接 {connection_id} 已断开"


def db_get_schema_full(connection_id: str = "", table_name: str = "") -> dict:
    """获取完整表结构（返回dict，供智能问数服务使用，不经过CLI）"""
    info = _load_conn(connection_id)
    if not info:
        return {"error": "连接无效"}
    try:
        conn = _create_connection(info)
        db_type = info.get("db_type", "mysql")
        if db_type == "mysql":
            schema = _mysql_describe_table(conn, table_name)
        elif db_type == "postgresql":
            schema = _pg_describe_table(conn, table_name)
        elif db_type == "sqlserver":
            schema = _mssql_describe_table(conn, table_name)
        elif db_type == "sqlite":
            schema = _sqlite_describe_table(conn, table_name)
        else:
            schema = _mysql_describe_table(conn, table_name)
        conn.close()
        return schema
    except Exception as e:
        return {"error": str(e)}


def db_get_tables_list(connection_id: str = "") -> list[dict]:
    """获取表列表（返回dict列表，供智能问数服务使用）"""
    info = _load_conn(connection_id)
    if not info:
        return []
    try:
        conn = _create_connection(info)
        db_type = info.get("db_type", "mysql")
        if db_type == "mysql":
            tables = _mysql_list_tables(conn)
        elif db_type == "postgresql":
            tables = _pg_list_tables(conn)
        elif db_type == "sqlserver":
            tables = _mssql_list_tables(conn)
        elif db_type == "sqlite":
            tables = _sqlite_list_tables(conn)
        else:
            tables = _mysql_list_tables(conn)
        conn.close()
        return tables
    except Exception:
        return []


# ---- 注册为nanobuddy工具（通过 @register_tool 装饰器） ----

from core.tools.registry_tools import register_tool  # noqa: E402

register_tool(
    name="db_connect",
    description="连接数据库（MySQL/PostgreSQL/SQL Server/SQLite），返回连接ID",
    parameters={
        "db_type": {"type": "string", "description": "数据库类型: mysql、postgresql、sqlserver、sqlite"},
        "host": {"type": "string", "description": "主机地址，默认 localhost（SQLite不需要）"},
        "port": {"type": "integer", "description": "端口，MySQL默认3306，PostgreSQL默认5432，SQL Server默认1433"},
        "database": {"type": "string", "description": "数据库名称（SQLite为文件路径）"},
        "username": {"type": "string", "description": "用户名（SQLite不需要）"},
        "password": {"type": "string", "description": "密码（SQLite不需要）"},
    },
    category="database",
    timeout=15,
)(db_connect)

register_tool(
    name="db_list_tables",
    description="列出数据库中的所有表",
    parameters={
        "connection_id": {"type": "string", "description": "数据库连接ID"},
    },
    category="database",
    timeout=15,
)(db_list_tables)

register_tool(
    name="db_describe_table",
    description="查看表结构详情（字段名、类型、主键、外键等）",
    parameters={
        "connection_id": {"type": "string", "description": "数据库连接ID"},
        "table_name": {"type": "string", "description": "表名"},
    },
    category="database",
    timeout=15,
)(db_describe_table)

register_tool(
    name="db_execute_query",
    description="执行 SQL 查询语句并返回结果",
    parameters={
        "connection_id": {"type": "string", "description": "数据库连接ID"},
        "sql": {"type": "string", "description": "SQL 查询语句，如 SELECT * FROM users"},
        "limit": {"type": "integer", "description": "返回行数上限，默认100"},
    },
    category="database",
    timeout=60,
)(db_execute_query)

register_tool(
    name="db_test_connection",
    description="测试数据库连接是否可用（MySQL/PostgreSQL/SQL Server/SQLite）",
    parameters={
        "db_type": {"type": "string", "description": "数据库类型: mysql、postgresql、sqlserver、sqlite"},
        "host": {"type": "string", "description": "主机地址（SQLite不需要）"},
        "port": {"type": "integer", "description": "端口"},
        "database": {"type": "string", "description": "数据库名称（SQLite为文件路径）"},
        "username": {"type": "string", "description": "用户名（SQLite不需要）"},
        "password": {"type": "string", "description": "密码（SQLite不需要）"},
    },
    category="database",
    timeout=15,
)(db_test_connection)

register_tool(
    name="db_disconnect",
    description="断开数据库连接",
    parameters={
        "connection_id": {"type": "string", "description": "数据库连接ID"},
    },
    category="database",
    timeout=5,
)(db_disconnect)
