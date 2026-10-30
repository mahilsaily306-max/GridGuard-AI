from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterator

from app.config import settings


SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS feeders (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    nominal_capacity_kw REAL NOT NULL CHECK(nominal_capacity_kw > 0),
    status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS villages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    estimated_households INTEGER NOT NULL CHECK(estimated_households >= 0),
    data_source TEXT NOT NULL DEFAULT 'synthetic'
);
CREATE TABLE IF NOT EXISTS transformers (
    id TEXT PRIMARY KEY,
    feeder_id TEXT NOT NULL REFERENCES feeders(id),
    village_name TEXT NOT NULL UNIQUE,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    capacity_kva REAL NOT NULL CHECK(capacity_kva > 0),
    age_years INTEGER NOT NULL CHECK(age_years >= 0),
    installation_year INTEGER,
    village_id INTEGER REFERENCES villages(id),
    name TEXT,
    status TEXT NOT NULL DEFAULT 'operational'
);
CREATE INDEX IF NOT EXISTS ix_transformers_feeder ON transformers(feeder_id);
CREATE TABLE IF NOT EXISTS readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transformer_id TEXT NOT NULL REFERENCES transformers(id),
    observed_at TEXT NOT NULL,
    load_pct REAL NOT NULL,
    oil_temp_c REAL NOT NULL,
    ambient_temp_c REAL NOT NULL,
    rainfall_mm REAL NOT NULL CHECK(rainfall_mm >= 0),
    apparent_load_kva REAL,
    power_factor REAL,
    voltage_v REAL,
    current_a REAL,
    phase_imbalance_pct REAL,
    quality_flag TEXT NOT NULL DEFAULT 'good',
    provenance TEXT NOT NULL DEFAULT 'synthetic_sensor',
    UNIQUE(transformer_id, observed_at)
);
CREATE INDEX IF NOT EXISTS ix_readings_asset_time ON readings(transformer_id, observed_at DESC);
CREATE TABLE IF NOT EXISTS fault_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transformer_id TEXT NOT NULL REFERENCES transformers(id),
    fault_at TEXT NOT NULL,
    category TEXT NOT NULL,
    duration_min INTEGER NOT NULL CHECK(duration_min > 0)
);
CREATE TABLE IF NOT EXISTS predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transformer_id TEXT NOT NULL REFERENCES transformers(id),
    generated_at TEXT NOT NULL,
    horizon_hours INTEGER NOT NULL DEFAULT 24,
    risk_score REAL NOT NULL CHECK(risk_score BETWEEN 0 AND 1),
    risk_level TEXT NOT NULL,
    model_version TEXT NOT NULL,
    is_simulation INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_predictions_asset_time ON predictions(transformer_id, generated_at DESC);
CREATE TABLE IF NOT EXISTS simulation_state (
    transformer_id TEXT PRIMARY KEY REFERENCES transformers(id),
    load_pct REAL NOT NULL,
    oil_temp_c REAL NOT NULL,
    ambient_temp_c REAL NOT NULL,
    rainfall_mm REAL NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS outage_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transformer_id TEXT REFERENCES transformers(id),
    village_name TEXT NOT NULL,
    channel TEXT NOT NULL CHECK(channel IN ('sms','missed_call')),
    message TEXT,
    received_at TEXT NOT NULL,
    caller_hash TEXT,
    incident_id INTEGER REFERENCES incidents(id),
    duplicate_count INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_reports_time ON outage_reports(received_at DESC);
CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feeder_id TEXT NOT NULL REFERENCES feeders(id),
    suspected_transformer_id TEXT REFERENCES transformers(id),
    scope TEXT NOT NULL CHECK(scope IN ('transformer','feeder')),
    opened_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('reported','assigned','repairing','restored')),
    restored_at TEXT,
    eta_note TEXT,
    report_count INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS ix_incidents_status ON incidents(status, opened_at DESC);
CREATE TABLE IF NOT EXISTS incident_status_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_id INTEGER NOT NULL REFERENCES incidents(id),
    status TEXT NOT NULL,
    changed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS maintenance_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transformer_id TEXT NOT NULL REFERENCES transformers(id),
    priority TEXT NOT NULL,
    action TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'recommended',
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS weather_observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    feeder_id TEXT NOT NULL REFERENCES feeders(id),
    observed_at TEXT NOT NULL,
    ambient_temp_c REAL,
    rainfall_mm REAL,
    humidity_pct REAL,
    quality_flag TEXT NOT NULL DEFAULT 'good',
    provenance TEXT NOT NULL DEFAULT 'synthetic_weather',
    UNIQUE(feeder_id, observed_at)
);
CREATE TABLE IF NOT EXISTS maintenance_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transformer_id TEXT NOT NULL REFERENCES transformers(id),
    performed_at TEXT NOT NULL,
    maintenance_type TEXT NOT NULL,
    notes TEXT,
    provenance TEXT NOT NULL DEFAULT 'synthetic_record'
);
CREATE INDEX IF NOT EXISTS ix_maintenance_asset_time ON maintenance_records(transformer_id, performed_at DESC);
CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transformer_id TEXT REFERENCES transformers(id),
    feeder_id TEXT REFERENCES feeders(id),
    category TEXT NOT NULL,
    severity TEXT NOT NULL CHECK(severity IN ('info','warning','critical')),
    explanation TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','resolved')),
    acknowledged_by TEXT,
    acknowledged_at TEXT,
    dedupe_key TEXT NOT NULL,
    occurrence_count INTEGER NOT NULL DEFAULT 1,
    UNIQUE(dedupe_key, status)
);
CREATE INDEX IF NOT EXISTS ix_alerts_status_time ON alerts(status, created_at DESC);
CREATE TABLE IF NOT EXISTS maintenance_work_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transformer_id TEXT NOT NULL REFERENCES transformers(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    priority TEXT NOT NULL CHECK(priority IN ('routine','medium','high','urgent')),
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','scheduled','in_progress','completed','cancelled')),
    assigned_to TEXT,
    scheduled_for TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);
CREATE TABLE IF NOT EXISTS model_metadata (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    model_version TEXT NOT NULL UNIQUE,
    model_type TEXT NOT NULL,
    trained_at TEXT NOT NULL,
    feature_order_json TEXT NOT NULL,
    metrics_json TEXT NOT NULL,
    data_source TEXT NOT NULL DEFAULT 'synthetic'
);
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('administrator','operator','lineman','supervisor','public')),
    password_hash TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'en',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS service_zones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    feeder_id TEXT NOT NULL UNIQUE REFERENCES feeders(id)
);
CREATE TABLE IF NOT EXISTS lineman_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id),
    employee_code TEXT NOT NULL UNIQUE,
    service_zone_id INTEGER NOT NULL REFERENCES service_zones(id),
    supervisor_user_id INTEGER REFERENCES users(id),
    available INTEGER NOT NULL DEFAULT 1,
    skills_json TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS complaints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT NOT NULL UNIQUE,
    outage_report_id INTEGER REFERENCES outage_reports(id),
    incident_id INTEGER REFERENCES incidents(id),
    village_name TEXT NOT NULL,
    transformer_id TEXT REFERENCES transformers(id),
    category TEXT NOT NULL,
    severity TEXT NOT NULL CHECK(severity IN ('low','medium','high','emergency')),
    landmark TEXT,
    duration_minutes INTEGER,
    affected_area TEXT,
    hazard_flags_json TEXT NOT NULL DEFAULT '[]',
    language TEXT NOT NULL DEFAULT 'en',
    details TEXT,
    status TEXT NOT NULL DEFAULT 'received',
    caller_hash TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_complaints_incident ON complaints(incident_id, created_at DESC);
CREATE TABLE IF NOT EXISTS field_work_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT NOT NULL UNIQUE,
    incident_id INTEGER NOT NULL UNIQUE REFERENCES incidents(id),
    transformer_id TEXT REFERENCES transformers(id),
    service_zone_id INTEGER NOT NULL REFERENCES service_zones(id),
    assigned_lineman_id INTEGER REFERENCES users(id),
    supervisor_user_id INTEGER REFERENCES users(id),
    priority TEXT NOT NULL CHECK(priority IN ('low','medium','high','emergency')),
    status TEXT NOT NULL CHECK(status IN ('assigned','accepted','en_route','arrived','investigating','repairing','awaiting_verification','rework_required','resolved','closed')),
    safety_acknowledged_at TEXT,
    hazards_json TEXT NOT NULL DEFAULT '[]',
    stop_work INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT
);
CREATE INDEX IF NOT EXISTS ix_field_work_orders_assignee ON field_work_orders(assigned_lineman_id,status,updated_at DESC);
CREATE TABLE IF NOT EXISTS work_order_transitions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_order_id INTEGER NOT NULL REFERENCES field_work_orders(id),
    from_status TEXT,
    to_status TEXT NOT NULL,
    actor_user_id INTEGER NOT NULL REFERENCES users(id),
    notes TEXT,
    changed_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS diagnostic_recommendations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_order_id INTEGER NOT NULL REFERENCES field_work_orders(id),
    rank INTEGER NOT NULL,
    fault_category TEXT NOT NULL,
    score REAL NOT NULL,
    supporting_evidence_json TEXT NOT NULL,
    explanation TEXT NOT NULL,
    inspection_status TEXT NOT NULL DEFAULT 'pending',
    UNIQUE(work_order_id, rank)
);
CREATE TABLE IF NOT EXISTS inspection_findings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_order_id INTEGER NOT NULL REFERENCES field_work_orders(id),
    recommendation_id INTEGER REFERENCES diagnostic_recommendations(id),
    status TEXT NOT NULL CHECK(status IN ('pending','investigated','suspected','ruled_out','confirmed')),
    fault_category TEXT,
    observations TEXT NOT NULL,
    suspected_root_cause TEXT,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS repair_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_order_id INTEGER NOT NULL UNIQUE REFERENCES field_work_orders(id),
    fault_cause TEXT NOT NULL,
    repair_notes TEXT NOT NULL,
    materials_used TEXT,
    restoration_observations TEXT,
    remaining_issues TEXT,
    submitted_by INTEGER NOT NULL REFERENCES users(id),
    submitted_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS evidence_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_order_id INTEGER NOT NULL REFERENCES field_work_orders(id),
    repair_report_id INTEGER REFERENCES repair_reports(id),
    evidence_type TEXT NOT NULL CHECK(evidence_type IN ('before_photo','after_photo','document')),
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL UNIQUE,
    content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    uploaded_by INTEGER NOT NULL REFERENCES users(id),
    uploaded_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS supervisor_decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    work_order_id INTEGER NOT NULL REFERENCES field_work_orders(id),
    decision TEXT NOT NULL CHECK(decision IN ('approved','rejected','rework','more_information')),
    notes TEXT,
    supervisor_user_id INTEGER NOT NULL REFERENCES users(id),
    decided_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS verified_faults (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    transformer_id TEXT NOT NULL REFERENCES transformers(id),
    work_order_id INTEGER NOT NULL UNIQUE REFERENCES field_work_orders(id),
    fault_category TEXT NOT NULL,
    symptoms TEXT,
    verified_root_cause TEXT NOT NULL,
    inspection_findings TEXT,
    repair_action TEXT NOT NULL,
    supervisor_decision_id INTEGER NOT NULL REFERENCES supervisor_decisions(id),
    verified_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    read_at TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_notifications_user ON notifications(user_id,read_at,created_at DESC);
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id INTEGER REFERENCES users(id),
    actor_label TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    before_json TEXT,
    after_json TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_audit_entity ON audit_logs(entity_type,entity_id,created_at DESC);
CREATE TABLE IF NOT EXISTS simulation_scenarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    transformer_id TEXT NOT NULL REFERENCES transformers(id),
    inputs_json TEXT NOT NULL,
    result_json TEXT NOT NULL,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS replay_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_id INTEGER REFERENCES incidents(id),
    scenario_key TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    event_time TEXT NOT NULL,
    event_type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    payload_json TEXT NOT NULL DEFAULT '{}',
    UNIQUE(scenario_key, sequence)
);
CREATE TABLE IF NOT EXISTS presentation_telemetry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scenario_key TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    display_time TEXT NOT NULL,
    day_offset INTEGER NOT NULL DEFAULT 0,
    voltage_v REAL NOT NULL,
    current_a REAL NOT NULL,
    oil_temperature_c REAL NOT NULL,
    status TEXT NOT NULL,
    risk_level TEXT NOT NULL,
    UNIQUE(scenario_key, sequence)
);
"""


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def connect(path: Path | None = None) -> sqlite3.Connection:
    db_path = path or settings.database_path
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def database(path: Path | None = None) -> Iterator[sqlite3.Connection]:
    conn = connect(path)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def initialize_database() -> None:
    with database() as conn:
        conn.executescript(SCHEMA)
        columns = {
            "transformers": {
                "installation_year": "INTEGER",
                "village_id": "INTEGER REFERENCES villages(id)",
                "name": "TEXT",
            },
            "readings": {
                "apparent_load_kva": "REAL",
                "power_factor": "REAL",
                "voltage_v": "REAL",
                "current_a": "REAL",
                "phase_imbalance_pct": "REAL",
                "quality_flag": "TEXT NOT NULL DEFAULT 'good'",
                "provenance": "TEXT NOT NULL DEFAULT 'synthetic_sensor'",
            },
            "incidents": {
                "assigned_crew": "TEXT",
                "restoration_notes": "TEXT",
                "estimated_households": "INTEGER NOT NULL DEFAULT 0",
                "confidence_score": "REAL NOT NULL DEFAULT 0.5",
                "localization_explanation": "TEXT",
            },
            "outage_reports": {
                "latitude": "REAL",
                "longitude": "REAL",
                "report_status": "TEXT NOT NULL DEFAULT 'received'",
            },
        }
        for table, additions in columns.items():
            existing = {row[1] for row in conn.execute(f"PRAGMA table_info({table})")}
            for name, definition in additions.items():
                if name not in existing:
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")

