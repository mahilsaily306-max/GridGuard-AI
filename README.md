# GridGuard AI

Smart-grid prediction and field-operations platform — FastAPI backend + React/Vite frontend.

## Overview

GridGuard AI is a full-stack application for monitoring rural power distribution transformers. It covers the full complaint-to-repair workflow: outage report → dispatch → diagnosis → repair → verification.

- **Backend**: FastAPI + SQLAlchemy 2 + raw SQLite, running on `http://127.0.0.1:8000`
- **Frontend**: React 19 + Vite 7 + TypeScript + Tailwind 3, running on `http://127.0.0.1:5173`
- **24 synthetic transformers** (T-101..T-124) across **6 feeders** (F-01..F-06)
- ML risk prediction (Random Forest), health scoring, GeoJSON network topology, work orders, alerts, and audit trail

## Directory Layout

```
GridGuard-AI/
├── backend/                 # FastAPI backend (Python)
│   ├── app/                 # Application source
│   ├── .venv/               # Python virtual environment
│   ├── run.py               # Uvicorn entry point
│   ├── requirements.txt     # Python dependencies
│   └── README.md            # Backend-specific docs
├── frontend/                # React frontend
│   ├── src/                 # React source
│   ├── node_modules/        # Installed (pnpm)
│   ├── package.json         # npm scripts (npm is broken; use node directly)
│   └── vitest.config.ts     # Vitest config (jsdom)
├── start-backend.bat        # Windows batch: start backend
├── start-backend.ps1        # Windows PowerShell: start backend
├── start-frontend.bat       # Windows batch: start frontend
├── start-frontend.ps1       # Windows PowerShell: start frontend
└── README.md                # This file
```

## Quick Start (Windows)

### Option 1: Startup scripts (recommended)

Open two terminals. In terminal 1:

```powershell
.\start-backend.ps1
```

In terminal 2:

```powershell
.\start-frontend.ps1
```

Then open **http://127.0.0.1:5173** in your browser.

### Option 2: Manual steps

**Backend:**
```powershell
cd backend
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python -m alembic upgrade head
.venv\Scripts\python -m app.ml.train
.venv\Scripts\python run.py
```

**Frontend** (npm is broken — use Node directly):
```powershell
cd frontend
node node_modules\.bin\vite --host 127.0.0.1
```

## Demo Accounts

| Role | Username | Password |
|------|----------|----------|
| Operator | `operator` | `Operator@123` |
| Lineman | `lineman1` | `Lineman@123` |
| Supervisor | `supervisor` | `Supervisor@123` |
| Admin | `admin` | `Admin@123` |

## Testing

### Backend tests
```powershell
cd backend
.venv\Scripts\python -m pytest
```

### Frontend tests (Vitest 4)
npm is broken; invoke Vitest via Node directly:

```powershell
cd frontend
node node_modules\vitest\vitest.mjs run
```

All 14 frontend tests pass (3 test files).

## API

Base URL: `http://127.0.0.1:8000`

Interactive docs: `http://127.0.0.1:8000/docs`

Major route groups:
- **Auth**: `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`
- **Dashboard**: `/api/dashboard/overview`, `/risk-distribution`, `/load-temperature-trends`, `/recent-alerts`, `/activity`
- **Network**: `/api/network/map`, `/api/feeders`, `/api/feeders/{id}`
- **Transformers**: metadata, readings, history, fault history, maintenance, `/health`
- **ML**: `/api/ml/train`, `/api/ml/metrics`, `/api/ml/model-info`, predictions
- **Operations**: alerts, incidents/restoration, work orders, maintenance recommendations
- **Analytics**: load-temperature, risk trends, feeder performance, per-transformer analytics

## Known Issues / Notes

- **npm is broken** (v11.19.1 vs Node v24.22.1 mismatch). Use `node node_modules/.bin/vite` for the dev server and `node node_modules/vitest/vitest.mjs run` for tests.
- Frontend vitest must be invoked via `node node_modules/vitest/vitest.mjs run` (not `npx vitest` or `npm test`).
- The frontend proxies `/api` to `http://127.0.0.1:8000`, so the backend must be running for the frontend to load data.
- All transformer telemetry, weather, faults, and ETAs are synthetic/simulated.

## Backlog

See `IMPLEMENTATION_GAP_MATRIX.md` for the full gap audit and remaining feature work.
