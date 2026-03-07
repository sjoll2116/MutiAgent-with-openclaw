"""Agents API — Agent 配置和状态查询。"""

import json
import logging
from pathlib import Path

from fastapi import APIRouter

log = logging.getLogger("edict.api.agents")
router = APIRouter()

# Agent 元信息
AGENT_META = {
    "coordinator": {"name": "协调中枢", "role": "协调中枢", "icon": "🤴"},
    "planner": {"name": "任务编排引擎", "role": "规划引擎", "icon": "📜"},
    "reviewer": {"name": "安全审查引擎", "role": "审核引擎", "icon": "🔍"},
    "dispatcher": {"name": "任务调度引擎", "role": "调度引擎", "icon": "📮"},
    "data_analyst": {"name": "数据分析师", "role": "数据分析", "icon": "💰"},
    "doc_writer": {"name": "文档编写员", "role": "文档撰写", "icon": "📚"},
    "software_engineer": {"name": "代码架构师", "role": "代码开发", "icon": "🔧"},
    "qa_engineer": {"name": "质量保证师", "role": "质量保证", "icon": "⚖️"},
    "monitor": {"name": "情报监控员", "role": "系统监控", "icon": "📰"},
}


@router.get("")
async def list_agents():
    """列出所有可用 Agent。"""
    agents = []
    for agent_id, meta in AGENT_META.items():
        agents.append({
            "id": agent_id,
            **meta,
        })
    return {"agents": agents}


@router.get("/{agent_id}")
async def get_agent(agent_id: str):
    """获取 Agent 详情。"""
    meta = AGENT_META.get(agent_id)
    if not meta:
        return {"error": f"Agent '{agent_id}' not found"}, 404

    # 尝试读取 SOUL.md
    soul_path = Path(__file__).parents[4] / "agents" / agent_id / "SOUL.md"
    soul_content = ""
    if soul_path.exists():
        soul_content = soul_path.read_text(encoding="utf-8")[:2000]

    return {
        "id": agent_id,
        **meta,
        "soul_preview": soul_content,
    }


@router.get("/{agent_id}/config")
async def get_agent_config(agent_id: str):
    """获取 Agent 运行时配置。"""
    config_path = Path(__file__).parents[4] / "data" / "agent_config.json"
    if not config_path.exists():
        return {"agent_id": agent_id, "config": {}}

    try:
        configs = json.loads(config_path.read_text(encoding="utf-8"))
        agent_config = configs.get(agent_id, {})
        return {"agent_id": agent_id, "config": agent_config}
    except (json.JSONDecodeError, IOError):
        return {"agent_id": agent_id, "config": {}}
