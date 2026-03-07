import os
import json
from typing import List, Dict, Any, Optional
from openai import AsyncOpenAI
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from ..models.document import DocumentChunk

# Retrieve from environment
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if OPENAI_API_KEY:
    client = AsyncOpenAI(api_key=OPENAI_API_KEY)
else:
    client = None

class RAGService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.encoder_model = "text-embedding-3-small"
        self.llm_model = "gpt-4o-mini"
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200
        )

    async def _get_embedding(self, text_content: str) -> List[float]:
        if not client:
            return [0.0] * 1536
        try:
            response = await client.embeddings.create(
                input=[text_content],
                model=self.encoder_model
            )
            return response.data[0].embedding
        except Exception as e:
            print(f"Embedding error: {e}")
            return [0.0] * 1536

    async def ingest_document(self, doc_id: str, raw_text: str, metadata: dict = None):
        """Split a document into chunks, embed each chunk, and store in the database."""
        if metadata is None:
            metadata = {}
            
        chunks = self.splitter.split_text(raw_text)
        
        for chunk in chunks:
            embedding = await self._get_embedding(chunk)
            
            db_chunk = DocumentChunk(
                doc_id=doc_id,
                content=chunk,
                metadata_json=json.dumps(metadata) if metadata else "{}",
                embedding=embedding
            )
            self.db.add(db_chunk)
            await self.db.flush()
            
            # Update the tsvector field natively. We use 'simple' config mapping to avoid requiring external plugins.
            await self.db.execute(
                text("UPDATE document_chunks SET fts = to_tsvector('simple', content) WHERE id = :id"),
                {"id": db_chunk.id}
            )
            
        await self.db.commit()

    async def generate_hyde_draft(self, query: str) -> str:
        """Use an LLM to hallucinate an ideal answer document to the query."""
        if not client:
            return query
        try:
            response = await client.chat.completions.create(
                model=self.llm_model,
                messages=[
                    {"role": "system", "content": "You are a helpful knowledge assistant. Please write a highly detailed, comprehensive, and factual hypothetical answer to the user's query. This text will be used for document retrieval, so focus on exact terms, concepts, and phrasing that you might find in official documentation. Do not answer directly; just generate the hypothetical document."},
                    {"role": "user", "content": query}
                ],
                temperature=0.3,
            )
            return response.choices[0].message.content
        except Exception as e:
            print(f"HyDE error: {e}")
            return query

    async def hybrid_search(self, query: str, top_k: int = 5, use_hyde: bool = True) -> List[Dict[str, Any]]:
        """Combine Dense (Pgvector) and Sparse (FTS) search with Reciprocal Rank Fusion (RRF)."""
        search_text = query
        if use_hyde:
            search_text = await self.generate_hyde_draft(query)
            
        query_embedding = await self._get_embedding(search_text)
        
        # RRF executed directly inside Postgres using CTEs
        rrf_query = """
        WITH vector_search AS (
            SELECT id, 
                   RANK() OVER (ORDER BY embedding <=> cast(:embedding as vector)) AS vector_rank
            FROM document_chunks
            ORDER BY embedding <=> cast(:embedding as vector)
            LIMIT 50
        ),
        fts_search AS (
            SELECT id, 
                   RANK() OVER (ORDER BY ts_rank(fts, plainto_tsquery('simple', :query)) DESC) AS fts_rank
            FROM document_chunks
            WHERE fts @@ plainto_tsquery('simple', :query)
            ORDER BY ts_rank(fts, plainto_tsquery('simple', :query)) DESC
            LIMIT 50
        )
        SELECT 
            c.id, c.doc_id, c.content, c.metadata_json,
            COALESCE(1.0 / (60 + v.vector_rank), 0.0) + 
            COALESCE(1.0 / (60 + f.fts_rank), 0.0) AS rrf_score
        FROM document_chunks c
        LEFT JOIN vector_search v ON c.id = v.id
        LEFT JOIN fts_search f ON c.id = f.id
        WHERE v.id IS NOT NULL OR f.id IS NOT NULL
        ORDER BY rrf_score DESC
        LIMIT :top_k
        """
        
        result = await self.db.execute(
            text(rrf_query),
            {
                "embedding": str(query_embedding),
                "query": query, # Raw query used for exact-match FTS logic 
                "top_k": top_k
            }
        )
        
        rows = result.fetchall()
        
        chunks = []
        for row in rows:
            chunks.append({
                "id": row.id,
                "doc_id": row.doc_id,
                "content": row.content,
                "metadata": json.loads(row.metadata_json) if row.metadata_json else {},
                "score": row.rrf_score
            })
            
        return chunks
