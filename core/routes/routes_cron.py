"""定时任务（cron）REST 接口。

前端「定时」页面通过这些接口管理引擎 CronService 中的任务。
修改类接口要求登录；只读接口在未登录时也可查看（本机部署默认免鉴权）。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from core.cron import service as cron_svc
from core.security.deps import get_current_user
from core.security.users import CurrentUser

router = APIRouter(prefix="/api")


class CronJobCreate(BaseModel):
    name: str = Field(default="", description="任务名称")
    message: str = Field(..., min_length=1, description="到点时交给 Agent 执行的指令")
    kind: str = Field(default="cron", description="at=一次性 / every=周期 / cron=表达式")
    at_ms: int | None = Field(default=None, description="一次性任务的毫秒时间戳")
    every_ms: int | None = Field(default=None, description="周期任务的毫秒间隔")
    expr: str | None = Field(default=None, description="cron 表达式，如 0 9 * * *")
    tz: str | None = Field(default=None, description="cron 表达式的 IANA 时区，如 Asia/Shanghai")
    delete_after_run: bool = Field(default=False, description="一次性任务执行后是否删除")
    deliver: bool = Field(default=False, description="是否推送执行结果（Web 端暂未接渠道）")


class ToggleRequest(BaseModel):
    enabled: bool = Field(..., description="启用或停用")


@router.get("/cron/status")
def cron_status():
    """调度器运行状态与任务概况。"""
    svc = cron_svc.get_cron_service()
    try:
        jobs = svc.list_jobs(include_disabled=True)
    except Exception as e:
        raise HTTPException(500, f"读取定时任务失败：{e}")
    enabled_jobs = [j for j in jobs if j.enabled]
    return {
        "running": cron_svc.is_running(),
        "store": str(cron_svc.cron_store_path()),
        "total": len(jobs),
        "enabled": len(enabled_jobs),
        "next_wake_at_ms": svc.status().get("next_wake_at_ms"),
    }


@router.get("/cron/jobs")
def list_cron_jobs(include_disabled: bool = True):
    """列出全部定时任务。"""
    svc = cron_svc.get_cron_service()
    try:
        jobs = svc.list_jobs(include_disabled=include_disabled)
    except Exception as e:
        raise HTTPException(500, f"读取定时任务失败：{e}")
    return {"jobs": [cron_svc.job_to_dict(j) for j in jobs]}


@router.post("/cron/jobs")
async def create_cron_job(req: CronJobCreate, user: CurrentUser = Depends(get_current_user)):
    """新建定时任务。

    注意：必须是 async——CronService 在保存后会调用 ``_arm_timer``，
    内部 ``asyncio.create_task`` 需要处在事件循环中；写成同步处理器会被
    FastAPI 丢进线程池执行，从而抛「no running event loop」。
    """
    try:
        schedule = cron_svc.build_schedule(
            req.kind,
            at_ms=req.at_ms,
            every_ms=req.every_ms,
            expr=req.expr,
            tz=req.tz,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    svc = cron_svc.get_cron_service()
    name = (req.name or "").strip() or req.message[:30]
    try:
        job = svc.add_job(
            name=name,
            schedule=schedule,
            message=req.message,
            deliver=req.deliver,
            delete_after_run=req.delete_after_run,
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"status": "ok", "job": cron_svc.job_to_dict(job)}


@router.post("/cron/jobs/{job_id}/toggle")
async def toggle_cron_job(job_id: str, req: ToggleRequest, user: CurrentUser = Depends(get_current_user)):
    """启用 / 停用任务。"""
    svc = cron_svc.get_cron_service()
    job = svc.enable_job(job_id, req.enabled)
    if job is None:
        raise HTTPException(404, "任务不存在")
    return {"status": "ok", "job": cron_svc.job_to_dict(job)}


@router.post("/cron/jobs/{job_id}/run")
async def run_cron_job(job_id: str, user: CurrentUser = Depends(get_current_user)):
    """立即执行一次（不受启用状态限制）。"""
    svc = cron_svc.get_cron_service()
    ok = await svc.run_job(job_id, force=True)
    if not ok:
        raise HTTPException(404, "任务不存在")
    job = svc.get_job(job_id)
    return {"status": "ok", "job": cron_svc.job_to_dict(job) if job else None}


@router.delete("/cron/jobs/{job_id}")
async def delete_cron_job(job_id: str, user: CurrentUser = Depends(get_current_user)):
    """删除任务（系统内置任务受保护，不可删）。"""
    svc = cron_svc.get_cron_service()
    result = svc.remove_job(job_id)
    if result == "not_found":
        raise HTTPException(404, "任务不存在")
    if result == "protected":
        raise HTTPException(403, "系统内置任务不可删除")
    return {"status": "ok"}
