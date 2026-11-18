import os
import sys
from dotenv import load_dotenv, find_dotenv

load_dotenv(find_dotenv())

# Ensure root python_ai directory is in sys.path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import MemorySaver

try:
    from guardrials import GuardrailEngine
except ImportError:
    from python_ai.guardrials import GuardrailEngine

try:
    from prompts import OPERATIONS_AGENT_SYSTEM_PROMPT
except ImportError:
    from python_ai.prompts import OPERATIONS_AGENT_SYSTEM_PROMPT

from agent_services.tools import (
    get_budget_status,
    get_event_overview,
    verify_upi_payment,
    get_gate_attendance,
    get_meal_stats
)


class EventOperationsAgent:
    """
    LangGraph-powered Operations Copilot for Faculty and Event Coordinators.
    Uses multi-turn conversation memory and deterministic tool calling.
    """

    def __init__(self, model_name: str = "openai/gpt-oss-20b", max_tokens: int = 150):
        self.llm = ChatGroq(
            model=model_name,
            temperature=0.0,
            max_tokens=max_tokens,
            model_kwargs={"extra_body": {"reasoning_effort": "low"}}
        )

        self.tools = [
            get_event_overview,
            get_gate_attendance,
            verify_upi_payment,
            get_budget_status,
            get_meal_stats
        ]

        self.memory = MemorySaver()
        self.system_prompt = OPERATIONS_AGENT_SYSTEM_PROMPT

        self.graph = create_react_agent(
            model=self.llm,
            tools=self.tools,
            checkpointer=self.memory,
            prompt=self.system_prompt
        )

    def ask(self, event_id: str, query: str, thread_id: str = "default_session") -> str:
        """
        Executes a query through the LangGraph agent with conversation memory and input guardrails.
        """
        # 1. Agent Input Guardrail
        is_safe, message = GuardrailEngine.guard_agent_input(event_id, query)
        if not is_safe:
            return message

        prompt_with_context = f"[Context: Authorized Event ID = {event_id}]\n\nQuestion: {query}"
        config = {"configurable": {"thread_id": thread_id}}

        response = self.graph.invoke(
            {"messages": [HumanMessage(content=prompt_with_context)]},
            config=config
        )

        return response["messages"][-1].content
