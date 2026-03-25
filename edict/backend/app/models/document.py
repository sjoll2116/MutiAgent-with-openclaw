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
