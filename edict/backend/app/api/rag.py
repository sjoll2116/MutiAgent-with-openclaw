import os
import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
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
async def search(request: SearchRequest, db: AsyncSession = Depends(get_db)):
    """混合检索接口，支持元数据过滤。"""
    service = RAGService(db)
    results = await service.hybrid_search(
        request.query, 
        top_k=request.top_k, 
        use_hyde=request.use_hyde,
        metadata_filter=request.metadata_filter
    )
    return results

@router.post("/ask")
async def ask(request: SearchRequest, db: AsyncSession = Depends(get_db)):
    """RAG 问答接口。"""
    service = RAGService(db)
    return await service.answer_query(
        request.query, 
        top_k=request.top_k, 
        metadata_filter=request.metadata_filter
    )

@router.get("/documents")
async def list_documents(
    page: int = Query(1, ge=1),
    limit: int = Query(10, ge=1, le=50),
    db: AsyncSession = Depends(get_db)
):
    """罗列知识库中的文档。"""
    service = RAGService(db)
    return await service.list_documents(page, limit)

@router.delete("/documents/{doc_id}")
async def delete_document(doc_id: str, db: AsyncSession = Depends(get_db)):
    """从知识库中删除特定文档及其切片。"""
    service = RAGService(db)
    await service.delete_document(doc_id)
    return {"status": "success", "message": f"Document {doc_id} deleted."}

@router.post("/ingest-file")
async def ingest_file(
    file: UploadFile = File(...),
    project_id: str = Form(""),
    is_temporary: bool = Form(False),
    db: AsyncSession = Depends(get_db)
):
    """多模态文件上传与注入。"""
    try:
        parser = MultiModalParser()
        content = await file.read()
        
        # 逻辑分流解析
        text_content = await parser.parse(content, file.filename)
        
        service = RAGService(db)
        # 业务 doc_id 建议包含时间戳和随机位
        doc_id = f"up-{datetime.now().strftime('%Y%m%d%H%M')}-{os.urandom(3).hex()}"
        
        await service.ingest_document(
            doc_id=doc_id,
            raw_text=text_content,
            metadata={"project_id": project_id, "source_agent": "user"},
            filename=file.filename,
            is_temporary=is_temporary
        )
        return {"status": "success", "message": "File ingested successfully", "doc_id": doc_id}
    except Exception as e:
        log.error(f"Ingest file error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
