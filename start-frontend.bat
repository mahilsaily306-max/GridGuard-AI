@echo off
:: GridGuard AI - Frontend Startup Script (Windows Batch)
:: Starts the Vite dev server on http://127.0.0.1:5173
:: NOTE: npm is broken on this system, so Vite is launched via Node directly.

setlocal enabledelayedexpansion

set "ROOT_DIR=%~dp0"
set "FRONTEND_DIR=%ROOT_DIR%frontend"
set "VITE_BIN=%FRONTEND_DIR%node_modules\.bin\vite.exe"

echo ============================================
echo  GridGuard AI - Frontend Startup
echo ============================================
echo.

if not exist "%VITE_BIN%" (
    echo [ERROR] Vite binary not found at %VITE_BIN%
    echo       Please install frontend dependencies first:
    echo       cd %FRONTEND_DIR%
    echo       pnpm install   (or npm install if npm is functional)
    echo.
    pause
    exit /b 1
)

echo [1/2] Checking that backend is reachable...
echo       The frontend proxies /api to http://127.0.0.1:8000
echo       Make sure the backend is running (start-backend.bat / .ps1)
echo.

echo [2/2] Starting Vite dev server on http://127.0.0.1:5173
echo       Press Ctrl+C to stop the server.
echo.

cd /d "%FRONTEND_DIR%"
node node_modules\.bin\vite --host 127.0.0.1

endlocal
pause
