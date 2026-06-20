#!/bin/bash
# stop.sh - Stop Grabr daemon
set -e

# Navigate to the project root directory
cd "$(dirname "$0")"

echo "============================================="
echo "             Stopping Grabr Daemon"
echo "============================================="

# Ensure Bun is installed
if ! command -v bun &> /dev/null; then
    echo "Error: Bun is not installed."
    echo "Please install Bun first: https://bun.sh"
    exit 1
fi

# Stop daemon
bun run cli daemon stop

echo "============================================="
