#!/usr/bin/env bash
# Savor CLI Backup script for Cron or Manual triggers

set -e

APP_DIR="/opt/savor"

if [ ! -d "$APP_DIR" ]; then
  echo "Error: Savor directory not found at $APP_DIR"
  exit 1
fi

cd "$APP_DIR"

# Run the Node backup service via evaluation
echo "Generating full Savor backup..."
node -e "
const { initDatabase } = require('./src/database');
const { ensureDirectories } = require('./src/config');
ensureDirectories();
initDatabase();
const backupService = require('./src/services/backup-service');
backupService.createBackup()
  .then(p => console.log('SUCCESS:' + p))
  .catch(err => {
    console.error('FAILED:', err.message);
    process.exit(1);
  });
"
