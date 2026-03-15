from sqlalchemy import Column, Integer, String, Text, Index
from sqlalchemy.dialects.postgresql import TSVECTOR
from pgvector.sqlalchemy import Vector
from ..db import Base

class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    doc_id = Column(String(255), index=True)      # 源文档标识符
    content = Column(Text, nullable=False)        # 原始文本内容
    metadata_json = Column(Text)                  # 附加元数据（JSON，保留兼容）
    
    # ── 结构化元数据列（用于 SQL 过滤，避免 JSON 解析） ──
    file_name = Column(String(255), index=True)     # 原始文件名
    file_type = Column(String(50), index=True)      # 文件类型: pdf/code/markdown/image/text
    source_agent = Column(String(100))              # 产生该文档的智能体，用户上传默认 "user"
    project_id = Column(String(100), index=True)    # 项目归属

    # 1024 维向量，匹配 BAAI/bge-m3 模型
    embedding = Column(Vector(1024))
    
    # 全文检索向量（倒排索引）
    fts = Column(TSVECTOR)

# 注意：建议通过 Alembic 管理 fts 的 GIN 索引和 embedding 的 HNSW 索引。
# 新增列通过 Alembic migration:
#   alembic revision --autogenerate -m "add_metadata_columns"
#   alembic upgrade head
