'use strict';

const { getDb } = require('../database');

/**
 * Settings Service — key-value store backed by the settings table.
 */

/**
 * Get a single setting value by key.
 * @param {number} userId
 * @param {string} key
 * @returns {string|null}
 */
function get(userId, key) {
  if (!userId) return null;
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE user_id = ? AND key = ?').get(userId, key);
  return row ? row.value : null;
}

/**
 * Set a setting value. Creates or updates the key.
 * @param {number} userId
 * @param {string} key
 * @param {string} value
 */
function set(userId, key, value) {
  if (!userId) return;
  const db = getDb();
  db.prepare(
    'INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value'
  ).run(userId, key, String(value));
}

/**
 * Get all settings as a plain object.
 * @param {number} userId
 * @returns {Object.<string, string>}
 */
function getAll(userId) {
  if (!userId) return {};
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM settings WHERE user_id = ?').all(userId);
  const result = {};
  for (const row of rows) {
    result[row.key] = row.value;
  }
  return result;
}

/**
 * Delete a setting by key.
 * @param {number} userId
 * @param {string} key
 */
function remove(userId, key) {
  if (!userId) return;
  const db = getDb();
  db.prepare('DELETE FROM settings WHERE user_id = ? AND key = ?').run(userId, key);
}

module.exports = { get, set, getAll, delete: remove };
