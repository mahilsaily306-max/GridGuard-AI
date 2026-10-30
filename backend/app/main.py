from __future__ import annotations

from contextlib import asynccontextmanager
from datetime import datetime, timezone
import json

import pandas as pd
from fastapi import FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import settings
from app.database import database, initialize_database
from app.dashboard_services import (
    dashboard_overview,
    feeder_performance,
    generate_alerts,
    list_alerts,
    load_temperature_trends,
    network_map,
    risk_trends,
)
from app.health import calculate_health
from app.ml.predictor import ModelUnavailableError, predictor
from app.ml.train import train_and_evaluate
from app.operations import seed_operations
from app.operations_routes import router as operations_router
from app.schemas import (
    AlertUpdate,
    IncidentUpdate,
    OutageReportCreate,
    RiskSimulationRequest,
    SimulationInput,
    WorkOrderCreate,
    WorkOrderUpdate,
)
from app.services import (
    create_outage_report,
    ensure_current_predictions,
    features_for_transformer,
    incident_detail,
    maintenance_recommendations,
    predict_transformer,
    reset_simulation,
    seed_database,
    simulate,
    update_incident,
)


@asynccontextmanager
async def lifespan(_: FastAPI):
    initialize_database()
    train_and_evaluate()
    predictor.load()
    training_data = pd.read_csv(settings.artifact_dir / "synthetic_training_data.csv", parse_dates=["timestamp"])
    seed_database(training_data)
    ensure_current_predictions()
    seed_operations()
    metrics = predictor.metrics()
    with database() as conn:
        conn.execute(
            """INSERT OR REPLACE INTO model_metadata
            (model_version,model_type,trained_at,feature_order_json,metrics_json,data_source)
            VALUES(?,?,?,?,?,'synthetic')""",
            (
                metrics["model_version"], metrics["model_type"], metrics["split"]["train_end"],
                json.dumps(metrics["feature_order"]), json.dumps(metrics),
            ),
        )
    generate_alerts()
    yield


app = FastAPI(
    title="GridGuard AI Backend",
    version="1.0.0",
    description=(
        "Local hackathon backend for synthetic rural transformer monitoring, trained ML inference, "
        "simulated outage intake, and advisory-only operational workflows."
    ),
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.cors_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(operations_router)


@app.exception_handler(ModelUnavailableError)
async def model_unavailable_handler(_, exc: ModelUnavailableError):
    return JSONResponse(status_code=503, content={"detail": str(exc), "code": "model_unavailable"})


@app.get("/api/health", tags=["system"])
def health() -> dict:
    with database() as conn:
        database_ok = conn.execute("SELECT 1").fetchone()[0] == 1
        transformer_count = conn.execute("SELECT COUNT(*) FROM transformers").fetchone()[0]
    return {
        "status": "ok" if database_ok and predictor.loaded else "degraded",
        "database": "available" if database_ok else "unavailable",
        "model_loaded": predictor.loaded,
        "model_version": predictor.model_version,
        "transformer_count": transformer_count,
        "data_source": "synthetic",
        "telecom_integration": "simulated",
    }


@app.get("/api/feeders", tags=["network"])
def list_feeders() -> list[dict]:
    with database() as conn:
        feeders = []
        for row in conn.execute("SELECT * FROM feeders ORDER BY id"):
            feeder = dict(row)
            feeder["transformers"] = [
                dict(item)
                for item in conn.execute(
                    "SELECT id,village_name,latitude,longitude,capacity_kva,status FROM transformers WHERE feeder_id=? ORDER BY id",
                    (row["id"],),
                )
            ]
            feeder["data_source"] = "synthetic"
            feeders.append(feeder)
        return feeders


def _latest_prediction(conn, transformer_id: str):
    return conn.execute(
        "SELECT * FROM predictions WHERE transformer_id=? ORDER BY id DESC LIMIT 1",
        (transformer_id,),
    ).fetchone()


@app.get("/api/transformers", tags=["transformers"])
def list_transformers(
    feeder_id: str | None = Query(default=None, pattern=r"^F-\d{2}$"),
    risk_level: str | None = Query(default=None, pattern=r"^(low|warning|high)$"),
) -> list[dict]:
    with database() as conn:
        query = "SELECT * FROM transformers"
        params: list[str] = []
        if feeder_id:
            query += " WHERE feeder_id=?"
            params.append(feeder_id)
        assets = []
        for row in conn.execute(query + " ORDER BY id", params):
            item = dict(row)
            prediction = _latest_prediction(conn, row["id"])
            reading = conn.execute(
                "SELECT * FROM readings WHERE transformer_id=? ORDER BY observed_at DESC LIMIT 1", (row["id"],)
            ).fetchone()
            simulation_state = conn.execute(
                "SELECT * FROM simulation_state WHERE transformer_id=?", (row["id"],)
            ).fetchone()
            item["latest_prediction"] = dict(prediction) if prediction else None
            item["latest_reading"] = dict(reading) if reading else None
            item["simulation_active"] = simulation_state is not None
            item["data_source"] = "synthetic"
            if not risk_level or (prediction and prediction["risk_level"] == risk_level):
                assets.append(item)
        return assets


@app.get("/api/transformers/{transformer_id}", tags=["transformers"])
def transformer_detail(
    transformer_id: str,
    readings_limit: int = Query(default=168, ge=1, le=1000),
) -> dict:
    with database() as conn:
        row = conn.execute("SELECT * FROM transformers WHERE id=?", (transformer_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Transformer not found")
        result = dict(row)
        result["readings"] = [
            dict(item)
            for item in conn.execute(
                "SELECT * FROM readings WHERE transformer_id=? ORDER BY observed_at DESC LIMIT ?",
                (transformer_id, readings_limit),
            )
        ]
        prediction = _latest_prediction(conn, transformer_id)
        result["latest_prediction"] = dict(prediction) if prediction else None
        result["prediction_history"] = [
            dict(item)
            for item in conn.execute(
                "SELECT * FROM predictions WHERE transformer_id=? ORDER BY id DESC LIMIT 50", (transformer_id,)
            )
        ]
        result["fault_history"] = [
            dict(item)
            for item in conn.execute(
                "SELECT * FROM fault_history WHERE transformer_id=? ORDER BY fault_at DESC LIMIT 100", (transformer_id,)
            )
        ]
        simulation_state = conn.execute(
            "SELECT * FROM simulation_state WHERE transformer_id=?", (transformer_id,)
        ).fetchone()
        result["simulation_state"] = dict(simulation_state) if simulation_state else None
        result["health"] = calculate_health(transformer_id)
        result["measurement_units"] = {
            "capacity_kva": "kVA", "load_pct": "percent", "apparent_load_kva": "kVA",
            "power_factor": "ratio", "oil_temp_c": "degC", "ambient_temp_c": "degC",
            "voltage_v": "V", "current_a": "A", "phase_imbalance_pct": "percent", "rainfall_mm": "mm",
        }
        if result["readings"]:
            latest_time = datetime.fromisoformat(result["readings"][0]["observed_at"].replace("Z", "+00:00"))
            age_hours = (datetime.now(timezone.utc) - latest_time).total_seconds() / 3600
            result["telemetry_status"] = {"stale": age_hours > 2, "age_hours": round(max(0, age_hours), 2), "quality_flag": result["readings"][0].get("quality_flag", "unknown")}
        result["data_source"] = "synthetic"
        return result


@app.get("/api/transformers/{transformer_id}/readings", tags=["transformers"])
def transformer_readings(
    transformer_id: str,
    limit: int = Query(default=168, ge=1, le=5000),
) -> list[dict]:
    with database() as conn:
        if conn.execute("SELECT 1 FROM transformers WHERE id=?", (transformer_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="Transformer not found")
        return [
            dict(row)
            for row in conn.execute(
                "SELECT * FROM readings WHERE transformer_id=? ORDER BY observed_at DESC LIMIT ?",
                (transformer_id, limit),
            )
        ]


@app.post("/api/predict/{transformer_id}", tags=["predictions"])
def predict(transformer_id: str) -> dict:
    try:
        return predict_transformer(transformer_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Transformer not found") from None


@app.post("/api/simulate/{transformer_id}", tags=["simulation"])
def run_simulation(transformer_id: str, payload: SimulationInput) -> dict:
    try:
        return simulate(transformer_id, payload.model_dump())
    except KeyError:
        raise HTTPException(status_code=404, detail="Transformer not found") from None


@app.post("/api/simulate/{transformer_id}/reset", tags=["simulation"])
def reset_transformer_simulation(transformer_id: str) -> dict:
    try:
        return reset_simulation(transformer_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Transformer not found") from None


@app.post("/api/outage-reports", status_code=status.HTTP_201_CREATED, tags=["outages"])
def submit_outage_report(payload: OutageReportCreate) -> JSONResponse:
    values = payload.model_dump()
    values["channel"] = payload.channel.value
    try:
        report, deduplicated = create_outage_report(values)
    except KeyError:
        raise HTTPException(status_code=404, detail="Transformer not found") from None
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    response_status = status.HTTP_200_OK if deduplicated else status.HTTP_201_CREATED
    return JSONResponse(status_code=response_status, content=report)


@app.get("/api/outage-reports", tags=["outages"])
def list_outage_reports(limit: int = Query(default=100, ge=1, le=1000)) -> list[dict]:
    with database() as conn:
        rows = conn.execute("SELECT * FROM outage_reports ORDER BY received_at DESC LIMIT ?", (limit,))
        output = []
        for row in rows:
            item = dict(row)
            item["caller_protected"] = bool(item.pop("caller_hash", None))
            item["data_source"] = "simulated_telecom"
            output.append(item)
        return output


@app.get("/api/incidents", tags=["incidents"])
def list_incidents(
    incident_status: str | None = Query(default=None, alias="status", pattern=r"^(reported|assigned|repairing|restored)$"),
) -> list[dict]:
    with database() as conn:
        if incident_status:
            rows = conn.execute(
                "SELECT id FROM incidents WHERE status=? ORDER BY opened_at DESC", (incident_status,)
            ).fetchall()
        else:
            rows = conn.execute("SELECT id FROM incidents ORDER BY opened_at DESC").fetchall()
        return [incident_detail(conn, row["id"]) for row in rows]


@app.get("/api/incidents/{incident_id}", tags=["incidents"])
def get_incident(incident_id: int) -> dict:
    with database() as conn:
        if conn.execute("SELECT 1 FROM incidents WHERE id=?", (incident_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="Incident not found")
        return incident_detail(conn, incident_id)


@app.patch("/api/incidents/{incident_id}", tags=["incidents"])
def patch_incident(incident_id: int, payload: IncidentUpdate) -> dict:
    try:
        return update_incident(
            incident_id,
            payload.status.value,
            payload.eta_note,
            payload.assigned_crew,
            payload.restoration_notes,
        )
    except KeyError:
        raise HTTPException(status_code=404, detail="Incident not found") from None
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None


@app.get("/api/maintenance", tags=["maintenance"])
def maintenance() -> dict:
    return {
        "recommendations": maintenance_recommendations(),
        "advisory_note": "Synthetic planning support only. All actions require qualified utility engineering review.",
        "automatic_switching": False,
    }


@app.get("/api/dashboard", tags=["dashboard"])
def dashboard() -> dict:
    assets = list_transformers(feeder_id=None, risk_level=None)
    ranked = sorted(
        assets,
        key=lambda item: item["latest_prediction"]["risk_score"] if item["latest_prediction"] else -1,
        reverse=True,
    )
    with database() as conn:
        active_incidents = conn.execute(
            "SELECT COUNT(*) FROM incidents WHERE status!='restored'"
        ).fetchone()[0]
        today = datetime.now(timezone.utc).date().isoformat()
        reports_today = conn.execute(
            "SELECT COUNT(*) FROM outage_reports WHERE substr(received_at,1,10)=?", (today,)
        ).fetchone()[0]
        recent_incidents = [
            incident_detail(conn, row["id"])
            for row in conn.execute("SELECT id FROM incidents ORDER BY opened_at DESC LIMIT 5")
        ]
    distribution = {level: 0 for level in ("low", "warning", "high")}
    for asset in assets:
        if asset["latest_prediction"]:
            distribution[asset["latest_prediction"]["risk_level"]] += 1
    return {
        "kpis": {
            "total_transformers": len(assets),
            "high_risk_transformers": distribution["high"],
            "active_incidents": active_incidents,
            "reports_today": reports_today,
        },
        "risk_distribution": distribution,
        "ranked_transformers": ranked,
        "recent_incidents": recent_incidents,
        "data_source": "synthetic",
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


@app.get("/api/model/metrics", tags=["model"])
def model_metrics() -> dict:
    return predictor.metrics()


# Dashboard contracts derived from the supplied command-center reference.
@app.get("/api/dashboard/overview", tags=["dashboard"])
def dashboard_overview_endpoint() -> dict:
    return dashboard_overview()


@app.get("/api/dashboard/risk-distribution", tags=["dashboard"])
def dashboard_risk_distribution() -> dict:
    overview = dashboard_overview()
    return {
        "total": overview["total_transformers"],
        "counts": overview["risk_counts"],
        "percentages": overview["risk_percentages"],
        "risk_policy": overview["risk_policy"],
        "data_source": "synthetic",
    }


@app.get("/api/dashboard/load-temperature-trends", tags=["dashboard"])
def dashboard_load_temperature_trends(hours: int = Query(default=24, ge=1, le=720)) -> dict:
    return load_temperature_trends(hours)


@app.get("/api/dashboard/recent-alerts", tags=["dashboard"])
def dashboard_recent_alerts(limit: int = Query(default=10, ge=1, le=100)) -> list[dict]:
    return list_alerts(limit=limit)


@app.get("/api/dashboard/activity", tags=["dashboard"])
def dashboard_activity() -> dict:
    with database() as conn:
        incidents = [dict(row) for row in conn.execute("SELECT id,status,updated_at FROM incidents ORDER BY updated_at DESC LIMIT 10")]
        work_orders = [dict(row) for row in conn.execute("SELECT id,transformer_id,status,updated_at FROM maintenance_work_orders ORDER BY updated_at DESC LIMIT 10")]
    return {"alerts": list_alerts(limit=10), "incidents": incidents, "work_orders": work_orders, "data_source": "synthetic"}


@app.get("/api/feeders/{feeder_id}", tags=["network"])
def feeder_detail(feeder_id: str) -> dict:
    with database() as conn:
        feeder = conn.execute("SELECT * FROM feeders WHERE id=?", (feeder_id,)).fetchone()
        if feeder is None:
            raise HTTPException(status_code=404, detail="Feeder not found")
        result = dict(feeder)
        result["transformers"] = [dict(row) for row in conn.execute("SELECT * FROM transformers WHERE feeder_id=? ORDER BY id", (feeder_id,))]
        result["topology_source"] = "simulated"
        return result


@app.get("/api/feeders/{feeder_id}/transformers", tags=["network"])
def feeder_transformers(feeder_id: str) -> list[dict]:
    with database() as conn:
        if conn.execute("SELECT 1 FROM feeders WHERE id=?", (feeder_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="Feeder not found")
    return list_transformers(feeder_id=feeder_id, risk_level=None)


@app.get("/api/network/map", tags=["network"])
def map_data(
    feeder_id: str | None = Query(default=None, pattern=r"^F-\d{2}$"),
    risk_level: str | None = Query(default=None, pattern=r"^(low|warning|high)$"),
    outage_only: bool = False,
) -> dict:
    return network_map(feeder_id, risk_level, outage_only)


@app.get("/api/transformers/{transformer_id}/history", tags=["transformers"])
def transformer_history(transformer_id: str, hours: int = Query(default=168, ge=1, le=2160)) -> dict:
    readings = transformer_readings(transformer_id, hours)
    return {
        "transformer_id": transformer_id,
        "readings": readings,
        "measurement_units": {
            "load_pct": "percent", "apparent_load_kva": "kVA", "power_factor": "ratio",
            "oil_temp_c": "degC", "ambient_temp_c": "degC", "voltage_v": "V",
            "current_a": "A", "phase_imbalance_pct": "percent", "rainfall_mm": "mm",
        },
        "ordering": "newest_first",
        "data_source": "synthetic",
    }


@app.get("/api/transformers/{transformer_id}/health", tags=["transformers"])
def transformer_health(transformer_id: str) -> dict:
    try:
        return calculate_health(transformer_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Transformer not found") from None
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from None


@app.get("/api/transformers/{transformer_id}/fault-history", tags=["transformers"])
def transformer_fault_history(transformer_id: str) -> dict:
    with database() as conn:
        if conn.execute("SELECT 1 FROM transformers WHERE id=?", (transformer_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="Transformer not found")
        rows = [dict(row) for row in conn.execute("SELECT * FROM fault_history WHERE transformer_id=? ORDER BY fault_at DESC", (transformer_id,))]
    return {"transformer_id": transformer_id, "faults": rows, "data_source": "synthetic"}


@app.get("/api/transformers/{transformer_id}/maintenance-history", tags=["transformers"])
def transformer_maintenance_history(transformer_id: str) -> dict:
    with database() as conn:
        if conn.execute("SELECT 1 FROM transformers WHERE id=?", (transformer_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="Transformer not found")
        rows = [dict(row) for row in conn.execute("SELECT * FROM maintenance_records WHERE transformer_id=? ORDER BY performed_at DESC", (transformer_id,))]
    return {"transformer_id": transformer_id, "maintenance_records": rows, "data_source": "synthetic"}


@app.post("/api/ml/train", tags=["model"])
def retrain_model() -> dict:
    metrics = train_and_evaluate(force=True)
    predictor.load()
    with database() as conn:
        ids = [row[0] for row in conn.execute("SELECT id FROM transformers ORDER BY id")]
        conn.execute(
            """INSERT OR REPLACE INTO model_metadata(model_version,model_type,trained_at,feature_order_json,metrics_json,data_source)
            VALUES(?,?,?,?,?,'synthetic')""",
            (metrics["model_version"], metrics["model_type"], datetime.now(timezone.utc).isoformat(), json.dumps(metrics["feature_order"]), json.dumps(metrics)),
        )
    for transformer_id in ids:
        predict_transformer(transformer_id)
    return {"status": "trained", "metrics": metrics}


@app.get("/api/ml/metrics", tags=["model"])
def ml_metrics() -> dict:
    return predictor.metrics()


@app.get("/api/ml/model-info", tags=["model"])
def model_info() -> dict:
    metrics = predictor.metrics()
    return {
        "model_version": predictor.model_version,
        "model_type": metrics["model_type"],
        "feature_order": predictor.feature_order,
        "generator_version": metrics["generator_version"],
        "training_data_source": "synthetic",
        "loaded": predictor.loaded,
        "prediction_horizon_hours": 24,
        "probability_quality_note": "The score is uncalibrated and is not a field-validated probability.",
        "evaluation_split": metrics["split"],
    }


@app.get("/api/predictions", tags=["predictions"])
def list_predictions(limit: int = Query(default=100, ge=1, le=1000), include_simulations: bool = False) -> list[dict]:
    with database() as conn:
        if include_simulations:
            rows = conn.execute("SELECT * FROM predictions ORDER BY id DESC LIMIT ?", (limit,))
        else:
            rows = conn.execute("SELECT * FROM predictions WHERE is_simulation=0 ORDER BY id DESC LIMIT ?", (limit,))
        return [dict(row) for row in rows]


@app.get("/api/predictions/{transformer_id}", tags=["predictions"])
def transformer_predictions(transformer_id: str, limit: int = Query(default=50, ge=1, le=500)) -> dict:
    with database() as conn:
        if conn.execute("SELECT 1 FROM transformers WHERE id=?", (transformer_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="Transformer not found")
        rows = [dict(row) for row in conn.execute("SELECT * FROM predictions WHERE transformer_id=? ORDER BY id DESC LIMIT ?", (transformer_id, limit))]
    return {"transformer_id": transformer_id, "predictions": rows, "data_source": "synthetic_ml"}


@app.post("/api/simulations/transformer-risk", tags=["simulation"])
def rich_risk_simulation(payload: RiskSimulationRequest) -> dict:
    values = payload.overrides.model_dump()
    try:
        original_features = features_for_transformer(payload.transformer_id)
        overrides = {
            "load_pct": values["load_utilization_pct"],
            "oil_temp_c": values["oil_temperature_c"],
            "ambient_temp_c": values["ambient_temperature_c"],
            "rainfall_mm": original_features["rainfall_mm"] if values["rainfall_mm"] is None else values["rainfall_mm"],
        }
        original_prediction = predict_transformer(payload.transformer_id, persist=False)
        simulated_prediction = predict_transformer(payload.transformer_id, overrides, persist=False, is_simulation=True)
        original_health = calculate_health(payload.transformer_id)
        simulated_health = calculate_health(payload.transformer_id, overrides)
    except KeyError:
        raise HTTPException(status_code=404, detail="Transformer not found") from None
    warnings = []
    if overrides["load_pct"] > 100:
        warnings.append("Load exceeds the prototype rated-utilization threshold")
    if overrides["oil_temp_c"] > 90:
        warnings.append("Oil temperature exceeds the prototype critical threshold")
    return {
        "transformer_id": payload.transformer_id,
        "original_readings": original_prediction["features"],
        "simulated_readings": overrides,
        "original_model_prediction": original_prediction,
        "simulated_model_prediction": simulated_prediction,
        "risk_score_change": round(simulated_prediction["risk_score"] - original_prediction["risk_score"], 6),
        "original_health_score": original_health["overall_health_index"],
        "simulated_health_score": simulated_health["overall_health_index"],
        "risk_category": simulated_prediction["risk_level"],
        "warning_messages": warnings,
        "contributing_factors": simulated_prediction["top_factors"],
        "recommended_next_actions": ["Qualified operator review", "Inspect thermal and loading conditions"] if warnings else ["Continue routine monitoring"],
        "model_version": predictor.model_version,
        "simulation_timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "historical_telemetry_modified": False,
        "data_source": "synthetic_simulation",
    }


@app.get("/api/alerts", tags=["alerts"])
def alerts(limit: int = Query(default=100, ge=1, le=1000), alert_status: str | None = Query(default=None, alias="status", pattern=r"^(open|acknowledged|resolved)$")) -> list[dict]:
    return list_alerts(limit, alert_status)


@app.get("/api/alerts/{alert_id}", tags=["alerts"])
def alert_detail(alert_id: int) -> dict:
    with database() as conn:
        row = conn.execute("SELECT * FROM alerts WHERE id=?", (alert_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Alert not found")
        item = dict(row)
        item["evidence"] = json.loads(item.pop("evidence_json"))
        return item


@app.patch("/api/alerts/{alert_id}", tags=["alerts"])
def patch_alert(alert_id: int, payload: AlertUpdate) -> dict:
    with database() as conn:
        row = conn.execute("SELECT * FROM alerts WHERE id=?", (alert_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Alert not found")
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        acknowledged_at = now if payload.status == "acknowledged" else row["acknowledged_at"]
        conn.execute(
            "UPDATE alerts SET status=?,acknowledged_by=COALESCE(?,acknowledged_by),acknowledged_at=?,updated_at=? WHERE id=?",
            (payload.status, payload.acknowledged_by, acknowledged_at, now, alert_id),
        )
    return alert_detail(alert_id)


@app.get("/api/outage-reports/{report_id}", tags=["outages"])
def outage_report_detail(report_id: int) -> dict:
    with database() as conn:
        row = conn.execute("SELECT * FROM outage_reports WHERE id=?", (report_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Outage report not found")
        item = dict(row)
        item["caller_protected"] = bool(item.pop("caller_hash", None))
        item["data_source"] = "simulated_telecom"
        return item


@app.get("/api/maintenance/recommendations", tags=["maintenance"])
def maintenance_recommendations_endpoint() -> dict:
    return maintenance()


@app.get("/api/maintenance/transformers/{transformer_id}", tags=["maintenance"])
def transformer_maintenance(transformer_id: str) -> dict:
    matches = [item for item in maintenance_recommendations() if item["transformer_id"] == transformer_id]
    if not matches:
        raise HTTPException(status_code=404, detail="Transformer not found")
    with database() as conn:
        work_orders = [dict(row) for row in conn.execute("SELECT * FROM maintenance_work_orders WHERE transformer_id=? ORDER BY created_at DESC", (transformer_id,))]
    return {"recommendation": matches[0], "health": calculate_health(transformer_id), "work_orders": work_orders}


@app.post("/api/maintenance/work-orders", status_code=201, tags=["maintenance"])
def create_work_order(payload: WorkOrderCreate) -> dict:
    with database() as conn:
        if conn.execute("SELECT 1 FROM transformers WHERE id=?", (payload.transformer_id,)).fetchone() is None:
            raise HTTPException(status_code=404, detail="Transformer not found")
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        cursor = conn.execute(
            """INSERT INTO maintenance_work_orders
            (transformer_id,title,description,priority,status,assigned_to,scheduled_for,created_at,updated_at)
            VALUES(?,?,?,?,'open',?,?,?,?)""",
            (payload.transformer_id, payload.title, payload.description, payload.priority, payload.assigned_to, payload.scheduled_for.isoformat() if payload.scheduled_for else None, now, now),
        )
        return dict(conn.execute("SELECT * FROM maintenance_work_orders WHERE id=?", (cursor.lastrowid,)).fetchone())


WORK_ORDER_TRANSITIONS = {
    "open": {"scheduled", "in_progress", "cancelled"}, "scheduled": {"in_progress", "cancelled"},
    "in_progress": {"completed", "cancelled"}, "completed": set(), "cancelled": set(),
}


@app.patch("/api/maintenance/work-orders/{work_order_id}", tags=["maintenance"])
def patch_work_order(work_order_id: int, payload: WorkOrderUpdate) -> dict:
    with database() as conn:
        row = conn.execute("SELECT * FROM maintenance_work_orders WHERE id=?", (work_order_id,)).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Work order not found")
        if payload.status != row["status"] and payload.status not in WORK_ORDER_TRANSITIONS[row["status"]]:
            raise HTTPException(status_code=409, detail=f"Invalid transition from {row['status']} to {payload.status}")
        now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        completed = now if payload.status == "completed" else row["completed_at"]
        conn.execute(
            """UPDATE maintenance_work_orders SET status=?,assigned_to=COALESCE(?,assigned_to),
            scheduled_for=COALESCE(?,scheduled_for),updated_at=?,completed_at=? WHERE id=?""",
            (payload.status, payload.assigned_to, payload.scheduled_for.isoformat() if payload.scheduled_for else None, now, completed, work_order_id),
        )
        return dict(conn.execute("SELECT * FROM maintenance_work_orders WHERE id=?", (work_order_id,)).fetchone())


@app.get("/api/analytics/load-temperature", tags=["analytics"])
def analytics_load_temperature(hours: int = Query(default=24, ge=1, le=720)) -> dict:
    return load_temperature_trends(hours)


@app.get("/api/analytics/risk-trends", tags=["analytics"])
def analytics_risk_trends(hours: int = Query(default=168, ge=1, le=720)) -> dict:
    return risk_trends(hours)


@app.get("/api/analytics/feeder-performance", tags=["analytics"])
def analytics_feeder_performance() -> list[dict]:
    return feeder_performance()


@app.get("/api/analytics/transformer/{transformer_id}", tags=["analytics"])
def transformer_analytics(transformer_id: str, hours: int = Query(default=168, ge=1, le=720)) -> dict:
    try:
        return {
            "transformer_id": transformer_id,
            "history": transformer_history(transformer_id, hours),
            "health": calculate_health(transformer_id),
            "current_prediction": predict_transformer(transformer_id, persist=False),
            "data_source": "synthetic",
        }
    except KeyError:
        raise HTTPException(status_code=404, detail="Transformer not found") from None

