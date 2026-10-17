"""定时任务（cron）服务与接口的单元测试。"""

import pytest

from core.cron.service import (
    build_schedule,
    cron_store_path,
    job_to_dict,
)
from nanobuddy.cron.service import CronService
from nanobuddy.cron.types import (
    CronJob,
    CronJobState,
    CronPayload,
    CronRunRecord,
    CronSchedule,
)


# ── build_schedule 校验 ──

def test_build_schedule_every():
    s = build_schedule("every", every_ms=600_000)
    assert s.kind == "every" and s.every_ms == 600_000


@pytest.mark.parametrize("bad", [0, -1, None])
def test_build_schedule_every_invalid(bad):
    with pytest.raises(ValueError):
        build_schedule("every", every_ms=bad)


def test_build_schedule_cron_with_tz():
    s = build_schedule("cron", expr="0 9 * * *", tz="Asia/Shanghai")
    assert s.kind == "cron" and s.expr == "0 9 * * *" and s.tz == "Asia/Shanghai"


@pytest.mark.parametrize("bad", ["", "   ", None])
def test_build_schedule_cron_invalid(bad):
    with pytest.raises(ValueError):
        build_schedule("cron", expr=bad)


def test_build_schedule_at():
    s = build_schedule("at", at_ms=1_800_000_000_000)
    assert s.kind == "at" and s.at_ms == 1_800_000_000_000


def test_build_schedule_unknown_kind():
    with pytest.raises(ValueError):
        build_schedule("weekly")


# ── job_to_dict ──

def _job() -> CronJob:
    return CronJob(
        id="abc12345",
        name="每日晨报",
        enabled=True,
        schedule=CronSchedule(kind="cron", expr="0 9 * * *", tz="Asia/Shanghai"),
        payload=CronPayload(kind="agent_turn", message="检查系统状态"),
        state=CronJobState(
            next_run_at_ms=1_800_000_000_000,
            last_run_at_ms=1_799_900_000_000,
            last_status="ok",
            run_history=[CronRunRecord(run_at_ms=1_799_900_000_000 + i, status="ok", duration_ms=10)
                         for i in range(7)],
        ),
        created_at_ms=1_700_000_000_000,
        updated_at_ms=1_700_000_100_000,
    )


def test_job_to_dict_basic():
    d = job_to_dict(_job())
    assert d["id"] == "abc12345"
    assert d["kind"] == "cron" and d["expr"] == "0 9 * * *"
    assert d["message"] == "检查系统状态"
    assert d["system"] is False
    assert d["last_status"] == "ok"
    assert d["run_count"] == 7


def test_job_to_dict_limits_recent_runs():
    d = job_to_dict(_job())
    assert len(d["recent_runs"]) == 5
    # 保留最近的 5 条（run_at_ms 最大的）
    assert d["recent_runs"][-1]["run_at_ms"] == 1_799_900_000_000 + 6


def test_job_to_dict_system_flag():
    job = _job()
    job.payload = CronPayload(kind="system_event", message="heartbeat")
    assert job_to_dict(job)["system"] is True


def test_cron_store_path_under_data():
    p = cron_store_path()
    assert p.name == "jobs.json"
    assert p.parent.name == "cron"
    assert p.parent.parent.name == "data"


# ── CronService 存取往返（临时目录，不碰真实存储） ──

def test_service_add_list_roundtrip(tmp_path):
    svc = CronService(tmp_path / "jobs.json")
    # 未 start() 时走 action 日志，仍需能读回
    svc.add_job("临时任务", CronSchedule(kind="every", every_ms=60_000), "测试消息")
    jobs = svc.list_jobs(include_disabled=True)
    assert len(jobs) == 1
    assert jobs[0].name == "临时任务"
    assert jobs[0].payload.message == "测试消息"

    svc.enable_job(jobs[0].id, enabled=False)
    assert svc.get_job(jobs[0].id).enabled is False
    assert svc.list_jobs(include_disabled=False) == []

    assert svc.remove_job(jobs[0].id) == "removed"
    assert svc.remove_job("nope") == "not_found"
