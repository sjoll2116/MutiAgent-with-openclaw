"""add document_chunks

Revision ID: 002_add_document_chunks
Revises: 001_initial
Create Date: 2025-03-07 11:50:00.000000
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
from pgvector.sqlalchemy import Vector

revision: str = "002_add_document_chunks"
down_revision: Union[str, None] = "001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 启用 pgvector 扩展
    op.execute('CREATE EXTENSION IF NOT EXISTS vector;')

    # 创建 document_chunks 表
    op.create_table(
        "document_chunks",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("doc_id", sa.String(length=255), nullable=True),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("metadata_json", sa.Text(), nullable=True),
        sa.Column("embedding", Vector(1536), nullable=True),
        sa.Column("fts", postgresql.TSVECTOR(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_document_chunks_doc_id", "document_chunks", ["doc_id"])
    
    # GIN 索引用于全文检索
    op.create_index("ix_document_chunks_fts", "document_chunks", ["fts"], postgresql_using="gin")
    
    # HNSW 索引用于向量余弦相似度搜索
    op.execute(
        "CREATE INDEX ix_document_chunks_embedding ON document_chunks USING hnsw (embedding vector_cosine_ops);"
    )


def downgrade() -> None:
    op.drop_index("ix_document_chunks_embedding", table_name="document_chunks")
    op.drop_index("ix_document_chunks_fts", table_name="document_chunks")
    op.drop_index("ix_document_chunks_doc_id", table_name="document_chunks")
    op.drop_table("document_chunks")
    # 不要轻易 DROP EXTENSION，因为可能有其他表依赖，这里为了干净回滚加上
    # op.execute('DROP EXTENSION IF EXISTS vector;')
