from sqlalchemy import Column, Integer, String, Text, Index
from sqlalchemy.dialects.postgresql import TSVECTOR
from pgvector.sqlalchemy import Vector
from ..db import Base

class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id = Column(Integer, primary_key=True, index=True, autoincrement=True)
    doc_id = Column(String(255), index=True)      # Identifier of the source document
    content = Column(Text, nullable=False)        # Raw text block
    metadata_json = Column(Text)                  # Additional metadata
    
    # 1536 dimension vector matching text-embedding-3-small
    embedding = Column(Vector(1536))
    
    # Text search vector (inverted index)
    fts = Column(TSVECTOR)

# Note: GIN index for fts and HNSW index for embedding are recommended to be managed via Alembic.
