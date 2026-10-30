from __future__ import annotations

import hashlib
import math
from datetime import datetime, timedelta, timezone
from typing import Any

import pandas as pd

from app.config import settings
from app.database import database, utc_now
from app.ml.predictor import predictor
from app.ml.synthetic import network_assets


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def risk_level(score: float) -> str:
    if score >= 0.65:
        return "high"
    if score >= 0.35:
        return "warning"
    return "low"


def top_factors(features: dict[str, float]) -> list[str]:
    factors: list[str] = []
    if features["load_pct"] > 100:
        factors.append("Current load exceeds rated operating level")
    elif features["load_pct"] > 85:
        factors.append("Current load is elevated")
    if features["oil_temp_c"] > 90:
        factors.append("Oil temperature is critically elevated")
    elif features["oil_temp_c"] > 75:
        factors.append("Oil temperature is elevated")
    if features["overload_hours_24h"] >= 4:
        factors.append("Repeated overload in the past 24 hours")
    if features["faults_last_90d"] >= 2:
        factors.append("Multiple simulated faults in the past 90 days")
    if features["rainfall_mm"] > 20:
        factors.append("Heavy simulated rainfall exposure")
    if features["age_years"] >= 20:
        factors.append("Older equipment age")
    return factors[:4] or ["No individual operating threshold is currently elevated"]


def seed_database(training_data: pd.DataFrame) -> None:
    assets = network_assets(settings.random_seed)
    with database() as conn:
        if conn.execute("SELECT COUNT(*) FROM transformers").fetchone()[0] == 24:
            _enrich_seed(conn, training_data, assets)
            return
        for feeder_number in range(1, 7):
            conn.execute(
                "INSERT OR IGNORE INTO feeders(id,name,nominal_capacity_kw,status) VALUES(?,?,?,?)",
                (f"F-{feeder_number:02d}", f"Rural Feeder {feeder_number:02d}", 720.0, "active"),
            )
        for asset in assets:
            conn.execute(
                """INSERT OR IGNORE INTO transformers
                (id,feeder_id,village_name,latitude,longitude,capacity_kva,age_years,status)
                VALUES(?,?,?,?,?,?,?,?)""",
                (
                    asset.transformer_id,
                    asset.feeder_id,
                    asset.village_name,
                    asset.latitude,
                    asset.longitude,
                    asset.capacity_kva,
                    asset.age_years,
                    "operational",
                ),
            )

        recent_cutoff = training_data["timestamp"].max() - pd.Timedelta(days=7)
        recent = training_data[training_data["timestamp"] >= recent_cutoff]
        reading_rows = [
            (
                row.transformer_id,
                pd.Timestamp(row.timestamp).isoformat(),
                float(row.load_pct),
                float(row.oil_temp_c),
                float(row.ambient_temp_c),
                float(row.rainfall_mm),
            )
            for row in recent.itertuples()
        ]
        conn.executemany(
            """INSERT OR IGNORE INTO readings
            (transformer_id,observed_at,load_pct,oil_temp_c,ambient_temp_c,rainfall_mm)
            VALUES(?,?,?,?,?,?)""",
            reading_rows,
        )
        fault_rows = [
            (
                row.transformer_id,
                pd.Timestamp(row.timestamp).isoformat(),
                "synthetic_overstress_event",
                30
                + (
                    int(
                        hashlib.sha256(
                            f"{row.transformer_id}|{row.timestamp}".encode("utf-8")
                        ).hexdigest()[:8],
                        16,
                    )
                    % 150
                ),
            )
            for row in training_data[training_data["fault_event"] == 1].itertuples()
        ]
        conn.executemany(
            "INSERT INTO fault_history(transformer_id,fault_at,category,duration_min) VALUES(?,?,?,?)",
            fault_rows,
        )
        _enrich_seed(conn, training_data, assets)


def _enrich_seed(conn: Any, training_data: pd.DataFrame, assets: list[Any]) -> None:
    latest_timestamp = pd.Timestamp(training_data["timestamp"].max()).to_pydatetime()
    for index, asset in enumerate(assets):
        households = 75 + (index * 17) % 140
        conn.execute(
            """INSERT OR IGNORE INTO villages(name,latitude,longitude,estimated_households,data_source)
            VALUES(?,?,?,?, 'synthetic')""",
            (asset.village_name, asset.latitude, asset.longitude, households),
        )
        village_id = conn.execute("SELECT id FROM villages WHERE name=?", (asset.village_name,)).fetchone()[0]
        conn.execute(
            "UPDATE transformers SET village_id=?,installation_year=?,name=? WHERE id=?",
            (village_id, latest_timestamp.year - asset.age_years, f"Distribution Transformer {asset.transformer_id}", asset.transformer_id),
        )
        if conn.execute(
            "SELECT 1 FROM maintenance_records WHERE transformer_id=?", (asset.transformer_id,)
        ).fetchone() is None:
            performed = latest_timestamp - timedelta(days=180 + (index * 47) % 900)
            conn.execute(
                """INSERT INTO maintenance_records
                (transformer_id,performed_at,maintenance_type,notes,provenance) VALUES(?,?,?,?,?)""",
                (
                    asset.transformer_id,
                    _iso(performed.replace(tzinfo=timezone.utc) if performed.tzinfo is None else performed),
                    "preventive_inspection",
                    "Synthetic historical inspection record",
                    "synthetic_record",
                ),
            )

    rows = conn.execute(
        """SELECT r.id,r.transformer_id,r.observed_at,r.load_pct,t.capacity_kva
        FROM readings r JOIN transformers t ON t.id=r.transformer_id
        WHERE r.apparent_load_kva IS NULL"""
    ).fetchall()
    for row in rows:
        apparent = float(row["capacity_kva"]) * float(row["load_pct"]) / 100
        sequence = int(row["transformer_id"].split("-")[1])
        voltage = 415 + ((sequence + row["id"]) % 9 - 4) * 0.8
        power_factor = 0.88 + ((sequence + row["id"]) % 9) / 100
        current = apparent * 1000 / (math.sqrt(3) * voltage)
        imbalance = max(0.4, min(12.0, 1.2 + max(0, float(row["load_pct"]) - 70) * 0.055 + sequence % 4 * 0.35))
        conn.execute(
            """UPDATE readings SET apparent_load_kva=?,power_factor=?,voltage_v=?,current_a=?,
            phase_imbalance_pct=?,quality_flag='good',provenance='synthetic_sensor' WHERE id=?""",
            (apparent, power_factor, voltage, current, imbalance, row["id"]),
        )

    weather_exists = conn.execute("SELECT 1 FROM weather_observations LIMIT 1").fetchone()
    if weather_exists is None:
        weather_rows = conn.execute(
            """SELECT t.feeder_id,r.observed_at,AVG(r.ambient_temp_c) ambient,AVG(r.rainfall_mm) rainfall
            FROM readings r JOIN transformers t ON t.id=r.transformer_id
            GROUP BY t.feeder_id,r.observed_at"""
        ).fetchall()
        conn.executemany(
            """INSERT OR IGNORE INTO weather_observations
            (feeder_id,observed_at,ambient_temp_c,rainfall_mm,humidity_pct,quality_flag,provenance)
            VALUES(?,?,?,?,?,'good','synthetic_weather')""",
            [
                (row["feeder_id"], row["observed_at"], row["ambient"], row["rainfall"], 55 + min(35, row["rainfall"] * 1.5))
                for row in weather_rows
            ],
        )


def transformer_or_none(conn: Any, transformer_id: str) -> Any:
    return conn.execute("SELECT * FROM transformers WHERE id=?", (transformer_id,)).fetchone()


def features_for_transformer(transformer_id: str, overrides: dict[str, float] | None = None) -> dict[str, float]:
    with database() as conn:
        asset = transformer_or_none(conn, transformer_id)
        if asset is None:
            raise KeyError(transformer_id)
        rows = conn.execute(
            "SELECT * FROM readings WHERE transformer_id=? ORDER BY observed_at DESC LIMIT 2161",
            (transformer_id,),
        ).fetchall()
        if not rows:
            raise RuntimeError(f"No readings available for {transformer_id}")
        latest = dict(rows[0])
        simulation = conn.execute(
            "SELECT * FROM simulation_state WHERE transformer_id=?", (transformer_id,)
        ).fetchone()
        if simulation:
            latest.update(dict(simulation))
        if overrides:
            latest.update(overrides)

        last_24 = rows[:24]
        load_avg = sum(float(row["load_pct"]) for row in last_24) / len(last_24)
        overload_hours = sum(float(row["load_pct"]) > 100 for row in last_24)
        temp_six_hours_ago = float(rows[min(6, len(rows) - 1)]["oil_temp_c"])
        latest_time = datetime.fromisoformat(str(rows[0]["observed_at"]).replace("Z", "+00:00"))
        faults_cutoff = _iso(latest_time - timedelta(days=90))
        fault_count = conn.execute(
            "SELECT COUNT(*) FROM fault_history WHERE transformer_id=? AND fault_at>=? AND fault_at<?",
            (transformer_id, faults_cutoff, str(rows[0]["observed_at"])),
        ).fetchone()[0]
        hour = latest_time.hour
        return {
            "load_pct": float(latest["load_pct"]),
            "oil_temp_c": float(latest["oil_temp_c"]),
            "ambient_temp_c": float(latest["ambient_temp_c"]),
            "rainfall_mm": float(latest["rainfall_mm"]),
            "age_years": float(asset["age_years"]),
            "faults_last_90d": float(fault_count),
            "overload_hours_24h": float(overload_hours),
            "load_avg_24h": float(load_avg),
            "temp_change_6h": float(latest["oil_temp_c"]) - temp_six_hours_ago,
            "hour_sin": math.sin(2 * math.pi * hour / 24),
            "hour_cos": math.cos(2 * math.pi * hour / 24),
        }


def predict_transformer(
    transformer_id: str,
    overrides: dict[str, float] | None = None,
    persist: bool = True,
    is_simulation: bool = False,
) -> dict:
    features = features_for_transformer(transformer_id, overrides)
    score = predictor.predict(features)
    level = risk_level(score)
    generated_at = utc_now()
    if persist:
        with database() as conn:
            conn.execute(
                """INSERT INTO predictions
                (transformer_id,generated_at,horizon_hours,risk_score,risk_level,model_version,is_simulation)
                VALUES(?,?,?,?,?,?,?)""",
                (transformer_id, generated_at, 24, score, level, predictor.model_version, int(is_simulation)),
            )
    return {
        "transformer_id": transformer_id,
        "generated_at": generated_at,
        "horizon_hours": 24,
        "risk_score": round(score, 6),
        "risk_level": level,
        "top_factors": top_factors(features),
        "explanation_method": "Non-causal threshold evidence from current inputs; global held-out permutation importance is available in model metrics.",
        "features": {key: round(value, 4) for key, value in features.items()},
        "data_source": "synthetic",
        "model_type": "random_forest",
        "model_version": predictor.model_version,
        "simulation": is_simulation,
        "score_note": "Model score from synthetic training data; not a calibrated field probability.",
    }


def ensure_current_predictions() -> None:
    with database() as conn:
        ids = [row[0] for row in conn.execute("SELECT id FROM transformers ORDER BY id")]
    for transformer_id in ids:
        with database() as conn:
            exists = conn.execute(
                "SELECT 1 FROM predictions WHERE transformer_id=? LIMIT 1", (transformer_id,)
            ).fetchone()
        if not exists:
            predict_transformer(transformer_id)


def simulate(transformer_id: str, values: dict[str, float]) -> dict:
    result = predict_transformer(transformer_id, values, persist=True, is_simulation=True)
    with database() as conn:
        conn.execute(
            """INSERT INTO simulation_state
            (transformer_id,load_pct,oil_temp_c,ambient_temp_c,rainfall_mm,updated_at)
            VALUES(?,?,?,?,?,?)
            ON CONFLICT(transformer_id) DO UPDATE SET
            load_pct=excluded.load_pct,oil_temp_c=excluded.oil_temp_c,
            ambient_temp_c=excluded.ambient_temp_c,rainfall_mm=excluded.rainfall_mm,
            updated_at=excluded.updated_at""",
            (
                transformer_id,
                values["load_pct"],
                values["oil_temp_c"],
                values["ambient_temp_c"],
                values["rainfall_mm"],
                utc_now(),
            ),
        )
    return result


def reset_simulation(transformer_id: str) -> dict:
    with database() as conn:
        if transformer_or_none(conn, transformer_id) is None:
            raise KeyError(transformer_id)
        conn.execute("DELETE FROM simulation_state WHERE transformer_id=?", (transformer_id,))
    return predict_transformer(transformer_id, persist=True, is_simulation=False)


def create_outage_report(payload: dict) -> tuple[dict, bool]:
    received = payload.get("received_at") or datetime.now(timezone.utc)
    received_at = _iso(received)
    with database() as conn:
        asset = None
        if payload.get("transformer_id"):
            asset = transformer_or_none(conn, payload["transformer_id"])
            if asset is None:
                raise KeyError(payload["transformer_id"])
            if payload["village_name"].casefold() != asset["village_name"].casefold():
                raise ValueError("village_name does not match transformer_id")
        else:
            asset = conn.execute(
                "SELECT * FROM transformers WHERE lower(village_name)=lower(?)",
                (payload["village_name"],),
            ).fetchone()
            if asset is None:
                raise ValueError("village_name is not in the simulated service area")
        if payload.get("feeder_id") and payload["feeder_id"] != asset["feeder_id"]:
            raise ValueError("feeder_id does not match the resolved transformer topology")

        caller_hash = None
        if payload.get("caller_id"):
            caller_hash = hashlib.sha256(payload["caller_id"].encode("utf-8")).hexdigest()
            duplicate_cutoff = _iso(received - timedelta(minutes=settings.duplicate_window_minutes))
            duplicate = conn.execute(
                """SELECT * FROM outage_reports
                WHERE caller_hash=? AND lower(village_name)=lower(?)
                AND received_at BETWEEN ? AND ? ORDER BY received_at DESC LIMIT 1""",
                (caller_hash, asset["village_name"], duplicate_cutoff, received_at),
            ).fetchone()
            if duplicate:
                conn.execute(
                    "UPDATE outage_reports SET duplicate_count=duplicate_count+1 WHERE id=?",
                    (duplicate["id"],),
                )
                result = dict(duplicate)
                result["duplicate_count"] += 1
                result["deduplicated"] = True
                result["data_source"] = "simulated_telecom"
                result["caller_protected"] = bool(result.pop("caller_hash", None))
                return result, True

        group_cutoff = _iso(received - timedelta(minutes=settings.outage_group_minutes))
        incident = conn.execute(
            """SELECT * FROM incidents WHERE feeder_id=? AND status!='restored'
            AND opened_at BETWEEN ? AND ? ORDER BY opened_at DESC LIMIT 1""",
            (asset["feeder_id"], group_cutoff, received_at),
        ).fetchone()
        now = utc_now()
        if incident is None:
            cursor = conn.execute(
                """INSERT INTO incidents
                (feeder_id,suspected_transformer_id,scope,opened_at,updated_at,status,eta_note,report_count,
                estimated_households,confidence_score,localization_explanation)
                VALUES(?,?,?,?,?,'reported',?,1,?,?,?)""",
                (
                    asset["feeder_id"],
                    asset["id"],
                    "transformer",
                    received_at,
                    now,
                    "Illustrative ETA pending operator assessment",
                    conn.execute("SELECT estimated_households FROM villages WHERE name=?", (asset["village_name"],)).fetchone()[0],
                    0.7,
                    "One specific transformer report; transformer-level suspicion requires operator verification.",
                ),
            )
            incident_id = cursor.lastrowid
            conn.execute(
                "INSERT INTO incident_status_history(incident_id,status,changed_at) VALUES(?,'reported',?)",
                (incident_id, now),
            )
        else:
            incident_id = incident["id"]
            different_asset = incident["suspected_transformer_id"] != asset["id"]
            conn.execute(
                """UPDATE incidents SET report_count=report_count+1,updated_at=?,
                scope=?,suspected_transformer_id=?,confidence_score=?,localization_explanation=? WHERE id=?""",
                (
                    now,
                    "feeder" if different_asset or incident["scope"] == "feeder" else "transformer",
                    None if different_asset or incident["scope"] == "feeder" else asset["id"],
                    0.82 if different_asset or incident["scope"] == "feeder" else 0.72,
                    "Reports span multiple downstream transformers on one feeder; shared feeder fault is suspected."
                    if different_asset or incident["scope"] == "feeder"
                    else "Multiple reports map to one transformer service area.",
                    incident_id,
                ),
            )
        cursor = conn.execute(
            """INSERT INTO outage_reports
            (transformer_id,village_name,channel,message,received_at,caller_hash,incident_id,latitude,longitude,report_status)
            VALUES(?,?,?,?,?,?,?,?,?,'received')""",
            (
                asset["id"],
                asset["village_name"],
                payload["channel"],
                payload.get("message"),
                received_at,
                caller_hash,
                incident_id,
                payload.get("latitude"),
                payload.get("longitude"),
            ),
        )
        conn.execute(
            """UPDATE incidents SET estimated_households=(
            SELECT COALESCE(SUM(v.estimated_households),0) FROM villages v
            WHERE v.name IN (SELECT DISTINCT village_name FROM outage_reports WHERE incident_id=?))
            WHERE id=?""",
            (incident_id, incident_id),
        )
        alert_key = f"incident:{incident_id}:outage_reported"
        existing_alert = conn.execute("SELECT id FROM alerts WHERE dedupe_key=? AND status='open'", (alert_key,)).fetchone()
        if existing_alert:
            conn.execute("UPDATE alerts SET occurrence_count=occurrence_count+1,updated_at=? WHERE id=?", (now, existing_alert["id"]))
        else:
            conn.execute(
                """INSERT INTO alerts(transformer_id,feeder_id,category,severity,explanation,evidence_json,
                created_at,updated_at,status,dedupe_key) VALUES(?,?,?,?,?,?,?,?,'open',?)""",
                (asset["id"], asset["feeder_id"], "outage_reported", "warning", "Simulated consumer outage report received", '{"source":"simulated_telecom"}', now, now, alert_key),
            )
        report = dict(conn.execute("SELECT * FROM outage_reports WHERE id=?", (cursor.lastrowid,)).fetchone())
        report["caller_protected"] = bool(report.pop("caller_hash", None))
        report.update({"deduplicated": False, "data_source": "simulated_telecom"})
        return report, False


VALID_TRANSITIONS = {
    "reported": {"assigned"},
    "assigned": {"repairing"},
    "repairing": {"restored"},
    "restored": set(),
}


def update_incident(
    incident_id: int,
    status: str,
    eta_note: str | None,
    assigned_crew: str | None = None,
    restoration_notes: str | None = None,
) -> dict:
    with database() as conn:
        incident = conn.execute("SELECT * FROM incidents WHERE id=?", (incident_id,)).fetchone()
        if incident is None:
            raise KeyError(incident_id)
        current = incident["status"]
        if status != current and status not in VALID_TRANSITIONS[current]:
            raise ValueError(f"Invalid transition from {current} to {status}")
        now = utc_now()
        restored_at = now if status == "restored" else incident["restored_at"]
        conn.execute(
            """UPDATE incidents SET status=?,updated_at=?,restored_at=?,eta_note=COALESCE(?,eta_note),
            assigned_crew=COALESCE(?,assigned_crew),restoration_notes=COALESCE(?,restoration_notes) WHERE id=?""",
            (status, now, restored_at, eta_note, assigned_crew, restoration_notes, incident_id),
        )
        if status != current:
            conn.execute(
                "INSERT INTO incident_status_history(incident_id,status,changed_at) VALUES(?,?,?)",
                (incident_id, status, now),
            )
        return incident_detail(conn, incident_id)


def incident_detail(conn: Any, incident_id: int) -> dict:
    row = conn.execute("SELECT * FROM incidents WHERE id=?", (incident_id,)).fetchone()
    result = dict(row)
    result["reports"] = []
    for item in conn.execute(
        "SELECT * FROM outage_reports WHERE incident_id=? ORDER BY received_at", (incident_id,)
    ):
        report = dict(item)
        report["caller_protected"] = bool(report.pop("caller_hash", None))
        result["reports"].append(report)
    result["status_history"] = [
        dict(item)
        for item in conn.execute(
            "SELECT status,changed_at FROM incident_status_history WHERE incident_id=? ORDER BY changed_at",
            (incident_id,),
        )
    ]
    result["localization_label"] = "suspected"
    result["data_source"] = "simulated_telecom"
    result["affected_villages"] = sorted({report["village_name"] for report in result["reports"]})
    result["eta_is_simulated"] = True
    return result


def load_balancing_advisory(transformer_id: str, current_load_pct: float) -> dict | None:
    with database() as conn:
        source = transformer_or_none(conn, transformer_id)
        candidates = conn.execute(
            "SELECT * FROM transformers WHERE feeder_id=? AND id!=? ORDER BY id",
            (source["feeder_id"], transformer_id),
        ).fetchall()
    excess_kva = max(0.0, (current_load_pct - 85) / 100 * source["capacity_kva"])
    if excess_kva <= 0:
        return None
    ranked = []
    for candidate in candidates:
        features = features_for_transformer(candidate["id"])
        safe_headroom = max(0.0, (80 - features["load_pct"]) / 100 * candidate["capacity_kva"])
        if safe_headroom > 0:
            ranked.append((safe_headroom, candidate, features["load_pct"]))
    if not ranked:
        return None
    headroom, target, target_load = max(ranked, key=lambda item: item[0])
    transfer = min(excess_kva, headroom)
    if transfer < 5:
        return None
    return {
        "from_transformer_id": transformer_id,
        "to_transformer_id": target["id"],
        "shared_feeder_id": source["feeder_id"],
        "suggested_transfer_kva": round(transfer, 2),
        "target_current_load_pct": round(target_load, 2),
        "target_safe_headroom_kva": round(headroom, 2),
        "advisory_only": True,
        "safety_note": "Planning suggestion requiring qualified engineering verification; no switching instruction or power-flow validation.",
    }


def maintenance_recommendations() -> list[dict]:
    from app.health import calculate_health

    with database() as conn:
        assets = [dict(row) for row in conn.execute("SELECT * FROM transformers ORDER BY id")]
    recommendations = []
    for asset in assets:
        prediction = predict_transformer(asset["id"], persist=False)
        health = calculate_health(asset["id"])
        features = prediction["features"]
        actions = []
        if features["oil_temp_c"] > 80:
            actions.append("Inspect cooling system, oil level, and thermal connections")
        if features["load_pct"] > 90:
            actions.append("Review recent demand profile and overload exposure")
        if features["faults_last_90d"] > 0:
            actions.append("Review simulated recent fault history and protection records")
        if asset["age_years"] >= 20:
            actions.append("Schedule age-condition inspection and insulation testing")
        actions = actions or ["Continue routine condition monitoring"]
        priority_score = prediction["risk_score"] * 0.8 + min(asset["age_years"] / 30, 1) * 0.2
        recommendations.append(
            {
                "transformer_id": asset["id"],
                "feeder_id": asset["feeder_id"],
                "village_name": asset["village_name"],
                "priority_score": round(priority_score, 6),
                "priority": "urgent" if priority_score >= 0.7 else "high" if priority_score >= 0.5 else "routine",
                "model_risk_score": prediction["risk_score"],
                "health_index": health["overall_health_index"],
                "actions": actions,
                "reason": "; ".join(prediction["top_factors"]),
                "recommended_inspection": actions[0],
                "suggested_timeframe": "within 24 hours" if priority_score >= 0.7 else "within 7 days" if priority_score >= 0.5 else "within 30 days",
                "evidence": prediction["top_factors"],
                "load_balancing_advisory": load_balancing_advisory(asset["id"], features["load_pct"]),
                "work_order_status": "not_created",
                "data_source": "synthetic",
            }
        )
    ranked = sorted(recommendations, key=lambda item: item["priority_score"], reverse=True)
    for rank, item in enumerate(ranked, start=1):
        item["priority_rank"] = rank
    return ranked

