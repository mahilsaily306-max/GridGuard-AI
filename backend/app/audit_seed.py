from __future__ import annotations

import json
from typing import Any

from app.database import database


SIMULATED_AUDIT_EVENTS: list[dict[str, Any]] = [
    {"actor": "admin", "action": "auth.login", "module": "Authentication", "entity_type": "user", "entity_id": "admin", "resource": "user:admin", "result": "SUCCESS", "details": {"summary": "Demo administrator signed in."}},
    {"actor": "operator", "action": "dashboard.accessed", "module": "Dashboard", "entity_type": "dashboard", "entity_id": "overview", "resource": "dashboard:overview", "result": "SUCCESS", "details": {"summary": "Control-room overview opened."}},
    {"actor": "operator", "action": "risk_assessment.reviewed", "module": "Risk Assessment", "entity_type": "transformer", "entity_id": "T-101", "resource": "transformer:T-101", "result": "SUCCESS", "details": {"summary": "Synthetic risk evidence reviewed; score is an uncalibrated demonstration output."}},
    {"actor": "operator", "action": "alert.acknowledged", "module": "Alerts", "entity_type": "transformer", "entity_id": "T-101", "resource": "transformer:T-101", "result": "SUCCESS", "details": {"summary": "Demonstration elevated-risk alert acknowledged."}},
    {"actor": "operator", "action": "complaint.received", "module": "Complaints", "entity_type": "replay", "entity_id": "demo_incident", "resource": "replay:demo_incident", "result": "SUCCESS", "details": {"summary": "Simulated villager complaint entered into the replay sequence."}},
    {"actor": "operator", "action": "incident.opened", "module": "Incidents", "entity_type": "replay", "entity_id": "demo_incident", "resource": "replay:demo_incident", "result": "SUCCESS", "details": {"summary": "Related simulated complaints grouped into one replay incident."}},
    {"actor": "operator", "action": "dispatch.assigned", "module": "Dispatch", "entity_type": "replay", "entity_id": "demo_incident", "resource": "replay:demo_incident", "result": "SUCCESS", "details": {"summary": "Demonstration field response assigned."}},
    {"actor": "lineman1", "action": "work_order.accepted", "module": "Work Orders", "entity_type": "replay", "entity_id": "demo_incident", "resource": "replay:demo_incident", "result": "SUCCESS", "details": {"summary": "Simulated assignment accepted."}},
    {"actor": "lineman1", "action": "work_order.arrived", "module": "Work Orders", "entity_type": "replay", "entity_id": "demo_incident", "resource": "replay:demo_incident", "result": "SUCCESS", "details": {"summary": "Arrival and safety acknowledgment recorded for the demonstration."}},
    {"actor": "lineman1", "action": "inspection.completed", "module": "Inspection", "entity_type": "replay", "entity_id": "demo_incident", "resource": "replay:demo_incident", "result": "SUCCESS", "details": {"summary": "Qualified simulated inspection findings recorded."}},
    {"actor": "lineman1", "action": "diagnosis.recorded", "module": "Diagnosis", "entity_type": "replay", "entity_id": "demo_incident", "resource": "replay:demo_incident", "result": "SUCCESS", "details": {"summary": "Loose-connection diagnosis recorded in the simulated replay."}},
    {"actor": "lineman1", "action": "evidence.uploaded", "module": "Evidence", "entity_type": "replay", "entity_id": "demo_incident", "resource": "replay:demo_incident", "result": "SUCCESS", "details": {"summary": "Demonstration after-repair evidence attached."}},
    {"actor": "lineman1", "action": "repair.submitted", "module": "Work Orders", "entity_type": "replay", "entity_id": "demo_incident", "resource": "replay:demo_incident", "result": "SUCCESS", "details": {"summary": "Simulated repair report submitted for independent review."}},
    {"actor": "supervisor", "action": "supervisor.approved", "module": "Approval", "entity_type": "replay", "entity_id": "demo_incident", "resource": "replay:demo_incident", "result": "SUCCESS", "details": {"summary": "Independent demonstration review approved the repair record."}},
    {"actor": "operator", "action": "incident.closed", "module": "Closure", "entity_type": "replay", "entity_id": "demo_incident", "resource": "replay:demo_incident", "result": "SUCCESS", "details": {"summary": "Simulated incident closed after restoration and approval."}},
    {"actor": "supervisor", "action": "report.generated", "module": "Reporting", "entity_type": "replay", "entity_id": "demo_incident", "resource": "replay:demo_incident", "result": "SUCCESS", "details": {"summary": "Demonstration incident report generated."}},
    {"actor": "operator", "action": "simulation.executed", "module": "Simulation", "entity_type": "transformer", "entity_id": "T-101", "resource": "transformer:T-101", "result": "SUCCESS", "details": {"summary": "Non-persistent transformer scenario executed."}},
    {"actor": "supervisor", "action": "knowledge.accessed", "module": "Knowledge Base", "entity_type": "knowledge_entry", "entity_id": "KB-REF-001", "resource": "knowledge_entry:KB-REF-001", "result": "SUCCESS", "details": {"summary": "Reference-guidance entry viewed."}},
]


def seed_simulated_audit_events() -> None:
    with database() as conn:
        users = {
            row["username"]: dict(row)
            for row in conn.execute("SELECT id,username,role FROM users")
        }
        for index, event in enumerate(SIMULATED_AUDIT_EVENTS, start=1):
            actor = users[event["actor"]]
            timestamp = f"2026-10-30T{8 + (index - 1) // 4:02d}:{((index - 1) % 4) * 15:02d}:00Z"
            conn.execute(
                """INSERT OR IGNORE INTO audit_logs(
                event_id,actor_user_id,actor_label,actor_role,action,module,entity_type,entity_id,
                resource,result,origin,details_json,seed_key,created_at
                ) VALUES(?,?,?,?,?,?,?,?,?,?, 'SIMULATED',?,?,?)""",
                (
                    f"EVT-SIM-{index:03d}", actor["id"], actor["username"], actor["role"],
                    event["action"], event["module"], event["entity_type"], event["entity_id"],
                    event["resource"], event["result"], json.dumps(event["details"]),
                    f"audit-demo-v1-{index:03d}", timestamp,
                ),
            )
