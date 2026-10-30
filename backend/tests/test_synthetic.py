from __future__ import annotations

from app.ml.synthetic import FEATURE_COLUMNS, generate_dataset, network_assets


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

