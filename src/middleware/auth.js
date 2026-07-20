const authService = require('../services/auth-service');

// Routes that bypass auth
const PUBLIC_PATHS = ['/login', '/favicon.svg', '/favicon.ico', '/favicon.png', '/icons/', '/css/', '/js/', '/manifest.json', '/sw.js'];

/**
 * Global authentication middleware.
 */
function authMiddleware(req, res, next) {
  // Allow public paths
  if (PUBLIC_PATHS.some(p => req.path.startsWith(p))) {
    return next();
  }

  // Allow share links
  if (req.path.startsWith('/share/')) {
    return next();
  }

  const hasUsers = authService.hasUsers();
  
  // If no users exist, only allow them to access the setup/login page
  if (!hasUsers) {
    if (req.path === '/login' || (req.path.startsWith('/settings/auth') && req.method === 'POST')) {
      return next();
    }
    return res.redirect('/login');
  }

  // Check for valid session token
  const sessionToken = req.headers.cookie
    ?.split(';')
    .map(c => c.trim())
    .find(c => c.startsWith('savor_session='))
    ?.split('=')[1];

  if (sessionToken) {
    const user = authService.validateSession(sessionToken);
    if (user) {
      req.user = user;
      res.locals.user = user;
      return next();
    }
  }

  // Not authenticated — redirect to login
  if (req.path.startsWith('/api/') || req.xhr) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  res.redirect('/login');
}

module.exports = { authMiddleware };
