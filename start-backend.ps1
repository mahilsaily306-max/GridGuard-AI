# GridGuard AI - Backend Startup Script (PowerShell)
# Starts the FastAPI backend on http://127.0.0.1:8000

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$backendDir = Join-Path $scriptDir "backend"
$venvPy = Join-Path $backendDir ".venv\Scripts\python.exe"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host " GridGuard AI - Backend Startup" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $venvPy)) {
    Write-Host "[ERROR] Python virtual environment not found at $venvPy" -ForegroundColor Red
    Write-Host "       Please set up the backend first:" -ForegroundColor Yellow
    Write-Host "       cd $backendDir" -ForegroundColor Yellow
    Write-Host "       python -m venv .venv" -ForegroundColor Yellow
    Write-Host "       .venv\Scripts\pip install -r requirements.txt" -ForegroundColor Yellow
    Write-Host "       .venv\Scripts\python -m alembic upgrade head" -ForegroundColor Yellow
    Write-Host "       .venv\Scripts\python -m app.ml.train" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "[1/4] Activating virtual environment..." -ForegroundColor Green
Set-Location $backendDir

Write-Host "[2/4] Running database migrations (alembic upgrade head)..." -ForegroundColor Green
& $venvPy -m alembic upgrade head
if ($LASTEXITCODE -ne 0) {
    Write-Host "[ERROR] Alembic migration failed." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "[3/4] Training ML model (if artifacts missing)..." -ForegroundColor Green
& $venvPy -m app.ml.train
if ($LASTEXITCODE -ne 0) {
    Write-Host "[WARNING] ML training step returned non-zero. Continuing anyway..." -ForegroundColor Yellow
}

Write-Host "[4/4] Starting FastAPI backend on http://127.0.0.1:8000" -ForegroundColor Green
Write-Host "       OpenAPI docs: http://127.0.0.1:8000/docs" -ForegroundColor Green
Write-Host ""
Write-Host "Press Ctrl+C to stop the server." -ForegroundColor Gray
Write-Host ""

& $venvPy run.py
