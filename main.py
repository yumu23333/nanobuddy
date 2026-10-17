"""nanobuddy AI 助手 - 基于 nanobuddy 引擎的 FastAPI 服务"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from loguru import logger
from pydantic import BaseModel, Field

from core.routes.routes_api import router as api_router
from core.routes.routes_auth import router as auth_router
from core.routes.routes_admin import router as admin_router
from core.routes.routes_security import router as security_router
from core.security.auth import APIKeyMiddleware, get_security_settings
from core.security.context import clear_request_context, set_request_context
from core.security.users import bootstrap_admin_if_needed
from core.security.chat_session import resolve_chat_ids
from core.wechat.work_bridge import router as work_router

async def get_adapter():
    """全系统共享同一个 NanoBuddyAdapter 实例（委托给 nanobuddy.adapter 模块的单例）"""
    from nanobuddy.adapter import get_adapter as _get_nanobuddy_adapter
    return await _get_nanobuddy_adapter()


@asynccontextmanager
async def lifespan(app: FastAPI):
    sec = get_security_settings(reload=True)
    bootstrap_admin_if_needed()
    try:
        from core.path_policy.workspace import ensure_layout

        from core.database.db import get_db
        from core.path_policy.workspace import ensure_user_dir

        ws = ensure_layout()
        for row in get_db().list_users():
            ensure_user_dir(row["id"])
        logger.info("团队文件工作区: {}", ws)
    except Exception as e:
        logger.warning("初始化文件工作区失败: {}", e)
    if sec.enabled:
        logger.info(
            "鉴权已启用 mode={} localhost_skip={}",
            sec.auth_mode,
            sec.allow_localhost_without_auth,
        )
        # 启动时校验 JWT 密钥强度（过短仅告警；内部按需自动生成强密钥）
        try:
            from core.security.users import _jwt_settings

            _jwt_settings()
        except Exception as e:
            logger.warning("JWT 密钥校验失败: {}", e)
    else:
        logger.warning("API 鉴权未启用：请在 config.yaml 的 security 段配置")

    async def _init_engine() -> None:
        await asyncio.sleep(0)  # 先让出，避免阻塞 lifespan 到达 yield
        try:
            ad = await get_adapter()
            await ad.start_feishu_bridge()
            logger.info("NanoBuddy启动完成（nanobuddy 引擎）")
        except Exception as e:
            logger.exception("后台引擎初始化失败: {}", e)

    init_task = asyncio.create_task(_init_engine())
    yield
    init_task.cancel()
    try:
        await init_task
    except asyncio.CancelledError:
        pass
    try:
        ad = await get_adapter()
        await ad.stop_feishu_bridge()
    except Exception:
        pass


app = FastAPI(title="NanoBuddy", docs_url=None, redoc_url=None, lifespan=lifespan)
app.add_middleware(APIKeyMiddleware)
app.include_router(api_router)
app.include_router(auth_router)
app.include_router(admin_router)
app.include_router(security_router)
app.include_router(work_router)


static_dir = os.path.join(os.path.dirname(__file__), "web")
if os.path.isdir(static_dir):
    from fastapi.staticfiles import StaticFiles
    app.mount("/static", StaticFiles(directory=static_dir, check_dir=False), name="static")


# ── 请求模型 ──

class ChatRequest(BaseModel):
    query: str = Field(..., min_length=1, description="用户输入")
    session_id: str = Field(default="", description="会话ID")
    conversation_id: str = Field(default="", description="对话ID")
    files: list[str] = Field(default=[], description="已上传文件路径")


class ResetRequest(BaseModel):
    session_id: str = Field(default="", description="会话ID")


class RegenerateRequest(BaseModel):
    conversation_id: str = Field(default="", description="对话ID")
    message_index: int = Field(..., ge=0, description="目标消息序号（0 起，按会话消息顺序）")
    mode: str = Field(default="regenerate", description="regenerate=重新生成助手回复；edit=编辑用户消息重发")
    query: str = Field(default="", description="edit 模式下编辑后的新文本")
    session_id: str = Field(default="", description="会话ID（兼容旧字段）")


# ── 前端页面 ──

_cache_buster: str = ""

def _get_cache_buster() -> str:
    global _cache_buster
    if not _cache_buster:
        import time
        _cache_buster = str(int(time.time() * 1000))
    return _cache_buster


def get_html() -> str:
    html_path = os.path.join(os.path.dirname(__file__), "web", "index.html")
    try:
        with open(html_path, "r", encoding="utf-8") as f:
            return f.read()
    except FileNotFoundError:
        return "<h1>前端页面未找到</h1>"


@app.get("/", response_class=HTMLResponse)
def home():
    from starlette.responses import Response
    content = get_html().replace("v=VERSION", "v=" + _get_cache_buster())
    return Response(content=content, media_type="text/html",
                    headers={"Cache-Control": "no-cache, no-store, must-revalidate",
                             "Pragma": "no-cache", "Expires": "0"})


# ── 对话接口 ──

@app.post("/chat")
async def chat(req: ChatRequest, request: Request):
    adapter = await get_adapter()
    sid, conv_id, user = resolve_chat_ids(
        request, session_id=req.session_id, conversation_id=req.conversation_id
    )
    set_request_context(
        session_id=sid,
        client_ip=request.client.host if request.client else "",
        actor=user.username if user else "api",
        user_id=user.id if user else "",
        role=user.role if user else "",
    )
    reply = await adapter.chat(query=req.query, sid=sid, files=req.files or None)
    return {"reply": reply, "session_id": sid, "conversation_id": conv_id}


@app.post("/chat/stream")
async def chat_stream(req: ChatRequest, request: Request):
    adapter = await get_adapter()
    sid, conv_id, user = resolve_chat_ids(
        request, session_id=req.session_id, conversation_id=req.conversation_id
    )
    set_request_context(
        session_id=sid,
        client_ip=request.client.host if request.client else "",
        actor=user.username if user else "api",
        user_id=user.id if user else "",
        role=user.role if user else "",
    )

    async def generate():
        async for event_str in adapter.chat_stream(query=req.query, sid=sid, files=req.files or None):
            yield f"data: {event_str}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"X-Session-Id": sid, "X-Conversation-Id": conv_id},
    )


@app.post("/chat/stop")
async def stop_chat(session_id: str = "", conversation_id: str = ""):
    adapter = await get_adapter()
    sid = conversation_id or session_id
    triggered = adapter.cancel_chat(sid)
    if triggered:
        return {"status": "ok", "message": "已中断对话", "session_id": sid}
    return {"status": "warning", "message": "未找到正在执行的对话", "session_id": sid}


@app.post("/chat/reset")
async def reset_chat(req: ResetRequest):
    adapter = await get_adapter()
    await adapter.reset_session(req.session_id)
    return {"status": "ok", "message": "会话已重置"}


@app.post("/chat/regenerate")
async def chat_regenerate(req: RegenerateRequest, request: Request):
    """重新生成 / 编辑重发：截断锚点之后的会话，以原问（或编辑后的新文本）重跑。"""
    adapter = await get_adapter()
    sid, conv_id, user = resolve_chat_ids(
        request, session_id=req.session_id, conversation_id=req.conversation_id
    )
    set_request_context(
        session_id=sid,
        client_ip=request.client.host if request.client else "",
        actor=user.username if user else "api",
        user_id=user.id if user else "",
        role=user.role if user else "",
    )
    from core.database.db import get_db
    from core.context.chat_persist import truncate_engine_session

    db = get_db()
    msgs = db.get_messages(conv_id, limit=5000)
    if not msgs or req.message_index >= len(msgs):
        raise HTTPException(400, "消息序号无效或会话为空")
    target = msgs[req.message_index]
    if req.mode == "edit":
        if target.get("role") != "user":
            raise HTTPException(400, "编辑重发只能用于用户消息")
        new_query = (req.query or "").strip()
        if not new_query:
            raise HTTPException(400, "编辑后的内容不能为空")
        anchor_idx = req.message_index
    elif req.mode == "regenerate":
        if target.get("role") != "assistant":
            raise HTTPException(400, "重新生成只能用于助手消息")
        anchor_idx = next(
            (i for i in range(req.message_index - 1, -1, -1) if msgs[i].get("role") == "user"),
            None,
        )
        if anchor_idx is None:
            raise HTTPException(400, "未找到该回复对应的用户消息")
        new_query = (msgs[anchor_idx].get("content") or "").strip()
        if not new_query:
            raise HTTPException(400, "原消息内容为空，无法重新生成")
    else:
        raise HTTPException(400, "mode 仅支持 regenerate / edit")

    # 截断 DB（保留锚点之前的消息）
    db.truncate_messages_from(conv_id, msgs[anchor_idx]["id"])
    # 截断引擎会话（按用户消息序数映射；失败则降级为保留完整历史）
    user_ordinal = sum(1 for m in msgs[:anchor_idx] if m.get("role") == "user")
    truncate_engine_session(adapter, sid, user_ordinal)

    async def generate():
        async for event_str in adapter.chat_stream(query=new_query, sid=sid, files=None):
            yield f"data: {event_str}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"X-Session-Id": sid, "X-Conversation-Id": conv_id},
    )


# ── 工具列表 ──

@app.get("/tools")
async def list_tools(session_id: str = ""):
    _TOOL_CATS = {
        "exec": "utility", "read_file": "io", "write_file": "io", "edit_file": "io",
        "list_dir": "filesystem", "glob": "filesystem", "grep": "filesystem",
        "web_search": "web", "web_fetch": "web",
        "get_time": "utility", "calculator": "utility", "web_search": "web",
        "create_document": "office", "create_table": "office", "create_presentation": "office",
        "delete_file": "filesystem", "read_document": "filesystem",
        "analyze_data": "data", "knowledge_stats": "knowledge",
        "query_knowledge": "knowledge", "index_knowledge": "knowledge",
        "ocr_image": "utility", "ocr_pdf": "utility",
        "parse_email": "utility",
        "organize_files": "filesystem", "rename_files": "filesystem", "deduplicate_files": "filesystem",
        "run_code": "utility",
        "db_connect": "data", "db_list_tables": "data", "db_describe_table": "data",
        "db_execute_query": "data", "db_test_connection": "data", "db_disconnect": "data",
    }
    adapter = await get_adapter()
    tools_info = []
    # 显示全量工具（含懒加载隐藏的）
    full = adapter.tools._tools
    for name, tool in full.items():
        tools_info.append({
            "name": name,
            "description": tool.description,
            "parameters": tool.parameters,
            "category": _TOOL_CATS.get(name, "general"),
        })
    return {"tools": tools_info}


# ── 会话统计 ──

@app.get("/sessions")
async def get_sessions():
    adapter = await get_adapter()
    sessions_info = []
    for key, session in adapter.session_manager._cache.items():
        sessions_info.append({
            "id": key,
            "messages": len(session.messages),
            "created_at": str(session.created_at),
            "updated_at": str(session.updated_at),
        })
    return {"total_sessions": len(sessions_info), "sessions": sessions_info}


# ── 健康检查 ──

@app.get("/favicon.ico")
async def favicon():
    from fastapi.responses import Response
    return Response(status_code=204)


@app.get("/chat/mode")
async def chat_mode(session_id: str = ""):
    return {"session_id": session_id, "mode": "react"}


@app.get("/health")
async def health():
    return {"status": "healthy", "engine": "nanobuddy"}


if __name__ == "__main__":
    import uvicorn
    try:
        print("🚀 NanoBuddy启动中...")
        print("🌐 访问地址: http://127.0.0.1:8000 （局域网请用本机 IP）")
    except UnicodeEncodeError:
        print("NanoBuddy启动中...")
        print("访问地址: http://127.0.0.1:8000")
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    host = os.environ.get("NANOBUDDY_HOST", "0.0.0.0")
    port = int(os.environ.get("NANOBUDDY_PORT", "8000"))
    try:
        print(f"🌐 本机: http://127.0.0.1:{port}  局域网: http://<本机IP>:{port}")
    except UnicodeEncodeError:
        print(f"本机: http://127.0.0.1:{port}  局域网: http://<本机IP>:{port}")
    uvicorn.run(app, host=host, port=port, log_level="info")
