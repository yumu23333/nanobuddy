"""用户登录与当前账号信息。"""

from __future__ import annotations

import logging
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from core.database.db import get_db
from core.security.deps import get_current_user
from core.security.users import (
    ROLES,
    CurrentUser,
    create_access_token,
    hash_password,
    verify_password,
)
from core.security.context import set_request_context

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=64)
    password: str = Field(..., min_length=1, max_length=128)


class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=64)
    password: str = Field(..., min_length=6, max_length=128)


@router.post("/login")
def login(req: LoginRequest, request: Request):
    db = get_db()
    row = db.get_user_by_username(req.username)
    if not row or not row.get("is_active"):
        raise HTTPException(401, "用户名或密码错误")
    if not verify_password(req.password, row["password_hash"]):
        raise HTTPException(401, "用户名或密码错误")
    db.touch_user_login(row["id"])
    token, expires_in = create_access_token(row["id"], row["username"], row["role"])
    user = CurrentUser(
        id=row["id"],
        username=row["username"],
        role=row["role"],
        display_name=row.get("display_name") or row["username"],
    )
    request.state.user = user
    set_request_context(actor=user.username, client_ip=_client_ip(request))
    return {
        "token": token,
        "expires_in": expires_in,
        "user": db.user_to_public(row),
    }


@router.get("/me")
def auth_me(user: CurrentUser = Depends(get_current_user)):
    # 虚拟身份（localhost 免鉴权 / guest / service）不在用户表中，
    # 返回合成信息而非 401，便于前端统一读取当前账号
    if user.id in ("localhost", "guest", "anonymous", "service"):
        return {"user": {
            "id": user.id,
            "username": user.username,
            "display_name": {"localhost": "本机管理员", "guest": "访客",
                             "service": "服务账号"}.get(user.id, user.username),
            "role": user.role,
            "is_active": True,
            "created_at": None,
            "last_login_at": None,
            "virtual": True,
        }}
    row = get_db().get_user_by_id(user.id)
    if not row or not row.get("is_active"):
        raise HTTPException(401, "账号已禁用或不存在")
    return {"user": get_db().user_to_public(row)}


@router.post("/register")
def register(req: RegisterRequest):
    db = get_db()
    if db.get_user_by_username(req.username):
        raise HTTPException(400, "用户名已存在")
    password_hash = hash_password(req.password)
    uid = db.create_user(
        username=req.username,
        password_hash=password_hash,
        role="member",
        display_name=req.username,
    )
    try:
        from core.path_policy.workspace import ensure_user_dir
        ensure_user_dir(uid)
    except Exception as e:
        logging.getLogger("nanobuddy.routes_auth").warning("创建工作区目录失败 uid=%s: %s", uid, e)
    return {"message": "注册成功", "user_id": uid}


def _client_ip(request: Request) -> str:
    return request.client.host if request.client else ""
