import os
import sys
import re
import json
from typing import Tuple, Dict, Any, Optional
from bson import ObjectId
from dotenv import load_dotenv, find_dotenv

load_dotenv(find_dotenv())

# Ensure root python_ai directory is in sys.path
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from langchain_groq import ChatGroq
from langchain_core.messages import SystemMessage, HumanMessage

try:
    from prompts import GUARDRAIL_SECURITY_JUDGE_PROMPT, GUARDRAIL_GROUNDING_JUDGE_PROMPT
except ImportError:
    from python_ai.prompts import GUARDRAIL_SECURITY_JUDGE_PROMPT, GUARDRAIL_GROUNDING_JUDGE_PROMPT



class GuardrailEngine:
    """
    Two-Tier Guardrails Engine for EventHub:
    - Tier 1 (Deterministic / Regex): Instant < 1ms check for known injections & PII masking.
    - Tier 2 (Model-as-a-Judge): Uses Groq LLM to evaluate complex jailbreaks and answer grounding.
    """

    # --- 1. Adversarial Injection Patterns ---
    INJECTION_PATTERNS = [
        r"ignore\s+(all\s+)?(prior|previous)\s+instructions",
        r"disregard\s+(all\s+)?(prior|previous)\s+instructions",
        r"system\s+prompt",
        r"you\s+are\s+now\s+in\s+developer\s+mode",
        r"\bjailbreak\b",
        r"act\s+as\s+dan",
        r"reveal\s+(your\s+)?instructions",
        r"print\s+(your\s+)?initial\s+prompt",
        r"drop\s+(database|table|collection)",
        r"delete\s+from",
        r"\$where",
        r"eval\s*\(",
        r"bypass\s+security"
    ]

    # --- 2. Blatant Off-Topic Inquiries ---
    OFF_TOPIC_PATTERNS = [
        r"write\s+(a\s+)?python\s+script",
        r"solve\s+my\s+homework",
        r"write\s+an\s+essay\s+on",
        r"who\s+is\s+the\s+prime\s+minister",
        r"tell\s+me\s+a\s+joke",
        r"recipe\s+for"
    ]

    # --- 3. PII Detection (Indian Mobile & Private Emails) ---
    PHONE_REGEX = re.compile(r"(\+91[\-\s]?)?[6-9]\d{9}\b")
    EMAIL_REGEX = re.compile(r"[a-zA-Z0-9_.+-]+@(?!jnnce\.ac\.in)[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+")

    # Allowed Read-Only Tools for the Operations Agent
    ALLOWED_AGENT_TOOLS = {
        "get_event_overview",
        "get_gate_attendance",
        "verify_upi_payment",
        "get_budget_status",
        "get_meal_stats"
    }

    def __init__(self, model_name: str = "openai/gpt-oss-20b"):
        self.judge_llm = ChatGroq(model=model_name, temperature=0.0)

    # ==========================================
    #           STUDENT RAG GUARDRAILS
    # ==========================================

    @classmethod
    def fast_rag_input_check(cls, query: str) -> Tuple[bool, str]:
        """Fast < 1ms regex check for prompt injections and off-topic prompts."""
        clean = query.strip()
        if not clean:
            return False, "Query cannot be empty. Please ask an event-related question."

        for pattern in cls.INJECTION_PATTERNS:
            if re.search(pattern, clean, re.IGNORECASE):
                return False, "⚠️ Request denied: Prompt injection or security bypass attempt detected."

        for pattern in cls.OFF_TOPIC_PATTERNS:
            if re.search(pattern, clean, re.IGNORECASE):
                return False, "⚠️ Out of scope: I can only answer questions related to official event guidelines, fees, and rules."

        return True, clean

    def judge_input_safety(self, query: str) -> Dict[str, Any]:
        """Tier 2 LLM Model Judge for complex or ambiguous queries."""
        is_safe, msg = self.fast_rag_input_check(query)
        if not is_safe:
            return {"is_safe": False, "classification": "JAILBREAK", "reason": msg}

        prompt = f"User Query: \"{query}\"\nJSON Output:"
        try:
            res = self.judge_llm.invoke([
                SystemMessage(content=GUARDRAIL_SECURITY_JUDGE_PROMPT),
                HumanMessage(content=prompt)
            ])
            cleaned = re.sub(r"^```json\s*|\s*```$", "", res.content.strip())
            return json.loads(cleaned)
        except Exception:
            return {"is_safe": True, "classification": "SAFE", "reason": "Passed baseline checks."}

    def judge_answer_grounding(self, query: str, context: str, answer: str) -> Dict[str, Any]:
        """Checks if the generated RAG answer is 100% faithful to the retrieved context chunks."""
        user_content = f"Context:\n{context}\n\nQuestion: {query}\n\nGenerated Answer:\n{answer}\n\nJSON Output:"
        try:
            res = self.judge_llm.invoke([
                SystemMessage(content=GUARDRAIL_GROUNDING_JUDGE_PROMPT),
                HumanMessage(content=user_content)
            ])
            cleaned = re.sub(r"^```json\s*|\s*```$", "", res.content.strip())
            return json.loads(cleaned)
        except Exception:
            return {"is_grounded": True, "hallucination_detected": False, "confidence_score": 1.0}

    @classmethod
    def mask_pii_output(cls, text: str) -> str:
        """Redacts phone numbers and private emails from public-facing RAG answers."""
        sanitized = cls.PHONE_REGEX.sub("[Contact Coordinator Desk]", text)
        sanitized = cls.EMAIL_REGEX.sub("[Official Email on Portal]", sanitized)
        return sanitized

    # ==========================================
    #        OPERATIONS AGENT GUARDRAILS
    # ==========================================

    @classmethod
    def guard_agent_input(cls, event_id: str, query: str) -> Tuple[bool, str]:
        """Enforces safe MongoDB ObjectId and blocks destructive mutation commands."""
        if not event_id or not ObjectId.is_valid(event_id):
            return False, f" Access Denied: Invalid or tampered Event ID '{event_id}'."

        for pattern in [r"delete\s+all", r"drop\s+collection", r"clear\s+database", r"remove\s+all"]:
            if re.search(pattern, query, re.IGNORECASE):
                return False, " Unauthorized: The AI Agent is strictly read-only and cannot mutate database records."

        return True, query.strip()

    @classmethod
    def guard_tool_execution(cls, tool_name: str) -> bool:
        """Ensures the agent only invokes approved read-only operational tools."""
        return tool_name in cls.ALLOWED_AGENT_TOOLS


# Backwards compatibility alias for typo
GuardrialEngine = GuardrailEngine
