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
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

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
elif SILICONFLOW_API_KEY:
    log.info("Using SiliconFlow as LLM provider (fallback from OpenAI).")
    openai_client = AsyncOpenAI(
        api_key=SILICONFLOW_API_KEY,
        base_url=SILICONFLOW_API_URL
    )
else:
    openai_client = None

class RAGService:
    def __init__(self, db: AsyncSession, http_client: httpx.AsyncClient):
        self.db = db
        self.http_client = http_client
        # 硅基流动模型配置
        self.encoder_model = "BAAI/bge-m3"
        self.reranker_model = "BAAI/bge-reranker-v2-m3"
        self.llm_model = "THUDM/GLM-4-32B-0414"
        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=1500,
            chunk_overlap=150,
            separators=["\n# ", "\n## ", "\n### ", "\n\n", "\n", " ", ""]
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

    @retry(
        wait=wait_exponential(multiplier=1, max=10),
        stop=stop_after_attempt(5),
        retry=retry_if_exception_type((httpx.HTTPStatusError, httpx.TimeoutException)),
        reraise=True
    )
    async def _get_embedding(self, input_texts: List[str]) -> List[List[float]]:
        """通过硅基流动 API 获取批量文本向量。极大地提高并发处理速度并避免 429。"""
        if not SILICONFLOW_API_KEY:
            log.warning("未找到 SILICONFLOW_API_KEY。返回空向量池。")
            return [[0.0] * 1024 for _ in input_texts]
            
        try:
            response = await self.http_client.post(
                f"{SILICONFLOW_API_URL}/embeddings",
                headers={
                    "Authorization": f"Bearer {SILICONFLOW_API_KEY}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": self.encoder_model,
                    "input": input_texts
                }
            )
            response.raise_for_status()
            data = response.json()
            # 保证返回的向量顺序与输入严格一致
            embeddings = [item["embedding"] for item in sorted(data["data"], key=lambda x: x["index"])]
            return embeddings
        except httpx.HTTPStatusError as e:
            if e.response.status_code in (429, 502, 503, 504):
                log.warning(f"Embedding API Rate Limit or Server Error ({e.response.status_code}), retrying...")
                raise e
            log.error(f"Embedding fatal error: {e.response.text}")
            return [[0.0] * 1024 for _ in input_texts]
        except Exception as e:
            log.error(f"Embedding error: {e}")
            raise e

    @retry(
        wait=wait_exponential(multiplier=1, max=10),
        stop=stop_after_attempt(3),
        retry=retry_if_exception_type((httpx.HTTPStatusError, httpx.TimeoutException)),
        reraise=True
    )
    async def _rerank_results(self, query: str, documents: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """使用硅基流动 BGE-Reranker 对搜索结果进行重排序。"""
        if not SILICONFLOW_API_KEY or not documents:
            return documents
            
        try:
            response = await self.http_client.post(
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
                }
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
            
        except httpx.HTTPStatusError as e:
            if e.response.status_code in (429, 502, 503, 504):
                log.warning(f"Rerank API Rate Limit or Error ({e.response.status_code}). Retrying...")
                raise e
            log.error(f"Rerank fatal error: {e.response.text}")
            return documents
        except Exception as e:
            log.error(f"Rerank error: {e}")
            raise e

    @retry(
        wait=wait_exponential(multiplier=1, max=10),
        stop=stop_after_attempt(3),
        retry=retry_if_exception_type((httpx.HTTPStatusError, httpx.TimeoutException)),
        reraise=True
    )
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
            response = await self.http_client.post(url, json=payload, timeout=20.0)
            response.raise_for_status()
            data = response.json()
            
            web_results = []
            for res in data.get("results", []):
                web_results.append({
                    "content": f"[外部互联网参考资料] {res['title']}\n{res['content']}",
                    "doc_id": f"web:{res['url']}",
                    "score": 0.5,
                    "rerank_score": 0.5,
                    "is_web": True
                })
            return web_results
        except httpx.HTTPStatusError as e:
            if e.response.status_code in (429, 502, 503, 504):
                log.warning(f"Tavily API Limit ({e.response.status_code}), retrying...")
                raise e
            log.error(f"Tavily error: {e.response.text}")
            return []
        except Exception as e:
            log.error(f"Tavily search fallback failed: {e}")
            raise e

    async def ingest_document(self, doc_id: str, file_bytes: bytes, raw_text: str, metadata: Optional[Dict[str, Any]] = None, 
                               filename: Optional[str] = None, is_temporary: bool = False):
        """将文档切分为片段，提取元数据并存储。支持清洗、去重及生命周期管理。"""
        if metadata is None: metadata = {}
        
        # 0. 原始文件持久化存储
        upload_dir = "data/uploads"
        os.makedirs(upload_dir, exist_ok=True)
        
        ext = filename.split(".")[-1].lower() if filename and "." in filename else "bin"
        # 使用 doc_id 命名以确保物理文件与数据库记录一一对应
        storage_filename = f"{doc_id}.{ext}"
        file_path = os.path.join(upload_dir, storage_filename)
        
        with open(file_path, "wb") as f:
            f.write(file_bytes)
        log.info(f"Original file persisted to: {file_path}")

        # 1. 文本清洗
        cleaned_text = AdvancedCleaningService.process(raw_text)
        
        # --- 实现方案 A：彻底清洗 pymupdf4llm 产生的图片占位符及无意义文本 ---
        # 1. 清除主占位符标签，例如: **==> picture [20 x 20] intentionally omitted <==**
        cleaned_text = re.sub(r'\*\*==>\s*picture.*?<==\*\*', '', cleaned_text, flags=re.IGNORECASE)
        # 2. 清除附带的图片内嵌识别文本，例如: --- Start of picture text *** <br> 3 <br> --- End of picture text ***
        cleaned_text = re.sub(r'---\s*Start of picture text\s*\*\*\*.*?---\s*End of picture text\s*\*\*\*(?:<br>)?', '', cleaned_text, flags=re.IGNORECASE | re.DOTALL)
        
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
                "md": Language.MARKDOWN,
            }
            language = lang_map.get(ext)
            if ext in ("pdf", "docx", "pptx"): file_type = ext
            elif language: file_type = "code"
            elif ext in ("png", "jpg", "jpeg"): file_type = "image"

        source_agent = metadata.get("source_agent", "user")
        project_id = metadata.get("project_id")
        
        expire_at = datetime.now() + timedelta(hours=24) if is_temporary else None

        # 3. 创建主文档记录
        new_doc = Document(
            doc_id=doc_id,
            file_name=file_name,
            file_type=file_type,
            file_hash=file_hash,
            source_agent=source_agent,
            file_path=file_path,  # 关联物理路径
            project_id=project_id,
            expire_at=expire_at
        )
        self.db.add(new_doc)
        await self.db.flush()

        # Parent-Child chunking
        parent_splitter = self.splitter 
        child_splitter = RecursiveCharacterTextSplitter(
            chunk_size=350,
            chunk_overlap=50,
            separators=["\n\n", "\n", " ", ""]
        )
        
        parent_chunks_raw = []
        if language == Language.MARKDOWN:
            parent_chunks_raw = self._markdown_semantic_split(cleaned_text, file_name)
        elif language:
            code_splitter = RecursiveCharacterTextSplitter.from_language(
                language=language, 
                chunk_size=5000,
                chunk_overlap=0
            )
            raw = code_splitter.split_text(cleaned_text)
            parent_chunks_raw = [{"text": c, "path": "Code"} for c in raw]
        else:
            raw = parent_splitter.split_text(cleaned_text)
            parent_chunks_raw = [{"text": c, "path": "General"} for c in raw]

        # 生成 Child 块并构建扁平化数据结构以便统一打流 (Embedding)
        flat_chunk_data = []
        for p_idx, p_item in enumerate(parent_chunks_raw):
            flat_chunk_data.append({
                "text": p_item["text"], 
                "path": p_item["path"], 
                "type": "parent", 
                "parent_idx": None,
                "idx": p_idx
            })
            
            # 对较长的 Parent 进行 Child 切分
            if len(p_item["text"]) > 256:
                child_texts = child_splitter.split_text(p_item["text"])
                for c_text in child_texts:
                    flat_chunk_data.append({
                        "text": c_text,
                        "path": p_item["path"],
                        "type": "child",
                        "parent_idx": p_idx,
                        "idx": len(flat_chunk_data)
                    })
        
        # --- 批量获取向量并写入  ---
        enrichment_texts = []
        for item in flat_chunk_data:
            chunk_text = item["text"]
            section_path = item["path"]
            enrichment_texts.append(f"Document: {file_name}\nSection: {section_path}\n{chunk_text}")
        
        # 批量请求向量池 (每批 50)
        embeddings = []
        for i in range(0, len(enrichment_texts), 50):
            batch_texts = enrichment_texts[i:i+50]
            batch_emb = await self._get_embedding(batch_texts)
            embeddings.extend(batch_emb)
        
        # 分离 parent 和 child，实现两段式入库
        parent_db_chunks = []
        child_flat_items = [] # 保留 child 的原始 flat 信息以映射 embedding
        
        for i, item in enumerate(flat_chunk_data):
            if item["type"] == "parent":
                chunk_metadata = metadata.copy()
                chunk_metadata["section_path"] = item["path"]
                chunk_metadata["file_name"] = file_name
                
                db_chunk = DocumentChunk(
                    doc_id=doc_id,
                    content=item["text"],
                    metadata_json=json.dumps(chunk_metadata),
                    file_name=file_name,
                    file_type=file_type,
                    source_agent=source_agent,
                    project_id=project_id,
                    embedding=embeddings[i]
                )
                parent_db_chunks.append((item["idx"], db_chunk))
            else:
                child_flat_items.append((i, item))

        # 1. 先插入 Parent 获取 ID
        db_parents_only = [chunk for _, chunk in parent_db_chunks]
        self.db.add_all(db_parents_only)
        await self.db.flush() 
        
        parent_idx_to_db_id = {idx: chunk.id for idx, chunk in parent_db_chunks}
        
        # 2. 构建并插入 Child Chunks
        child_db_chunks = []
        for global_i, item in child_flat_items:
            chunk_metadata = metadata.copy()
            chunk_metadata["section_path"] = item["path"]
            chunk_metadata["file_name"] = file_name
            
            parent_db_id = parent_idx_to_db_id.get(item["parent_idx"])
            
            db_chunk = DocumentChunk(
                doc_id=doc_id,
                content=item["text"],
                metadata_json=json.dumps(chunk_metadata),
                file_name=file_name,
                file_type=file_type,
                source_agent=source_agent,
                project_id=project_id,
                embedding=embeddings[global_i],
                parent_id=parent_db_id
            )
            child_db_chunks.append(db_chunk)
            
        if child_db_chunks:
            self.db.add_all(child_db_chunks)
            await self.db.flush()
        
        # 聚合单条 Update 彻底完成 FTS 更新
        await self.db.execute(
            text("UPDATE document_chunks SET fts = to_tsvector('simple', content) WHERE doc_id = :doc_id"),
            {"doc_id": doc_id}
        )
        
        await self.db.commit()

    async def delete_document(self, doc_id: str):
        """软删除文档。"""
        await self.db.execute(
            update(Document).where(Document.doc_id == doc_id).values(is_deleted=True)
        )
        await self.db.commit()

    async def hard_delete_document(self, doc_id: str):
        """硬删除文档及其所有切片，释放空间。"""
        from sqlalchemy import delete
        from ..models.document import DocumentChunk
        await self.db.execute(
            delete(DocumentChunk).where(DocumentChunk.doc_id == doc_id)
        )
        await self.db.execute(
            delete(Document).where(Document.doc_id == doc_id)
        )
        await self.db.commit()

    async def list_documents(self, page: int = 1, limit: int = 10) -> Dict[str, Any]:
        """分页查看未删除的文档，返回列表及总数。"""
        offset = (page - 1) * limit
        count_query = select(text("count(*)")).select_from(Document).where(Document.is_deleted == False)
        count_res = await self.db.execute(count_query)
        total = count_res.scalar() or 0

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
        """Query routing - 3 mutually exclusive paths:
          bypass: original query as-is
          rewrite_only: 【升级】支持查询拆解 (Multi-Query Array)，用于应对包含多意图的复合问题。
          hyde: hypothetical answer from ORIGINAL query
        """
        if not openai_client:
            return {"rewritten_queries": [query], "routing": "bypass"}
        
        try:
            rewrite_system_prompt = (
                "You are an intelligent routing expert for a RAG system. "
                "Analyze the user query and context.\n"
                "Decide the processing path. Three MUTUALLY EXCLUSIVE paths:\n"
                "1. bypass: Query is already clear and specific.\n"
                "2. rewrite_only: Query has unclear references, or contains MULTIPLE distinct factual questions "
                "(e.g., 'command to config AND top 10 skills'). Split and rewrite into an ARRAY of 1 to 3 "
                "standalone, optimized search terms. For factual lookups.\n"
                "3. hyde: Large semantic gap. User asks about abstract concepts. The system will generate a hypothetical answer. "
                "For this path, you MUST STILL clean the query by removing roleplay and conversational filler.\n\n"
                "Rules:\n"
                "- bypass: rewritten_queries = [\"original query unchanged\"].\n"
                "- rewrite_only: rewritten_queries = [\"optimized sub-query 1\", \"optimized sub-query 2\", ...].\n"
                "- hyde: rewritten_queries = [\"optimized clean question WITHOUT roleplay\"].\n"
                'Output ONLY JSON: {"routing_decision": "bypass"|"rewrite_only"|"hyde", '
                '"rewritten_queries": ["..."]}'
            )
            
            user_msg = f"Context: {context}\nQuery: {query}" if context else f"Query: {query}"
            
            response = await openai_client.chat.completions.create(
                model=self.llm_model, 
                messages=[
                    {"role": "system", "content": rewrite_system_prompt},
                    {"role": "user", "content": user_msg}
                ],
                temperature=0.1,
                response_format={"type": "json_object"}
            )
            
            result = json.loads(response.choices[0].message.content)
            routing = result.get("routing_decision", "bypass")
            rewritten_queries = result.get("rewritten_queries", [query])
            
            if not isinstance(rewritten_queries, list):
                rewritten_queries = [rewritten_queries]
                
            if routing == "bypass" or not rewritten_queries:
                rewritten_queries = [query]
            
            log.info(f"Query Routing: [{routing}] {query} -> {rewritten_queries}")
            return {"rewritten_queries": rewritten_queries, "routing": routing}
        except Exception as e:
            log.error(f"Query Rewrite error: {e}")
            return {"rewritten_queries": [query], "routing": "bypass"}

    async def generate_hyde_draft(self, query: str) -> str:
        """HyDE 模式：生成理想答案草案。"""
        if not openai_client: return query
        try:
            hyde_system_prompt = (
                "You are a professional technical documentation expert.\n"
                "Please generate a detailed, authoritative, and accurate hypothetical document excerpt "
                "that answers the user's query. The output should read EXACTLY like a section from an "
                "official technical manual, wiki, or official documentation.\n"
                "DO NOT include any conversational filler, greetings, or acknowledgments.\n"
                "Output ONLY the document content."
            )
            response = await openai_client.chat.completions.create(
                model=self.llm_model, 
                messages=[{"role": "system", "content": hyde_system_prompt}, {"role": "user", "content": query}],
                temperature=0.3,
            )
            draft = response.choices[0].message.content
            log.info(f"HyDE draft generated ({len(draft)} chars): {draft[:200]}...")
            return draft
        except Exception as e:
            log.error(f"HyDE error: {e}")
            return query

    async def answer_query(self, query: str, top_k: int = 5, metadata_filter: Optional[dict] = None, 
                           context: Optional[str] = None, allow_web_search: bool = False) -> Dict[str, Any]:
        """执行 RAG 完整流程：检索 -> 综合 -> 生成回答。
        
        Args:
            allow_web_search: 私域场景默认为 False。若设为 True，将在内部检索失败时调用外部搜索引擎兜底。
        """
        search_res = await self.hybrid_search(
            query, top_k=top_k, metadata_filter=metadata_filter, 
            context=context, allow_web_search=allow_web_search
        )
        chunks = search_res["chunks"]
        routing_info = search_res["routing_info"]
        
        if not chunks:
            return {
                "context": "", 
                "sources": [], 
                "routing_info": routing_info,
                "message": "No relevant information found in knowledge base."
            }
            
        # Format chunks into structured context for Agent consumption
        formatted_parts = []
        for i, c in enumerate(chunks, 1):
            m = c.get("metadata", {})
            source_tag = f"[Source: {m.get('file_name', 'unknown')}, Section: {m.get('section_path', 'Root')}]"
            web_tag = " [Web]" if c.get("is_web", False) else ""
            score = c.get("rerank_score", c.get("score", 0))
            formatted_parts.append(
                f"--- Reference #{i} {source_tag}{web_tag} (score: {score:.2f}) ---\n"
                f"{c['content']}"
            )
        
        context_str = "\n\n".join(formatted_parts)
        
        # Auto eval sampling hook (record without synthesis)
        try:
            sample = EvalSample(
                sample_type="rag",
                query=query,
                context=context_str,
                answer="[direct-chunks-mode]",
                metadata_json=json.dumps({
                    "top_k": top_k,
                    "model": self.llm_model,
                    "source_count": len(chunks),
                    "routing_decision": routing_info.get("routing"),
                    "rewritten_queries": routing_info.get("rewritten_queries"),
                    "used_hyde": routing_info.get("used_hyde", False),
                    "web_fallback_triggered": routing_info.get("web_fallback_triggered", False)
                })
            )
            self.db.add(sample)
            await self.db.flush()
        except Exception as eval_err:
            log.warning(f"Failed to save eval sample: {eval_err}")

        return {
            "context": context_str,
            "sources": chunks,
            "routing_info": routing_info
        }

    async def hybrid_search(self, query: str, top_k: int = 5, use_hyde: bool = True, 
                            metadata_filter: Optional[dict] = None, context: Optional[str] = None,
                            allow_web_search: bool = False) -> Dict[str, Any]:
        """Hybrid vector + FTS search with Multi-Query Routing and Parent-Child Reranking."""
        
        # 1. 路由与查询分解
        rewrite_res = await self.rewrite_query(query, context)
        routing = rewrite_res.get("routing", "bypass")
        rewritten_queries = rewrite_res.get("rewritten_queries", [query])
        
        search_texts = []
        if routing == "hyde" and use_hyde:
            # 对于 HyDE，仅使用第一个核心问题生成草稿
            search_text = await self.generate_hyde_draft(rewritten_queries[0])
            search_texts = [search_text]
            used_hyde = True
        elif routing == "rewrite_only":
            search_texts = rewritten_queries # 可能存在多个子查询
            used_hyde = False
        else:  # bypass
            search_texts = [query]
            used_hyde = False
        
        # 2. 批量获取所有查询分支的 Embedding
        embeddings = await self._get_embedding(search_texts)
        
        # 3. 动态拼接多维过滤
        filter_parts: List[str] = []
        if metadata_filter:
            for key, val in metadata_filter.items():
                if key in ("file_type", "project_id", "source_agent", "file_name", "doc_id") and val:
                    filter_parts.append(f"AND c.{key} = :{key}_val")
                elif key == "year" and val:
                    filter_parts.append(f"AND EXTRACT(YEAR FROM d.created_at) = :year_val")
        filter_sql = " ".join(filter_parts)

        # SQL 提取中分离 chunk_content (供 Rerank) 和 parent_content (供 LLM)
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
        SELECT c.id, 
               COALESCE(p.doc_id, c.doc_id) as doc_id, 
               c.content as chunk_content, 
               COALESCE(p.content, c.content) as parent_content, 
               COALESCE(p.metadata_json, c.metadata_json) as metadata_json,
               COALESCE(1.0 / (60 + v.vector_rank), 0.0) + COALESCE(1.0 / (60 + f.fts_rank), 0.0) AS rrf_score
        FROM document_chunks c
        LEFT JOIN vector_search v ON c.id = v.id
        LEFT JOIN fts_search f ON c.id = f.id
        LEFT JOIN document_chunks p ON c.parent_id = p.id
        JOIN documents d ON c.doc_id = d.doc_id
        WHERE (v.id IS NOT NULL OR f.id IS NOT NULL) 
          AND d.is_deleted = false 
          {filter_sql}
        ORDER BY rrf_score DESC LIMIT 30
        """
        
        # 4. 循环执行 Multi-Query 并合并结果 (在单一 session 中线性安全执行)
        unique_chunks_map = {}
        
        # 构造执行对：(向量检索文本, 全文检索文本)
        # 如果是 HyDE 模式，向量用 search_texts[0] (即 HyDE 稿子)，FTS 强制用原始 query
        if routing == "hyde" and used_hyde:
            query_pairs = [(search_texts[0], query)]
        else:
            query_pairs = [(txt, txt) for txt in search_texts]

        for vector_txt, fts_txt in query_pairs:
            # 获取对应的向量（对应 query_pairs 的顺序）
            # 注意：如果 routing == "hyde"，search_texts 只有一个元素，embeddings 也只有一个
            curr_emb = embeddings[0] if (routing == "hyde") else embeddings[search_texts.index(vector_txt)]
            
            params = {"embedding": str(curr_emb), "query": fts_txt}
            if metadata_filter:
                for key, val in metadata_filter.items():
                    if key in ("file_type", "project_id", "source_agent", "file_name", "doc_id") and val:
                        params[f"{key}_val"] = val
                    elif key == "year" and val:
                        params["year_val"] = int(val)
                        
            result = await self.db.execute(text(rrf_query), params)
            rows = result.fetchall()
            
            # 使用 chunk_content 哈希去重合并所有子查询结果
            for row in rows:
                content_hash = hashlib.md5(row.chunk_content.encode('utf-8')).hexdigest()
                if content_hash not in unique_chunks_map:
                    unique_chunks_map[content_hash] = {
                        "doc_id": row.doc_id, 
                        "content": row.chunk_content, # 用于精准 Rerank
                        "parent_content": row.parent_content, # 用于 LLM 上下文
                        "metadata": json.loads(row.metadata_json) if row.metadata_json else {},
                        "score": float(row.rrf_score)
                    }
                else:
                    if float(row.rrf_score) > unique_chunks_map[content_hash]["score"]:
                        unique_chunks_map[content_hash]["score"] = float(row.rrf_score)
                        
        initial_chunks = list(unique_chunks_map.values())
        
        # 5. 精准 Reranking：模型只会看到 500 字的精华片段，排序极准
        reranked = await self._rerank_results(query, initial_chunks)
        
        # 6. 父文档替换与去重 (Parent Document Replacement)
        passed_chunks = [c for c in reranked if c.get("rerank_score", 0) >= self.rerank_threshold]
        passed_chunks.sort(key=lambda x: x["rerank_score"], reverse=True)
        
        final_results = []
        seen_parents = set()
        for c in passed_chunks:
            parent_hash = hashlib.md5(c["parent_content"].encode('utf-8')).hexdigest()
            if parent_hash not in seen_parents:
                seen_parents.add(parent_hash)
                # 将内容替换回大块父文档，喂给 LLM
                c["content"] = c["parent_content"] 
                final_results.append(c)
                if len(final_results) >= self.rerank_top_k:
                    break
        
        # 7. 智能双阈值 Web 兜底逻辑 (依据 allow_web_search 开关执行)
        needs_fallback = False
        if not final_results:
            needs_fallback = True
        elif final_results[0].get("rerank_score", 0) < 0.70 or len(final_results) < 3:
            needs_fallback = True
            
        web_fallback_triggered = False
        if needs_fallback and allow_web_search:
            log.info("触发网络搜索兜底 (Web Fallback)")
            web_results = await self._web_search_fallback(query)
            final_results.extend(web_results)
            web_fallback_triggered = True
            
        # 8. 返回结果与元数据
        return {
            "chunks": final_results,
            "routing_info": {
                "routing": routing,
                "rewritten_queries": rewritten_queries,
                "used_hyde": used_hyde,
                "web_fallback_triggered": web_fallback_triggered
            }
        }