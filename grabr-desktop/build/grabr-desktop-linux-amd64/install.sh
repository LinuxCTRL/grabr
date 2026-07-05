#!/bin/bash
set -e

# Clear screen and show a premium text header
clear
echo "===================================================="
echo "          Installing Grabr Desktop Package          "
echo "===================================================="
echo ""

# Ensure we run from the script directory
cd "$(dirname "$0")"

# 1. Create directory structures if they don't exist
echo "[1/4] Preparing directories..."
mkdir -p "$HOME/.local/bin"
mkdir -p "$HOME/.local/share/applications"
mkdir -p "$HOME/.local/share/icons/hicolor/256x256/apps"

# 2. Copy the desktop binary
echo "[2/4] Installing application executable..."
if [ -f "grabr-desktop" ]; then
    cp grabr-desktop "$HOME/.local/bin/grabr-desktop"
    chmod +x "$HOME/.local/bin/grabr-desktop"
else
    echo "Error: grabr-desktop binary not found in package directory!"
    exit 1
fi

# 3. Install icon and desktop launcher
echo "[3/4] Registering launcher & system icon..."
if [ -f "grabr-desktop.png" ]; then
    cp grabr-desktop.png "$HOME/.local/share/icons/hicolor/256x256/apps/grabr-desktop.png"
fi

if [ -f "grabr-desktop.desktop" ]; then
    # Customize paths in desktop file to point to user's home folder bin & icon
    cp grabr-desktop.desktop "$HOME/.local/share/applications/grabr-desktop.desktop"
    sed -i "s|Exec=grabr-desktop|Exec=$HOME/.local/bin/grabr-desktop|g" "$HOME/.local/share/applications/grabr-desktop.desktop"
    sed -i "s|Icon=grabr-desktop|Icon=$HOME/.local/share/icons/hicolor/256x256/apps/grabr-desktop.png|g" "$HOME/.local/share/applications/grabr-desktop.desktop"
    chmod +x "$HOME/.local/share/applications/grabr-desktop.desktop"
fi

# 4. Install native messaging manifests for Chrome/Firefox extension support
echo "[4/4] Integrating with web browsers (Native Messaging)..."
"$HOME/.local/bin/grabr-desktop" --install-manifest

echo ""
echo "===================================================="
echo " Grabr Desktop has been successfully installed!"
echo " Log out and log back in, or refresh your desktop"
echo " environment launcher to open Grabr Desktop."
echo "===================================================="
