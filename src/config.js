const path = require('path');

// Load .env file if it exists (no dotenv dependency — manual parse)
const fs = require('fs');
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

const config = {
  port: parseInt(process.env.PORT, 10) || 3000,
  dataDir: path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data')),
  nodeEnv: process.env.NODE_ENV || 'production',

  get dbPath() {
    return path.join(this.dataDir, 'savor.db');
  },

  get imagesDir() {
    return path.join(this.dataDir, 'images', 'recipes');
  },

  get backupsDir() {
    return path.join(this.dataDir, 'backups');
  },

  get isDev() {
    return this.nodeEnv === 'development';
  },
};

// Ensure data directories exist
function ensureDirectories() {
  const dirs = [config.dataDir, config.imagesDir, config.backupsDir];
  for (const dir of dirs) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

module.exports = { config, ensureDirectories };
