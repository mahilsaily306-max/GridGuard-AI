from __future__ import annotations

from datetime import datetime, timedelta, timezone


def _report(transformer_id: str, village: str, caller: str, minutes_ago: int = 5) -> dict:
    timestamp = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
    return {
        "transformer_id": transformer_id,
        "village_name": village,
        "channel": "sms",
        "message": "Simulated power unavailable",
        "caller_id": caller,
        "received_at": timestamp.isoformat(),
    }


def test_health_and_seed_counts(client):
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["model_loaded"] is True
    assert response.json()["transformer_count"] == 24
    feeders = client.get("/api/feeders").json()
    assert len(feeders) == 6
    assert all(len(feeder["transformers"]) == 4 for feeder in feeders)


def test_transformer_monitoring_and_prediction_are_reproducible(client):
    assets = client.get("/api/transformers").json()
    assert len(assets) == 24
    detail = client.get("/api/transformers/T-104?readings_limit=24")
    assert detail.status_code == 200
    assert len(detail.json()["readings"]) == 24
    first = client.post("/api/predict/T-104")
    second = client.post("/api/predict/T-104")
    assert first.status_code == second.status_code == 200
    assert first.json()["risk_score"] == second.json()["risk_score"]
    assert 0 <= first.json()["risk_score"] <= 1
    assert first.json()["data_source"] == "synthetic"


def test_prediction_rejects_unknown_asset_and_simulation_input(client):
    assert client.post("/api/predict/T-999").status_code == 404
    invalid = client.post(
        "/api/simulate/T-104",
        json={"load_pct": 250, "oil_temp_c": 90, "ambient_temp_c": 35, "rainfall_mm": 0},
    )
    assert invalid.status_code == 422


def test_fault_simulation_updates_and_resets_state(client):
    baseline = client.post("/api/predict/T-104").json()
    stressed = client.post(
        "/api/simulate/T-104",
        json={"load_pct": 132, "oil_temp_c": 112, "ambient_temp_c": 43, "rainfall_mm": 42},
    )
    assert stressed.status_code == 200
    assert stressed.json()["simulation"] is True
    assert stressed.json()["risk_score"] != baseline["risk_score"]
    assert client.get("/api/transformers/T-104").json()["simulation_state"] is not None
    reset = client.post("/api/simulate/T-104/reset")
    assert reset.status_code == 200
    assert reset.json()["simulation"] is False
    assert reset.json()["risk_score"] == baseline["risk_score"]


def test_outage_deduplication_grouping_and_localization(client):
    first = client.post("/api/outage-reports", json=_report("T-101", "Demo Village A", "caller-a", 7))
    assert first.status_code == 201
    duplicate = client.post("/api/outage-reports", json=_report("T-101", "Demo Village A", "caller-a", 6))
    assert duplicate.status_code == 200
    assert duplicate.json()["deduplicated"] is True
    second_asset = client.post("/api/outage-reports", json=_report("T-102", "Demo Village B", "caller-b", 5))
    assert second_asset.status_code == 201
    unrelated = client.post("/api/outage-reports", json=_report("T-105", "Demo Village E", "caller-c", 4))
    assert unrelated.status_code == 201

    incidents = client.get("/api/incidents").json()
    assert len(incidents) == 2
    feeder_one = next(item for item in incidents if item["feeder_id"] == "F-01")
    assert feeder_one["scope"] == "feeder"
    assert feeder_one["suspected_transformer_id"] is None
    assert feeder_one["report_count"] == 2
    reports = client.get("/api/outage-reports").json()
    assert len(reports) == 3
    assert sum(item["duplicate_count"] for item in reports) == 4


def test_incident_transition_order_and_restoration_timestamp(client):
    client.post("/api/outage-reports", json=_report("T-101", "Demo Village A", "caller-a"))
    incident_id = client.get("/api/incidents").json()[0]["id"]
    invalid = client.patch(f"/api/incidents/{incident_id}", json={"status": "restored"})
    assert invalid.status_code == 409
    for state in ["assigned", "repairing", "restored"]:
        response = client.patch(f"/api/incidents/{incident_id}", json={"status": state})
        assert response.status_code == 200
    restored = response.json()
    assert restored["restored_at"] is not None
    assert [item["status"] for item in restored["status_history"]] == [
        "reported",
        "assigned",
        "repairing",
        "restored",
    ]


def test_dashboard_and_maintenance_advisories(client):
    dashboard = client.get("/api/dashboard")
    assert dashboard.status_code == 200
    assert dashboard.json()["kpis"]["total_transformers"] == 24
    assert sum(dashboard.json()["risk_distribution"].values()) == 24

    maintenance = client.get("/api/maintenance")
    assert maintenance.status_code == 200
    recommendations = maintenance.json()["recommendations"]
    assert len(recommendations) == 24
    assert recommendations == sorted(
        recommendations, key=lambda item: item["priority_score"], reverse=True
    )
    for item in recommendations:
        advisory = item["load_balancing_advisory"]
        if advisory:
            assert advisory["suggested_transfer_kva"] <= advisory["target_safe_headroom_kva"]
            assert advisory["advisory_only"] is True


def test_model_metrics_are_real_and_leakage_gap_is_recorded(client):
    response = client.get("/api/model/metrics")
    assert response.status_code == 200
    metrics = response.json()
    assert metrics["data_source"] == "synthetic"
    assert metrics["split"]["strategy"] == "chronological_with_24h_gap"
    assert metrics["split"]["train_rows"] > 0
    assert metrics["split"]["test_rows"] > 0
    assert 0 <= metrics["random_forest"]["f1"] <= 1
    assert len(metrics["random_forest"]["confusion_matrix"]) == 2

