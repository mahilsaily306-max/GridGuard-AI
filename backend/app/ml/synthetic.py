from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

import numpy as np
import pandas as pd


GENERATOR_VERSION = "synthetic-grid-v1"
FEATURE_COLUMNS = [
    "load_pct",
    "oil_temp_c",
    "ambient_temp_c",
    "rainfall_mm",
    "age_years",
    "faults_last_90d",
    "overload_hours_24h",
    "load_avg_24h",
    "temp_change_6h",
    "hour_sin",
    "hour_cos",
]


@dataclass(frozen=True)
class NetworkAsset:
    transformer_id: str
    feeder_id: str
    village_name: str
    latitude: float
    longitude: float
    capacity_kva: float
    age_years: int


def network_assets(seed: int = 20261030) -> list[NetworkAsset]:
    rng = np.random.default_rng(seed)
    capacities = [100.0, 160.0, 200.0, 250.0]
    assets: list[NetworkAsset] = []
    base_lat, base_lon = 30.9000, 75.8500
    for index in range(24):
        feeder_number = index // 4 + 1
        within = index % 4
        assets.append(
            NetworkAsset(
                transformer_id=f"T-{101 + index}",
                feeder_id=f"F-{feeder_number:02d}",
                village_name=f"Demo Village {chr(65 + index)}",
                latitude=round(base_lat + (feeder_number - 3.5) * 0.025 + within * 0.006, 6),
                longitude=round(base_lon + (feeder_number - 3.5) * 0.03 - within * 0.004, 6),
                capacity_kva=capacities[index % len(capacities)],
                age_years=int(rng.integers(3, 29)),
            )
        )
    return assets


def generate_dataset(
    seed: int = 20261030,
    days: int = 120,
    end_at: datetime | None = None,
) -> pd.DataFrame:
    """Generate reproducible hourly histories and a future-24h synthetic target.

    The event at each hour is sampled from a latent condition-dependent process.
    Rolling features use current/past rows only; the future window is used solely
    to form the label.
    """
    rng = np.random.default_rng(seed)
    end = pd.Timestamp(end_at or datetime(2026, 10, 30, tzinfo=timezone.utc)).floor("h")
    timestamps = pd.date_range(end=end, periods=days * 24, freq="h", tz="UTC")
    frames: list[pd.DataFrame] = []

    for asset_index, asset in enumerate(network_assets(seed)):
        n = len(timestamps)
        hours = timestamps.hour.to_numpy()
        day_index = np.arange(n) / 24.0
        seasonal = 4.5 * np.sin(2 * np.pi * day_index / 90 + asset_index / 7)
        ambient = 29 + seasonal + 5 * np.sin(2 * np.pi * (hours - 14) / 24) + rng.normal(0, 1.8, n)
        rain_shock = rng.random(n) < (0.035 + 0.015 * (np.sin(day_index / 10) + 1))
        rainfall = np.where(rain_shock, rng.gamma(2.2, 7.0, n), 0.0)

        vulnerability = 0.8 + asset.age_years / 38 + rng.uniform(-0.15, 0.15)
        demand_cycle = 18 * np.sin(2 * np.pi * (hours - 18) / 24) + 10 * np.sin(4 * np.pi * (hours - 18) / 24)
        trend = 3 * np.sin(2 * np.pi * day_index / 14 + asset_index)
        load = 68 + demand_cycle + trend + (ambient - 29) * 1.1 + rng.normal(0, 5, n)
        anomaly_starts = rng.random(n) < 0.003
        anomaly = np.convolve(anomaly_starts.astype(float), np.array([22, 18, 13, 8, 4]), mode="same")
        load = np.clip(load + anomaly + (vulnerability - 1) * 5, 15, 145)
        oil_temp = ambient + 18 + 0.43 * load + 5 * np.maximum(load - 100, 0) / 20 + rng.normal(0, 2.2, n)

        latent = (
            -6.0
            + 0.055 * np.maximum(load - 82, 0)
            + 0.045 * np.maximum(oil_temp - 75, 0)
            + 0.015 * np.minimum(rainfall, 40)
            + 0.045 * asset.age_years
            + 0.45 * (vulnerability - 1)
        )
        hourly_fault_probability = np.clip(1 / (1 + np.exp(-latent)), 0.0004, 0.16)
        fault_event = (rng.random(n) < hourly_fault_probability).astype(int)

        frame = pd.DataFrame(
            {
                "transformer_id": asset.transformer_id,
                "timestamp": timestamps,
                "load_pct": load,
                "oil_temp_c": oil_temp,
                "ambient_temp_c": ambient,
                "rainfall_mm": rainfall,
                "age_years": asset.age_years,
                "fault_event": fault_event,
            }
        )
        prior_faults = frame["fault_event"].shift(1, fill_value=0)
        frame["faults_last_90d"] = prior_faults.rolling(90 * 24, min_periods=1).sum()
        frame["overload_hours_24h"] = (frame["load_pct"] > 100).shift(1, fill_value=False).rolling(24, min_periods=1).sum()
        frame["load_avg_24h"] = frame["load_pct"].shift(1).rolling(24, min_periods=1).mean().fillna(frame["load_pct"])
        frame["temp_change_6h"] = (frame["oil_temp_c"] - frame["oil_temp_c"].shift(6)).fillna(0)
        frame["hour_sin"] = np.sin(2 * np.pi * hours / 24)
        frame["hour_cos"] = np.cos(2 * np.pi * hours / 24)
        future_fault = pd.concat([frame["fault_event"].shift(-offset) for offset in range(1, 25)], axis=1).max(axis=1)
        frame["fault_next_24h"] = future_fault
        frames.append(frame.iloc[24:-24].copy())

    result = pd.concat(frames, ignore_index=True)
    numeric = [*FEATURE_COLUMNS, "fault_next_24h", "fault_event"]
    result[numeric] = result[numeric].apply(pd.to_numeric)
    return result

