"""Add normalized audit provenance and filter fields.

Revision ID: 0004
Revises: 0003
"""
from alembic import op


revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


ADDITIONS = {
    "event_id": "TEXT",
    "actor_role": "TEXT",
    "module": "TEXT",
    "resource": "TEXT",
    "result": "TEXT NOT NULL DEFAULT 'SUCCESS'",
    "origin": "TEXT NOT NULL DEFAULT 'REAL'",
    "details_json": "TEXT",
    "seed_key": "TEXT",
}


def upgrade() -> None:
    connection = op.get_bind().connection
    existing = {row[1] for row in connection.execute("PRAGMA table_info(audit_logs)")}
    for name, definition in ADDITIONS.items():
        if name not in existing:
            connection.execute(f"ALTER TABLE audit_logs ADD COLUMN {name} {definition}")
    connection.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_audit_event_id ON audit_logs(event_id)")
    connection.execute("CREATE UNIQUE INDEX IF NOT EXISTS ux_audit_seed_key ON audit_logs(seed_key)")
    connection.execute("CREATE INDEX IF NOT EXISTS ix_audit_filters ON audit_logs(origin,module,actor_role,created_at DESC)")
    connection.execute("UPDATE audit_logs SET event_id='EVT-REAL-' || printf('%06d', id) WHERE event_id IS NULL")
    connection.execute("UPDATE audit_logs SET actor_role=COALESCE((SELECT role FROM users WHERE users.id=audit_logs.actor_user_id),'public') WHERE actor_role IS NULL")
    connection.execute("UPDATE audit_logs SET module=replace(entity_type,'_',' ') WHERE module IS NULL")
    connection.execute("UPDATE audit_logs SET resource=entity_type || ':' || entity_id WHERE resource IS NULL")
    connection.execute("UPDATE audit_logs SET result='SUCCESS' WHERE result IS NULL")
    connection.execute("UPDATE audit_logs SET origin='REAL' WHERE origin IS NULL")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_audit_filters")
    op.execute("DROP INDEX IF EXISTS ux_audit_seed_key")
    op.execute("DROP INDEX IF EXISTS ux_audit_event_id")
