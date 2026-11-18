import os
from dotenv import load_dotenv, find_dotenv

load_dotenv(find_dotenv())

from langchain_groq import ChatGroq
from langchain_core.messages import HumanMessage
from langgraph.prebuilt import create_react_agent
from langgraph.checkpoint.memory import MemorySaver

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

    def __init__(self, model_name: str = "openai/gpt-oss-20b"):
        self.llm = ChatGroq(model=model_name, temperature=0.0)

        self.tools = [
            get_event_overview,
            get_gate_attendance,
            verify_upi_payment,
            get_budget_status,
            get_meal_stats
        ]

        self.memory = MemorySaver()

        self.system_prompt = (
            "You are the official EventHub Operations Assistant for faculty in-charges and student coordinators.\n"
            "Your job is to assist with live event-day operations, attendance, gate check-in, payments, and budgets.\n\n"
            "Strict Guidelines:\n"
            "1. ALWAYS call the appropriate tool to fetch live data from the database. NEVER guess numbers, team names, or payment statuses.\n"
            "2. When the user asks about an event, always pass the authorized 'event_id' to the tools.\n"
            "3. Format your answers in clean, professional Markdown with bullet points or tables.\n"
            "4. If a query cannot be answered by the available tools, politely state so."
        )

        self.graph = create_react_agent(
            model=self.llm,
            tools=self.tools,
            checkpointer=self.memory,
            prompt=self.system_prompt
        )

    def ask(self, event_id: str, query: str, thread_id: str = "default_session") -> str:
        """
        Executes a query through the LangGraph agent with conversation memory.
        """
        prompt_with_context = f"[Context: Authorized Event ID = {event_id}]\n\nQuestion: {query}"
        config = {"configurable": {"thread_id": thread_id}}

        response = self.graph.invoke(
            {"messages": [HumanMessage(content=prompt_with_context)]},
            config=config
        )

        return response["messages"][-1].content
