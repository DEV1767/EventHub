import os
from dotenv import load_dotenv, find_dotenv

load_dotenv(find_dotenv())

from agent_services.ai_services import EventOperationsAgent
from agent_services.db_client import get_db

db = get_db()


def main():
    print("--- 1. Initializing LangGraph Event Operations Agent ---")
    agent = EventOperationsAgent(model_name="openai/gpt-oss-20b")
    print("Agent graph initialized successfully with memory!")

    # Find the first real event in MongoDB, or fallback to mock ID
    event = db.events.find_one({})
    if event:
        event_id = str(event["_id"])
        event_title = event.get("title", "Event")
        print(f"\nConnected to live event: '{event_title}' (ID: {event_id})")
    else:
        event_id = "67398bbc3e6246a6a3ad64e8"
        print(f"\nNo live events found. Using test ID: {event_id}")

    test_queries = [
        "Give me an overview of registered and confirmed teams for this event.",
        "Who hasn't checked in at the gate yet? Give me team leads and their phone numbers.",
        "How many lunch plates have been claimed at the food counter?",
        "What is the budget status and category breakdown?"
    ]

    session_thread = "test_coordinator_session_01"

    for q in test_queries:
        print(f"\n[Coordinator]: {q}")
        try:
            answer = agent.ask(event_id=event_id, query=q, thread_id=session_thread)
            print(f"[Agent]:\n{answer}")
        except Exception as e:
            print(f"[Error]: {e}")


if __name__ == "__main__":
    main()
