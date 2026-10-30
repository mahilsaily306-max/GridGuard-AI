from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from app.auth import audit
from app.database import database, utc_now
from app.services import create_outage_report, features_for_transformer, predict_transformer, update_incident


WORKFLOW_TRANSITIONS = {
    "assigned": {"accepted"},
    "accepted": {"en_route"},
    "en_route": {"arrived"},
    "arrived": {"investigating"},
    "investigating": {"repairing"},
    "repairing": {"awaiting_verification"},
    "awaiting_verification": {"rework_required", "resolved"},
    "rework_required": {"repairing"},
    "resolved": {"closed"},
    "closed": set(),
}


PRESENTATION_ROWS = [
    ("06:00", 0, 230, 35, 42, "Normal", "Low"),
    ("07:00", 0, 228, 45, 45, "Normal", "Low"),
    ("08:00", 0, 225, 75, 52, "Normal", "Low"),
    ("09:00", 0, 220, 110, 61, "Moderate Load", "Low"),
    ("10:00", 0, 215, 135, 72, "Heavy Load", "Medium"),
    ("11:00", 0, 205, 155, 85, "Overload", "High"),
    ("12:00", 0, 195, 170, 96, "Severe Overheating", "Critical"),
    ("13:00", 0, 210, 130, 88, "Cooling Down", "High"),
    ("14:00", 0, 222, 90, 74, "Moderate Load", "Medium"),
    ("15:00", 0, 226, 60, 62, "Normal", "Low"),
    ("16:00", 0, 228, 50, 55, "Normal", "Low"),
    ("17:00", 0, 225, 65, 58, "Normal", "Low"),
    ("18:00", 0, 218, 125, 75, "Heavy Load", "Medium"),
    ("19:00", 0, 212, 145, 84, "Overload", "High"),
    ("20:00", 0, 202, 160, 92, "High Overload", "Critical"),
    ("21:00", 0, 215, 120, 83, "Moderate Load", "Medium"),
    ("22:00", 0, 224, 70, 68, "Normal", "Low"),
    ("23:00", 0, 229, 45, 55, "Normal", "Low"),
    ("00:00", 1, 232, 30, 46, "Normal", "Low"),
]


REPLAY_EVENTS = [
    (1, "09:00", "normal", "Normal operation", "All synthetic parameters are within the demo operating range."),
    (2, "10:00", "stress", "Rising stress", "Load and oil temperature begin rising."),
    (3, "10:30", "warning", "Early warning", "Prototype threshold rule creates an elevated-load alert."),
    (4, "11:00", "recommendation", "Preventive recommendation", "Inspection is recommended for operator review."),
    (5, "12:00", "outage", "Simulated outage", "Supply loss is introduced only in the presentation replay."),
    (6, "12:03", "complaint", "Villager complaints", "Related simulated reports arrive from the service area."),
    (7, "12:04", "grouping", "Complaint grouping", "Reports are linked to one suspected incident."),
    (8, "12:05", "dispatch", "Lineman dispatched", "A field work order is assigned."),
    (9, "12:25", "diagnosis", "Guided diagnosis", "Field checks confirm a loose connection."),
    (10, "12:45", "repair", "Repair recorded", "Evidence and repair notes are submitted."),
    (11, "12:55", "verification", "Supervisor verification", "A separate supervisor approves the repair."),
    (12, "13:00", "restoration", "Restoration", "The simulated incident is closed after verification."),
]


def seed_operations() -> None:
    from app.auth import seed_demo_users

    seed_demo_users()
    with database() as conn:
        supervisor_id = conn.execute("SELECT id FROM users WHERE username='supervisor'").fetchone()[0]
        linemen = [row[0] for row in conn.execute("SELECT id FROM users WHERE role='lineman' ORDER BY id")]
        for number in range(1, 7):
            feeder_id = f"F-{number:02d}"
            conn.execute(
                "INSERT OR IGNORE INTO service_zones(code,name,feeder_id) VALUES(?,?,?)",
                (f"ZONE-{number:02d}", f"Feeder {number:02d} Service Zone", feeder_id),
            )
        zones = [row[0] for row in conn.execute("SELECT id FROM service_zones ORDER BY id")]
        for index, lineman_id in enumerate(linemen):
            conn.execute(
                """INSERT OR IGNORE INTO lineman_profiles
                (user_id,employee_code,service_zone_id,supervisor_user_id,available,skills_json)
                VALUES(?,?,?,?,1,?)""",
                (lineman_id, f"LM-{index + 1:03d}", zones[index % len(zones)], supervisor_id, json.dumps(["transformer inspection", "outage response"])),
            )
        # Additional zone coverage is represented by deterministic assignments in dispatch selection.
        for sequence, row in enumerate(PRESENTATION_ROWS, start=1):
            conn.execute(
                """INSERT OR IGNORE INTO presentation_telemetry
                (scenario_key,sequence,display_time,day_offset,voltage_v,current_a,oil_temperature_c,status,risk_level)
                VALUES('overload_day',?,?,?,?,?,?,?,?)""",
                (sequence, *row),
            )
        for sequence, event_time, event_type, title, description in REPLAY_EVENTS:
            conn.execute(
                """INSERT OR IGNORE INTO replay_events
                (scenario_key,sequence,event_time,event_type,title,description,payload_json)
                VALUES('demo_incident',?,?,?,?,?,?)""",
                (sequence, event_time, event_type, title, description, json.dumps({"simulated": True})),
            )


def _public_user(row: Any) -> dict | None:
    if row is None:
        return None
    return {key: row[key] for key in ("id", "username", "display_name", "role", "language") if key in row.keys()}


def create_complaint(payload: dict, actor: dict | None = None) -> dict:
    report_payload = {
        "village_name": payload["village_name"],
        "transformer_id": payload.get("transformer_id"),
        "channel": "sms",
        "message": payload.get("details") or payload["category"].replace("_", " "),
        "received_at": datetime.now(timezone.utc),
        "caller_id": payload.get("caller_id"),
    }
    report, deduplicated = create_outage_report(report_payload)
    incident_id = report["incident_id"]
    reference = f"GG-{uuid.uuid4().hex[:8].upper()}"
    now = utc_now()
    caller_hash = hashlib.sha256(payload["caller_id"].encode()).hexdigest() if payload.get("caller_id") else None
    with database() as conn:
        cursor = conn.execute(
            """INSERT INTO complaints(reference,outage_report_id,incident_id,village_name,transformer_id,category,
            severity,landmark,duration_minutes,affected_area,hazard_flags_json,language,details,status,caller_hash,created_at,updated_at)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'received',?,?,?)""",
            (
                reference, report["id"], incident_id, payload["village_name"], payload.get("transformer_id"),
                payload["category"], payload["severity"], payload.get("landmark"), payload.get("duration_minutes"),
                payload.get("affected_area"), json.dumps(payload.get("hazard_flags", [])), payload.get("language", "en"),
                payload.get("details"), caller_hash, now, now,
            ),
        )
        complaint_id = cursor.lastrowid
    audit("complaint.created", "complaint", complaint_id, actor, after=json.dumps({"reference": reference, "incident_id": incident_id}))
    result = complaint_by_reference(reference)
    result["deduplicated_report"] = deduplicated
    return result


def complaint_by_reference(reference: str) -> dict:
    with database() as conn:
        row = conn.execute("SELECT * FROM complaints WHERE reference=?", (reference,)).fetchone()
        if row is None:
            raise KeyError(reference)
        item = dict(row)
        item["hazard_flags"] = json.loads(item.pop("hazard_flags_json"))
        item["caller_protected"] = bool(item.pop("caller_hash", None))
        incident = conn.execute("SELECT * FROM incidents WHERE id=?", (item["incident_id"],)).fetchone()
        work_order = conn.execute("SELECT * FROM field_work_orders WHERE incident_id=?", (item["incident_id"],)).fetchone()
        item["incident_status"] = incident["status"] if incident else None
        item["work_order_status"] = work_order["status"] if work_order else None
        item["tracking_steps"] = tracking_steps(item["status"], item["incident_status"], item["work_order_status"])
        return item


def tracking_steps(complaint_status: str, incident_status: str | None, work_status: str | None) -> list[dict]:
    steps = [
        ("received", "Complaint received"), ("linked", "Incident linked"), ("assigned", "Lineman assigned"),
        ("investigating", "Investigation underway"), ("repairing", "Repair underway"),
        ("restored", "Restoration reported"), ("closed", "Verified resolution"),
    ]
    progress = 0
    if complaint_status:
        progress = 1
    if incident_status:
        progress = 2
    if work_status:
        progress = 3
        if work_status in {"investigating", "repairing", "awaiting_verification", "resolved", "closed"}:
            progress = 4
        if work_status in {"repairing", "awaiting_verification", "resolved", "closed"}:
            progress = 5
        if incident_status == "restored":
            progress = 6
        if work_status == "closed":
            progress = 7
    return [{"key": key, "label": label, "complete": index < progress} for index, (key, label) in enumerate(steps)]


def dispatch_incident(incident_id: int, priority: str, actor: dict, lineman_user_id: int | None = None) -> dict:
    with database() as conn:
        incident = conn.execute("SELECT * FROM incidents WHERE id=?", (incident_id,)).fetchone()
        if incident is None:
            raise KeyError(incident_id)
        existing = conn.execute("SELECT id FROM field_work_orders WHERE incident_id=?", (incident_id,)).fetchone()
        if existing:
            return get_work_order(existing["id"], actor)
        zone = conn.execute("SELECT * FROM service_zones WHERE feeder_id=?", (incident["feeder_id"],)).fetchone()
        if zone is None:
            raise RuntimeError("No service zone for incident feeder")
        if lineman_user_id:
            lineman = conn.execute(
                """SELECT u.*,lp.supervisor_user_id FROM users u JOIN lineman_profiles lp ON lp.user_id=u.id
                WHERE u.id=? AND u.role='lineman' AND u.active=1""",
                (lineman_user_id,),
            ).fetchone()
        else:
            lineman = conn.execute(
                """SELECT u.*,lp.supervisor_user_id FROM users u JOIN lineman_profiles lp ON lp.user_id=u.id
                WHERE u.role='lineman' AND u.active=1 AND lp.available=1
                ORDER BY CASE WHEN lp.service_zone_id=? THEN 0 ELSE 1 END,u.id LIMIT 1""",
                (zone["id"],),
            ).fetchone()
        if lineman is None:
            raise RuntimeError("No available lineman")
        reference = f"WO-{uuid.uuid4().hex[:7].upper()}"
        now = utc_now()
        cursor = conn.execute(
            """INSERT INTO field_work_orders(reference,incident_id,transformer_id,service_zone_id,assigned_lineman_id,
            supervisor_user_id,priority,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'assigned',?,?)""",
            (reference, incident_id, incident["suspected_transformer_id"], zone["id"], lineman["id"], lineman["supervisor_user_id"], priority, now, now),
        )
        work_order_id = cursor.lastrowid
        conn.execute(
            "INSERT INTO work_order_transitions(work_order_id,from_status,to_status,actor_user_id,notes,changed_at) VALUES(?,NULL,'assigned',?,?,?)",
            (work_order_id, actor["id"], "Automatic area-based dispatch", now),
        )
        conn.execute(
            """INSERT INTO notifications(user_id,category,title,message,entity_type,entity_id,created_at)
            VALUES(?, 'work_order', ?, ?, 'work_order', ?, ?)""",
            (lineman["id"], f"New assignment {reference}", f"Incident on {incident['feeder_id']} requires response", str(work_order_id), now),
        )
        conn.execute("UPDATE complaints SET status='dispatched',updated_at=? WHERE incident_id=?", (now, incident_id))
    if incident["status"] == "reported":
        update_incident(incident_id, "assigned", "Illustrative ETA pending field assessment", assigned_crew=lineman["display_name"])
    generate_diagnostics(work_order_id)
    audit("work_order.dispatched", "work_order", work_order_id, actor, after=json.dumps({"lineman_user_id": lineman["id"]}))
    return get_work_order(work_order_id, actor)


def generate_diagnostics(work_order_id: int) -> None:
    with database() as conn:
        work = conn.execute("SELECT * FROM field_work_orders WHERE id=?", (work_order_id,)).fetchone()
        if work is None or conn.execute("SELECT 1 FROM diagnostic_recommendations WHERE work_order_id=?", (work_order_id,)).fetchone():
            return
        incident = conn.execute("SELECT * FROM incidents WHERE id=?", (work["incident_id"],)).fetchone()
        complaints = [dict(row) for row in conn.execute("SELECT * FROM complaints WHERE incident_id=?", (work["incident_id"],))]
    transformer_id = work["transformer_id"]
    features = features_for_transformer(transformer_id) if transformer_id else None
    prediction = predict_transformer(transformer_id, persist=False) if transformer_id else None
    categories = [
        ["Overload / protection trip", 30.0, []],
        ["Loose or damaged connection", 24.0, []],
        ["Fuse or protective-device issue", 18.0, []],
        ["Insulation / thermal issue", 14.0, []],
        ["Upstream feeder fault", 10.0, []],
    ]
    if features:
        if features["load_pct"] > 90:
            categories[0][1] += 18
            categories[0][2].append(f"Load utilization {features['load_pct']:.1f}%")
        if features["oil_temp_c"] > 80:
            categories[3][1] += 18
            categories[3][2].append(f"Oil temperature {features['oil_temp_c']:.1f} °C")
        if features["faults_last_90d"] > 0:
            categories[2][1] += 7
            categories[2][2].append("Recent simulated fault history")
    complaint_categories = {item["category"] for item in complaints}
    if "flickering" in complaint_categories or "sparking_fire" in complaint_categories:
        categories[1][1] += 16
        categories[1][2].append("Complaint symptoms indicate intermittent or sparking supply")
    if incident["scope"] == "feeder":
        categories[4][1] += 25
        categories[4][2].append("Reports span multiple downstream transformers")
    if prediction:
        categories[0][2].append(f"Uncalibrated 24-hour model score {prediction['risk_score']:.2f}")
    ranked = sorted(categories, key=lambda item: item[1], reverse=True)
    with database() as conn:
        for rank, (category, score, evidence) in enumerate(ranked, start=1):
            conn.execute(
                """INSERT INTO diagnostic_recommendations
                (work_order_id,rank,fault_category,score,supporting_evidence_json,explanation,inspection_status)
                VALUES(?,?,?,?,?,?,'pending')""",
                (
                    work_order_id, rank, category, round(score, 2), json.dumps(evidence),
                    "Evidence-based ranking score for guided inspection; not a calibrated fault probability.",
                ),
            )


def get_work_order(work_order_id: int, actor: dict | None = None) -> dict:
    with database() as conn:
        row = conn.execute(
            """SELECT w.*,u.display_name lineman_name,s.display_name supervisor_name,z.name service_zone_name
            FROM field_work_orders w
            LEFT JOIN users u ON u.id=w.assigned_lineman_id LEFT JOIN users s ON s.id=w.supervisor_user_id
            JOIN service_zones z ON z.id=w.service_zone_id WHERE w.id=?""",
            (work_order_id,),
        ).fetchone()
        if row is None:
            raise KeyError(work_order_id)
        if actor and actor["role"] == "lineman" and row["assigned_lineman_id"] != actor["id"]:
            raise PermissionError("Lineman may access only assigned work orders")
        result = dict(row)
        result["hazards"] = json.loads(result.pop("hazards_json"))
        result["complaints"] = [dict(item) for item in conn.execute("SELECT id,reference,category,severity,village_name,details,status,created_at FROM complaints WHERE incident_id=?", (row["incident_id"],))]
        result["diagnostics"] = []
        for item in conn.execute("SELECT * FROM diagnostic_recommendations WHERE work_order_id=? ORDER BY rank", (work_order_id,)):
            diagnostic = dict(item)
            diagnostic["supporting_evidence"] = json.loads(diagnostic.pop("supporting_evidence_json"))
            result["diagnostics"].append(diagnostic)
        result["transitions"] = [dict(item) for item in conn.execute("SELECT * FROM work_order_transitions WHERE work_order_id=? ORDER BY id", (work_order_id,))]
        repair = conn.execute("SELECT * FROM repair_reports WHERE work_order_id=?", (work_order_id,)).fetchone()
        result["repair_report"] = dict(repair) if repair else None
        result["evidence"] = [dict(item) for item in conn.execute("SELECT * FROM evidence_files WHERE work_order_id=? ORDER BY uploaded_at", (work_order_id,))]
        result["supervisor_decisions"] = [dict(item) for item in conn.execute("SELECT * FROM supervisor_decisions WHERE work_order_id=? ORDER BY decided_at", (work_order_id,))]
        return result


def list_work_orders(actor: dict, status: str | None = None) -> list[dict]:
    with database() as conn:
        clauses = []
        params: list[Any] = []
        if actor["role"] == "lineman":
            clauses.append("assigned_lineman_id=?")
            params.append(actor["id"])
        elif actor["role"] == "supervisor":
            clauses.append("supervisor_user_id=?")
            params.append(actor["id"])
        if status:
            clauses.append("status=?")
            params.append(status)
        query = "SELECT id FROM field_work_orders"
        if clauses:
            query += " WHERE " + " AND ".join(clauses)
        query += " ORDER BY updated_at DESC"
        ids = [row[0] for row in conn.execute(query, params)]
    return [get_work_order(work_order_id, actor) for work_order_id in ids]


def transition_work_order(work_order_id: int, payload: dict, actor: dict) -> dict:
    before = get_work_order(work_order_id, actor)
    current = before["status"]
    target = payload["status"]
    if target not in WORKFLOW_TRANSITIONS[current]:
        raise ValueError(f"Invalid transition from {current} to {target}")
    if actor["role"] == "lineman" and before["assigned_lineman_id"] != actor["id"]:
        raise PermissionError("Work order is not assigned to this lineman")
    if target in {"investigating", "repairing", "awaiting_verification"} and not (
        before["safety_acknowledged_at"] or payload.get("safety_acknowledged")
    ):
        raise ValueError("Safety acknowledgment is required before diagnosis or repair")
    if before["stop_work"] and target not in {"rework_required"}:
        raise ValueError("Stop-work escalation is active")
    if target in {"resolved", "closed"} and actor["role"] not in {"supervisor", "administrator", "operator"}:
        raise PermissionError("Only supervisors/operators may resolve or close work orders")
    now = utc_now()
    hazards = payload.get("hazards") if payload.get("hazards") is not None else before["hazards"]
    safety_at = now if payload.get("safety_acknowledged") else before["safety_acknowledged_at"]
    with database() as conn:
        conn.execute(
            """UPDATE field_work_orders SET status=?,hazards_json=?,safety_acknowledged_at=?,stop_work=?,updated_at=?,
            completed_at=CASE WHEN ?='closed' THEN ? ELSE completed_at END WHERE id=?""",
            (target, json.dumps(hazards), safety_at, int(payload.get("stop_work", False)), now, target, now, work_order_id),
        )
        conn.execute(
            """INSERT INTO work_order_transitions(work_order_id,from_status,to_status,actor_user_id,notes,changed_at)
            VALUES(?,?,?,?,?,?)""",
            (work_order_id, current, target, actor["id"], payload.get("notes"), now),
        )
    if target == "repairing":
        incident = before["incident_id"]
        with database() as conn:
            current_incident = conn.execute("SELECT status FROM incidents WHERE id=?", (incident,)).fetchone()[0]
        if current_incident == "assigned":
            update_incident(incident, "repairing", "Illustrative field repair underway")
    audit("work_order.transition", "work_order", work_order_id, actor, before=json.dumps({"status": current}), after=json.dumps({"status": target}))
    return get_work_order(work_order_id, actor)


def submit_inspection(work_order_id: int, payload: dict, actor: dict) -> dict:
    work = get_work_order(work_order_id, actor)
    if work["status"] not in {"investigating", "repairing"}:
        raise ValueError("Inspection findings require investigating or repairing status")
    category = payload.get("fault_category") or "Other / Unknown Fault"
    now = utc_now()
    with database() as conn:
        cursor = conn.execute(
            """INSERT INTO inspection_findings(work_order_id,recommendation_id,status,fault_category,observations,
            suspected_root_cause,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)""",
            (work_order_id, payload.get("recommendation_id"), payload["status"], category, payload["observations"], payload.get("suspected_root_cause"), actor["id"], now),
        )
        if payload.get("recommendation_id"):
            conn.execute("UPDATE diagnostic_recommendations SET inspection_status=? WHERE id=? AND work_order_id=?", (payload["status"], payload["recommendation_id"], work_order_id))
        finding = dict(conn.execute("SELECT * FROM inspection_findings WHERE id=?", (cursor.lastrowid,)).fetchone())
    audit("inspection.created", "work_order", work_order_id, actor, after=json.dumps({"finding_id": finding["id"], "status": payload["status"]}))
    return finding


def submit_repair(work_order_id: int, payload: dict, actor: dict) -> dict:
    work = get_work_order(work_order_id, actor)
    if work["status"] != "repairing":
        raise ValueError("Repair report requires repairing status")
    now = utc_now()
    with database() as conn:
        conn.execute(
            """INSERT INTO repair_reports(work_order_id,fault_cause,repair_notes,materials_used,restoration_observations,
            remaining_issues,submitted_by,submitted_at) VALUES(?,?,?,?,?,?,?,?)
            ON CONFLICT(work_order_id) DO UPDATE SET fault_cause=excluded.fault_cause,repair_notes=excluded.repair_notes,
            materials_used=excluded.materials_used,restoration_observations=excluded.restoration_observations,
            remaining_issues=excluded.remaining_issues,submitted_by=excluded.submitted_by,submitted_at=excluded.submitted_at""",
            (work_order_id, payload["fault_cause"], payload["repair_notes"], payload.get("materials_used"), payload.get("restoration_observations"), payload.get("remaining_issues"), actor["id"], now),
        )
        report = dict(conn.execute("SELECT * FROM repair_reports WHERE work_order_id=?", (work_order_id,)).fetchone())
    audit("repair.submitted", "work_order", work_order_id, actor, after=json.dumps({"repair_report_id": report["id"]}))
    return report


def supervisor_decision(work_order_id: int, payload: dict, actor: dict) -> dict:
    work = get_work_order(work_order_id, actor)
    if actor["id"] == work["assigned_lineman_id"]:
        raise PermissionError("Linemen cannot approve their own repairs")
    if work["status"] != "awaiting_verification":
        raise ValueError("Supervisor decision requires awaiting_verification status")
    now = utc_now()
    with database() as conn:
        cursor = conn.execute(
            "INSERT INTO supervisor_decisions(work_order_id,decision,notes,supervisor_user_id,decided_at) VALUES(?,?,?,?,?)",
            (work_order_id, payload["decision"], payload.get("notes"), actor["id"], now),
        )
        decision_id = cursor.lastrowid
    if payload["decision"] == "approved":
        transition_work_order(work_order_id, {"status": "resolved", "notes": payload.get("notes")}, actor)
        with database() as conn:
            incident = conn.execute("SELECT status FROM incidents WHERE id=?", (work["incident_id"],)).fetchone()[0]
        if incident == "repairing":
            update_incident(work["incident_id"], "restored", "Simulated restoration verified by supervisor", restoration_notes=payload.get("notes"))
        repair = get_work_order(work_order_id, actor)["repair_report"]
        if repair and work["transformer_id"]:
            with database() as conn:
                conn.execute(
                    """INSERT OR IGNORE INTO verified_faults(transformer_id,work_order_id,fault_category,symptoms,
                    verified_root_cause,inspection_findings,repair_action,supervisor_decision_id,verified_at)
                    VALUES(?,?,?,?,?,?,?,?,?)""",
                    (work["transformer_id"], work_order_id, repair["fault_cause"], None, repair["fault_cause"], None, repair["repair_notes"], decision_id, now),
                )
    else:
        transition_work_order(work_order_id, {"status": "rework_required", "notes": payload.get("notes")}, actor)
    audit("supervisor.decision", "work_order", work_order_id, actor, after=json.dumps(payload))
    return get_work_order(work_order_id, actor)

