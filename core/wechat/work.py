"""企业微信客户端 —— 自建应用消息收发

发送：HTTP API（通用）
接收：支持两种模式
  1. WebSocket 长连接（智能机器人，无需公网 URL）
  2. HTTP Callback（自建应用，需公网 URL/HTTPS）
"""

import json
import logging
import time
import threading
from typing import Optional, Callable, Dict, Any
from dataclasses import dataclass, field

import requests

# WebSocket 是可选依赖，若未安装则优雅降级
try:
    import websocket
    HAS_WEBSOCKET = True
except ImportError:
    HAS_WEBSOCKET = False
    websocket = None

logger = logging.getLogger("nanobuddy.wechat.work")

API_BASE = "https://qyapi.weixin.qq.com/cgi-bin"
TOKEN_EXPIRE_BUFFER = 300  # 提前 5 分钟刷新 Token


@dataclass
class WorkConfig:
    """企业微信配置"""
    corp_id: str = ""
    agent_id: str = ""
    corp_secret: str = ""


@dataclass
class WorkMessage:
    """企业微信消息"""
    from_user: str = ""
    content: str = ""
    msg_type: str = "text"
    msg_id: str = ""
    chat_type: str = "single"  # single / group


class WorkClient:
    """企业微信 API 客户端"""

    def __init__(self, config: WorkConfig = None):
        self.config = config or WorkConfig()
        self._token = ""
        self._token_expires = 0

    def is_configured(self) -> bool:
        return bool(self.config.corp_id and self.config.corp_secret)

    # ──── Token 管理 ────

    def _get_token(self) -> str:
        """获取 access_token（自动缓存刷新）"""
        if self._token and time.time() < self._token_expires:
            return self._token

        url = f"{API_BASE}/gettoken"
        params = {
            "corpid": self.config.corp_id,
            "corpsecret": self.config.corp_secret,
        }
        try:
            resp = requests.get(url, params=params, timeout=10)
            data = resp.json()
            if data.get("errcode") == 0:
                self._token = data["access_token"]
                self._token_expires = time.time() + data["expires_in"] - TOKEN_EXPIRE_BUFFER
                logger.info("Token refreshed, expires in %ds", data["expires_in"])
                return self._token
            else:
                logger.error("Get token failed: %s", data)
                return ""
        except Exception as e:
            logger.error("Get token error: %s", e)
            return ""

    # ──── 发送消息 ────

    def send_text(self, to_user: str, content: str, agent_id: str = "") -> bool:
        """发送文本消息到企业微信"""
        token = self._get_token()
        if not token:
            return False

        url = f"{API_BASE}/message/send?access_token={token}"
        payload = {
            "touser": to_user,
            "msgtype": "text",
            "agentid": int(agent_id or self.config.agent_id),
            "text": {"content": content},
        }

        try:
            resp = requests.post(url, json=payload, timeout=15)
            data = resp.json()
            if data.get("errcode") == 0:
                logger.info("已发送消息到 %s: %.60s", to_user, content)
                return True
            else:
                logger.error("Send message failed: %s", data)
                return False
        except Exception as e:
            logger.error("Send message error: %s", e)
            return False

    def send_markdown(self, to_user: str, content: str, agent_id: str = "") -> bool:
        """发送 Markdown 消息"""
        token = self._get_token()
        if not token:
            return False

        url = f"{API_BASE}/message/send?access_token={token}"
        payload = {
            "touser": to_user,
            "msgtype": "markdown",
            "agentid": int(agent_id or self.config.agent_id),
            "markdown": {"content": content},
        }

        try:
            resp = requests.post(url, json=payload, timeout=15)
            data = resp.json()
            return data.get("errcode") == 0
        except Exception as e:
            logger.error("Send markdown error: %s", e)
            return False

    # ──── 连接测试 ────

    def test_connection(self) -> tuple[bool, str]:
        """测试企业微信连接是否正常"""
        token = self._get_token()
        if not token:
            return False, "获取 Token 失败，请检查 CorpID 和 Secret"

        # 简单测试：获取企业信息
        url = f"{API_BASE}/agent/get?access_token={token}&agentid={self.config.agent_id}"
        try:
            resp = requests.get(url, timeout=10)
            data = resp.json()
            if data.get("errcode") == 0:
                name = data.get("name", "未知应用")
                return True, f"连接成功！应用: {name}"
            else:
                return False, data.get("errmsg", "未知错误")
        except Exception as e:
            return False, str(e)


# ──── WebSocket 消息接收（智能机器人模式）────

class WorkWSReceiver:
    """
    企业微信 WebSocket 消息接收器

    通过长连接接收企业微信消息，无需公网 URL。
    需要企业微信后台启用「智能机器人」功能。

    使用示例：
        def on_msg(msg):
            print(f"收到消息: {msg.content} from {msg.from_user}")

        receiver = WorkWSReceiver(bot_id="your_bot_id", secret="your_secret")
        receiver.on_message = on_msg
        receiver.start()
    """

    WS_URL = "wss://openws.work.weixin.qq.com"

    def __init__(self, bot_id: str = "", secret: str = "", corp_id: str = ""):
        """
        Args:
            bot_id: 智能机器人 ID（企业微信后台获取）
            secret: 智能机器人 Secret
            corp_id: 企业 CorpID（用于获取 ws_ticket）
        """
        self.bot_id = bot_id
        self.secret = secret
        self.corp_id = corp_id
        self._running = False
        self._thread: Optional[threading.Thread] = None
        self._ws = None
        self._lock = threading.Lock()
        self._reconnect_delay = 1  # 重连间隔（秒），指数退避

        # 回调函数
        self.on_message: Optional[Callable[[WorkMessage], None]] = None
        self.on_error: Optional[Callable[[str], None]] = None

        if not HAS_WEBSOCKET:
            logger.error("需要安装 websocket-client 库: pip install websocket-client")

    def _get_ws_ticket(self) -> Optional[str]:
        """
        获取 WebSocket 连接 ticket
        企业微信 API: /cgi-bin/ws/get_ticket
        """
        if not self.corp_id or not self.secret:
            logger.error("缺少 corp_id 或 secret，无法获取 ws_ticket")
            return None

        # 先获取 access_token（使用 corp_id 和 secret）
        client = WorkClient(WorkConfig(corp_id=self.corp_id, corp_secret=self.secret))
        token = client._get_token()
        if not token:
            logger.error("无法获取 access_token，请检查 corp_id 和 secret")
            return None

        url = f"{API_BASE}/ws/get_ticket?access_token={token}"
        try:
            resp = requests.get(url, timeout=10)
            data = resp.json()
            if data.get("errcode") == 0:
                ticket = data.get("ticket")
                logger.info("获取 ws_ticket 成功")
                return ticket
            else:
                logger.error("获取 ws_ticket 失败: %s", data)
                return None
        except Exception as e:
            logger.error("请求 ws_ticket 异常: %s", e)
            return None

    def _build_ws_url(self, ticket: str) -> str:
        """构造 WebSocket 连接 URL"""
        # 企业微信要求拼接参数：?bot_id=xxx&ticket=xxx
        return f"{self.WS_URL}?bot_id={self.bot_id}&ticket={ticket}"

    def _on_ws_message(self, ws, message):
        """WebSocket 接收消息回调"""
        try:
            data = json.loads(message)
            # 根据企业微信协议解析消息
            # 文档：https://developer.work.weixin.qq.com/document/path/90240
            msg_type = data.get("msgtype", "text")
            if msg_type == "text":
                content = data.get("text", {}).get("content", "")
                from_user = data.get("from", {}).get("user_id", "")
                msg_id = data.get("msgid", "")

                # 构造 WorkMessage
                wm = WorkMessage(
                    from_user=from_user,
                    content=content,
                    msg_type=msg_type,
                    msg_id=msg_id,
                    chat_type="single"  # 智能机器人默认单聊
                )
                if self.on_message:
                    self.on_message(wm)
            else:
                logger.debug("忽略非文本消息: %s", data)
        except json.JSONDecodeError:
            logger.warning("WebSocket 收到非 JSON 数据: %s", message)
        except Exception as e:
            logger.error("处理 WebSocket 消息异常: %s", e)
            if self.on_error:
                self.on_error(f"消息处理异常: {e}")

    def _on_ws_error(self, ws, error):
        """WebSocket 错误回调"""
        logger.error("WebSocket 错误: %s", error)
        if self.on_error:
            self.on_error(f"WebSocket 错误: {error}")

    def _on_ws_close(self, ws, close_status_code, close_msg):
        """WebSocket 关闭回调"""
        logger.warning("WebSocket 连接关闭: code=%s, msg=%s", close_status_code, close_msg)
        # 若设置了 _running，则尝试重连
        if self._running:
            self._reconnect()

    def _on_ws_open(self, ws):
        """WebSocket 打开回调"""
        logger.info("WebSocket 连接已建立")
        self._reconnect_delay = 1  # 重置重连延迟

    def _reconnect(self):
        """尝试重连（指数退避）"""
        if not self._running:
            return
        delay = self._reconnect_delay
        self._reconnect_delay = min(delay * 2, 60)  # 最大间隔 60 秒
        logger.info("将在 %.1f 秒后重连...", delay)
        time.sleep(delay)
        self._connect_ws()

    def _connect_ws(self):
        """建立 WebSocket 连接（内部）"""
        if not HAS_WEBSOCKET:
            logger.error("websocket-client 未安装，无法启动 WebSocket 接收")
            return

        # 获取 ticket
        ticket = self._get_ws_ticket()
        if not ticket:
            logger.error("获取 ticket 失败，无法建立连接")
            return

        ws_url = self._build_ws_url(ticket)
        logger.info("正在连接 WebSocket: %s", ws_url)

        try:
            # 设置 WebSocket 回调
            self._ws = websocket.WebSocketApp(
                ws_url,
                on_open=self._on_ws_open,
                on_message=self._on_ws_message,
                on_error=self._on_ws_error,
                on_close=self._on_ws_close,
            )
            # 运行 WebSocket（阻塞）
            self._ws.run_forever(
                ping_interval=30,          # 每 30 秒发送 Ping
                ping_timeout=10,           # Ping 超时 10 秒
                reconnect=0                # 我们自己管理重连
            )
        except Exception as e:
            logger.error("WebSocket 连接异常: %s", e)
            if self._running:
                self._reconnect()

    def start(self):
        """启动 WebSocket 接收（在后台线程中运行）"""
        if not HAS_WEBSOCKET:
            logger.error("无法启动：缺少 websocket-client")
            return

        if self._running:
            logger.warning("WebSocket 接收已在运行")
            return

        self._running = True
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()
        logger.info("WebSocket 接收线程已启动")

    def _run(self):
        """线程主循环"""
        while self._running:
            self._connect_ws()
            # 如果连接断开且 _running 仍为 True，_connect_ws 内部会调用 _reconnect
            # 但为了防止意外，加一个小休眠
            if self._running:
                time.sleep(1)

    def stop(self):
        """停止 WebSocket 接收"""
        self._running = False
        if self._ws:
            try:
                self._ws.close()
            except Exception:
                pass
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2)
        logger.info("WebSocket 接收已停止")