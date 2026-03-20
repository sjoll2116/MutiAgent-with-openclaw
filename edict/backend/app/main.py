"""Edict Backend — FastAPI 应用入口。

Lifespan 管理：
- startup: 连接 Redis Event Bus, 初始化数据库
- shutdown: 关闭连接

路由：
- /api/tasks — 任务 CRUD
- /api/agents — Agent 信息
- /api/events — 事件查询
- /api/admin — 管理操作
- /ws — WebSocket 实时推送
"""

import logging
from contextlib import asynccontextmanager

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .services.event_bus import get_event_bus
from .api import rag


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
log = logging.getLogger("edict")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期管理。"""
    settings = get_settings()
    log.info(f"🚀 Edict Backend (RAG Only) starting on port {settings.port}...")

    # 全局 HTTP Client — 复用 TCP/TLS 连接池，避免每次请求重建开销
    app.state.http_client = httpx.AsyncClient(
        limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
        timeout=httpx.Timeout(30.0, connect=10.0),
    )
    log.info("✅ Global HTTP Client initialized (pool=100, keepalive=20)")

    # 如果 RAG 仍需 Event Bus，则保持连接
    bus = await get_event_bus()
    log.info("✅ Event Bus connected")

    yield

    # 清理
    await app.state.http_client.aclose()
    log.info("✅ Global HTTP Client closed")
    await bus.close()
    log.info("Edict Backend shutdown complete")


app = FastAPI(
    title="OpenClaw MAS RAG Backend",
    description="专门负责 RAG 检索与评估的 Python 服务",
    version="2.1.0",
    lifespan=lifespan,
)

# CORS — 开发环境允许所有来源
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由 - 仅保留 RAG
app.include_router(rag.router, prefix="/api", tags=["rag"])


@app.get("/health")
async def health():
    return {"status": "ok", "version": "2.0.0", "engine": "edict"}


@app.get("/api")
async def api_root():
    return {
        "name": "Edict OpenClaw MAS API",
        "version": "2.0.0",
        "endpoints": {
            "tasks": "/api/tasks",
            "agents": "/api/agents",
            "events": "/api/events",
            "admin": "/api/admin",
            "websocket": "/ws",
            "health": "/health",
        },
    }
