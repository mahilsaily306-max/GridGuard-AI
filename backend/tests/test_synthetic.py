from __future__ import annotations

from app.ml.synthetic import FEATURE_COLUMNS, generate_dataset, network_assets

PUNJAB_LAT_MIN, PUNJAB_LAT_MAX = 29.4, 32.3
PUNJAB_LON_MIN, PUNJAB_LON_MAX = 73.9, 76.8


def test_network_and_dataset_are_reproducible():
    assets = network_assets()
    assert len(assets) == 24
    assert len({asset.feeder_id for asset in assets}) == 6
    assert all(sum(item.feeder_id == asset.feeder_id for item in assets) == 4 for asset in assets)

    first = generate_dataset(days=10)
    second = generate_dataset(days=10)
    assert first.shape == second.shape
    assert first.iloc[0][FEATURE_COLUMNS].equals(second.iloc[0][FEATURE_COLUMNS])
    assert set(first["fault_next_24h"].unique()).issubset({0, 1})


def test_network_assets_are_relocated_to_punjab():
    assets = network_assets()
    assert len(assets) == 24
    # Every transformer now sits inside Punjab state bounds.
    for asset in assets:
        assert PUNJAB_LAT_MIN <= asset.latitude <= PUNJAB_LAT_MAX, (
            f"{asset.transformer_id} latitude {asset.latitude} outside Punjab band"
        )
        assert PUNJAB_LON_MIN <= asset.longitude <= PUNJAB_LON_MAX, (
            f"{asset.transformer_id} longitude {asset.longitude} outside Punjab band"
        )
    # 6 feeders, 4 transformers each, T-101..T-124 preserved.
    assert sorted(a.transformer_id for a in assets) == [f"T-{101 + i}" for i in range(24)]
    assert all(sum(1 for a in assets if a.feeder_id == f"F-{i:02d}") == 4 for i in range(1, 7))

