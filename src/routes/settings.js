const express = require('express');
const router = express.Router();
const settingsService = require('../services/settings-service');
const authService = require('../services/auth-service');
const pantryService = require('../services/pantry-service');
const collectionService = require('../services/collection-service');
const { formatDuration } = require('../utils/time-parser');

// GET /settings - Settings page
router.get('/settings', async (req, res, next) => {
  try {
    const settings = await settingsService.getAll(req.user.id);
    let users = [];
    if (req.user && req.user.isAdmin) {
      users = authService.getUsers();
    }

    res.render('layouts/main', {
      title: 'Settings',
      view: 'settings',
      formatDuration,
      settings,
      users,
      origin: `${req.protocol}://${req.get('host')}`,
      flashError: req.query.error || null,
      flashSuccess: req.query.success || null,
    });
  } catch (err) {
    next(err);
  }
});

// GET /pantry-staples - Pantry Staples standalone page
router.get('/pantry-staples', async (req, res, next) => {
  try {
    const collections = await collectionService.getAllWithCounts(req.user.id);
    const staples = pantryService.getStaples(req.user.id);

    res.render('layouts/main', {
      title: 'Pantry Staples',
      view: 'pantry-staples',
      staples,
      sidebarCollections: collections,
      currentPath: '/pantry-staples',
      flashError: req.query.error || null,
      flashSuccess: req.query.success || null,
    });
  } catch (err) {
    next(err);
  }
});

// POST /settings - Update settings
router.post('/settings', async (req, res, next) => {
  try {
    const { theme, ...otherSettings } = req.body;

    if (theme) {
      await settingsService.set(req.user.id, 'theme', theme);
    }

    if (otherSettings.action === 'ai_config') {
      if (!otherSettings.ai_enabled) {
        otherSettings.ai_enabled = '0';
      }
      delete otherSettings.action;
    }

    // Save any other settings
    for (const [key, value] of Object.entries(otherSettings)) {
      await settingsService.set(req.user.id, key, value);
    }

    res.redirect('/settings');
  } catch (err) {
    next(err);
  }
});

// GET /login - Login page
router.get('/login', async (req, res, next) => {
  try {
    const hasUsers = authService.hasUsers();
    res.render('layouts/main', {
      title: hasUsers ? 'Login' : 'Admin Setup',
      view: 'login',
      formatDuration,
      setupMode: !hasUsers,
      error: req.query.error || null
    });
  } catch (err) {
    next(err);
  }
});

// POST /login - Verify password and create session
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const hasUsers = authService.hasUsers();

    if (!hasUsers) {
      // Setup Mode
      if (!email || !password) return res.redirect('/login?error=missing_fields');
      const adminId = authService.registerAdmin(email, password);
      const session = authService.createSession(adminId);
      res.cookie('savor_session', session.token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });
      return res.redirect('/');
    }

    // Login Mode
    const userId = authService.login(email, password);
    if (!userId) {
      return res.redirect('/login?error=invalid');
    }

    const session = authService.createSession(userId);
    res.cookie('savor_session', session.token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.redirect('/');
  } catch (err) {
    next(err);
  }
});

// POST /logout - Destroy session and clear cookie
router.post('/logout', async (req, res, next) => {
  try {
    const token = req.headers.cookie?.split(';').map(c => c.trim()).find(c => c.startsWith('savor_session='))?.split('=')[1];
    if (token) {
      authService.destroySession(token);
    }
    res.clearCookie('savor_session');
    res.redirect('/login');
  } catch (err) {
    next(err);
  }
});

// POST /settings/auth/change-password - Change password
router.post('/settings/auth/change-password', async (req, res, next) => {
  try {
    const { current_password, new_password } = req.body;
    if (!new_password) return res.redirect('/settings?error=password_required');

    try {
      authService.changePassword(req.user.id, current_password, new_password);
      res.redirect('/settings?success=Password updated');
    } catch (e) {
      res.redirect('/settings?error=' + encodeURIComponent(e.message));
    }
  } catch (err) {
    next(err);
  }
});

// POST /settings/auth/create-user - Admin create user
router.post('/settings/auth/create-user', async (req, res, next) => {
  try {
    if (!req.user.isAdmin) return res.redirect('/settings?error=Unauthorized');
    const { email, password, is_admin } = req.body;
    try {
      authService.createUser(email, password, is_admin === 'on');
      res.redirect('/settings?success=User created');
    } catch (e) {
      res.redirect('/settings?error=' + encodeURIComponent(e.message));
    }
  } catch (err) {
    next(err);
  }
});

// POST /settings/auth/:id/delete - Admin delete user
router.post('/settings/auth/:id/delete', async (req, res, next) => {
  try {
    if (!req.user.isAdmin) return res.redirect('/settings?error=Unauthorized');
    try {
      authService.deleteUser(req.user.id, parseInt(req.params.id));
      res.redirect('/settings?success=User deleted');
    } catch (e) {
      res.redirect('/settings?error=' + encodeURIComponent(e.message));
    }
  } catch (err) {
    next(err);
  }
});

// POST /settings/onboarding/reset - Reset welcome wizard
router.post('/settings/onboarding/reset', async (req, res, next) => {
  try {
    await settingsService.set(req.user.id, 'onboarding_complete', '0');
    res.redirect('/settings?success=onboarding_reset');
  } catch (err) {
    next(err);
  }
});

// POST /settings/pantry - Add staple
router.post('/settings/pantry', async (req, res, next) => {
  try {
    const { name } = req.body;
    if (name && name.trim()) {
      pantryService.addStaple(req.user.id, name.trim());
      res.redirect('/pantry-staples?success=' + encodeURIComponent(`Added pantry staple: ${name.trim()}`));
    } else {
      res.redirect('/pantry-staples?error=Staple name cannot be empty');
    }
  } catch (err) {
    next(err);
  }
});

// POST /settings/pantry/:id/delete - Delete staple
router.post('/settings/pantry/:id/delete', async (req, res, next) => {
  try {
    pantryService.deleteStaple(req.user.id, req.params.id);
    res.redirect('/pantry-staples?success=Pantry staple deleted');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
