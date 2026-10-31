from __future__ import annotations

from app.audit_seed import seed_simulated_audit_events
from app.database import database


def _admin_headers(client) -> dict[str, str]:
    response = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "Admin@123"},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_simulated_audit_seed_is_idempotent_and_distinguishable(client):
    headers = _admin_headers(client)
    seed_simulated_audit_events()
    seed_simulated_audit_events()

    with database() as conn:
        assert conn.execute("SELECT COUNT(*) FROM audit_logs WHERE origin='SIMULATED'").fetchone()[0] == 18
        assert conn.execute("SELECT COUNT(*) FROM audit_logs WHERE origin='REAL'").fetchone()[0] >= 1

    response = client.get("/api/audit-logs?origin=SIMULATED&page_size=50", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 18
    assert all(item["origin"] == "SIMULATED" for item in body["items"])
    assert all(item["event_id"].startswith("EVT-SIM-") for item in body["items"])
    required = {"timestamp", "event_id", "actor", "actor_role", "action", "module", "resource", "result", "origin"}
    assert all(required.issubset(item) for item in body["items"])


def test_audit_filters_search_and_pagination(client):
    headers = _admin_headers(client)
    seed_simulated_audit_events()

    first_page = client.get("/api/audit-logs?origin=SIMULATED&page=1&page_size=5", headers=headers).json()
    second_page = client.get("/api/audit-logs?origin=SIMULATED&page=2&page_size=5", headers=headers).json()
    assert len(first_page["items"]) == 5
    assert len(second_page["items"]) == 5
    assert {item["event_id"] for item in first_page["items"]}.isdisjoint(item["event_id"] for item in second_page["items"])

    knowledge = client.get("/api/audit-logs?module=Knowledge%20Base", headers=headers).json()
    assert knowledge["total"] == 1
    assert knowledge["items"][0]["resource"] == "knowledge_entry:KB-REF-001"

    search = client.get("/api/audit-logs?search=uncalibrated", headers=headers).json()
    assert search["total"] == 1
    assert search["items"][0]["module"] == "Risk Assessment"

    lineman = client.get("/api/audit-logs?role=lineman", headers=headers).json()
    assert lineman["total"] >= 1
    assert all(item["actor_role"] == "lineman" for item in lineman["items"])


def test_synthetic_event_resources_reference_seeded_entities(client):
    _admin_headers(client)
    seed_simulated_audit_events()
    with database() as conn:
        rows = [dict(row) for row in conn.execute("SELECT entity_type,entity_id FROM audit_logs WHERE origin='SIMULATED'")]
        for row in rows:
            if row["entity_type"] == "user":
                assert conn.execute("SELECT 1 FROM users WHERE username=?", (row["entity_id"],)).fetchone()
            elif row["entity_type"] == "transformer":
                assert conn.execute("SELECT 1 FROM transformers WHERE id=?", (row["entity_id"],)).fetchone()
            elif row["entity_type"] == "replay":
                assert conn.execute("SELECT 1 FROM replay_events WHERE scenario_key=?", (row["entity_id"],)).fetchone()
            elif row["entity_type"] == "knowledge_entry":
                assert conn.execute("SELECT 1 FROM knowledge_entries WHERE id=?", (row["entity_id"],)).fetchone()
            else:
                assert row["entity_type"] == "dashboard" and row["entity_id"] == "overview"
