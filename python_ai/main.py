import os
import sys
import shutil
import tempfile
from typing import Dict, Any, Optional

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from bson import ObjectId
from dotenv import load_dotenv, find_dotenv

load_dotenv(find_dotenv())

from Rag_services.loader import EventDocumentLoader
from Rag_services.vector_store import QdrantVectorService
from Rag_services.hybrid_retriver import AdvanceEventRAG
from agent_services.ai_services import EventOperationsAgent
from agent_services.db_client import get_db

app = FastAPI(
    title="EventHub AI Microservice",
    description="Decoupled AI service powering Student RAG, Document Vectorization, and Operations Agent",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

qdrant_service = None
operations_agent = None


def get_qdrant():
    global qdrant_service
    if qdrant_service is None:
        qdrant_service = QdrantVectorService()
    return qdrant_service


def get_agent():
    global operations_agent
    if operations_agent is None:
        operations_agent = EventOperationsAgent()
    return operations_agent


class SyncEventRequest(BaseModel):
    event_id: Optional[str] = None
    event: Optional[Dict[str, Any]] = None


class SyncTextRequest(BaseModel):
    event_id: str
    text: str
    title: Optional[str] = ""
    doc_type: Optional[str] = "custom"


class RagChatRequest(BaseModel):
    event_id: str
    query: str


class AgentQueryRequest(BaseModel):
    event_id: str
    query: str
    thread_id: Optional[str] = "default_session"


@app.get("/health")
def health_check():
    return {"status": "ok", "service": "EventHub AI Microservice", "version": "1.0.0"}


@app.post("/api/documents/upload-pdf")
async def upload_pdf_document(
    file: UploadFile = File(...),
    event_id: str = Form(...),
    title: Optional[str] = Form(""),
    college_name: Optional[str] = Form("")
):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF documents are accepted for vector indexing."
        )

    temp_dir = tempfile.mkdtemp()
    temp_path = os.path.join(temp_dir, file.filename)

    try:
        with open(temp_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)

        loader = EventDocumentLoader()
        docs = loader.load_from_pdf(
            file_path=temp_path,
            event_id=event_id,
            title=title or "",
            college_name=college_name or ""
        )

        vector_svc = get_qdrant()
        vector_svc.upsert_documents(docs)

        return {
            "success": True,
            "event_id": event_id,
            "filename": file.filename,
            "chunks_indexed": len(docs),
            "message": f"Successfully vectorized {len(docs)} chunks from '{file.filename}'."
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to process and vectorize PDF: {str(e)}"
        )
    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


@app.post("/api/documents/sync-event")
def sync_event_to_vector_store(payload: SyncEventRequest):
    event_data = payload.event
    event_id = payload.event_id

    if not event_data and event_id:
        db = get_db()
        try:
            event_data = db.events.find_one({"_id": ObjectId(event_id)})
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid event ID")

    if not event_data:
        raise HTTPException(status_code=400, detail="Either 'event' object or valid 'event_id' must be provided")

    try:
        loader = EventDocumentLoader()
        docs = loader.load_from_dict(event_data)

        vector_svc = get_qdrant()
        vector_svc.upsert_documents(docs)

        resolved_id = str(event_data.get("_id") or event_id)
        return {
            "success": True,
            "event_id": resolved_id,
            "chunks_indexed": len(docs),
            "message": f"Successfully indexed event '{event_data.get('title', 'Event')}' into Qdrant."
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to sync event to vector store: {str(e)}"
        )


@app.post("/api/documents/sync-text")
def sync_text_notice(payload: SyncTextRequest):
    try:
        loader = EventDocumentLoader()
        docs = loader.load_from_text(
            text=payload.text,
            event_id=payload.event_id,
            title=payload.title or "",
            doc_type=payload.doc_type or "custom"
        )

        vector_svc = get_qdrant()
        vector_svc.upsert_documents(docs)

        return {
            "success": True,
            "event_id": payload.event_id,
            "chunks_indexed": len(docs),
            "message": "Notice vectorized and stored in Qdrant."
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to index notice text: {str(e)}"
        )


@app.post("/api/rag/chat")
def student_rag_chat(payload: RagChatRequest):
    try:
        rag = AdvanceEventRAG.from_event_id(payload.event_id, qdrant_service=get_qdrant())
        if not rag:
            raise HTTPException(status_code=404, detail=f"Event '{payload.event_id}' not found")

        answer = rag.ask(payload.query)
        return {
            "success": True,
            "event_id": payload.event_id,
            "answer": answer
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"RAG execution error: {str(e)}"
        )


@app.post("/api/agent/query")
def coordinator_agent_query(payload: AgentQueryRequest):
    try:
        agent = get_agent()
        answer = agent.ask(
            event_id=payload.event_id,
            query=payload.query,
            thread_id=payload.thread_id or "default_session"
        )
        return {
            "success": True,
            "event_id": payload.event_id,
            "answer": answer
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Agent execution error: {str(e)}"
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8001, reload=True)
