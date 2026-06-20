@echo off
:: stop.cmd - Stop Grabr daemon on Windows
setlocal enabledelayedexpansion

echo =============================================
echo              Stopping Grabr Daemon
echo =============================================

:: Ensure Bun is installed
where bun >nul 2>nul
if %errorlevel% neq 0 (
    echo Error: Bun is not installed.
    echo Please install Bun first: https://bun.sh
    exit /b 1
)

:: Stop daemon
call bun run cli daemon stop

echo =============================================
