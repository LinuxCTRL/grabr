@echo off
:: start.cmd - Start Grabr daemon and Web UI on Windows
setlocal enabledelayedexpansion

echo =============================================
echo              Starting Grabr Daemon
echo =============================================

:: Ensure Bun is installed
where bun >nul 2>nul
if %errorlevel% neq 0 (
    echo Error: Bun is not installed.
    echo Please install Bun first: https://bun.sh
    exit /b 1
)

:: Run install if node_modules doesn't exist
if not exist node_modules (
    echo node_modules not found. Installing dependencies...
    call bun install
)

:: Build frontend static assets
echo Building Web UI assets...
call bun run build

:: Start daemon
call bun run cli daemon start

:: Check status
call bun run cli daemon status

:: Detect server port from config
set PORT=7474
set CONFIG_FILE=%USERPROFILE%\.grabr\config.json
if exist "%CONFIG_FILE%" (
    for /f "tokens=2 delims=: " %%A in ('findstr /i "serverPort" "%CONFIG_FILE%"') do (
        set RAW_PORT=%%A
        set RAW_PORT=!RAW_PORT:,=!
        set RAW_PORT=!RAW_PORT:"=!
        set PORT=!RAW_PORT!
    )
)

echo ---------------------------------------------
echo Grabr dashboard is accessible at: http://localhost:%PORT%
echo To stop the daemon, run: stop.cmd
echo =============================================
