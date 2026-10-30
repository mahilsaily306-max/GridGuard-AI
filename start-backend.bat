@echo off
:: GridGuard AI - Backend Startup Script (Windows Batch)
:: Starts the FastAPI backend on http://127.0.0.1:8000

setlocal enabledelayedexpansion

set "ROOT_DIR=%~dp0"
set "BACKEND_DIR=%ROOT_DIR%backend"
set "VENV_PY=%BACKEND_DIR%\.venv\Scripts\python.exe"

echo ============================================
echo  GridGuard AI - Backend Startup
echo ============================================
echo.

if not exist "%VENV_PY%" (
    echo [ERROR] Python virtual environment not found at %VENV_PY%
    echo       Please set up the backend first:
    echo       cd %BACKEND_DIR%
    echo       python -m venv .venv
    echo       .venv\Scripts\pip install -r requirements.txt
    echo       .venv\Scripts\python -m alembic upgrade head
    echo       .venv\Scripts\python -m app.ml.train
    echo.
    pause
    exit /b 1
)

echo [1/4] Activating virtual environment...
cd /d "%BACKEND_DIR%"

echo [2/4] Running database migrations (alembic upgrade head)...
call "%VENV_PY%" -m alembic upgrade head
if errorlevel 1 (
    echo [ERROR] Alembic migration failed.
    pause
    exit /b 1
)

echo [3/4] Training ML model (if artifacts missing)...
call "%VENV_PY%" -m app.ml.train
if errorlevel 1 (
    echo [WARNING] ML training step returned non-zero. Continuing anyway...
)

echo [4/4] Starting FastAPI backend on http://127.0.0.1:8000
echo       OpenAPI docs: http://127.0.0.1:8000/docs
echo.
echo Press Ctrl+C to stop the server.
echo.

call "%VENV_PY%" run.py

endlocal
pause
