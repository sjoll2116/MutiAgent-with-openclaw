from sqlalchemy import Column, Integer, String, Text, Index
from sqlalchemy.dialects.postgresql import TSVECTOR
from pgvector.sqlalchemy import Vector
from ..db import Base

class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    doc_id = Column(String(255), index=True)      # 源文档标识符
    content = Column(Text, nullable=False)        # 原始文本内容
    metadata_json = Column(Text)                  # 附加元数据
    
    # 1024 维向量，匹配 BAAI/bge-m3 模型
    embedding = Column(Vector(1024))
    
    # 全文检索向量（倒排索引）
    fts = Column(TSVECTOR)

# 注意：建议通过 Alembic 管理 fts 的 GIN 索引和 embedding 的 HNSW 索引。
