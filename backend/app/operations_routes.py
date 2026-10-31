from __future__ import annotations

import io
import json
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
from reportlab.lib import colors

from app.auth import authenticate, audit, current_user, require_roles
from app.config import BACKEND_DIR
from app.database import database, utc_now
from app.knowledge import list_knowledge
from app.operations import (
    complaint_by_reference,
    create_complaint,
    dispatch_incident,
    get_work_order,
    list_work_orders,
    submit_inspection,
    submit_repair,
    supervisor_decision,
    transition_work_order,
)
from app.schemas import (
    ComplaintCreate,
    DispatchRequest,
    InspectionCreate,
    LoginRequest,
    RepairReportCreate,
    ScenarioSaveRequest,
    SupervisorDecisionCreate,
    WorkOrderTransitionRequest,
)


router = APIRouter(prefix="/api")
UPLOAD_DIR = BACKEND_DIR / "uploads"


def _error(exc: Exception) -> HTTPException:
    if isinstance(exc, KeyError):
        return HTTPException(status_code=404, detail="Resource not found")
    if isinstance(exc, PermissionError):
        return HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=409, detail=str(exc))
    return HTTPException(status_code=422, detail=str(exc))


@router.post("/auth/login", tags=["authentication"])
def login(payload: LoginRequest) -> dict:
    result = authenticate(payload.username, payload.password)
    if result is None:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    audit("auth.login", "user", result["user"]["id"], result["user"])
    return result


@router.get("/auth/me", tags=["authentication"])
def me(user: dict = Depends(current_user)) -> dict:
    return user


@router.get("/users", tags=["authentication"])
def users(_: dict = Depends(require_roles("administrator", "supervisor", "operator"))) -> list[dict]:
    with database() as conn:
        return [dict(row) for row in conn.execute("SELECT id,username,display_name,role,language,active,created_at FROM users ORDER BY role,display_name")]


@router.get("/notifications", tags=["notifications"])
def notifications(user: dict = Depends(current_user)) -> list[dict]:
    with database() as conn:
        return [dict(row) for row in conn.execute("SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 100", (user["id"],))]


@router.patch("/notifications/{notification_id}/read", tags=["notifications"])
def read_notification(notification_id: int, user: dict = Depends(current_user)) -> dict:
    with database() as conn:
        row = conn.execute("SELECT * FROM notifications WHERE id=? AND user_id=?", (notification_id, user["id"])).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Notification not found")
        conn.execute("UPDATE notifications SET read_at=? WHERE id=?", (utc_now(), notification_id))
        return dict(conn.execute("SELECT * FROM notifications WHERE id=?", (notification_id,)).fetchone())


@router.post("/complaints", status_code=201, tags=["complaints"])
def post_complaint(payload: ComplaintCreate) -> dict:
    try:
        return create_complaint(payload.model_dump())
    except Exception as exc:
        raise _error(exc) from None


@router.get("/complaints", tags=["complaints"])
def complaints(
    status: str | None = Query(default=None),
    search: str | None = Query(default=None, max_length=100),
    _: dict = Depends(require_roles("administrator", "operator", "supervisor", "lineman")),
) -> list[dict]:
    with database() as conn:
        clauses: list[str] = []
        params: list[object] = []
        if status:
            clauses.append("status=?")
            params.append(status)
        if search:
            pattern = f"%{search}%"
            clauses.append("(reference LIKE ? OR village_name LIKE ?)")
            params.extend([pattern, pattern])
        query = "SELECT reference FROM complaints"
        if clauses:
            query += " WHERE " + " AND ".join(clauses)
        query += " ORDER BY created_at DESC"
        references = [row[0] for row in conn.execute(query, params)]
    return [complaint_by_reference(reference) for reference in references]


@router.get("/complaints/{reference}", tags=["complaints"])
def complaint_tracking(reference: str) -> dict:
    try:
        return complaint_by_reference(reference.upper())
    except KeyError:
        raise HTTPException(status_code=404, detail="Complaint reference not found") from None


@router.post("/incidents/{incident_id}/dispatch", tags=["dispatch"])
def dispatch(
    incident_id: int,
    payload: DispatchRequest,
    user: dict = Depends(require_roles("administrator", "operator", "supervisor")),
) -> dict:
    try:
        return dispatch_incident(incident_id, payload.priority, user, payload.lineman_user_id)
    except Exception as exc:
        raise _error(exc) from None


@router.get("/work-orders", tags=["field operations"])
def work_orders(
    status: str | None = Query(default=None),
    user: dict = Depends(current_user),
) -> list[dict]:
    return list_work_orders(user, status)


@router.get("/linemen/me/assignments", tags=["field operations"])
def my_assignments(user: dict = Depends(require_roles("lineman"))) -> list[dict]:
    return list_work_orders(user)


@router.get("/work-orders/{work_order_id}", tags=["field operations"])
def work_order_detail(work_order_id: int, user: dict = Depends(current_user)) -> dict:
    try:
        return get_work_order(work_order_id, user)
    except Exception as exc:
        raise _error(exc) from None


@router.post("/work-orders/{work_order_id}/transitions", tags=["field operations"])
def work_order_transition(
    work_order_id: int,
    payload: WorkOrderTransitionRequest,
    user: dict = Depends(current_user),
) -> dict:
    try:
        return transition_work_order(work_order_id, payload.model_dump(), user)
    except Exception as exc:
        raise _error(exc) from None


@router.post("/work-orders/{work_order_id}/accept", tags=["field operations"])
def accept_work_order(work_order_id: int, user: dict = Depends(require_roles("lineman"))) -> dict:
    try:
        return transition_work_order(work_order_id, {"status": "accepted", "notes": "Assignment accepted"}, user)
    except Exception as exc:
        raise _error(exc) from None


@router.post("/work-orders/{work_order_id}/arrival", tags=["field operations"])
def record_arrival(work_order_id: int, user: dict = Depends(require_roles("lineman"))) -> dict:
    try:
        work = get_work_order(work_order_id, user)
        if work["status"] == "accepted":
            transition_work_order(work_order_id, {"status": "en_route", "notes": "Travel recorded"}, user)
        return transition_work_order(
            work_order_id,
            {"status": "arrived", "notes": "Arrival and safety acknowledgment recorded", "safety_acknowledged": True},
            user,
        )
    except Exception as exc:
        raise _error(exc) from None


@router.get("/work-orders/{work_order_id}/diagnostics", tags=["field operations"])
def diagnostics(work_order_id: int, user: dict = Depends(current_user)) -> dict:
    try:
        work = get_work_order(work_order_id, user)
        return {
            "work_order_id": work_order_id,
            "ranking_method": "Evidence-weighted inspection ranking; scores are not calibrated probabilities.",
            "recommendations": work["diagnostics"],
            "unknown_fault_supported": True,
        }
    except Exception as exc:
        raise _error(exc) from None


@router.post("/work-orders/{work_order_id}/inspections", status_code=201, tags=["field operations"])
@router.post("/work-orders/{work_order_id}/findings", status_code=201, tags=["field operations"])
def inspection(work_order_id: int, payload: InspectionCreate, user: dict = Depends(require_roles("lineman", "administrator"))) -> dict:
    try:
        return submit_inspection(work_order_id, payload.model_dump(), user)
    except Exception as exc:
        raise _error(exc) from None


@router.post("/work-orders/{work_order_id}/repair", tags=["field operations"])
def repair(work_order_id: int, payload: RepairReportCreate, user: dict = Depends(require_roles("lineman", "administrator"))) -> dict:
    try:
        return submit_repair(work_order_id, payload.model_dump(), user)
    except Exception as exc:
        raise _error(exc) from None


@router.post("/work-orders/{work_order_id}/evidence", status_code=201, tags=["field operations"])
async def upload_evidence(
    work_order_id: int,
    evidence_type: str = Form(...),
    file: UploadFile = File(...),
    user: dict = Depends(require_roles("lineman", "supervisor", "administrator")),
) -> dict:
    try:
        get_work_order(work_order_id, user)
    except Exception as exc:
        raise _error(exc) from None
    if evidence_type not in {"before_photo", "after_photo", "document"}:
        raise HTTPException(status_code=422, detail="Unsupported evidence type")
    allowed = {"image/jpeg": ".jpg", "image/png": ".png", "application/pdf": ".pdf"}
    if file.content_type not in allowed:
        raise HTTPException(status_code=415, detail="Only JPEG, PNG, and PDF evidence is supported")
    content = await file.read(5 * 1024 * 1024 + 1)
    if len(content) > 5 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Evidence file exceeds 5 MB")
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    stored_name = f"{uuid.uuid4().hex}{allowed[file.content_type]}"
    (UPLOAD_DIR / stored_name).write_bytes(content)
    with database() as conn:
        report = conn.execute("SELECT id FROM repair_reports WHERE work_order_id=?", (work_order_id,)).fetchone()
        cursor = conn.execute(
            """INSERT INTO evidence_files(work_order_id,repair_report_id,evidence_type,original_name,stored_name,
            content_type,size_bytes,uploaded_by,uploaded_at) VALUES(?,?,?,?,?,?,?,?,?)""",
            (work_order_id, report["id"] if report else None, evidence_type, Path(file.filename or "evidence").name, stored_name, file.content_type, len(content), user["id"], utc_now()),
        )
        result = dict(conn.execute("SELECT * FROM evidence_files WHERE id=?", (cursor.lastrowid,)).fetchone())
    audit("evidence.uploaded", "work_order", work_order_id, user, after=json.dumps({"evidence_id": result["id"]}))
    return result


@router.post("/work-orders/{work_order_id}/submit-review", tags=["field operations"])
def submit_review(work_order_id: int, user: dict = Depends(require_roles("lineman", "administrator"))) -> dict:
    try:
        work = get_work_order(work_order_id, user)
        if not work["repair_report"]:
            raise ValueError("A repair report is required before supervisor review")
        return transition_work_order(work_order_id, {"status": "awaiting_verification", "notes": "Submitted for independent supervisor review"}, user)
    except Exception as exc:
        raise _error(exc) from None


@router.post("/work-orders/{work_order_id}/supervisor-decision", tags=["field operations"])
def decide(
    work_order_id: int,
    payload: SupervisorDecisionCreate,
    user: dict = Depends(require_roles("supervisor", "administrator")),
) -> dict:
    try:
        return supervisor_decision(work_order_id, payload.model_dump(), user)
    except Exception as exc:
        raise _error(exc) from None


@router.get("/knowledge-base", tags=["knowledge base"])
def knowledge_base(
    query: str | None = Query(default=None, max_length=100),
    category: str | None = Query(default=None, max_length=100),
    _: dict = Depends(current_user),
) -> list[dict]:
    return list_knowledge(query, category)


@router.get("/audit-logs", tags=["audit"])
def audit_logs(
    search: str | None = Query(default=None, max_length=100),
    date_from: str | None = None,
    date_to: str | None = None,
    role: str | None = None,
    module: str | None = None,
    origin: str | None = None,
    entity_type: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    _: dict = Depends(require_roles("administrator", "supervisor")),
) -> dict:
    if origin and origin not in {"REAL", "SIMULATED"}:
        raise HTTPException(status_code=422, detail="Origin must be REAL or SIMULATED")
    clauses: list[str] = []
    params: list[object] = []
    filters = {
        "actor_role": role,
        "module": module,
        "origin": origin,
        "entity_type": entity_type,
    }
    for column, value in filters.items():
        if value:
            clauses.append(f"{column}=?")
            params.append(value)
    if date_from:
        clauses.append("created_at>=?")
        params.append(date_from)
    if date_to:
        clauses.append("created_at<=?")
        params.append(date_to)
    if search:
        pattern = f"%{search}%"
        clauses.append("(event_id LIKE ? OR actor_label LIKE ? OR action LIKE ? OR module LIKE ? OR resource LIKE ? OR details_json LIKE ?)")
        params.extend([pattern] * 6)
    where = f" WHERE {' AND '.join(clauses)}" if clauses else ""
    with database() as conn:
        total = conn.execute(f"SELECT COUNT(*) FROM audit_logs{where}", params).fetchone()[0]
        rows = conn.execute(
            f"SELECT * FROM audit_logs{where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?",
            [*params, page_size, (page - 1) * page_size],
        )
        items = []
        for row in rows:
            item = dict(row)
            try:
                details = json.loads(item["details_json"]) if item.get("details_json") else {}
            except (TypeError, json.JSONDecodeError):
                details = {"raw": item.get("details_json")}
            item.update({
                "timestamp": item["created_at"],
                "actor": item["actor_label"],
                "actor_role": item.get("actor_role") or "public",
                "module": item.get("module") or item["entity_type"].replace("_", " ").title(),
                "resource": item.get("resource") or f"{item['entity_type']}:{item['entity_id']}",
                "result": item.get("result") or "SUCCESS",
                "origin": item.get("origin") or "REAL",
                "details": details,
            })
            items.append(item)
    return {"items": items, "total": total, "page": page, "page_size": page_size}


@router.get("/replay/{incident_id}", tags=["replay"])
def replay(incident_id: int) -> dict:
    with database() as conn:
        incident = conn.execute("SELECT * FROM incidents WHERE id=?", (incident_id,)).fetchone()
        events = [dict(row) for row in conn.execute("SELECT * FROM replay_events WHERE scenario_key='demo_incident' ORDER BY sequence")]
        telemetry = [dict(row) for row in conn.execute("SELECT * FROM presentation_telemetry WHERE scenario_key='overload_day' ORDER BY sequence")]
    return {
        "incident": dict(incident) if incident else {"id": incident_id, "status": "simulated_replay_only"},
        "events": events,
        "presentation_telemetry": telemetry,
        "simulation_only": True,
        "operational_data_modified": False,
    }


@router.post("/simulation-scenarios", status_code=201, tags=["simulation"])
def save_scenario(payload: ScenarioSaveRequest, user: dict = Depends(current_user)) -> dict:
    with database() as conn:
        cursor = conn.execute(
            "INSERT INTO simulation_scenarios(name,transformer_id,inputs_json,result_json,created_by,created_at) VALUES(?,?,?,?,?,?)",
            (payload.name, payload.transformer_id, json.dumps(payload.inputs), json.dumps(payload.result), user["id"], utc_now()),
        )
        result = dict(conn.execute("SELECT * FROM simulation_scenarios WHERE id=?", (cursor.lastrowid,)).fetchone())
    audit("simulation.saved", "simulation_scenario", result["id"], user)
    return result


@router.get("/simulation-scenarios", tags=["simulation"])
def scenarios(user: dict = Depends(current_user)) -> list[dict]:
    with database() as conn:
        rows = conn.execute("SELECT * FROM simulation_scenarios WHERE created_by=? ORDER BY created_at DESC", (user["id"],))
        return [dict(row) for row in rows]


@router.get("/reports/incidents/{incident_id}/pdf", tags=["reports"])
def incident_pdf(incident_id: int, _: dict = Depends(current_user)) -> Response:
    with database() as conn:
        incident = conn.execute("SELECT * FROM incidents WHERE id=?", (incident_id,)).fetchone()
        if incident is None:
            raise HTTPException(status_code=404, detail="Incident not found")
        complaints = [dict(row) for row in conn.execute("SELECT reference,category,severity,village_name,status,created_at FROM complaints WHERE incident_id=?", (incident_id,))]
        work = conn.execute("SELECT * FROM field_work_orders WHERE incident_id=?", (incident_id,)).fetchone()
        repair = conn.execute("SELECT * FROM repair_reports WHERE work_order_id=?", (work["id"],)).fetchone() if work else None
        decisions = [dict(row) for row in conn.execute("SELECT * FROM supervisor_decisions WHERE work_order_id=?", (work["id"],))] if work else []
    buffer = io.BytesIO()
    document = SimpleDocTemplate(buffer, pagesize=A4, title=f"GridGuard Incident {incident_id}")
    styles = getSampleStyleSheet()
    story = [Paragraph("GridGuard AI — Incident Report", styles["Title"]), Paragraph("Synthetic demonstration data — not an operational utility record", styles["Italic"]), Spacer(1, 12)]
    incident_rows = [["Incident", str(incident_id)], ["Feeder", incident["feeder_id"]], ["Status", incident["status"]], ["Suspected transformer", incident["suspected_transformer_id"] or "Feeder-level suspicion"], ["Opened", incident["opened_at"]], ["Restored", incident["restored_at"] or "Not restored"]]
    table = Table(incident_rows, colWidths=[140, 350])
    table.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.5, colors.grey), ("BACKGROUND", (0, 0), (0, -1), colors.HexColor("#EAF2FF")), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story.extend([table, Spacer(1, 14), Paragraph("Complaints", styles["Heading2"])])
    for complaint in complaints:
        story.append(Paragraph(f"{complaint['reference']} — {complaint['category']} ({complaint['severity']}) — {complaint['village_name']}", styles["BodyText"]))
    story.extend([Spacer(1, 12), Paragraph("Field workflow", styles["Heading2"]), Paragraph(f"Work order: {work['reference'] if work else 'Not dispatched'}; status: {work['status'] if work else 'N/A'}", styles["BodyText"])])
    if repair:
        story.append(Paragraph(f"Repair: {repair['fault_cause']} — {repair['repair_notes']}", styles["BodyText"]))
    if decisions:
        story.append(Paragraph(f"Supervisor decision: {decisions[-1]['decision']} — {decisions[-1]['notes'] or ''}", styles["BodyText"]))
    story.extend([Spacer(1, 16), Paragraph("Predictions in this prototype use synthetic training data and are not field-validated probabilities. Fault localization remains a hypothesis until verified by a qualified worker.", styles["Italic"])])
    document.build(story)
    return Response(buffer.getvalue(), media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="gridguard-incident-{incident_id}.pdf"'})
