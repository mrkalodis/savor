const { getDb } = require('../database');

/**
 * Get all pantry staples ordered by name.
 */
function getStaples() {
  const db = getDb();
  return db.prepare('SELECT * FROM pantry_staples ORDER BY name ASC').all();
}

/**
 * Add a new staple name. Ignores duplicates.
 */
function addStaple(name) {
  const db = getDb();
  const trimmed = name.trim();
  if (!trimmed) return null;
  
  const stmt = db.prepare('INSERT OR IGNORE INTO pantry_staples (name) VALUES (?)');
  const result = stmt.run(trimmed);
  return { id: result.lastInsertRowid };
}

/**
 * Delete a staple by its ID.
 */
function deleteStaple(id) {
  const db = getDb();
  db.prepare('DELETE FROM pantry_staples WHERE id = ?').run(id);
}

module.exports = {
  getStaples,
  addStaple,
  deleteStaple
};
