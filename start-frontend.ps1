# GridGuard AI - Frontend Startup Script (PowerShell)
# Starts the Vite dev server on http://127.0.0.1:5173
# NOTE: npm is broken on this system, so Vite is launched via Node directly.

$ErrorActionPreference = 'Stop'
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$frontendDir = Join-Path $scriptDir "frontend"
$viteBin = Join-Path $frontendDir "node_modules\.bin\vite.exe"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host " GridGuard AI - Frontend Startup" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

if (-not (Test-Path $viteBin)) {
    Write-Host "[ERROR] Vite binary not found at $viteBin" -ForegroundColor Red
    Write-Host "       Please install frontend dependencies first:" -ForegroundColor Yellow
    Write-Host "       cd $frontendDir" -ForegroundColor Yellow
    Write-Host "       pnpm install   (or npm install if npm is functional)" -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "[1/2] Backend connectivity:" -ForegroundColor Green
Write-Host "       The frontend proxies /api to http://127.0.0.1:8000" -ForegroundColor Green
Write-Host "       Make sure the backend is running (start-backend.bat / .ps1)" -ForegroundColor Green
Write-Host ""

Write-Host "[2/2] Starting Vite dev server on http://127.0.0.1:5173" -ForegroundColor Green
Write-Host "       Press Ctrl+C to stop the server." -ForegroundColor Gray
Write-Host ""

Set-Location $frontendDir
node node_modules\.bin\vite --host 127.0.0.1
