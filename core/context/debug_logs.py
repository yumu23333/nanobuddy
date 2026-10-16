"""调试日志缓冲：在内存中保留最近 N 条日志，供前端调试面板拉取"""

import collections
import logging
import threading
import time
from typing import List, Dict, Optional, Any


class MemoryLogHandler(logging.Handler):
    """将日志同时写入内存环形缓冲区，支持按级别、时间、Logger 名称过滤"""

    def __init__(self, capacity: int = 300, level: int = logging.DEBUG):
        """
        Args:
            capacity: 缓冲区最大容量（默认 300）
            level: 该 handler 处理的最低日志级别
        """
        super().__init__()
        self.buffer = collections.deque(maxlen=capacity)
        self.setLevel(level)
        self.setFormatter(
            logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
        )
        # 锁保护缓冲区操作（deque 本身线程安全，但读取时先 copy 再操作）
        self._lock = threading.Lock()

    def emit(self, record: logging.LogRecord) -> None:
        """将日志记录转换为字典并存入缓冲区"""
        # 构建基础条目
        entry: Dict[str, Any] = {
            "timestamp": time.time_ns(),           # 纳秒精度
            "time": self.format(record),           # 格式化时间字符串
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        # 如果有异常信息，添加 exc_info 字段（包含格式化的堆栈）
        if record.exc_info:
            entry["exc_info"] = self.formatException(record.exc_info)
        # 可选：添加模块名、行号等（可根据需要扩展）
        entry["module"] = record.module
        entry["lineno"] = record.lineno

        with self._lock:
            self.buffer.append(entry)

    def get_logs(
        self,
        since: Optional[float] = None,
        limit: int = 100,
        level: Optional[str] = None,
        logger_name: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        获取缓冲区中的日志条目，支持过滤

        Args:
            since: 时间戳（纳秒），只返回 timestamp >= since 的条目
            limit: 最多返回条数（默认 100）
            level: 按日志级别过滤（如 'INFO', 'WARNING'），不区分大小写
            logger_name: 按 Logger 名称前缀过滤（如 'core.agent' 会匹配 core.agent.*）

        Returns:
            符合条件的日志条目列表（按时间从旧到新排列，最多 limit 条）
        """
        with self._lock:
            items = list(self.buffer)

        # 过滤
        if since is not None:
            items = [it for it in items if it["timestamp"] >= since]
        if level:
            level = level.upper()
            items = [it for it in items if it["level"] == level]
        if logger_name:
            items = [it for it in items if it["logger"].startswith(logger_name)]

        # 返回最新的 limit 条（按时间倒序，即最新的在前面，便于前端展示）
        return items[-limit:]

    def clear(self) -> None:
        """清空缓冲区"""
        with self._lock:
            self.buffer.clear()

    def size(self) -> int:
        """返回当前缓冲区中的日志条数"""
        with self._lock:
            return len(self.buffer)

    def stats(self) -> Dict[str, int]:
        """
        返回日志统计信息（各等级计数）
        """
        with self._lock:
            items = list(self.buffer)
        stats = {}
        for it in items:
            level = it["level"]
            stats[level] = stats.get(level, 0) + 1
        return stats


# ---------- 单例管理 ----------
_handler: Optional[MemoryLogHandler] = None
_lock = threading.Lock()


def get_memory_handler(capacity: int = 300, level: int = logging.DEBUG) -> MemoryLogHandler:
    """
    获取全局唯一的 MemoryLogHandler 实例（线程安全）
    如果尚未创建，则创建并添加到根 Logger。
    """
    global _handler
    if _handler is None:
        with _lock:
            if _handler is None:
                _handler = MemoryLogHandler(capacity=capacity, level=level)
                # 添加到根 Logger，捕获所有日志
                root = logging.getLogger()
                root.addHandler(_handler)
                # 如果根 Logger 级别高于 handler 级别，可能导致日志丢失
                # 这里保证根 Logger 至少为 handler 的级别，但不强制更改（由用户控制）
                if root.getEffectiveLevel() > _handler.level:
                    # 可选：发出警告，但不修改用户设置
                    pass
    return _handler


def remove_memory_handler() -> None:
    """
    移除并清空内存日志处理器（用于测试或关闭调试面板）
    """
    global _handler
    if _handler is not None:
        root = logging.getLogger()
        root.removeHandler(_handler)
        _handler = None


# ---------- 自动初始化（模块加载时） ----------
# 使用默认容量 300，级别 DEBUG
# 如果不想自动注册，可以注释下面这行
get_memory_handler()

# 为了方便前端直接调用，暴露常用函数
__all__ = [
    "MemoryLogHandler",
    "get_memory_handler",
    "remove_memory_handler",
]