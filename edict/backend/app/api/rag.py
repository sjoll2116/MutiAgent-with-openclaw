from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from ..db import get_db
from ..services.rag_service import RAGService

router = APIRouter(prefix="/rag", tags=["RAG"])

class SearchRequest(BaseModel):
    query: str
    top_k: int = 5
    use_hyde: bool = True

class IngestRequest(BaseModel):
    doc_id: str
    content: str
    metadata: dict = {}

@router.post("/search")
async def search_knowledge(request: SearchRequest, db: AsyncSession = Depends(get_db)):
    service = RAGService(db)
    try:
        results = await service.hybrid_search(
            query=request.query, 
            top_k=request.top_k, 
            use_hyde=request.use_hyde
        )
        return {"status": "success", "data": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/ingest")
async def ingest_knowledge(request: IngestRequest, db: AsyncSession = Depends(get_db)):
    service = RAGService(db)
    try:
        await service.ingest_document(
            doc_id=request.doc_id,
            raw_text=request.content,
            metadata=request.metadata
        )
        return {"status": "success", "message": "Document ingested successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
