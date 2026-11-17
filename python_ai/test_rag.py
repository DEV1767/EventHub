import os
from dotenv import load_dotenv, find_dotenv

# Load root .env
load_dotenv(find_dotenv())

from Rag_services.loader import EventDocumentLoader
from Rag_services.vector_store import QdrantVectorService
from Rag_services.hybrid_retriver import AdvanceEventRAG
from qdrant_client import models

sample_event = {
    "_id": "event_hackathon_101",
    "title": "HackJNNCE 2026",
    "category": "Hackathon",
    "department": "AIML",
    "description": "24-hour national hackathon focused on Agentic AI and Smart Campus solutions.",
    "venue": "Campus Tech Park, Lab 4, JNNCE Shivamogga",
    "startDate": "2026-12-10",
    "endDate": "2026-12-11",
    "registrationFee": 350,
    "teamSize": {"min": 2, "max": 4},
    "eligibility": "Open to all undergraduate engineering students across India.",
    "rules": [
        "Rule 1: All code must be authored inside the 24-hour hackathon window.",
        "Rule 2: Teams must consist of 2 to 4 members from recognized colleges.",
        "Rule 3: Use of pre-built backends or plagiarism leads to immediate disqualification."
    ],
    "certificate": {"isProvided": True, "type": "Merit and Participation"},
    "contactEmail": "hackathon@jnnce.ac.in",
    "contactPhone": "+91 9845012345"
}

def main():
    print("--- 1. Chunking Event with Loader ---")
    loader = EventDocumentLoader()
    docs = loader.load_from_dict(sample_event)
    print(f"Generated {len(docs)} chunks with event_id metadata.")

    print("\n--- 2. Upserting Chunks to Qdrant Cloud ---")
    qdrant = QdrantVectorService()
    qdrant.upsert_documents(docs)
    print("Chunks successfully stored in Qdrant!")

    print("\n--- 3. Initializing Hybrid RAG (BM25 + Qdrant + Reranker) ---")
    scoped_qdrant_retriever = qdrant.vector_store.as_retriever(
        search_kwargs={
            "k": 5,
            "filter": models.Filter(
                must=[
                    models.FieldCondition(
                        key="metadata.event_id",
                        match=models.MatchValue(value="event_hackathon_101")
                    )
                ]
            )
        }
    )

    rag = AdvanceEventRAG(documents=docs, qdrant_retriever=scoped_qdrant_retriever)

    queries = [
        "What is the registration fee and how many members can join a team?",
        "What is Rule 3 about?",
        "Can a student from arts or medical college participate?"
    ]

    for q in queries:
        print(f"\nQ: {q}")
        answer = rag.ask(query=q, event_title=sample_event["title"])
        print(f"A: {answer}")

if __name__ == "__main__":
    main()
