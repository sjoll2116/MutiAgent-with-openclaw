import os
import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query, Request, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Dict, Any, Optional
from ..db import get_db
from ..services.rag_service import RAGService
from ..services.multimodal_parser import MultiModalParser
from ..auth import get_current_user

log = logging.getLogger("edict.api.rag")

router = APIRouter(prefix="/rag", tags=["RAG"], dependencies=[Depends(get_current_user)])

class SearchRequest(BaseModel):
    query: str
    top_k: int = 5
    use_hyde: bool = True
    metadata_filter: Optional[dict] = None

class ActionResponse(BaseModel):
    status: str
    message: str

@router.post("/search")
async def search(request: Request, search_req: SearchRequest, db: AsyncSession = Depends(get_db)):
    """混合检索接口，支持元数据过滤。"""
    service = RAGService(db, http_client=request.app.state.http_client)
    results = await service.hybrid_search(
        search_req.query, 
        top_k=search_req.top_k, 
        use_hyde=search_req.use_hyde,
        metadata_filter=search_req.metadata_filter
    )
    return results

@router.post("/ask")
async def ask(request: Request, ask_req: SearchRequest, db: AsyncSession = Depends(get_db)):
    """RAG 问答接口"""
    service = RAGService(db, http_client=request.app.state.http_client)
    return await service.answer_query(
        ask_req.query, 
        top_k=ask_req.top_k, 
        metadata_filter=ask_req.metadata_filter
    )

@router.get("/documents")
async def list_documents(
    request: Request,
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db)
):
    """罗列知识库中的文档"""
    service = RAGService(db, http_client=request.app.state.http_client)
    return await service.list_documents(page, limit)

@router.delete("/documents/{doc_id}")
async def delete_document(request: Request, doc_id: str, db: AsyncSession = Depends(get_db)):
    """从知识库中删除特定文档及其切片"""
    service = RAGService(db, http_client=request.app.state.http_client)
    await service.delete_document(doc_id)
    return {"status": "success", "message": f"Document {doc_id} deleted."}

@router.post("/ingest-file")
async def ingest_file(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    project_id: str = Form(""),
    is_temporary: bool = Form(False),
    db: AsyncSession = Depends(get_db)
):
    """多模态文件上传与注入 (异步后台处理)。"""
    try:
        parser = MultiModalParser()
        content = await file.read()
        
        # 逻辑分流解析 (此时同步读取，因为需要拿到内容以写入后台，防止文件指针失效)
        text_content = await parser.parse(content, file.filename)
        
        # 业务 doc_id 建议包含时间戳和随机位
        doc_id = f"up-{datetime.now().strftime('%Y%m%d%H%M')}-{os.urandom(3).hex()}"
        
        # 将耗时的清洗、向量化和入库扔进后台任务
        # 创建一个独立于当前 Request 生命周期的 Service
        from ..db import async_session
        async def _background_ingest():
            async with async_session() as bg_db:
                service = RAGService(bg_db, http_client=request.app.state.http_client)
                await service.ingest_document(
                    doc_id=doc_id,
                    raw_text=text_content,
                    metadata={"project_id": project_id, "source_agent": "user"},
                    filename=file.filename,
                    is_temporary=is_temporary
                )
                await bg_db.commit()

        background_tasks.add_task(_background_ingest)
        
        return {"status": "processing", "message": "File is being ingested in background.", "doc_id": doc_id}
    except Exception as e:
        log.error(f"Ingest file error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
