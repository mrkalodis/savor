const { config } = require('../config');

/**
 * 404 Not Found handler
 */
function notFoundHandler(req, res, next) {
  res.status(404).render('error', {
    title: 'Page Not Found',
    status: 404,
    message: 'The page you are looking for does not exist.',
  });
}

/**
 * Global error handler
 */
function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const message = config.isDev
    ? err.message
    : 'Something went wrong. Please try again.';

  console.error(`[Error] ${status} - ${err.message}`);
  if (config.isDev) {
    console.error(err.stack);
  }

  // API requests get JSON errors
  if (req.path.startsWith('/api/')) {
    return res.status(status).json({ error: message });
  }

  res.status(status).render('error', {
    title: 'Error',
    status,
    message,
  });
}

module.exports = { notFoundHandler, errorHandler };
