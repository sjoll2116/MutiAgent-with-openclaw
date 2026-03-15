import os
import json
import httpx
import logging
from typing import List, Dict, Any, Optional
from openai import AsyncOpenAI
from langchain_text_splitters import RecursiveCharacterTextSplitter, Language
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from ..models.document import DocumentChunk

log = logging.getLogger("edict.rag_service")

# 从环境变量获取配置
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
SILICONFLOW_API_KEY = os.getenv("SILICONFLOW_API_KEY")
SILICONFLOW_API_URL = os.getenv("SILICONFLOW_API_URL", "https://api.siliconflow.cn/v1")
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")

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
        self.llm_model = "THUDM/GLM-Z1-9B-0414"
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=512,
            chunk_overlap=128
        )
        
        # Reranker 配置：Top 5 封顶 + 0.4 硬阈值
        self.rerank_threshold = 0.4
        self.rerank_top_k = 5

    async def _get_embedding(self, text_content: str) -> List[float]:
        """通过硅基流动 API 获取文本向量。"""
        if not SILICONFLOW_API_KEY:
            log.warning("未找到 SILICONFLOW_API_KEY。")
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
            log.error(f"硅基流动 Embedding 错误: {e}")
            return [0.0] * 1024

    async def _rerank_results(self, query: str, documents: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """使用硅基流动 BGE-Reranker 对搜索结果进行重排序。"""
        if not SILICONFLOW_API_KEY or not documents:
            return documents
            
        try:
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
                reranked_results = data.get("results", [])
                
                final_results = []
                for res in reranked_results:
                    idx = res["index"]
                    doc = documents[idx].copy()
                    doc["rerank_score"] = res["relevance_score"]
                    final_results.append(doc)
                
                final_results.sort(key=lambda x: x.get("rerank_score", 0), reverse=True)
                return final_results
                
        except Exception as e:
            log.error(f"硅基流动重排序错误: {e}")
            return documents

    async def _web_search_fallback(self, query: str) -> List[Dict[str, Any]]:
        """当本地知识库无结果时，调用 Tavily 搜索进行补充。"""
        if not TAVILY_API_KEY:
            log.info("No TAVILY_API_KEY found, skipping web fallback.")
            return []
            
        try:
            log.info(f"Triggering web search fallback for: {query}")
            url = "https://api.tavily.com/search"
            payload = {
                "api_key": TAVILY_API_KEY,
                "query": query,
                "search_depth": "smart",
                "max_results": 3
            }
            async with httpx.AsyncClient() as client:
                response = await client.post(url, json=payload, timeout=20.0)
                response.raise_for_status()
                data = response.json()
                
                web_results = []
                for res in data.get("results", []):
                    web_results.append({
                        "content": f"[来自网页搜索] {res['title']}\n{res['content']}",
                        "doc_id": f"web:{res['url']}",
                        "score": 0.5,
                        "rerank_score": 0.5,
                        "is_web": True
                    })
                return web_results
        except Exception as e:
            log.error(f"Tavily search fallback failed: {e}")
            return []

    async def ingest_document(self, doc_id: str, raw_text: str, metadata: dict = None, filename: str = None):
        """将文档切分为片段，提取元数据并存储。支持代码感知切分。"""
        if metadata is None:
            metadata = {}
            
        # ── 元数据提取逻辑 ──
        file_name = filename or metadata.get("filename")
        file_type = "text"
        language = None
        
        if file_name:
            ext = file_name.split(".")[-1].lower()
            lang_map = {
                "py": Language.PYTHON, "go": Language.GO, "js": Language.JS, "ts": Language.TS,
                "tsx": Language.TS, "jsx": Language.JS, "java": Language.JAVA,
                "cpp": Language.CPP, "c": Language.C, "html": Language.HTML,
                "md": Language.MARKDOWN, "sol": Language.SOLIDITY, "sh": Language.PROTO,
            }
            language = lang_map.get(ext)
            if ext in ("pdf", "docx", "pptx"): file_type = ext
            elif language: file_type = "code"
            elif ext in ("png", "jpg", "jpeg"): file_type = "image"

        source_agent = metadata.get("source_agent", "user")
        project_id = metadata.get("project_id")

        if language:
            splitter = RecursiveCharacterTextSplitter.from_language(
                language=language,
                chunk_size=self.splitter._chunk_size,
                chunk_overlap=self.splitter._chunk_overlap
            )
            chunks = splitter.split_text(raw_text)
        else:
            chunks = self.splitter.split_text(raw_text)
        
        for chunk in chunks:
            embedding = await self._get_embedding(chunk)
            
            db_chunk = DocumentChunk(
                doc_id=doc_id,
                content=chunk,
                metadata_json=json.dumps(metadata) if metadata else "{}",
                file_name=file_name,
                file_type=file_type,
                source_agent=source_agent,
                project_id=project_id,
                embedding=embedding
            )
            self.db.add(db_chunk)
            await self.db.flush()
            
            await self.db.execute(
                text("UPDATE document_chunks SET fts = to_tsvector('simple', content) WHERE id = :id"),
                {"id": db_chunk.id}
            )
            
        await self.db.commit()

    async def generate_hyde_draft(self, query: str) -> str:
        """HyDE 模式：生成理想答案草稿。"""
        if not openai_client: return query
        try:
            hyde_system_prompt = (
                "你是一个专业技术文档专家。\n"
                "针对用户的查询生成一段详尽且准确的预想回答。仅输出文档内容，不包含引导语。"
            )
            response = await openai_client.chat.completions.create(
                model=self.llm_model,
                messages=[{"role": "system", "content": hyde_system_prompt}, {"role": "user", "content": query}],
                temperature=0.3,
            )
            return response.choices[0].message.content
        except Exception:
            return query

    async def answer_query(self, query: str, top_k: int = 5, metadata_filter: Optional[dict] = None) -> Dict[str, Any]:
        """执行 RAG 完整流程：检索 -> 综合 -> 生成回答。"""
        chunks = await self.hybrid_search(query, top_k=top_k, metadata_filter=metadata_filter)
        
        if not chunks:
            return {"answer": "知识库及网页搜索中均未找到相关信息，建议重新描述问题。", "sources": []}
            
        context = "\n\n".join([f"--- 片段 {i+1} ---\n{c['content']}" for i, c in enumerate(chunks)])
        synthesis_prompt = (
            f"基于提供的【参考知识】回答用户问题。若信息带 [来自网页搜索] 标记，请注明。\n\n"
            f"【参考知识】\n{context}\n\n"
            f"问题：{query}"
        )
        
        try:
            response = await openai_client.chat.completions.create(
                model=self.llm_model,
                messages=[{"role": "system", "content": "你是一个严谨的助理。"}, {"role": "user", "content": synthesis_prompt}],
                temperature=0.5,
            )
            return {"answer": response.choices[0].message.content, "sources": chunks}
        except Exception as e:
            return {"answer": f"合成回答错误: {e}", "sources": chunks}

    async def hybrid_search(self, query: str, top_k: int = 5, use_hyde: bool = True, 
                            metadata_filter: Optional[dict] = None) -> List[Dict[str, Any]]:
        """结合密集向量和全文检索，随后执行过滤、重排序、阈值筛选及 Web 兜底。"""
        search_text = await self.generate_hyde_draft(query) if use_hyde else query
        query_embedding = await self._get_embedding(search_text)
        
        # 构建动态过滤 SQL
        filter_sql = ""
        params = {"embedding": str(query_embedding), "query": query}
        if metadata_filter:
            for key, val in metadata_filter.items():
                if key in ("file_type", "project_id", "source_agent") and val:
                    filter_sql += f" AND c.{key} = :{key}_val"
                    params[f"{key}_val"] = val

        rrf_query = f"""
        WITH vector_search AS (
            SELECT id, RANK() OVER (ORDER BY embedding <=> cast(:embedding as vector)) AS vector_rank
            FROM document_chunks
            ORDER BY embedding <=> cast(:embedding as vector) LIMIT 50
        ),
        fts_search AS (
            SELECT id, RANK() OVER (ORDER BY ts_rank(fts, plainto_tsquery('simple', :query)) DESC) AS fts_rank
            FROM document_chunks
            WHERE fts @@ plainto_tsquery('simple', :query)
            ORDER BY ts_rank(fts, plainto_tsquery('simple', :query)) DESC
            LIMIT 50
        )
        SELECT c.id, c.doc_id, c.content, c.metadata_json,
               COALESCE(1.0 / (60 + v.vector_rank), 0.0) + COALESCE(1.0 / (60 + f.fts_rank), 0.0) AS rrf_score
        FROM document_chunks c
        LEFT JOIN vector_search v ON c.id = v.id
        LEFT JOIN fts_search f ON c.id = f.id
        WHERE (v.id IS NOT NULL OR f.id IS NOT NULL) {filter_sql}
        ORDER BY rrf_score DESC LIMIT 20
        """
        
        result = await self.db.execute(text(rrf_query), params)
        rows = result.fetchall()
        
        initial_chunks = []
        for row in rows:
            initial_chunks.append({
                "id": row.id, "doc_id": row.doc_id, "content": row.content,
                "metadata": json.loads(row.metadata_json) if row.metadata_json else {},
                "score": float(row.rrf_score)
            })
            
        reranked = await self._rerank_results(query, initial_chunks)
        
        # 0.4 硬阈值 + Top-5
        final_results = [c for c in reranked[:self.rerank_top_k] if c.get("rerank_score", 0) >= self.rerank_threshold]
        
        if not final_results:
            final_results = await self._web_search_fallback(query)
            
        return final_results
