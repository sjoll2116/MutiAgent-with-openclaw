import os
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from typing import List, Dict, Any, Optional
from ..db import get_db
from ..services.rag_service import RAGService
from ..services.multimodal_parser import MultiModalParser
from ..auth import get_current_user

router = APIRouter(prefix="/rag", tags=["RAG"], dependencies=[Depends(get_current_user)])


class SearchRequest(BaseModel):
    query: str
    top_k: int = 5
    use_hyde: bool = True
    metadata_filter: Optional[Dict[str, Any]] = None

class IngestRequest(BaseModel):
    doc_id: str
    content: str
    filename: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None

@router.post("/search")
async def search_knowledge(request: SearchRequest, db: AsyncSession = Depends(get_db)):
    service = RAGService(db)
    try:
        results = await service.hybrid_search(
            query=request.query, 
            top_k=request.top_k, 
            use_hyde=request.use_hyde,
            metadata_filter=request.metadata_filter
        )
        return {"status": "success", "data": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/ask")
async def ask_knowledge(request: SearchRequest, db: AsyncSession = Depends(get_db)):
    """基于知识库回答问题。"""
    service = RAGService(db)
    try:
        result = await service.answer_query(
            query=request.query,
            top_k=request.top_k,
            metadata_filter=request.metadata_filter
        )
        return {"status": "success", "data": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/ingest")
async def ingest_knowledge(request: IngestRequest, db: AsyncSession = Depends(get_db)):
    service = RAGService(db)
    try:
        await service.ingest_document(
            doc_id=request.doc_id,
            raw_text=request.content,
            metadata=request.metadata,
            filename=request.filename
        )
        return {"status": "success", "message": "Document ingested successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/ingest-file")
async def ingest_file(
    file: UploadFile = File(...),
    project_id: str = Form(""),
    db: AsyncSession = Depends(get_db)
):
    """多模态文件上传与注入。"""
    try:
        parser = MultiModalParser()
        content = await file.read()
        
        # 逻辑分流解析
        text_content = await parser.parse(content, file.filename)
        
        service = RAGService(db)
        doc_id = f"upload-{file.filename}-{os.urandom(4).hex()}"
        await service.ingest_document(
            doc_id=doc_id,
            raw_text=text_content,
            metadata={"project_id": project_id, "source_agent": "user"},
            filename=file.filename
        )
        return {"status": "success", "message": "File ingested successfully", "doc_id": doc_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
