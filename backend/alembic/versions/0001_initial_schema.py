"""Initial GridGuard relational schema.

Revision ID: 0001
"""
from alembic import op

from app.database import SCHEMA

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind().connection
    connection.executescript(SCHEMA)


def downgrade() -> None:
    for table in (
        "model_metadata", "maintenance_work_orders", "alerts", "maintenance_records",
        "weather_observations", "maintenance_tasks", "incident_status_history", "outage_reports",
        "incidents", "simulation_state", "predictions", "fault_history", "readings",
        "transformers", "villages", "feeders",
    ):
        op.execute(f"DROP TABLE IF EXISTS {table}")
