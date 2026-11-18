import os
from typing import List
from dotenv import load_dotenv
from langchain_core.documents import Document
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_qdrant import QdrantVectorStore
from qdrant_client import QdrantClient, models
from qdrant_client.http.models import Distance, VectorParams

load_dotenv()


class QdrantVectorService:
    def __init__(self, collection_name: str = "eventhub_knowledge"):
        self.collection_name = collection_name
        self.qdrant_url = os.getenv("QDRANT_URL")
        self.qdrant_api_key = os.getenv("QDRANT_API_KEY")

        if not self.qdrant_url or not self.qdrant_api_key:
            raise ValueError("QDRANT_URL and QDRANT_API_KEY must be set in your .env")

        self.client = QdrantClient(
            url=self.qdrant_url,
            api_key=self.qdrant_api_key
        )

        self.embeddings = HuggingFaceEmbeddings(
            model_name="BAAI/bge-small-en-v1.5",
            model_kwargs={"device": "cpu"},
            encode_kwargs={"normalize_embeddings": True}
        )

        self.vector_dim = 384
        self._ensure_collection_exists()

        self.vector_store = QdrantVectorStore(
            client=self.client,
            collection_name=self.collection_name,
            embedding=self.embeddings
        )

    def _ensure_collection_exists(self):
        collections = [c.name for c in self.client.get_collections().collections]
        if self.collection_name not in collections:
            self.client.create_collection(
                collection_name=self.collection_name,
                vectors_config=VectorParams(size=self.vector_dim, distance=Distance.COSINE)
            )

    def upsert_documents(self, documents: List[Document]) -> List[str]:
        if not documents:
            return []
        return self.vector_store.add_documents(documents)

    def search_event_chunks(self, query: str, event_id: str, top_k: int = 4) -> List[Document]:
        event_filter = models.Filter(
            must=[
                models.FieldCondition(
                    key="metadata.event_id",
                    match=models.MatchValue(value=str(event_id))
                )
            ]
        )

        return self.vector_store.similarity_search(
            query=query,
            k=top_k,
            filter=event_filter
        )
