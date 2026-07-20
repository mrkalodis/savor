const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { config } = require('../config');
const backupService = require('../services/backup-service');

const upload = multer({
  dest: path.join(config.dataDir, 'tmp'),
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB max
  fileFilter: (req, file, cb) => {
    // Accept .tar.gz files (mimetype may vary by OS)
    const ok = file.originalname.endsWith('.tar.gz') ||
                file.mimetype === 'application/gzip' ||
                file.mimetype === 'application/x-tar' ||
                file.mimetype === 'application/octet-stream';
    if (ok) cb(null, true);
    else cb(new Error('Invalid file type. Please upload a .tar.gz backup file.'));
  }
});

// GET /backup/export - Create backup and send file download
router.get('/backup/export', async (req, res, next) => {
  try {
    const backupPath = await backupService.createBackup();
    const filename = path.basename(backupPath);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.sendFile(backupPath);
  } catch (err) {
    console.error('[Backup] Export error:', err.message);
    next(err);
  }
});

// POST /backup/restore - Restore from uploaded backup
router.post('/backup/restore', (req, res, next) => {
  upload.single('backup')(req, res, async (uploadErr) => {
    if (uploadErr) {
      console.error('[Backup] Upload error:', uploadErr.message);
      return res.redirect('/settings?error=' + encodeURIComponent('Upload failed: ' + uploadErr.message));
    }

    try {
      if (!req.file) {
        return res.redirect('/settings?error=' + encodeURIComponent('No backup file was uploaded.'));
      }

      await backupService.restoreFromBackup(req.file.path);
      res.redirect('/settings?success=' + encodeURIComponent('Backup restored successfully! The app is using your restored data.'));
    } catch (err) {
      console.error('[Backup] Restore error:', err.message);
      // Clean up temp file if it still exists
      try { require('fs').unlinkSync(req.file.path); } catch {}
      res.redirect('/settings?error=' + encodeURIComponent('Restore failed: ' + err.message));
    }
  });
});

module.exports = router;
