#!/usr/bin/env bash
# Savor Update Script for Proxmox LXC

set -e

echo "=== Savor Recipe Manager Updater ==="

# Check if running as root
if [ "$EUID" -ne 0 ]; then
  echo "Error: Please run as root (or using sudo)."
  exit 1
fi

APP_DIR="/opt/savor"

if [ ! -d "$APP_DIR" ]; then
  echo "Error: Savor directory not found at $APP_DIR"
  exit 1
fi

echo "Stopping Savor service..."
systemctl stop savor

echo "Pulling latest code from git repository..."
cd "$APP_DIR"
git pull

echo "Installing production dependencies..."
npm install --production --no-audit --no-fund

echo "Starting Savor service..."
systemctl start savor

echo "Savor updated successfully!"
systemctl status savor --no-pager
