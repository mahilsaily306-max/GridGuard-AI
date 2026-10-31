"""Relocate seeded transformer and village coordinates to Punjab state.

Revision ID: 0005
Revises: 0004
"""
from alembic import op


revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

# Simplified Punjab state boundary polygon (GeoJSON lon/lat order).
# Approximates the state outline: SW 73.9/29.4, SE 76.8/29.4, NE 76.8/32.3,
# N 75.3/32.3, NW 73.9/30.5, closing back to SW.
PUNJAB_POLYGON = [
    [73.9, 29.4],
    [76.8, 29.4],
    [76.8, 32.3],
    [75.3, 32.3],
    [75.0, 32.0],
    [74.2, 31.2],
    [73.9, 30.5],
    [73.9, 29.4],
]

# Base coordinates for central Punjab (near Ludhiana), then fanned out per feeder.
PUNJAB_BASE_LAT = 30.9000
PUNJAB_BASE_LON = 75.8500


def _point_in_polygon(lon: float, lat: float, ring: list[list[float]]) -> bool:
    """Ray-casting point-in-polygon test. Ring is in [lon, lat] order."""
    inside = False
    n = len(ring)
    j = n - 1
    for i in range(n):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > lat) != (yj > lat):
            x_intersect = (xj - xi) * (lat - yi) / (yj - yi) + xi
            if lon < x_intersect:
                inside = not inside
        j = i
    return inside


def _punjab_coordinates(index: int) -> tuple[float, float]:
    """Deterministic Punjab coordinates for transformer index 0..23.

    Four transformers per feeder (F-01..F-06), fanned out so every point
    lands inside the Punjab boundary polygon.
    """
    feeder_number = index // 4 + 1
    within = index % 4
    lat = round(
        PUNJAB_BASE_LAT + (feeder_number - 3.5) * 0.025 + within * 0.006,
        6,
    )
    lon = round(
        PUNJAB_BASE_LON + (feeder_number - 3.5) * 0.03 - within * 0.004,
        6,
    )
    if not _point_in_polygon(lon, lat, PUNJAB_POLYGON):
        raise ValueError(
            f"Computed Punjab coordinate ({lat}, {lon}) for index {index} "
            f"falls outside the Punjab boundary polygon"
        )
    return lat, lon


def upgrade() -> None:
    connection = op.get_bind().connection

    # Idempotent: if a relocation backup already exists, this migration has run.
    already = connection.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='transformer_location_backup'"
    ).fetchone()
    if already is not None:
        return

    # 1. Back up current coordinates before any persistent data change.
    connection.execute(
        """CREATE TABLE transformer_location_backup (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transformer_id TEXT NOT NULL,
            old_latitude REAL NOT NULL,
            old_longitude REAL NOT NULL,
            village_name TEXT NOT NULL,
            feeder_id TEXT NOT NULL,
            relocated_at TEXT NOT NULL
        )"""
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS ix_location_backup_transformer ON transformer_location_backup(transformer_id)"
    )

    # Capture current coordinates for every transformer.
    current_rows = connection.execute(
        "SELECT id, latitude, longitude, village_name, feeder_id FROM transformers ORDER BY id"
    ).fetchall()

    from datetime import datetime, timezone
    relocated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    for row in current_rows:
        connection.execute(
            """INSERT INTO transformer_location_backup
            (transformer_id, old_latitude, old_longitude, village_name, feeder_id, relocated_at)
            VALUES(?,?,?,?,?,?)""",
            (row["id"], row["latitude"], row["longitude"], row["village_name"], row["feeder_id"], relocated_at),
        )

    # 2. Compute new Punjab coordinates for all seeded transformers (T-101..T-124),
    #    preserving feeder_id and village_name relationships.
    updates: list[tuple[float, float, str]] = []
    for index in range(24):
        transformer_id = f"T-{101 + index}"
        lat, lon = _punjab_coordinates(index)
        updates.append((lat, lon, transformer_id))

    # 3. Validate every new point sits inside the Punjab boundary polygon.
    for lat, lon, _transformer_id in updates:
        if not _point_in_polygon(lon, lat, PUNJAB_POLYGON):
            raise ValueError(f"Punjab relocation point ({lat}, {lon}) is outside the Punjab polygon")

    # 4. Update transformer latitude/longitude (all relationships preserved).
    for lat, lon, transformer_id in updates:
        connection.execute(
            "UPDATE transformers SET latitude=?, longitude=? WHERE id=?",
            (lat, lon, transformer_id),
        )

    # 5. Update matching village coordinates (villages share transformer lat/lon at seed time).
    villages = connection.execute(
        "SELECT name, latitude, longitude FROM villages ORDER BY id"
    ).fetchall()
    village_by_name = {row["name"]: row for row in villages}
    for index in range(24):
        village_name = f"Demo Village {chr(65 + index)}"
        lat, lon = _punjab_coordinates(index)
        if village_name in village_by_name:
            connection.execute(
                "UPDATE villages SET latitude=?, longitude=? WHERE name=?",
                (lat, lon, village_name),
            )

    # 6. Update outage_reports latitude/longitude where they match a relocated transformer.
    for lat, lon, transformer_id in updates:
        connection.execute(
            "UPDATE outage_reports SET latitude=?, longitude=? WHERE transformer_id=? AND (latitude IS NULL OR longitude IS NULL OR latitude != ? OR longitude != ?)",
            (lat, lon, transformer_id, lat, lon),
        )


def downgrade() -> None:
    connection = op.get_bind().connection
    backup = connection.execute(
        "SELECT transformer_id, old_latitude, old_longitude FROM transformer_location_backup"
    ).fetchall()
    for row in backup:
        connection.execute(
            "UPDATE transformers SET latitude=?, longitude=? WHERE id=?",
            (row["old_latitude"], row["old_longitude"], row["transformer_id"]),
        )
    connection.execute("DROP TABLE IF EXISTS transformer_location_backup")
