from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


BACKEND_DIR = Path(__file__).resolve().parents[1]


@dataclass(frozen=True)
class Settings:
    database_path: Path
    artifact_dir: Path
    random_seed: int = 20261030
    model_version: str = "rf-synthetic-v1"
    outage_group_minutes: int = 20
    duplicate_window_minutes: int = 10
    cors_origins: tuple[str, ...] = ("http://localhost:5173", "http://127.0.0.1:5173")

    @classmethod
    def from_env(cls) -> "Settings":
        origins = tuple(
            item.strip()
            for item in os.getenv(
                "GRIDGUARD_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
            ).split(",")
            if item.strip()
        )
        return cls(
            database_path=Path(os.getenv("GRIDGUARD_DB_PATH", BACKEND_DIR / "data" / "gridguard.db")),
            artifact_dir=Path(os.getenv("GRIDGUARD_ARTIFACT_DIR", BACKEND_DIR / "artifacts")),
            cors_origins=origins,
        )


settings = Settings.from_env()

