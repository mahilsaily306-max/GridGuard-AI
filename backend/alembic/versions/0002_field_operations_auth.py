"""Add authentication and field-operations workflow.

Revision ID: 0002
Revises: 0001
"""
from alembic import op

from app.database import SCHEMA

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.get_bind().connection.executescript(SCHEMA)


def downgrade() -> None:
    for table in (
        "presentation_telemetry",
        "replay_events",
        "simulation_scenarios",
        "audit_logs",
        "notifications",
        "verified_faults",
        "supervisor_decisions",
        "evidence_files",
        "repair_reports",
        "inspection_findings",
        "diagnostic_recommendations",
        "work_order_transitions",
        "field_work_orders",
        "complaints",
        "lineman_profiles",
        "service_zones",
        "auth_sessions",
        "users",
    ):
        op.execute(f"DROP TABLE IF EXISTS {table}")
