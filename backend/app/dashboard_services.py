from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any

from app.database import database, utc_now
from app.health import calculate_health
from app.services import maintenance_recommendations, predict_transformer, risk_level


RISK_POLICY = {
    "healthy": "model score < 0.35",
    "warning": "0.35 <= model score < 0.65",
    "high_risk": "model score >= 0.65",
}
ALERT_RULES_VERSION = "prototype-alert-rules-v1"


def _latest_asset_rows(conn: Any) -> list[dict]:
    return [
        dict(row)
        for row in conn.execute(
            """SELECT t.*,f.name feeder_name,r.observed_at,r.load_pct,r.oil_temp_c,r.ambient_temp_c,
            r.rainfall_mm,r.apparent_load_kva,r.power_factor,r.voltage_v,r.current_a,r.phase_imbalance_pct,
            r.quality_flag,r.provenance,p.risk_score,p.risk_level,p.generated_at prediction_at
            FROM transformers t JOIN feeders f ON f.id=t.feeder_id
            LEFT JOIN readings r ON r.id=(SELECT id FROM readings WHERE transformer_id=t.id ORDER BY observed_at DESC LIMIT 1)
            LEFT JOIN predictions p ON p.id=(SELECT id FROM predictions WHERE transformer_id=t.id ORDER BY id DESC LIMIT 1)
            ORDER BY t.id"""
        )
    ]


def dashboard_overview() -> dict:
    with database() as conn:
        assets = _latest_asset_rows(conn)
        active = conn.execute("SELECT COUNT(*) FROM incidents WHERE status!='restored'").fetchone()[0]
        affected = conn.execute(
            """SELECT COALESCE(SUM(v.estimated_households),0) FROM villages v
            WHERE v.name IN (SELECT DISTINCT village_name FROM outage_reports o JOIN incidents i ON i.id=o.incident_id WHERE i.status!='restored')"""
        ).fetchone()[0]
        latest_time = max((item["observed_at"] for item in assets if item["observed_at"]), default=None)
        prior_cutoff = None
        previous_utilization = None
        if latest_time:
            latest_dt = datetime.fromisoformat(latest_time.replace("Z", "+00:00"))
            prior_cutoff = (latest_dt - timedelta(hours=24)).isoformat()
            previous_utilization = conn.execute(
                """SELECT AVG(load_pct) FROM readings WHERE observed_at BETWEEN ? AND ?""",
                ((latest_dt - timedelta(hours=25)).isoformat(), prior_cutoff),
            ).fetchone()[0]
    counts = {"healthy": 0, "warning": 0, "high_risk": 0}
    for item in assets:
        level = item["risk_level"] or risk_level(float(item["risk_score"] or 0))
        counts["high_risk" if level == "high" else "healthy" if level == "low" else "warning"] += 1
    total = len(assets)
    average = sum(float(item["load_pct"] or 0) for item in assets) / total if total else 0
    previous = float(previous_utilization) if previous_utilization is not None else average
    return {
        "total_transformers": total,
        "total_feeders": 6,
        "risk_counts": counts,
        "risk_percentages": {key: round(value / total * 100, 2) if total else 0 for key, value in counts.items()},
        "active_incidents": active,
        "estimated_affected_households": int(affected),
        "average_load_utilization": {"value": round(average, 2), "unit": "percent"},
        "previous_period_utilization": {"value": round(previous, 2), "unit": "percent"},
        "utilization_change_pct_points": round(average - previous, 2),
        "risk_policy": RISK_POLICY,
        "last_data_refresh": latest_time,
        "data_source": "synthetic",
        "simulation_status": "live-style seeded data",
    }


def load_temperature_trends(hours: int) -> dict:
    with database() as conn:
        latest = conn.execute("SELECT MAX(observed_at) FROM readings").fetchone()[0]
        if not latest:
            return {"series": [], "data_source": "synthetic"}
        end = datetime.fromisoformat(latest.replace("Z", "+00:00"))
        cutoff = (end - timedelta(hours=hours - 1)).isoformat()
        rows = conn.execute(
            """SELECT observed_at,AVG(load_pct) load_pct,AVG(oil_temp_c) oil_temp_c
            FROM readings WHERE observed_at>=? GROUP BY observed_at ORDER BY observed_at""",
            (cutoff,),
        ).fetchall()
    return {
        "hours": hours,
        "aggregation": "mean_across_transformers_per_hour",
        "series": [
            {
                "timestamp": row["observed_at"],
                "load_utilization": {"value": round(row["load_pct"], 3), "unit": "percent"},
                "oil_temperature": {"value": round(row["oil_temp_c"], 3), "unit": "degC"},
            }
            for row in rows
        ],
        "data_source": "synthetic",
    }


def generate_alerts() -> None:
    now = utc_now()
    with database() as conn:
        assets = _latest_asset_rows(conn)
        rules: list[tuple] = []
        for item in assets:
            if item["risk_score"] is not None and item["risk_score"] >= 0.65:
                rules.append((item, "high_fault_risk", "critical", "ML fault-risk score is high", {"risk_score": item["risk_score"]}))
            if item["load_pct"] is not None and item["load_pct"] > 100:
                rules.append((item, "excessive_load", "critical", "Load utilization exceeds the prototype overload threshold", {"load_pct": item["load_pct"], "threshold_pct": 100}))
            elif item["load_pct"] is not None and item["load_pct"] > 90:
                rules.append((item, "elevated_load", "warning", "Load utilization is elevated", {"load_pct": item["load_pct"], "threshold_pct": 90}))
            if item["oil_temp_c"] is not None and item["oil_temp_c"] > 90:
                rules.append((item, "high_temperature", "critical", "Oil temperature exceeds the prototype critical threshold", {"oil_temp_c": item["oil_temp_c"], "threshold_c": 90}))
            elif item["oil_temp_c"] is not None and item["oil_temp_c"] > 80:
                rules.append((item, "elevated_temperature", "warning", "Oil temperature is elevated", {"oil_temp_c": item["oil_temp_c"], "threshold_c": 80}))
            maintenance = conn.execute(
                "SELECT performed_at FROM maintenance_records WHERE transformer_id=? ORDER BY performed_at DESC LIMIT 1",
                (item["id"],),
            ).fetchone()
            if maintenance:
                age_days = (datetime.now(timezone.utc) - datetime.fromisoformat(maintenance["performed_at"].replace("Z", "+00:00"))).days
                if age_days > 730:
                    rules.append((item, "maintenance_overdue", "warning", "Synthetic maintenance interval exceeds two years", {"days_since_maintenance": age_days}))
        for item, category, severity, explanation, evidence in rules:
            dedupe = f"{item['id']}:{category}"
            existing = conn.execute("SELECT id FROM alerts WHERE dedupe_key=? AND status='open'", (dedupe,)).fetchone()
            if not existing:
                conn.execute(
                    """INSERT INTO alerts(transformer_id,feeder_id,category,severity,explanation,evidence_json,
                    created_at,updated_at,status,dedupe_key) VALUES(?,?,?,?,?,?,?,?,'open',?)""",
                    (item["id"], item["feeder_id"], category, severity, explanation, json.dumps(evidence), now, now, dedupe),
                )


def list_alerts(limit: int = 100, status: str | None = None) -> list[dict]:
    generate_alerts()
    with database() as conn:
        if status:
            rows = conn.execute("SELECT * FROM alerts WHERE status=? ORDER BY created_at DESC LIMIT ?", (status, limit))
        else:
            rows = conn.execute("SELECT * FROM alerts ORDER BY created_at DESC LIMIT ?", (limit,))
        result = []
        for row in rows:
            item = dict(row)
            item["evidence"] = json.loads(item.pop("evidence_json"))
            item["rules_version"] = ALERT_RULES_VERSION
            item["threshold_note"] = "Prototype demonstration thresholds, not universal electrical safety limits."
            result.append(item)
        return result


def network_map(feeder_id: str | None, risk: str | None, outage_only: bool) -> dict:
    with database() as conn:
        assets = _latest_asset_rows(conn)
        outage_assets = {
            row[0]
            for row in conn.execute(
                """SELECT DISTINCT o.transformer_id FROM outage_reports o JOIN incidents i ON i.id=o.incident_id
                WHERE i.status!='restored' AND o.transformer_id IS NOT NULL"""
            )
        }
    features = []
    filtered = []
    for item in assets:
        item_risk = item["risk_level"] or "low"
        is_outage = item["id"] in outage_assets
        if feeder_id and item["feeder_id"] != feeder_id:
            continue
        if risk and item_risk != risk:
            continue
        if outage_only and not is_outage:
            continue
        health = calculate_health(item["id"])
        properties = {
            "transformer_id": item["id"], "transformer_name": item["name"], "village": item["village_name"],
            "feeder_id": item["feeder_id"], "feeder_name": item["feeder_name"], "rated_capacity_kva": item["capacity_kva"],
            "current_utilization_pct": item["load_pct"], "health_index": health["overall_health_index"],
            "fault_risk_score": item["risk_score"], "risk_category": item_risk, "outage_status": is_outage,
            "last_reading_timestamp": item["observed_at"], "data_source": "synthetic",
        }
        features.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [item["longitude"], item["latitude"]]}, "properties": properties})
        filtered.append(item)
    line_features = []
    feeder_ids = sorted({item["feeder_id"] for item in filtered})
    for fid in feeder_ids:
        points = sorted((item for item in filtered if item["feeder_id"] == fid), key=lambda x: x["id"])
        if len(points) >= 2:
            line_features.append({
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": [[p["longitude"], p["latitude"]] for p in points]},
                "properties": {"feeder_id": fid, "topology": "simulated_ordered_connection", "verified_real_world": False},
            })
    return {
        "transformers": {"type": "FeatureCollection", "features": features},
        "feeder_lines": {"type": "FeatureCollection", "features": line_features},
        "geometry_note": "Fictional feeder geometry connects seeded assets in explicit transformer order; it is not a verified real network.",
        "data_source": "synthetic",
    }


def risk_trends(hours: int) -> dict:
    with database() as conn:
        rows = conn.execute(
            """SELECT generated_at,AVG(risk_score) average_risk,
            SUM(CASE WHEN risk_level='high' THEN 1 ELSE 0 END) high_count
            FROM predictions WHERE is_simulation=0 GROUP BY generated_at ORDER BY generated_at DESC LIMIT ?""",
            (hours,),
        ).fetchall()
    return {"series": [dict(row) for row in reversed(rows)], "aggregation": "mean_model_score_by_generation_time", "data_source": "synthetic"}


def feeder_performance() -> list[dict]:
    with database() as conn:
        assets = _latest_asset_rows(conn)
    output = []
    for fid in sorted({item["feeder_id"] for item in assets}):
        group = [item for item in assets if item["feeder_id"] == fid]
        output.append({
            "feeder_id": fid,
            "transformer_count": len(group),
            "average_utilization_pct": round(sum(item["load_pct"] for item in group) / len(group), 3),
            "average_risk_score": round(sum(item["risk_score"] for item in group) / len(group), 6),
            "high_risk_count": sum(item["risk_level"] == "high" for item in group),
            "data_source": "synthetic",
        })
    return output

