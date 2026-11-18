import os
import sys
from dotenv import load_dotenv, find_dotenv

# Automatically finds and loads .env from the root project folder
load_dotenv(find_dotenv())

# Ensure root python_ai directory is in sys.path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from langchain_community.retrievers import BM25Retriever
try:
    from langchain.retrievers import EnsembleRetriever, ContextualCompressionRetriever
    from langchain.retrievers.document_compressors import CrossEncoderReranker
except (ImportError, ModuleNotFoundError):
    from langchain_classic.retrievers import EnsembleRetriever, ContextualCompressionRetriever
    from langchain_classic.retrievers.document_compressors import CrossEncoderReranker

from langchain_community.cross_encoders import HuggingFaceCrossEncoder
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_groq import ChatGroq

try:
    from guardrials import GuardrailEngine
except ImportError:
    from python_ai.guardrials import GuardrailEngine

try:
    from prompts import EVENT_RAG_PROMPT_TEMPLATE, EVENT_RAG_EMPTY_CONTEXT_FALLBACK
except ImportError:
    from python_ai.prompts import EVENT_RAG_PROMPT_TEMPLATE, EVENT_RAG_EMPTY_CONTEXT_FALLBACK


class AdvanceEventRAG:
    def __init__(self, documents, qdrant_retriever):
        #  BM25 Sparse Keyword Retriever 
        self.bm25_retriever = BM25Retriever.from_documents(documents)
        self.bm25_retriever.k = 5

        # Qdrant Dense Vector Retriever
        self.qdrant_retriever = qdrant_retriever
        self.qdrant_retriever.search_kwargs = {"k": 5}

        # Hybrid Ensemble (50% BM25 + 50% Vector with RRF)
        self.ensemble_retriever = EnsembleRetriever(
            retrievers=[self.bm25_retriever, self.qdrant_retriever],
            weights=[0.5, 0.5]
        )

        # Cross-Encoder Reranker using your cached BAAI/bge-reranker-base
        reranker_model = HuggingFaceCrossEncoder(model_name="BAAI/bge-reranker-base")
        compressor = CrossEncoderReranker(model=reranker_model, top_n=3)

        # Final Compressed Retriever
        self.final_retriever = ContextualCompressionRetriever(
            base_compressor=compressor,
            base_retriever=self.ensemble_retriever
        )

        #  Groq LLM 
        self.llm = ChatGroq(model="openai/gpt-oss-20b", temperature=0.1)

    def ask(self, query: str, event_title: str) -> str:
        # 1. Input Guardrail: Fast regex & safety check
        is_safe, message = GuardrailEngine.fast_rag_input_check(query)
        if not is_safe:
            return message

        # 2. Retrieve top reranked chunks
        relevant_docs = self.final_retriever.invoke(query)
        if not relevant_docs:
            return EVENT_RAG_EMPTY_CONTEXT_FALLBACK

        context = "\n\n".join([doc.page_content for doc in relevant_docs])

        prompt = ChatPromptTemplate.from_template(EVENT_RAG_PROMPT_TEMPLATE)
        chain = prompt | self.llm | StrOutputParser()
        raw_answer = chain.invoke({"event_title": event_title, "context": context, "query": query})

        # 3. Output Guardrail: PII Masking
        return GuardrailEngine.mask_pii_output(raw_answer)
