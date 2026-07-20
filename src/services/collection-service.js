'use strict';

const { getDb } = require('../database');
const { sanitizeString } = require('../utils/sanitize');

/**
 * Collection Service — CRUD, ordering, and recipe-count queries.
 */

/**
 * Get all collections sorted by sort_order.
 * @returns {Array}
 */
function getAll(userId) {
  const db = getDb();
  return db.prepare('SELECT * FROM collections WHERE user_id = ? ORDER BY sort_order ASC, name ASC').all(userId);
}

/**
 * Get all collections with a recipe_count field (counts only active recipes).
 * @returns {Array}
 */
function getAllWithCounts(userId) {
  const db = getDb();
  return db.prepare(`
    SELECT c.*, COUNT(r.id) AS recipe_count
    FROM collections c
    LEFT JOIN recipes r ON r.collection_id = c.id AND r.status = 'active' AND r.user_id = ?
    WHERE c.user_id = ?
    GROUP BY c.id
    ORDER BY c.sort_order ASC, c.name ASC
  `).all(userId, userId);
}

/**
 * Get a single collection by ID.
 * @param {number} id
 * @returns {Object|null}
 */
function getById(userId, id) {
  const db = getDb();
  return db.prepare('SELECT * FROM collections WHERE id = ? AND user_id = ?').get(id, userId) || null;
}

/**
 * Create a new collection.
 * @param {Object} data
 * @returns {Object} created collection
 */
function create(userId, data) {
  const db = getDb();
  const name = sanitizeString(data.name);
  if (!name) throw new Error('Collection name is required');

  const description = sanitizeString(data.description || '');
  const color = sanitizeString(data.color || '#6366f1');
  const icon = sanitizeString(data.icon || 'folder');

  // Place new collection at the end
  const maxOrder = db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM collections WHERE user_id = ?').get(userId).m;

  const result = db.prepare(`
    INSERT INTO collections (name, description, color, icon, sort_order, user_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, description, color, icon, maxOrder + 1, userId);

  return getById(userId, result.lastInsertRowid);
}

/**
 * Update a collection.
 * @param {number} id
 * @param {Object} data
 * @returns {Object} updated collection
 */
function update(userId, id, data) {
  const db = getDb();
  const existing = getById(userId, id);
  if (!existing) throw new Error('Collection not found');

  const name = sanitizeString(data.name ?? existing.name);
  if (!name) throw new Error('Collection name is required');

  const description = sanitizeString(data.description ?? existing.description);
  const color = sanitizeString(data.color ?? existing.color);
  const icon = sanitizeString(data.icon ?? existing.icon);

  db.prepare(`
    UPDATE collections
    SET name = ?, description = ?, color = ?, icon = ?, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(name, description, color, icon, id, userId);

  return getById(userId, id);
}

/**
 * Delete a collection. Recipes in this collection become uncollected.
 * @param {number} id
 */
function remove(userId, id) {
  const db = getDb();
  db.transaction(() => {
    db.prepare('UPDATE recipes SET collection_id = NULL WHERE collection_id = ? AND user_id = ?').run(id, userId);
    db.prepare('DELETE FROM collections WHERE id = ? AND user_id = ?').run(id, userId);
  })();
}

/**
 * Reorder collections by an array of IDs.
 * @param {number[]} orderedIds
 */
function reorder(userId, orderedIds) {
  const db = getDb();
  const stmt = db.prepare('UPDATE collections SET sort_order = ?, updated_at = datetime(\'now\') WHERE id = ? AND user_id = ?');
  db.transaction(() => {
    for (let i = 0; i < orderedIds.length; i++) {
      stmt.run(i, orderedIds[i], userId);
    }
  })();
}

module.exports = { getAll, getAllWithCounts, getById, create, update, delete: remove, reorder };
