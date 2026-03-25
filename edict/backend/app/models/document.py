from sqlalchemy import Column, Integer, String, Text, ForeignKey, DateTime, func, Boolean, Float
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import TSVECTOR
from pgvector.sqlalchemy import Vector
from ..db import Base

class Document(Base):
    """文档元数据主表：存储文件整体信息、内容哈希及数据生命周期。"""
    __tablename__ = "documents"
    
    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    doc_id = Column(String(100), unique=True, index=True) # 业务唯一 ID
    file_name = Column(String(255), index=True)
    file_type = Column(String(50), index=True) # pdf, code, markdown, image, text
    file_hash = Column(String(255), unique=True, index=True) # 内容 SHA-256，用于去重
    source_agent = Column(String(100))
    project_id = Column(String(100), index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    expire_at = Column(DateTime(timezone=True), nullable=True) # 临时文件过期时间，NULL 为永久存储
    is_deleted = Column(Boolean, default=False, index=True) # 软删除标志
    
    chunks = relationship("DocumentChunk", back_populates="document", cascade="all, delete-orphan")

class DocumentChunk(Base):
    """文档切片表：存储文本片段及对应向量。"""
    __tablename__ = "document_chunks"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    doc_id = Column(String(100), ForeignKey("documents.doc_id", ondelete="CASCADE"), index=True)
    content = Column(Text, nullable=False)
    metadata_json = Column(Text)                  # 附加元数据备份
    
    # 结构化冗余列（提速 FTS 和 SQL 过滤）
    file_name = Column(String(255), index=True)
    file_type = Column(String(50), index=True)
    source_agent = Column(String(100))
    project_id = Column(String(100), index=True)
    parent_id = Column(Integer, ForeignKey("document_chunks.id", ondelete="CASCADE"), nullable=True, index=True) # 父块 ID，用于 Parent-Child 检索

    embedding = Column(Vector(1024))
    fts = Column(TSVECTOR)

    document = relationship("Document", back_populates="chunks")
    parent = relationship("DocumentChunk", remote_side=[id], backref="children")

class Task(Base):
    """任务主表"""
    __tablename__ = "tasks"

    id = Column(String(100), primary_key=True, index=True) # UUID string
    title = Column(String(500), nullable=False)
    state = Column(String(50), nullable=False, index=True)
    org = Column(String(100))
    priority = Column(String(20), default="Normal")
    official = Column(String(100))
    now_text = Column(Text)
    eta = Column(DateTime(timezone=True))
    block_reason = Column(Text)
    output = Column(Text)
    archived = Column(Boolean, default=False, index=True)
    archived_at = Column(DateTime(timezone=True))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    flow_log = relationship("TaskFlow", back_populates="task", cascade="all, delete-orphan")
    progress_log = relationship("TaskProgress", back_populates="task", cascade="all, delete-orphan")
    todos = relationship("TaskTodo", back_populates="task", cascade="all, delete-orphan")

class TaskFlow(Base):
    """任务流转日志"""
    __tablename__ = "task_flow_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(String(100), ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    at = Column(DateTime(timezone=True), server_default=func.now())
    from_dept = Column(String(100))
    to_dept = Column(String(100))
    remark = Column(Text)

    task = relationship("Task", back_populates="flow_log")

class TaskProgress(Base):
    """任务进度日志 (Agent Thoughts)"""
    __tablename__ = "task_progress_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(String(100), ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    at = Column(DateTime(timezone=True), server_default=func.now())
    agent = Column(String(100))
    agent_label = Column(String(100))
    text = Column(Text)
    state = Column(String(50))
    org = Column(String(100))
    tokens = Column(Integer, default=0)
    cost = Column(Float, default=0.0)
    elapsed_sec = Column(Integer, default=0)

    task = relationship("Task", back_populates="progress_log")

class TaskTodo(Base):
    """任务待办 (Todos)"""
    __tablename__ = "task_todos"

    id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(String(100), ForeignKey("tasks.id", ondelete="CASCADE"), index=True)
    todo_id = Column(String(100))
    title = Column(String(255))
    status = Column(String(50), default="not-started")
    detail = Column(Text)

    task = relationship("Task", back_populates="todos")

class EvalSample(Base):
    """评估样本表：捕获 RAG 问答对或 Agent 决策链"""
    __tablename__ = "eval_samples"

    id = Column(Integer, primary_key=True, autoincrement=True)
    sample_type = Column(String(50), index=True) # "rag" or "agent"
    task_id = Column(String(100), index=True, nullable=True)
    query = Column(Text, nullable=False)
    context = Column(Text) # 检索到的原文片段或 Trace 文本
    answer = Column(Text)
    metadata_json = Column(Text) # 额外上下文信息
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    results = relationship("EvalResult", back_populates="sample", cascade="all, delete-orphan")

class EvalResult(Base):
    """评估结果表：存储各类维度的评分记录"""
    __tablename__ = "eval_results"

    id = Column(Integer, primary_key=True, autoincrement=True)
    sample_id = Column(Integer, ForeignKey("eval_samples.id", ondelete="CASCADE"), index=True)
    metric_name = Column(String(50), index=True) # faithfulness, relevance, coherence, etc.
    score = Column(Float) # 0.0 - 1.0
    reasoning = Column(Text) # 打分理由
    judge_model = Column(String(100)) # 执行评估的大模型名
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    sample = relationship("EvalSample", back_populates="results")
