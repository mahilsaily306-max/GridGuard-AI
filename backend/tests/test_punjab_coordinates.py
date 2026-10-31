"""Punjab transformer relocation tests.

Verifies that all seeded transformer and village coordinates are relocated
from central India to Punjab state, that every point lies inside the Punjab
boundary polygon, and that feeder/village relationships are preserved.
"""
from __future__ import annotations

from app.ml.synthetic import network_assets

# Simplified Punjab boundary polygon (lon/lat), same as migration 0005.
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


def _point_in_polygon(lon: float, lat: float, ring: list[list[float]]) -> bool:
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > lat) != (yj > lat):
            x_intersect = (xj - xi) * (lat - yi) / (yj - yi) + xi
            if lon < x_intersect:
                inside = not inside
        j = i
    return inside


def test_network_assets_are_all_in_punjab():
    assets = network_assets()
    assert len(assets) == 24
    # 6 feeders, 4 transformers each.
    assert len({a.feeder_id for a in assets}) == 6
    assert all(sum(1 for a in assets if a.feeder_id == f"F-{i:02d}") == 4 for i in range(1, 7))
    # Transformer IDs T-101..T-124.
    assert [a.transformer_id for a in assets] == [f"T-{101 + i}" for i in range(24)]
    # Every point inside the Punjab polygon.
    for asset in assets:
        assert _point_in_polygon(asset.longitude, asset.latitude, PUNJAB_POLYGON), (
            f"{asset.transformer_id} at ({asset.latitude}, {asset.longitude}) is outside Punjab"
        )
    # All latitudes within Punjab band (29.4 to 32.3 N).
    assert all(29.4 <= a.latitude <= 32.3 for a in assets)
    # All longitudes within Punjab band (73.9 to 76.8 E).
    assert all(73.9 <= a.longitude <= 76.8 for a in assets)


def test_network_assets_preserve_feeder_village_mapping():
    assets = network_assets()
    by_feeder: dict[str, list] = {}
    for asset in assets:
        by_feeder.setdefault(asset.feeder_id, []).append(asset)
    # Feeder F-01 has T-101..T-104 with Demo Village A..D, etc.
    for feeder_number in range(1, 7):
        fid = f"F-{feeder_number:02d}"
        group = sorted(by_feeder[fid], key=lambda a: a.transformer_id)
        expected_ids = [f"T-{100 + (feeder_number - 1) * 4 + j}" for j in range(1, 5)]
        assert [a.transformer_id for a in group] == expected_ids
        expected_villages = [f"Demo Village {chr(64 + (feeder_number - 1) * 4 + j)}" for j in range(1, 5)]
        assert [a.village_name for a in group] == expected_villages
