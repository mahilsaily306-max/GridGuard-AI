from __future__ import annotations

import json
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.inspection import permutation_importance
from sklearn.metrics import average_precision_score, confusion_matrix, precision_recall_fscore_support

from app.config import settings
from app.ml.synthetic import FEATURE_COLUMNS, GENERATOR_VERSION, generate_dataset


def _metrics(y_true: pd.Series, y_pred: np.ndarray, scores: np.ndarray) -> dict:
    precision, recall, f1, _ = precision_recall_fscore_support(
        y_true, y_pred, average="binary", zero_division=0
    )
    return {
        "precision": round(float(precision), 6),
        "recall": round(float(recall), 6),
        "f1": round(float(f1), 6),
        "pr_auc": round(float(average_precision_score(y_true, scores)), 6),
        "confusion_matrix": confusion_matrix(y_true, y_pred, labels=[0, 1]).tolist(),
    }


def train_and_evaluate(artifact_dir: Path | None = None, force: bool = False) -> dict:
    output_dir = artifact_dir or settings.artifact_dir
    model_path = output_dir / "fault_risk_model.joblib"
    metrics_path = output_dir / "metrics.json"
    dataset_path = output_dir / "synthetic_training_data.csv"
    if not force and model_path.exists() and metrics_path.exists() and dataset_path.exists():
        return json.loads(metrics_path.read_text(encoding="utf-8"))

    output_dir.mkdir(parents=True, exist_ok=True)
    data = generate_dataset(settings.random_seed)
    test_start = data["timestamp"].max() - pd.Timedelta(days=21)
    gap_start = test_start - pd.Timedelta(hours=24)
    train = data[data["timestamp"] < gap_start].copy()
    test = data[data["timestamp"] >= test_start].copy()

    model = RandomForestClassifier(
        n_estimators=160,
        max_depth=14,
        min_samples_leaf=4,
        class_weight="balanced_subsample",
        random_state=settings.random_seed,
        n_jobs=-1,
    )
    model.fit(train[FEATURE_COLUMNS], train["fault_next_24h"])
    scores = model.predict_proba(test[FEATURE_COLUMNS])[:, 1]
    predictions = (scores >= 0.5).astype(int)

    baseline_scores = (
        (test["load_pct"] > 100)
        | (test["oil_temp_c"] > 90)
        | (test["overload_hours_24h"] >= 4)
    ).astype(int)
    baseline_predictions = baseline_scores.to_numpy()

    sample_size = min(5000, len(test))
    sample = test.sample(sample_size, random_state=settings.random_seed)
    importance = permutation_importance(
        model,
        sample[FEATURE_COLUMNS],
        sample["fault_next_24h"],
        scoring="average_precision",
        n_repeats=3,
        random_state=settings.random_seed,
        n_jobs=-1,
    )
    feature_importance = sorted(
        [
            {"feature": feature, "importance": round(float(value), 6)}
            for feature, value in zip(FEATURE_COLUMNS, importance.importances_mean, strict=True)
        ],
        key=lambda item: item["importance"],
        reverse=True,
    )
    metrics = {
        "model_version": settings.model_version,
        "model_type": "RandomForestClassifier",
        "generator_version": GENERATOR_VERSION,
        "data_source": "synthetic",
        "evaluation_note": "Held-out later chronological block with a 24-hour gap; synthetic performance is not field accuracy.",
        "split": {
            "strategy": "chronological_with_24h_gap",
            "train_rows": int(len(train)),
            "test_rows": int(len(test)),
            "train_end": train["timestamp"].max().isoformat(),
            "test_start": test["timestamp"].min().isoformat(),
        },
        "class_balance": {
            "train_positive_rate": round(float(train["fault_next_24h"].mean()), 6),
            "test_positive_rate": round(float(test["fault_next_24h"].mean()), 6),
        },
        "random_forest": _metrics(test["fault_next_24h"], predictions, scores),
        "threshold_baseline": _metrics(
            test["fault_next_24h"], baseline_predictions, baseline_scores.to_numpy(dtype=float)
        ),
        "permutation_importance_held_out": feature_importance,
        "feature_order": FEATURE_COLUMNS,
    }
    joblib.dump({"model": model, "feature_order": FEATURE_COLUMNS, "model_version": settings.model_version}, model_path)
    metrics_path.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    data.to_csv(dataset_path, index=False)
    return metrics


if __name__ == "__main__":
    print(json.dumps(train_and_evaluate(force=True), indent=2))

