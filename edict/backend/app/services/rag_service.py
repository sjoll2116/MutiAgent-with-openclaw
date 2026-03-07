import os
import json
import httpx
from typing import List, Dict, Any, Optional
from openai import AsyncOpenAI
from langchain_text_splitters import RecursiveCharacterTextSplitter
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from ..models.document import DocumentChunk

# 从环境变量获取配置
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
SILICONFLOW_API_KEY = os.getenv("SILICONFLOW_API_KEY")
SILICONFLOW_API_URL = os.getenv("SILICONFLOW_API_URL", "https://api.siliconflow.cn/v1")

if OPENAI_API_KEY:
    openai_client = AsyncOpenAI(api_key=OPENAI_API_KEY)
else:
    openai_client = None

class RAGService:
    def __init__(self, db: AsyncSession):
        self.db = db
        # 硅基流动模型配置
        self.encoder_model = "BAAI/bge-m3"
        self.reranker_model = "BAAI/bge-reranker-v2-m3"
        self.llm_model = "gpt-4o-mini" # 也可以根据需要切换到硅基流动的大模型
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=1000,
            chunk_overlap=200
        )

    async def _get_embedding(self, text_content: str) -> List[float]:
        """通过硅基流动 API 获取文本向量。"""
        if not SILICONFLOW_API_KEY:
            print("警告：未找到 SILICONFLOW_API_KEY。")
            return [0.0] * 1024
            
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{SILICONFLOW_API_URL}/embeddings",
                    headers={
                        "Authorization": f"Bearer {SILICONFLOW_API_KEY}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": self.encoder_model,
                        "input": text_content
                    },
                    timeout=30.0
                )
                response.raise_for_status()
                data = response.json()
                return data["data"][0]["embedding"]
        except Exception as e:
            print(f"硅基流动 Embedding 错误: {e}")
            return [0.0] * 1024

    async def _rerank_results(self, query: str, documents: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """使用硅基流动 BGE-Reranker 对搜索结果进行重排序。"""
        if not SILICONFLOW_API_KEY or not documents:
            return documents
            
        try:
            # 准备重排序的文本对
            pairs = [[query, doc["content"]] for doc in documents]
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{SILICONFLOW_API_URL}/rerank",
                    headers={
                        "Authorization": f"Bearer {SILICONFLOW_API_KEY}",
                        "Content-Type": "application/json"
                    },
                    json={
                        "model": self.reranker_model,
                        "query": query,
                        "documents": [doc["content"] for doc in documents],
                        "top_n": len(documents)
                    },
                    timeout=30.0
                )
                response.raise_for_status()
                data = response.json()
                
                # 硅基流动重排序返回包含 index 和 relevance_score 的结果列表
                # 示例: {"results": [{"index": 0, "relevance_score": 0.9}, ...]}
                reranked_results = data.get("results", [])
                
                # 映射回原始文档并更新评分
                final_results = []
                for res in reranked_results:
                    idx = res["index"]
                    doc = documents[idx].copy()
                    doc["rerank_score"] = res["relevance_score"]
                    final_results.append(doc)
                
                # 按新的重排序评分排序
                final_results.sort(key=lambda x: x.get("rerank_score", 0), reverse=True)
                return final_results
                
        except Exception as e:
            print(f"硅基流动重排序错误: {e}")
            return documents

    async def ingest_document(self, doc_id: str, raw_text: str, metadata: dict = None):
        """将文档切分为片段，计算向量并存储到数据库。"""
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
            
            # 原生更新全文检索向量字段
            await self.db.execute(
                text("UPDATE document_chunks SET fts = to_tsvector('simple', content) WHERE id = :id"),
                {"id": db_chunk.id}
            )
            
        await self.db.commit()

    async def generate_hyde_draft(self, query: str) -> str:
        """使用 LLM 生成一个针对查询的理想答案草稿（HyDE 模式）。"""
        if not openai_client:
            return query
        try:
            response = await openai_client.chat.completions.create(
                model=self.llm_model,
                messages=[
                    {"role": "system", "content": "你是一个知识助手。请针对用户的查询写一个非常详尽、全面且事实准确的假设性回答。这段文本将用于文档检索，因此请专注于官方文档中可能出现的术语、概念和措辞。不要直接回答，只需生成假设性文档内容。"},
                    {"role": "user", "content": query}
                ],
                temperature=0.3,
            )
            return response.choices[0].message.content
        except Exception as e:
            print(f"HyDE 错误: {e}")
            return query

    async def hybrid_search(self, query: str, top_k: int = 5, use_hyde: bool = True) -> List[Dict[str, Any]]:
        """结合密集向量和全文检索（RRF 算法），然后执行重排序。"""
        search_text = query
        if use_hyde:
            search_text = await self.generate_hyde_draft(query)
            
        query_embedding = await self._get_embedding(search_text)
        
        # 在 Postgres 内部直接使用 CTE 执行 RRF 查询
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
        LIMIT 20
        """
        
        result = await self.db.execute(
            text(rrf_query),
            {
                "embedding": str(query_embedding),
                "query": query, 
                "top_k": top_k
            }
        )
        
        rows = result.fetchall()
        
        initial_chunks = []
        for row in rows:
            initial_chunks.append({
                "id": row.id,
                "doc_id": row.doc_id,
                "content": row.content,
                "metadata": json.loads(row.metadata_json) if row.metadata_json else {},
                "score": float(row.rrf_score)
            })
            
        # 执行重排序
        reranked_chunks = await self._rerank_results(query, initial_chunks)
        
        return reranked_chunks[:top_k]
