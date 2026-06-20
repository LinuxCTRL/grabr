#!/bin/bash
# start.sh - Start Grabr daemon and Web UI
set -e

# Navigate to the project root directory
cd "$(dirname "$0")"

echo "============================================="
echo "             Starting Grabr Daemon"
echo "============================================="

# Ensure Bun is installed
if ! command -v bun &> /dev/null; then
    echo "Error: Bun is not installed."
    echo "Please install Bun first: https://bun.sh"
    exit 1
fi

# Run install if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "node_modules not found. Installing dependencies..."
    bun install
fi

# Build frontend static assets
echo "Building Web UI assets..."
bun run build

# Start daemon
bun run cli daemon start

# Check status
bun run cli daemon status

# Detect server port from config
PORT=7474
CONFIG_FILE="$HOME/.grabr/config.json"
if [ -f "$CONFIG_FILE" ]; then
    DETECTED_PORT=$(grep '"serverPort"' "$CONFIG_FILE" | sed -E 's/.*"serverPort":\s*([0-9]+).*/\1/')
    if [ ! -z "$DETECTED_PORT" ]; then
        PORT=$DETECTED_PORT
    fi
fi

echo "---------------------------------------------"
echo "Grabr dashboard is accessible at: http://localhost:$PORT"
echo "To stop the daemon, run: ./stop.sh"
echo "============================================="
