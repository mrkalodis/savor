/**
 * Sanitize a string for safe display in HTML context.
 * This does NOT replace a templating engine's auto-escaping (EJS does that).
 * This is for sanitizing user input before storage.
 */
function sanitizeString(input) {
  if (typeof input !== 'string') return '';
  return input.trim();
}

/**
 * Sanitize a URL string.
 * Returns empty string if the URL is not valid http/https.
 */
function sanitizeUrl(input) {
  if (typeof input !== 'string') return '';
  const trimmed = input.trim();
  if (!trimmed) return '';

  try {
    const url = new URL(trimmed);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.href;
    }
  } catch {
    // Invalid URL
  }
  return '';
}

/**
 * Normalize a recipe title for comparison (lowercase, remove extra whitespace).
 */
function normalizeTitle(title) {
  if (!title) return '';
  return title.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Parse a JSON string safely, returning defaultValue on failure.
 */
function safeJsonParse(str, defaultValue = []) {
  if (!str) return defaultValue;
  if (Array.isArray(str)) return str;
  try {
    const parsed = JSON.parse(str);
    return parsed || defaultValue;
  } catch {
    return defaultValue;
  }
}

/**
 * Ensure a value is a valid JSON array string.
 */
function toJsonArray(input) {
  if (typeof input === 'string') {
    try {
      const parsed = JSON.parse(input);
      if (Array.isArray(parsed)) return JSON.stringify(parsed);
    } catch {
      // If it's a plain string, wrap in array
      if (input.trim()) {
        return JSON.stringify(input.split('\n').filter(l => l.trim()));
      }
    }
  }
  if (Array.isArray(input)) return JSON.stringify(input);
  return '[]';
}

/**
 * Generate a URL-safe random token.
 */
function generateToken(length = 32) {
  const crypto = require('crypto');
  return crypto.randomBytes(length).toString('hex');
}

/**
 * Slugify a string for use in filenames or URLs.
 */
function slugify(str) {
  return str
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

module.exports = {
  sanitizeString,
  sanitizeUrl,
  normalizeTitle,
  safeJsonParse,
  toJsonArray,
  generateToken,
  slugify,
};
