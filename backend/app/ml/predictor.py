from __future__ import annotations

import json
from pathlib import Path

import joblib
import pandas as pd

from app.config import settings


class ModelUnavailableError(RuntimeError):
    pass


class Predictor:
    def __init__(self, artifact_dir: Path | None = None) -> None:
        self.artifact_dir = artifact_dir or settings.artifact_dir
        self.model = None
        self.feature_order: list[str] = []
        self.model_version = "unavailable"

    def load(self) -> None:
        path = self.artifact_dir / "fault_risk_model.joblib"
        if not path.exists():
            raise ModelUnavailableError(f"Model artifact not found: {path}")
        bundle = joblib.load(path)
        self.model = bundle["model"]
        self.feature_order = bundle["feature_order"]
        self.model_version = bundle["model_version"]

    @property
    def loaded(self) -> bool:
        return self.model is not None

    def predict(self, features: dict[str, float]) -> float:
        if not self.loaded:
            raise ModelUnavailableError("Model is not loaded")
        frame = pd.DataFrame([[features[name] for name in self.feature_order]], columns=self.feature_order)
        return float(self.model.predict_proba(frame)[0, 1])

    def metrics(self) -> dict:
        path = self.artifact_dir / "metrics.json"
        if not path.exists():
            raise ModelUnavailableError("Evaluation metrics are not available")
        return json.loads(path.read_text(encoding="utf-8"))


predictor = Predictor()
