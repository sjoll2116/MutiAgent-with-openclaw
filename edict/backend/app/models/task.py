"""Task 模型 — 系统任务核心表。

包含所有前端展示、Go 调度器逻辑、Agent 上报所需的字段。
"""

import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Column,
    DateTime,
    Enum,
    Index,
    String,
    Text,
    Boolean,
    Integer,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID

from ..db import Base


class TaskState(str, enum.Enum):
    """任务状态枚举。"""
    Queued = "Queued"           # 等待路由
    Planning = "Planning"       # 规划
    PlanReview = "PlanReview"   # 安全审核
    Dispatching = "Dispatching" # 派发
    Next = "Next"               # 待执行
    Executing = "Executing"     # 执行中
    ResultReview = "ResultReview" # 审查汇总
    Completed = "Completed"       # 完成
    Blocked = "Blocked"         # 阻塞
    Cancelled = "Cancelled"     # 取消
    Pending = "Pending"         # 待处理
    
    # 状态机流转别名
    PlanResultReview = "PlanReview"
    ResultResultReview = "ResultReview"


# 终态集合
TERMINAL_STATES = {TaskState.Completed, TaskState.Cancelled}

# 状态流转合法路径
STATE_TRANSITIONS = {
    TaskState.Queued: {TaskState.Planning, TaskState.Cancelled},
    TaskState.Planning: {TaskState.PlanReview, TaskState.Cancelled, TaskState.Blocked},
    TaskState.PlanResultReview: {TaskState.Dispatching, TaskState.Planning, TaskState.Cancelled},
    TaskState.Dispatching: {TaskState.Executing, TaskState.Next, TaskState.Cancelled, TaskState.Blocked},
    TaskState.Next: {TaskState.Executing, TaskState.Cancelled},
    TaskState.Executing: {TaskState.ResultReview, TaskState.Completed, TaskState.Blocked, TaskState.Cancelled},
    TaskState.ResultResultReview: {TaskState.Completed, TaskState.Executing, TaskState.Cancelled},
    TaskState.Blocked: {TaskState.Queued, TaskState.Planning, TaskState.PlanReview, TaskState.Dispatching, TaskState.Executing},
}

# 状态 → Agent 映射 (辅助)
STATE_AGENT_MAP = {
    TaskState.Queued: "coordinator",
    TaskState.Planning: "planner",
    TaskState.PlanResultReview: "reviewer",
    TaskState.Dispatching: "dispatcher",
    TaskState.ResultResultReview: "dispatcher",
}

# 组织 → Agent 映射 (辅助)
ORG_AGENT_MAP = {
    "文档编写员": "doc_writer",
    "数据分析师": "data_analyst",
    "代码架构师": "software_engineer",
    "质量保证师": "qa_engineer",
    "任务编排引擎": "planner",
    "安全审查引擎": "reviewer",
    "任务调度引擎": "dispatcher",
    "协调中枢": "coordinator",
}


class Task(Base):
    """任务表 (全字段版)。"""
    __tablename__ = "tasks"

    task_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    trace_id = Column(String(64), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    description = Column(Text, default="")
    priority = Column(String(16), default="normal")
    state = Column(Enum(TaskState, name="task_state", inherit_schema=True), nullable=False, default=TaskState.Queued, index=True)
    org = Column(String(32), nullable=False, default="协调中枢", index=True)
    creator = Column(String(50), default="admin")
    
    # --- 动态进展评估字段 (前端 TaskModal 强依赖) ---
    official = Column(String(32), default="", comment="责任官员")
    now = Column(Text, default="", comment="当前进展描述")
    eta = Column(String(64), default="-", comment="预计完成时间")
    block = Column(Text, default="无", comment="阻塞原因")
    output = Column(Text, default="", comment="最终产出")
    ac = Column(Text, default="", comment="验收标准")
    
    # --- 流程控制字段 ---
    archived = Column(Boolean, default=False, index=True)
    archived_at = Column(String(64), default="")
    prev_state = Column(String(32), default="")
    review_round = Column(Integer, default=0)
    target_dept = Column(String(64), default="")
    
    # --- 模板与调度数据 ---
    template_id = Column(String(64), default="")
    template_params = Column(JSONB, default=dict)
    scheduler = Column(JSONB, default=dict)
    
    # --- JSON 日志与结构化数据 ---
    flow_log = Column(JSONB, default=list)
    progress_log = Column(JSONB, default=list)
    todos = Column(JSONB, default=list)
    meta = Column(JSONB, default=dict)

    created_at = Column(DateTime(timezone=True), server_default=text("now()"))
    updated_at = Column(DateTime(timezone=True), server_default=text("now()"), onupdate=text("now()"))

    def to_dict(self) -> dict:
        """格式化输出，保持与前端 interface Task 的兼容性。"""
        return {
            "id": str(self.task_id),
            "trace_id": self.trace_id,
            "title": self.title,
            "description": self.description,
            "priority": self.priority,
            "state": self.state.value if hasattr(self.state, 'value') else str(self.state),
            "org": self.org,
            "creator": self.creator,
            "official": self.official,
            "now": self.now,
            "eta": self.eta,
            "block": self.block,
            "output": self.output,
            "ac": self.ac,
            "archived": self.archived,
            "archivedAt": self.archived_at,
            "review_round": self.review_round,
            "targetDept": self.target_dept,
            "flow_log": self.flow_log or [],
            "progress_log": self.progress_log or [],
            "todos": self.todos or [],
            "scheduler": self.scheduler or {},
            "createdAt": self.created_at.isoformat() if self.created_at else "",
            "updatedAt": self.updated_at.isoformat() if self.updated_at else "",
            "_prev_state": self.prev_state,
        }
