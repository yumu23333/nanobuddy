"""Web 端定时任务服务。

引擎的 CronService 原本只在 CLI 里实例化，Web 应用从未启动调度器——
本模块补上这一环：单例持有 CronService，到点用独立会话跑一次 Agent。

任务存储沿用引擎格式（data/cron/jobs.json），因此 CLI 与 Agent 的
CronTool 增删的任务在这里同样可见。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from loguru import logger

from nanobuddy.cron.service import CronService
from nanobuddy.cron.types import CronJob, CronSchedule

# 本文件位于 core/cron/ 下，项目根需向上退 3 级
_PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
_STORE_REL = Path("data") / "cron" / "jobs.json"

_service: CronService | None = None


def cron_store_path() -> Path:
    """任务持久化文件路径。"""
    return _PROJECT_ROOT / _STORE_REL


async def _on_job(job: CronJob) -> str | None:
    """到点执行：以独立会话跑一次 Agent 对话。"""
    from nanobuddy.adapter import get_adapter

    adapter = await get_adapter()
    # 每个任务固定一个会话，便于在历史里回溯执行记录
    sid = f"cron:{job.id}"
    result = await adapter.chat(job.payload.message, sid=sid)
    logger.info(
        "定时任务 '{}' ({}) 执行完成，输出 {} 字符",
        job.name,
        job.id,
        len(result or ""),
    )
    return result


def get_cron_service() -> CronService:
    """获取（或惰性创建）全局单例 CronService。"""
    global _service
    if _service is None:
        _service = CronService(cron_store_path(), on_job=_on_job)
    return _service


async def start_cron_service() -> bool:
    """启动调度器。失败只告警，不阻断主服务。"""
    try:
        svc = get_cron_service()
        await svc.start()
        logger.info(
            "定时任务服务已启动：{} 个任务，存储 {}",
            len(svc.list_jobs(include_disabled=True)),
            cron_store_path(),
        )
        return True
    except Exception as e:
        logger.warning("定时任务服务启动失败（定时任务不可用）：{}", e)
        return False


def stop_cron_service() -> None:
    """停止调度器（不落盘删除任务）。"""
    global _service
    if _service is None:
        return
    try:
        _service.stop()
        logger.info("定时任务服务已停止")
    except Exception as e:
        logger.debug("停止定时任务服务失败: {}", e)


def is_running() -> bool:
    svc = _service
    return bool(svc and svc._running)


def job_to_dict(job: CronJob) -> dict[str, Any]:
    """CronJob → 前端友好的 dict。"""
    return {
        "id": job.id,
        "name": job.name,
        "enabled": job.enabled,
        "kind": job.schedule.kind,
        "at_ms": job.schedule.at_ms,
        "every_ms": job.schedule.every_ms,
        "expr": job.schedule.expr,
        "tz": job.schedule.tz,
        "message": job.payload.message,
        "deliver": job.payload.deliver,
        "system": job.payload.kind == "system_event",
        "delete_after_run": job.delete_after_run,
        "next_run_at_ms": job.state.next_run_at_ms,
        "last_run_at_ms": job.state.last_run_at_ms,
        "last_status": job.state.last_status,
        "last_error": job.state.last_error,
        "created_at_ms": job.created_at_ms,
        "updated_at_ms": job.updated_at_ms,
        "run_count": len(job.state.run_history),
        "recent_runs": [
            {
                "run_at_ms": r.run_at_ms,
                "status": r.status,
                "duration_ms": r.duration_ms,
                "error": r.error,
            }
            for r in job.state.run_history[-5:]
        ],
    }


def build_schedule(
    kind: str,
    *,
    at_ms: int | None = None,
    every_ms: int | None = None,
    expr: str | None = None,
    tz: str | None = None,
) -> CronSchedule:
    """按请求参数构造并校验调度定义。"""
    kind = (kind or "").strip().lower()
    if kind == "at":
        if not at_ms or at_ms <= 0:
            raise ValueError("一次性任务需要合法的 at_ms（毫秒时间戳）")
        return CronSchedule(kind="at", at_ms=int(at_ms))
    if kind == "every":
        if not every_ms or every_ms <= 0:
            raise ValueError("周期任务需要 every_ms > 0（毫秒间隔）")
        return CronSchedule(kind="every", every_ms=int(every_ms))
    if kind == "cron":
        if not expr or not str(expr).strip():
            raise ValueError("cron 任务需要表达式 expr，如 '0 9 * * *'")
        return CronSchedule(kind="cron", expr=str(expr).strip(), tz=tz or None)
    raise ValueError(f"不支持的调度类型：{kind}（可选 at / every / cron）")
