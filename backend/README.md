# GridGuard AI Backend

Backend-only local prototype for 24 fictional transformers across 6 fictional feeders. It provides trained scikit-learn inference, SQLite monitoring history, SQLAlchemy 2 relational models and Alembic migrations, simulated outage-report grouping, incident restoration tracking, transparent health scoring, alert management, preventive-maintenance ranking, analytics, GeoJSON topology, and conservative load-balancing advisories.

All transformer telemetry, weather, faults, outage reports, and ETAs are synthetic or simulated. Model scores are not calibrated field probabilities. Fault localization is suspected only, and load-balancing advice requires qualified engineering review.

## Setup and run

```powershell
cd D:\Claude\Codex\Projects\GridGuard-AI\backend
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python -m alembic upgrade head
.\.venv\Scripts\python -m app.ml.train
.\.venv\Scripts\python run.py
```

The first server start also trains the model and initializes the database if artifacts do not exist. OpenAPI documentation is available at `http://127.0.0.1:8000/docs`.

## Tests

```powershell
.\.venv\Scripts\python -m pytest
```

## Configuration

- `GRIDGUARD_DB_PATH`: optional SQLite database path.
- `GRIDGUARD_ARTIFACT_DIR`: optional model/metrics/data artifact directory.

Generated artifacts are local synthetic data and are intentionally labeled as such.

## Dashboard API groups

- Dashboard: `/api/dashboard/overview`, `/risk-distribution`, `/load-temperature-trends`, `/recent-alerts`, `/activity`.
- Network: `/api/network/map`, `/api/feeders`, `/api/feeders/{id}` and feeder transformers.
- Transformer intelligence: metadata, readings, history, fault history, maintenance history, and `/health`.
- ML: `/api/ml/train`, `/api/ml/metrics`, `/api/ml/model-info`, predictions and inference.
- Simulation: legacy stateful demo simulation plus non-mutating `/api/simulations/transformer-risk`.
- Operations: alerts, protected simulated outage reports, incidents/restoration, maintenance recommendations, and work orders.
- Analytics: load-temperature, risk trends, feeder performance, and per-transformer analytics.

The complete interactive contract is generated at `/docs`.

## Scoring policies

ML risk categories use `low < 0.35`, `warning 0.35–0.65`, and `high >= 0.65`. These are prototype operational bands, not universal safety limits. The independent 0–100 health index weights thermal condition 30%, loading 25%, fault history 20%, age/maintenance 15%, and electrical imbalance 10%. Missing evidence receives a neutral/uncertain score and is returned in `missing_data_flags`; it is not silently treated as healthy.

## Migration commands

```powershell
.\.venv\Scripts\python -m alembic current
.\.venv\Scripts\python -m alembic upgrade head
```
