from langchain_core.tools import tool
from bson import ObjectId
from agent_services.db_client import get_redis, get_db, db


@tool
def get_event_overview(event_id: str) -> str:
    """Return total registered teams, capacity, confirmed count, and revenue for an event."""
    try:
        e_id = ObjectId(event_id)
    except Exception:
        return f"Invalid event_id: {event_id}"

    event = db.events.find_one({"_id": e_id})
    if not event:
        return "Event not found."

    total_teams = db.teams.count_documents({"eventId": e_id})
    confirmed_teams = db.teams.count_documents({"eventId": e_id, "registrationStatus": "confirmed"})
    checked_in = db.teams.count_documents({"eventId": e_id, "checkedIn": True})

    return (
        f"Event: {event.get('title', 'N/A')}\n"
        f"Capacity: {event.get('maxParticipants', 'Unlimited')}\n"
        f"Total Registered: {total_teams}\n"
        f"Confirmed Teams: {confirmed_teams}\n"
        f"Checked-in at Gate: {checked_in}\n"
        f"Fee: Rs. {event.get('registrationFee', 0)}"
    )

@tool
def get_gate_attendance(event_id: str, department: str = "") -> str:
    """Returns live check-in attendance and lists absent teams with leader phone numbers."""
    try:
        e_id = ObjectId(event_id)
    except Exception:
        return f"Invalid event ID: {event_id}"

    query = {"eventId": e_id, "registrationStatus": "confirmed", "checkedIn": False}
    absent_teams = list(db.teams.find(query).limit(10))

    if not absent_teams:
        return "All confirmed teams have checked in at the gate!"

    lines = [f"Absent Teams ({len(absent_teams)} shown):"]
    for t in absent_teams:
        leader_id = t.get("leaderId")
        leader = db.users.find_one({"_id": leader_id}) if leader_id else {}
        lines.append(f"- {t.get('teamName')} (Leader: {leader.get('name', leader.get('firstname', 'N/A'))}, Phone: {leader.get('phonenumber', 'N/A')})")

    return "\n".join(lines)

@tool
def get_meal_stats(event_id: str, slot_id: str) -> str:
    """Queries Redis to get live counts of claimed meal plates for a slot (e.g. lunch, breakfast)."""
    r = get_redis()
    if not r:
        return "Redis is not connected."
    redis_key = f"event:{event_id}:meal:{slot_id}:claimed"
    try:
        count = r.scard(redis_key)
        return f"Meal Slot '{slot_id}': {count} participants have collected their food plate so far."
    except Exception as e:
        return f"Could not retrieve meal stats: {e}"

@tool
def verify_upi_payment(event_id: str, utr_number: str) -> str:
    """Checks if a 12-digit UPI UTR number is registered or duplicate."""
    try:
        e_id = ObjectId(event_id)
    except Exception:
        return f"Invalid event Id: {event_id}"

    team = db.teams.find_one({"eventId": e_id, "transactionId": utr_number.strip()})
    if not team:
        return f"UTR {utr_number} is NOT found in registrations."

    return (
        f"UTR {utr_number} belongs to Team '{team.get('teamName')}'.\n"
        f"Payment Status: {team.get('paymentStatus')}\n"
        f"Registration Status: {team.get('registrationStatus')}"
    )

@tool
def get_budget_status(event_id: str) -> str:
    """Returns allocated fest budget vs total spent, and category breakdown."""
    try:
        e_id = ObjectId(event_id)
    except Exception:
        return f"Invalid event Id: {event_id}"

    event = db.events.find_one({"_id": e_id})
    if not event or "budget" not in event:
        return "No budget details recorded for this event."

    b = event.get("budget", {})
    cats = b.get("categories", [])
    cat_summary = [f"- {c.get('name')}: Rs. {c.get('spentAmount', 0)} / {c.get('allocatedAmount', 0)}" for c in cats]
    return (
        f"Total Allocated: Rs. {b.get('totalAllocated', 0)}\n"
        f"Total Spent: Rs. {b.get('totalSpent', 0)}\n"
        f"Categories:\n" + "\n".join(cat_summary)
    )
