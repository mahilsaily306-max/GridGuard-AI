from __future__ import annotations

import os
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient


TEST_ROOT = Path(tempfile.mkdtemp(prefix="gridguard-tests-"))
os.environ["GRIDGUARD_DB_PATH"] = str(TEST_ROOT / "gridguard-test.db")
os.environ["GRIDGUARD_ARTIFACT_DIR"] = str(TEST_ROOT / "artifacts")

from app.database import database  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(scope="session")
def client() -> TestClient:
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture(autouse=True)
def clean_mutable_state(client: TestClient):
    with database() as conn:
        conn.execute("DELETE FROM verified_faults")
        conn.execute("DELETE FROM supervisor_decisions")
        conn.execute("DELETE FROM evidence_files")
        conn.execute("DELETE FROM repair_reports")
        conn.execute("DELETE FROM inspection_findings")
        conn.execute("DELETE FROM diagnostic_recommendations")
        conn.execute("DELETE FROM work_order_transitions")
        conn.execute("DELETE FROM complaints")
        conn.execute("DELETE FROM field_work_orders")
        conn.execute("DELETE FROM notifications")
        conn.execute("DELETE FROM simulation_scenarios")
        conn.execute("DELETE FROM audit_logs")
        conn.execute("DELETE FROM auth_sessions")
        conn.execute("DELETE FROM maintenance_work_orders")
        conn.execute("DELETE FROM alerts")
        conn.execute("DELETE FROM outage_reports")
        conn.execute("DELETE FROM incident_status_history")
        conn.execute("DELETE FROM incidents")
        conn.execute("DELETE FROM simulation_state")
    yield

