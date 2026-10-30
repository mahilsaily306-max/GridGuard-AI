from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.database import database, utc_now


HEALTH_VERSION = "health-index-v1"
HEALTH_WEIGHTS = {
    "thermal_stress": 0.30,
    "loading_stress": 0.25,
    "fault_history": 0.20,
    "age_and_maintenance": 0.15,
    "electrical_imbalance": 0.10,
}


def _clamp(value: float) -> float:
    return max(0.0, min(100.0, value))


def calculate_health(transformer_id: str, overrides: dict[str, float] | None = None) -> dict:
    """Return a transparent condition score distinct from short-term ML risk."""
    with database() as conn:
        asset = conn.execute("SELECT * FROM transformers WHERE id=?", (transformer_id,)).fetchone()
        if asset is None:
            raise KeyError(transformer_id)
        reading = conn.execute(
            "SELECT * FROM readings WHERE transformer_id=? ORDER BY observed_at DESC LIMIT 1",
            (transformer_id,),
        ).fetchone()
        if reading is None:
            raise RuntimeError("Missing telemetry")
        values = dict(reading)
        values.update(overrides or {})
        observed = datetime.fromisoformat(reading["observed_at"].replace("Z", "+00:00"))
        faults = conn.execute(
            "SELECT COUNT(*) FROM fault_history WHERE transformer_id=? AND fault_at>=?",
            (transformer_id, (observed - timedelta(days=365 * 3)).isoformat()),
        ).fetchone()[0]
        maintenance = conn.execute(
            "SELECT performed_at FROM maintenance_records WHERE transformer_id=? ORDER BY performed_at DESC LIMIT 1",
            (transformer_id,),
        ).fetchone()

    missing: list[str] = []
    oil_temp = values.get("oil_temp_c")
    load_pct = values.get("load_pct")
    imbalance = values.get("phase_imbalance_pct")
    if oil_temp is None:
        missing.append("oil_temp_c")
    if load_pct is None:
        missing.append("load_pct")
    if imbalance is None:
        missing.append("phase_imbalance_pct")

    thermal = 50.0 if oil_temp is None else _clamp(100 - max(0, oil_temp - 55) * 2.1)
    loading = 50.0 if load_pct is None else _clamp(100 - max(0, load_pct - 60) * 1.8)
    fault_health = _clamp(100 - faults * 14)
    if maintenance:
        last_maintenance = datetime.fromisoformat(maintenance["performed_at"].replace("Z", "+00:00"))
        maintenance_age_days = max(0, (observed - last_maintenance).days)
    else:
        last_maintenance = None
        maintenance_age_days = None
        missing.append("maintenance_history")
    age_component = _clamp(100 - max(0, asset["age_years"] - 5) * 2.2)
    maintenance_component = 45.0 if maintenance_age_days is None else _clamp(100 - max(0, maintenance_age_days - 365) / 12)
    age_maintenance = (age_component + maintenance_component) / 2
    imbalance_health = 50.0 if imbalance is None else _clamp(100 - max(0, float(imbalance) - 1) * 8)

    dimension_health = {
        "thermal_stress": thermal,
        "loading_stress": loading,
        "fault_history": fault_health,
        "age_and_maintenance": age_maintenance,
        "electrical_imbalance": imbalance_health,
    }
    overall = sum(dimension_health[name] * weight for name, weight in HEALTH_WEIGHTS.items())
    dimensions = {
        name: {
            "health_score": round(score, 2),
            "stress_score": round(100 - score, 2),
            "weight": HEALTH_WEIGHTS[name],
        }
        for name, score in dimension_health.items()
    }
    return {
        "transformer_id": transformer_id,
        "overall_health_index": round(overall, 2),
        "condition": "good" if overall >= 75 else "fair" if overall >= 50 else "poor",
        "dimensions": dimensions,
        "weights": HEALTH_WEIGHTS,
        "input_evidence": {
            "oil_temperature": {"value": oil_temp, "unit": "degC", "provenance": "synthetic_sensor"},
            "load_utilization": {"value": load_pct, "unit": "percent", "provenance": "derived_measurement"},
            "faults_past_3_years": {"value": faults, "unit": "count", "provenance": "synthetic_record"},
            "equipment_age": {"value": asset["age_years"], "unit": "years", "provenance": "synthetic_asset"},
            "last_maintenance": last_maintenance.isoformat() if last_maintenance else None,
            "phase_imbalance": {"value": imbalance, "unit": "percent", "provenance": "synthetic_sensor"},
        },
        "missing_data_flags": missing,
        "explanation": "Weighted condition index from observed thermal, loading, fault, age/maintenance, and imbalance evidence; it is independent of the ML risk score.",
        "calculated_at": utc_now(),
        "health_scoring_version": HEALTH_VERSION,
        "data_source": "synthetic",
    }

