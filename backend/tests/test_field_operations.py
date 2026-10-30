from __future__ import annotations


def login(client, username: str, password: str) -> dict:
    response = client.post("/api/auth/login", json={"username": username, "password": password})
    assert response.status_code == 200
    return response.json()


def auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def test_complete_complaint_dispatch_repair_verification_flow(client):
    complaint = client.post(
        "/api/complaints",
        json={
            "village_name": "Demo Village A",
            "transformer_id": "T-101",
            "category": "power_outage",
            "severity": "high",
            "landmark": "Community centre",
            "duration_minutes": 25,
            "affected_area": "North lane",
            "hazard_flags": [],
            "language": "pa",
            "details": "Synthetic village outage report",
            "caller_id": "private-demo-caller",
        },
    )
    assert complaint.status_code == 201
    complaint_body = complaint.json()
    assert complaint_body["reference"].startswith("GG-")
    assert "caller_hash" not in complaint_body
    tracking = client.get(f"/api/complaints/{complaint_body['reference']}")
    assert tracking.status_code == 200

    operator = login(client, "operator", "Operator@123")
    dispatched = client.post(
        f"/api/incidents/{complaint_body['incident_id']}/dispatch",
        json={"priority": "high"},
        headers=auth(operator["access_token"]),
    )
    assert dispatched.status_code == 200
    work = dispatched.json()
    assert work["status"] == "assigned"

    lineman = login(client, "lineman1", "Lineman@123")
    # Dispatch may choose either available lineman; use the selected demo account.
    selected_username = "lineman1" if work["lineman_name"] == "Harjit Singh" else "lineman2"
    selected_password = "Lineman@123"
    if selected_username != "lineman1":
        lineman = login(client, selected_username, selected_password)
    work_id = work["id"]
    assert client.post(f"/api/work-orders/{work_id}/accept", headers=auth(lineman["access_token"])).status_code == 200
    arrived = client.post(f"/api/work-orders/{work_id}/arrival", headers=auth(lineman["access_token"]))
    assert arrived.status_code == 200
    assert arrived.json()["safety_acknowledged_at"] is not None
    investigating = client.post(
        f"/api/work-orders/{work_id}/transitions",
        json={"status": "investigating", "notes": "Qualified field inspection started"},
        headers=auth(lineman["access_token"]),
    )
    assert investigating.status_code == 200
    diagnostics = client.get(f"/api/work-orders/{work_id}/diagnostics", headers=auth(lineman["access_token"]))
    assert diagnostics.status_code == 200
    assert len(diagnostics.json()["recommendations"]) == 5
    finding = client.post(
        f"/api/work-orders/{work_id}/findings",
        json={
            "recommendation_id": diagnostics.json()["recommendations"][0]["id"],
            "status": "confirmed",
            "fault_category": "Loose or damaged connection",
            "observations": "Synthetic inspection found heat discoloration at a connector.",
            "suspected_root_cause": "Loose termination",
        },
        headers=auth(lineman["access_token"]),
    )
    assert finding.status_code == 201
    assert client.post(
        f"/api/work-orders/{work_id}/transitions",
        json={"status": "repairing", "notes": "Repair documentation started"},
        headers=auth(lineman["access_token"]),
    ).status_code == 200
    repair = client.post(
        f"/api/work-orders/{work_id}/repair",
        json={
            "fault_cause": "Loose connection",
            "repair_notes": "Tightened and cleaned the synthetic connector.",
            "materials_used": "Connector, insulation tape",
            "restoration_observations": "Supply present in simulated workflow",
        },
        headers=auth(lineman["access_token"]),
    )
    assert repair.status_code == 200
    evidence = client.post(
        f"/api/work-orders/{work_id}/evidence",
        data={"evidence_type": "after_photo"},
        files={"file": ("after.png", b"\x89PNG\r\n\x1a\n" + b"demo", "image/png")},
        headers=auth(lineman["access_token"]),
    )
    assert evidence.status_code == 201
    review = client.post(f"/api/work-orders/{work_id}/submit-review", headers=auth(lineman["access_token"]))
    assert review.status_code == 200
    assert review.json()["status"] == "awaiting_verification"

    supervisor = login(client, "supervisor", "Supervisor@123")
    approved = client.post(
        f"/api/work-orders/{work_id}/supervisor-decision",
        json={"decision": "approved", "notes": "Independent synthetic demo verification complete"},
        headers=auth(supervisor["access_token"]),
    )
    assert approved.status_code == 200
    assert approved.json()["status"] == "resolved"
    assert client.post(
        f"/api/work-orders/{work_id}/transitions",
        json={"status": "closed", "notes": "Operator closed verified incident"},
        headers=auth(operator["access_token"]),
    ).status_code == 200
    assert len(client.get("/api/knowledge-base", headers=auth(supervisor["access_token"])).json()) == 1
    assert client.get(
        f"/api/reports/incidents/{complaint_body['incident_id']}/pdf",
        headers=auth(operator["access_token"]),
    ).headers["content-type"] == "application/pdf"


def test_role_permissions_and_audit(client):
    lineman = login(client, "lineman1", "Lineman@123")
    forbidden = client.get("/api/audit-logs", headers=auth(lineman["access_token"]))
    assert forbidden.status_code == 403
    admin = login(client, "admin", "Admin@123")
    logs = client.get("/api/audit-logs", headers=auth(admin["access_token"]))
    assert logs.status_code == 200
    assert any(item["action"] == "auth.login" for item in logs.json())


def test_replay_fixture_is_isolated(client):
    replay = client.get("/api/replay/999")
    assert replay.status_code == 200
    body = replay.json()
    assert len(body["events"]) == 12
    assert len(body["presentation_telemetry"]) == 19
    assert body["presentation_telemetry"][-1]["day_offset"] == 1
    assert body["operational_data_modified"] is False
