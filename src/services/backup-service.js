const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { config } = require('../config');
const { getDb } = require('../database');

/**
 * Create a full backup archive (.tar.gz) containing the database, images, and manifest.
 * Returns the path to the created backup file.
 */
async function createBackup() {
  const db = getDb();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `savor-backup-${timestamp}.tar.gz`;
  const backupPath = path.join(config.backupsDir, filename);

  fs.mkdirSync(config.backupsDir, { recursive: true });

  // Get stats for manifest
  const recipeCount = db.prepare('SELECT COUNT(*) as count FROM recipes').get().count;
  const collectionCount = db.prepare('SELECT COUNT(*) as count FROM collections').get().count;

  // Create manifest
  const manifest = {
    version: '1.0.0',
    appName: 'Savor',
    date: new Date().toISOString(),
    recipeCount,
    collectionCount,
  };

  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(backupPath);
    const archive = archiver('tar', { gzip: true, gzipOptions: { level: 6 } });

    output.on('close', () => {
      console.log(`[Backup] Created backup: ${filename} (${archive.pointer()} bytes)`);
      resolve(backupPath);
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);

    // Add manifest
    archive.append(JSON.stringify(manifest, null, 2), { name: 'manifest.json' });

    // Add database file
    if (fs.existsSync(config.dbPath)) {
      // Use a checkpoint to flush WAL before backup
      try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch {}
      archive.file(config.dbPath, { name: 'savor.db' });
    }

    // Add images directory
    const imagesParent = path.join(config.dataDir, 'images');
    if (fs.existsSync(imagesParent)) {
      archive.directory(imagesParent, 'images');
    }

    archive.finalize();
  });
}

/**
 * Restore from a backup archive.
 * Replaces the current database and images.
 */
async function restoreFromBackup(backupFilePath) {
  const tar = require('tar');

  // Create a temp directory for extraction
  const tempDir = path.join(config.dataDir, 'restore-tmp');
  fs.mkdirSync(tempDir, { recursive: true });

  try {
    // Extract the archive
    await tar.x({
      file: backupFilePath,
      cwd: tempDir,
    });

    // Validate manifest
    const manifestPath = path.join(tempDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error('Invalid backup: manifest.json not found');
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
    if (manifest.appName !== 'Savor') {
      throw new Error('Invalid backup: not a Savor backup file');
    }

    // Replace database
    const backupDb = path.join(tempDir, 'savor.db');
    if (fs.existsSync(backupDb)) {
      // Close current database connection
      const { closeDatabase, initDatabase } = require('../database');
      closeDatabase();

      // Replace DB file
      fs.copyFileSync(backupDb, config.dbPath);

      // Remove WAL and SHM files if they exist
      try { fs.unlinkSync(config.dbPath + '-wal'); } catch {}
      try { fs.unlinkSync(config.dbPath + '-shm'); } catch {}

      // Reinitialize database
      initDatabase();
    }

    // Replace images
    const backupImages = path.join(tempDir, 'images');
    const targetImages = path.join(config.dataDir, 'images');
    if (fs.existsSync(backupImages)) {
      // Remove existing images
      if (fs.existsSync(targetImages)) {
        fs.rmSync(targetImages, { recursive: true, force: true });
      }
      // Copy backup images
      copyDirSync(backupImages, targetImages);
    }

    console.log(`[Backup] Restored from backup: ${path.basename(backupFilePath)}`);
  } finally {
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
    // Clean up uploaded backup file
    try { fs.unlinkSync(backupFilePath); } catch {}
  }
}

/**
 * List available backups.
 */
function listBackups() {
  fs.mkdirSync(config.backupsDir, { recursive: true });

  const files = fs.readdirSync(config.backupsDir)
    .filter(f => f.endsWith('.tar.gz'))
    .map(f => {
      const stat = fs.statSync(path.join(config.backupsDir, f));
      return {
        filename: f,
        createdAt: stat.mtime,
        size: stat.size,
      };
    })
    .sort((a, b) => b.createdAt - a.createdAt);

  return files;
}

/**
 * Recursively copy a directory.
 */
function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

module.exports = { createBackup, restoreFromBackup, listBackups };
