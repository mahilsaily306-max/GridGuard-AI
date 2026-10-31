"""Add seeded reference-guidance knowledge records.

Revision ID: 0003
Revises: 0002
"""
from alembic import op


revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


KNOWLEDGE_SCHEMA = """
CREATE TABLE IF NOT EXISTS knowledge_entries (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    category TEXT NOT NULL,
    simple_explanation TEXT NOT NULL,
    warning_signs_json TEXT NOT NULL DEFAULT '[]',
    possible_causes_json TEXT NOT NULL DEFAULT '[]',
    relevant_measurements_json TEXT NOT NULL DEFAULT '[]',
    safe_inspection_considerations_json TEXT NOT NULL DEFAULT '[]',
    preventive_recommendations_json TEXT NOT NULL DEFAULT '[]',
    source_classification TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_knowledge_category ON knowledge_entries(category,title);
"""


def upgrade() -> None:
    op.get_bind().connection.executescript(KNOWLEDGE_SCHEMA)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS knowledge_entries")
