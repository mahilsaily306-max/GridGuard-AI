from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.database import database
from app.health import HEALTH_WEIGHTS
from app.models import Base


def test_dashboard_overview_counts_are_consistent(client):
    response = client.get("/api/dashboard/overview")
    assert response.status_code == 200
    body = response.json()
    assert body["total_transformers"] == 24
    assert body["total_feeders"] == 6
    assert sum(body["risk_counts"].values()) == 24
    assert round(sum(body["risk_percentages"].values()), 1) == 100.0
    assert body["average_load_utilization"]["unit"] == "percent"
    assert body["data_source"] == "synthetic"


def test_network_map_is_geojson_with_documented_simulated_geometry(client):
    response = client.get("/api/network/map?feeder_id=F-01")
    assert response.status_code == 200
    body = response.json()
    assert body["transformers"]["type"] == "FeatureCollection"
    assert len(body["transformers"]["features"]) == 4
    assert len(body["feeder_lines"]["features"]) == 1
    assert body["feeder_lines"]["features"][0]["geometry"]["type"] == "LineString"
    assert body["feeder_lines"]["features"][0]["properties"]["verified_real_world"] is False


def test_transformer_intelligence_and_health_index(client):
    detail = client.get("/api/transformers/T-101?readings_limit=2")
    assert detail.status_code == 200
    body = detail.json()
    latest = body["readings"][0]
    assert latest["apparent_load_kva"] == body["capacity_kva"] * latest["load_pct"] / 100
    assert latest["provenance"] == "synthetic_sensor"
    assert latest["quality_flag"] == "good"
    health = client.get("/api/transformers/T-101/health").json()
    assert 0 <= health["overall_health_index"] <= 100
    assert health["weights"] == HEALTH_WEIGHTS
    assert health["overall_health_index"] != round(100 - body["latest_prediction"]["risk_score"] * 100, 2)
    assert health["health_scoring_version"] == "health-index-v1"


def test_rich_simulation_does_not_mutate_telemetry_or_persist_prediction(client):
    with database() as conn:
        reading_before = dict(conn.execute("SELECT * FROM readings WHERE transformer_id='T-104' ORDER BY observed_at DESC LIMIT 1").fetchone())
        prediction_count = conn.execute("SELECT COUNT(*) FROM predictions").fetchone()[0]
    response = client.post(
        "/api/simulations/transformer-risk",
        json={
            "transformer_id": "T-104",
            "overrides": {
                "load_utilization_pct": 125,
                "oil_temperature_c": 105,
                "ambient_temperature_c": 40,
            },
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["historical_telemetry_modified"] is False
    assert body["simulated_model_prediction"]["simulation"] is True
    with database() as conn:
        reading_after = dict(conn.execute("SELECT * FROM readings WHERE transformer_id='T-104' ORDER BY observed_at DESC LIMIT 1").fetchone())
        assert conn.execute("SELECT COUNT(*) FROM predictions").fetchone()[0] == prediction_count
    assert reading_after == reading_before


def test_alert_engine_deduplicates_and_acknowledges(client):
    first = client.get("/api/alerts").json()
    second = client.get("/api/alerts").json()
    keys = [(item["dedupe_key"], item["status"]) for item in second]
    assert len(keys) == len(set(keys))
    assert len(second) == len(first)
    if second:
        alert_id = second[0]["id"]
        updated = client.patch(
            f"/api/alerts/{alert_id}",
            json={"status": "acknowledged", "acknowledged_by": "demo-operator"},
        )
        assert updated.status_code == 200
        assert updated.json()["acknowledged_at"] is not None


def test_phone_identifier_is_never_returned(client):
    timestamp = (datetime.now(timezone.utc) - timedelta(minutes=2)).isoformat()
    created = client.post(
        "/api/outage-reports",
        json={
            "transformer_id": "T-101",
            "village_name": "Demo Village A",
            "channel": "missed_call",
            "caller_id": "+91-demo-private",
            "received_at": timestamp,
        },
    )
    assert created.status_code == 201
    assert "caller_hash" not in created.json()
    assert "caller_id" not in created.json()
    assert created.json()["caller_protected"] is True
    fetched = client.get(f"/api/outage-reports/{created.json()['id']}").json()
    assert "caller_hash" not in fetched


def test_work_order_validated_workflow(client):
    created = client.post(
        "/api/maintenance/work-orders",
        json={
            "transformer_id": "T-101",
            "title": "Inspect thermal connections",
            "description": "Synthetic recommendation for operator review",
            "priority": "high",
        },
    )
    assert created.status_code == 201
    work_order_id = created.json()["id"]
    assert client.patch(f"/api/maintenance/work-orders/{work_order_id}", json={"status": "completed"}).status_code == 409
    for state in ("scheduled", "in_progress", "completed"):
        response = client.patch(f"/api/maintenance/work-orders/{work_order_id}", json={"status": state})
        assert response.status_code == 200
    assert response.json()["completed_at"] is not None


def test_analytics_and_model_contracts(client):
    trends = client.get("/api/analytics/load-temperature?hours=24")
    assert trends.status_code == 200
    assert len(trends.json()["series"]) == 24
    assert trends.json()["series"][0]["load_utilization"]["unit"] == "percent"
    feeders = client.get("/api/analytics/feeder-performance")
    assert feeders.status_code == 200
    assert len(feeders.json()) == 6
    info = client.get("/api/ml/model-info")
    assert info.status_code == 200
    assert info.json()["loaded"] is True
    assert "uncalibrated" in info.json()["probability_quality_note"]


def test_schema_catalog_and_required_tables_exist(client):
    assert {"feeders", "transformers", "readings", "alerts", "maintenance_work_orders"}.issubset(Base.metadata.tables)
    with database() as conn:
        tables = {row[0] for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {
        "villages", "weather_observations", "maintenance_records", "model_metadata",
        "alerts", "maintenance_work_orders",
    }.issubset(tables)
