import os
import json
import httpx
import logging
import hashlib
import re
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
from openai import AsyncOpenAI
from langchain_text_splitters import RecursiveCharacterTextSplitter, Language
from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from ..models.document import Document, DocumentChunk, EvalSample
from .cleaning_service import AdvancedCleaningService

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

    def _calculate_hash(self, text_content: str) -> str:
        """计算内容的 SHA-256 哈希值用于去重。"""
        return hashlib.sha256(text_content.encode("utf-8")).hexdigest()

    def _markdown_semantic_split(self, text_content: str, file_name: str) -> List[Dict[str, str]]:
        """针对 Markdown 的层级富化切片方案。
        返回包含 'text' 和 'path' 的字典列表。
        """
        lines = text_content.split("\n")
        header_stack = []
        sections = []
        current_content = []
        
        for line in lines:
            header_match = re.match(r'^(#+)\s+(.*)', line)
            if header_match:
                if current_content:
                    path = " > ".join(header_stack) if header_stack else "Root"
                    sections.append({"text": "\n".join(current_content), "path": path})
                    current_content = []
                
                level = len(header_match.group(1))
                title = header_match.group(2).strip()
                while len(header_stack) >= level:
                    header_stack.pop()
                header_stack.append(title)
            else:
                current_content.append(line)
        
        if current_content:
            path = " > ".join(header_stack) if header_stack else "Root"
            sections.append({"text": "\n".join(current_content), "path": path})
            
        final_chunks = []
        for sec in sections:
            if len(sec["text"]) > self.splitter._chunk_size:
                sub_texts = self.splitter.split_text(sec["text"])
                for st in sub_texts:
                    final_chunks.append({"text": st, "path": sec["path"]})
            else:
                final_chunks.append(sec)
                
        return final_chunks

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
        return []

    async def ingest_document(self, doc_id: str, raw_text: str, metadata: Optional[Dict[str, Any]] = None, 
                               filename: Optional[str] = None, is_temporary: bool = False):
        """将文档切分为片段，提取元数据并存储。支持清洗、去重及生命周期管理。"""
        if metadata is None: metadata = {}
        
        # 0. 文本清洗
        cleaned_text = AdvancedCleaningService.process(raw_text)
        
        # 1. 去重检查 (基于 SHA-256)
        file_hash = self._calculate_hash(cleaned_text)
        existing_doc_query = await self.db.execute(select(Document).where(Document.file_hash == file_hash))
        if existing_doc_query.scalar_one_or_none():
            log.info(f"File with hash {file_hash} already exists. Skipping ingestion.")
            return

        # 2. 元数据准备
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
        
        # 生命周期
        expire_at = datetime.now() + timedelta(hours=24) if is_temporary else None

        # 3. 创建主文档记录
        new_doc = Document(
            doc_id=doc_id,
            file_name=file_name,
            file_type=file_type,
            file_hash=file_hash,
            source_agent=source_agent,
            project_id=project_id,
            expire_at=expire_at
        )
        self.db.add(new_doc)
        await self.db.flush()

        # 4. 切片与元数据富化 (Structured Metadata)
        if language == Language.MARKDOWN:
            chunk_data = self._markdown_semantic_split(cleaned_text, file_name)
        elif language:
            splitter = RecursiveCharacterTextSplitter.from_language(
                language=language,
                chunk_size=self.splitter._chunk_size,
                chunk_overlap=self.splitter._chunk_overlap
            )
            raw_chunks = splitter.split_text(cleaned_text)
            chunk_data = [{"text": c, "path": "Code"} for c in raw_chunks]
        else:
            raw_chunks = self.splitter.split_text(cleaned_text)
            chunk_data = [{"text": c, "path": "General"} for c in raw_chunks]
        
        for item in chunk_data:
            chunk_text = item["text"]
            section_path = item["path"]
            
            # --- 向量计算注入上下文 (Embedding-only Enrichment) ---
            # 向量模型需要知道它属于哪个文档和章节，但存储时不强行拼接。
            enrichment_for_embedding = f"Document: {file_name}\nSection: {section_path}\n{chunk_text}"
            embedding = await self._get_embedding(enrichment_for_embedding)

            # 更新本片段特有的元数据
            chunk_metadata = metadata.copy()
            chunk_metadata["section_path"] = section_path
            chunk_metadata["file_name"] = file_name

            db_chunk = DocumentChunk(
                doc_id=doc_id,
                content=chunk_text, # 存储干净的文本，节约 Rerank/LLM Token
                metadata_json=json.dumps(chunk_metadata),
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

    async def delete_document(self, doc_id: str):
        """软删除文档。"""
        await self.db.execute(
            update(Document).where(Document.doc_id == doc_id).values(is_deleted=True)
        )
        await self.db.commit()

    async def list_documents(self, page: int = 1, limit: int = 10) -> Dict[str, Any]:
        """分页查看未删除的文档，返回列表及总数。"""
        offset = (page - 1) * limit
        
        # 获取总数
        count_query = select(text("count(*)")).select_from(Document).where(Document.is_deleted == False)
        count_res = await self.db.execute(count_query)
        total = count_res.scalar() or 0

        # 获取分页结果
        result = await self.db.execute(
            select(Document).where(Document.is_deleted == False).order_by(Document.created_at.desc()).offset(offset).limit(limit)
        )
        docs = result.scalars().all()
        
        return {
            "total": total,
            "items": [
                {
                    "doc_id": d.doc_id,
                    "file_name": d.file_name,
                    "file_type": d.file_type,
                    "created_at": d.created_at.isoformat() if d.created_at else None,
                    "source_agent": d.source_agent,
                    "is_temporary": d.expire_at is not None
                } for d in docs
            ]
        }

    async def rewrite_query(self, query: str, context: Optional[str] = None) -> Dict[str, Any]:
        """使用 GLM-4-9B-Chat 进行查询意图分析与路由分发。
        判断是否可以直接放行、仅需改写、还是需要深度幻觉。
        """
        if not openai_client:
            return {"rewritten_query": query, "needs_hyde": False, "routing": "bypass"}
        
        try:
            rewrite_system_prompt = (
                "你是一个 RAG 系统的智能路由专家。请分析用户的原始查询和当前对话上下文。\n"
                "你的任务是决定该查询的处理路径并输出 JSON。选项如下：\n"
                "1. bypass: 查询本身已经非常清晰、完整，无需任何扩充即可精准命中数据库（如：“系统架构图在哪里”、“192.168.1.1 设备的文档”）。\n"
                "2. rewrite_only: 存在指代不清（“修复它”、“那个任务”），或语句不够精炼，需要你结合上下文补全为独立搜索词，但属于明确的事实搜寻，不需要生成虚构答案。\n"
                "3. hyde: 语义鸿沟大。用户问的是抽象概念、原理逻辑或寻求解决方案（如：“如何优化并发性能”、“为什么总是报超时错误”）。你需要标记为 hyde，系统会用假想答案去检索。\n"
                "\n"
                "要求：若判定为 bypass，rewritten_query 保持原样；若判定为其它，提供优化后的查询。\n"
                "务必仅以 JSON 格式输出：{\"routing_decision\": \"bypass\"|\"rewrite_only\"|\"hyde\", \"rewritten_query\": \"...\"}"
            )
            
            user_msg = f"上下文: {context}\n问题: {query}" if context else f"问题: {query}"
            
            response = await openai_client.chat.completions.create(
                model="THUDM/glm-4-9b-chat", # 使用指定模型
                messages=[
                    {"role": "system", "content": rewrite_system_prompt},
                    {"role": "user", "content": user_msg}
                ],
                temperature=0.1,
                response_format={"type": "json_object"}
            )
            
            result = json.loads(response.choices[0].message.content)
            routing = result.get("routing_decision", "bypass")
            rewritten_query = result.get("rewritten_query", query)
            
            # 若判研为 bypass，强制使用原词以防 LLM 画蛇添足
            if routing == "bypass":
                rewritten_query = query
                
            needs_hyde = (routing == "hyde")
            
            log.info(f"Query Routing: [{routing}] {query} -> {rewritten_query}")
            return {"rewritten_query": rewritten_query, "needs_hyde": needs_hyde, "routing": routing}
        except Exception as e:
            log.error(f"Query Rewrite error: {e}")
            return {"rewritten_query": query, "needs_hyde": False, "routing": "bypass"}

    async def generate_hyde_draft(self, query: str) -> str:
        """HyDE 模式：生成理想答案草案。"""
        if not openai_client: return query
        try:
            hyde_system_prompt = (
                "你是一个专业技术文档专家。\n"
                "针对用户的查询生成一段详尽且准确的预想回答。仅输出文档内容，不包含引导语。"
            )
            response = await openai_client.chat.completions.create(
                model="THUDM/glm-4-9b-chat", # 保持模型一致性
                messages=[{"role": "system", "content": hyde_system_prompt}, {"role": "user", "content": query}],
                temperature=0.3,
            )
            return response.choices[0].message.content
        except Exception as e:
            log.error(f"HyDE error: {e}")
            return query

    async def answer_query(self, query: str, top_k: int = 5, metadata_filter: Optional[dict] = None, 
                           context: Optional[str] = None) -> Dict[str, Any]:
        """执行 RAG 完整流程：检索 -> 综合 -> 生成回答。"""
        chunks = await self.hybrid_search(query, top_k=top_k, metadata_filter=metadata_filter, context=context)
        
        if not chunks:
            return {"answer": "知识库及网页搜索中均未找到相关信息，建议重新描述问题。", "sources": []}
            
        # 综合参考资料：从元数据动态重建上下文头，保持 content 干净
        context_parts = []
        for i, c in enumerate(chunks):
            m = c.get("metadata", {})
            header = f"--- [来源: {m.get('file_name', '未知')}, 章节: {m.get('section_path', 'Root')}] ---"
            context_parts.append(f"{header}\n{c['content']}")
        
        context = "\n\n".join(context_parts)
        synthesis_prompt = (
            f"基于提供的【参考知识】回答用户问题。若信息带 [来自网页搜索] 标记，请注明。\n\n"
            f"【参考知识】\n{context}\n\n"
            f"问题：{query}"
        )
        
        if not openai_client:
            return {"answer": "OpenAI API Key 未配置，无法合成回答。", "sources": chunks}
            
        try:
            response = await openai_client.chat.completions.create(
                model=self.llm_model,
                messages=[{"role": "system", "content": "你是一个严谨的助理。"}, {"role": "user", "content": synthesis_prompt}],
                temperature=0.5,
            )
            answer = response.choices[0].message.content
            
            # --- 自动评估采样 Hook ---
            try:
                sample = EvalSample(
                    sample_type="rag",
                    query=query,
                    context=context,
                    answer=answer,
                    metadata_json=json.dumps({
                        "top_k": top_k,
                        "model": self.llm_model,
                        "source_count": len(chunks)
                    })
                )
                self.db.add(sample)
                await self.db.flush() # 确保在当前事务中生效，或者可以用独立 session
            except Exception as eval_err:
                log.warning(f"Failed to save eval sample: {eval_err}")

            return {"answer": answer, "sources": chunks}
        except Exception as e:
            return {"answer": f"合成回答错误: {e}", "sources": chunks}

    async def hybrid_search(self, query: str, top_k: int = 5, use_hyde: bool = True, 
                            metadata_filter: Optional[dict] = None, context: Optional[str] = None) -> List[Dict[str, Any]]:
        """结合密集向量和全文检索，随后执行过滤、重排序、阈值筛选及 Web 兜底。支持软删除过滤。"""
        # 1. 查询改写与动态 HyDE 决策
        rewrite_res = await self.rewrite_query(query, context)
        rewritten_query = rewrite_res.get("rewritten_query", query)
        should_hyde = rewrite_res.get("needs_hyde", False) and use_hyde
        
        # 2. 生成向量搜索文本 (Rewritten or HyDE)
        search_text = await self.generate_hyde_draft(rewritten_query) if should_hyde else rewritten_query
        query_embedding = await self._get_embedding(search_text)
        
        # 3. 动态拼接多维过滤
        filter_parts: List[str] = []
        params = {"embedding": str(query_embedding), "query": query}
        if metadata_filter:
            for key, val in metadata_filter.items():
                if key in ("file_type", "project_id", "source_agent") and val:
                    filter_parts.append(f"AND c.{key} = :{key}_val")
                    params[f"{key}_val"] = val
        
        filter_sql = " ".join(filter_parts)

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
        JOIN documents d ON c.doc_id = d.doc_id
        WHERE (v.id IS NOT NULL OR f.id IS NOT NULL) 
          AND d.is_deleted = false 
          {filter_sql}
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
        
        if len(reranked) > self.rerank_top_k:
            candidate_list = reranked[0:self.rerank_top_k]
        else:
            candidate_list = reranked

        final_results = [c for c in candidate_list if c.get("rerank_score", 0) >= self.rerank_threshold]
        
        if not final_results:
            final_results = await self._web_search_fallback(query)
            
        return final_results
