'use strict';

const fs = require('fs');
const path = require('path');
const { getDb } = require('../database');
const { config } = require('../config');
const { sanitizeString, sanitizeUrl, toJsonArray, safeJsonParse } = require('../utils/sanitize');
const { parseDuration } = require('../utils/time-parser');

/**
 * Recipe Service — full CRUD, lifecycle, tags, pagination.
 */

/**
 * Attach parsed tags to a recipe object.
 */
function attachTags(userId, recipe) {
  if (!recipe) return null;
  const db = getDb();
  recipe.tags = db.prepare(`
    SELECT t.id, t.name FROM tags t
    INNER JOIN recipe_tags rt ON rt.tag_id = t.id
    WHERE rt.recipe_id = ? AND rt.user_id = ?
    ORDER BY t.name
  `).all(recipe.id, userId);
  recipe.ingredients = safeJsonParse(recipe.ingredients, []);
  recipe.instructions = safeJsonParse(recipe.instructions, []);
  return recipe;
}

/**
 * Get all recipes with pagination and filters.
 */
function getAll(userId, { status = 'active', collectionId, page = 1, limit = 24, favorites, tag } = {}) {
  const db = getDb();
  let join = '';
  let where = 'WHERE r.status = ? AND r.user_id = ?';
  const params = [status, userId];

  if (tag) {
    join = 'INNER JOIN recipe_tags rt ON rt.recipe_id = r.id INNER JOIN tags t ON t.id = rt.tag_id';
    where += ' AND t.name = ?';
    params.push(tag);
  }

  if (collectionId !== undefined && collectionId !== null) {
    if (collectionId === 0 || collectionId === '0') {
      where += ' AND r.collection_id IS NULL';
    } else {
      where += ' AND r.collection_id = ?';
      params.push(collectionId);
    }
  }

  if (favorites) {
    where += ' AND r.is_favorite = 1';
  }

  const countRow = db.prepare(`SELECT COUNT(DISTINCT r.id) AS total FROM recipes r ${join} ${where}`).get(...params);
  const total = countRow.total;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const offset = (Math.max(1, page) - 1) * limit;

  const recipes = db.prepare(`
    SELECT DISTINCT r.*, c.name AS collection_name, c.color AS collection_color
    FROM recipes r
    LEFT JOIN collections c ON c.id = r.collection_id
    ${join}
    ${where}
    ORDER BY r.sort_order ASC, r.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  for (const recipe of recipes) {
    recipe.ingredients = safeJsonParse(recipe.ingredients, []);
    recipe.instructions = safeJsonParse(recipe.instructions, []);
  }

  return { recipes, total, page: Math.max(1, page), totalPages };
}

/**
 * Get a single recipe by ID with tags.
 */
function getById(userId, id) {
  const db = getDb();
  const recipe = db.prepare(`
    SELECT r.*, c.name AS collection_name, c.color AS collection_color
    FROM recipes r
    LEFT JOIN collections c ON c.id = r.collection_id
    WHERE r.id = ? AND r.user_id = ?
  `).get(id, userId);
  return attachTags(userId, recipe);
}

/**
 * Get recent active recipes.
 */
function getRecent(userId, limit = 10) {
  const db = getDb();
  const recipes = db.prepare(`
    SELECT r.*, c.name AS collection_name, c.color AS collection_color
    FROM recipes r
    LEFT JOIN collections c ON c.id = r.collection_id
    WHERE r.status = 'active' AND r.user_id = ?
    ORDER BY r.created_at DESC
    LIMIT ?
  `).all(userId, limit);
  for (const r of recipes) {
    r.ingredients = safeJsonParse(r.ingredients, []);
    r.instructions = safeJsonParse(r.instructions, []);
  }
  return recipes;
}

/**
 * Get favorite active recipes.
 */
function getFavorites(userId, limit = 10) {
  const db = getDb();
  const recipes = db.prepare(`
    SELECT r.*, c.name AS collection_name, c.color AS collection_color
    FROM recipes r
    LEFT JOIN collections c ON c.id = r.collection_id
    WHERE r.status = 'active' AND r.is_favorite = 1 AND r.user_id = ?
    ORDER BY r.updated_at DESC
    LIMIT ?
  `).all(userId, limit);
  for (const r of recipes) {
    r.ingredients = safeJsonParse(r.ingredients, []);
    r.instructions = safeJsonParse(r.instructions, []);
  }
  return recipes;
}

/**
 * Create a new recipe.
 */
function create(userId, data) {
  const db = getDb();
  const title = sanitizeString(data.title);
  if (!title) throw new Error('Recipe title is required');

  const description = sanitizeString(data.description || '');
  const ingredients = toJsonArray(data.ingredients);
  const instructions = toJsonArray(data.instructions);
  const prepTime = parseDuration(data.prep_time || data.prepTime) || null;
  const cookTime = parseDuration(data.cook_time || data.cookTime) || null;
  const totalTime = parseDuration(data.total_time || data.totalTime) || (prepTime || 0) + (cookTime || 0) || null;
  const servings = sanitizeString(data.servings || '');
  const notes = sanitizeString(data.notes || '');
  const sourceUrl = sanitizeUrl(data.source_url || data.sourceUrl || '');
  const imagePath = data.image_path || data.imagePath || '';
  const isFavorite = data.is_favorite || data.isFavorite ? 1 : 0;
  const collectionId = data.collection_id || data.collectionId || null;

  const maxOrder = db.prepare(
    'SELECT COALESCE(MAX(sort_order), 0) AS m FROM recipes WHERE collection_id IS ? AND status = ? AND user_id = ?'
  ).get(collectionId || null, 'active', userId).m;

  const result = db.prepare(`
    INSERT INTO recipes (
      user_id, collection_id, title, description, ingredients, instructions,
      prep_time, cook_time, total_time, servings, notes,
      source_url, image_path, is_favorite, sort_order
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId, collectionId || null, title, description, ingredients, instructions,
    prepTime, cookTime, totalTime, servings, notes,
    sourceUrl, imagePath, isFavorite, maxOrder + 1
  );

  const recipeId = result.lastInsertRowid;

  // Handle tags
  if (data.tags && Array.isArray(data.tags) && data.tags.length > 0) {
    setTags(userId, recipeId, data.tags);
  }

  return getById(userId, recipeId);
}

/**
 * Update a recipe.
 */
function update(userId, id, data) {
  const db = getDb();
  const existing = getById(userId, id);
  if (!existing) throw new Error('Recipe not found');

  const title = sanitizeString(data.title ?? existing.title);
  if (!title) throw new Error('Recipe title is required');

  const description = sanitizeString(data.description ?? existing.description);
  const ingredients = data.ingredients !== undefined ? toJsonArray(data.ingredients) : JSON.stringify(existing.ingredients);
  const instructions = data.instructions !== undefined ? toJsonArray(data.instructions) : JSON.stringify(existing.instructions);
  const prepTime = data.prep_time !== undefined || data.prepTime !== undefined
    ? parseDuration(data.prep_time || data.prepTime)
    : existing.prep_time;
  const cookTime = data.cook_time !== undefined || data.cookTime !== undefined
    ? parseDuration(data.cook_time || data.cookTime)
    : existing.cook_time;
  const totalTime = data.total_time !== undefined || data.totalTime !== undefined
    ? parseDuration(data.total_time || data.totalTime)
    : (prepTime || 0) + (cookTime || 0) || null;
  const servings = sanitizeString(data.servings ?? existing.servings);
  const notes = sanitizeString(data.notes ?? existing.notes);
  const sourceUrl = data.source_url !== undefined
    ? sanitizeUrl(data.source_url)
    : existing.source_url;
  const imagePath = data.image_path ?? existing.image_path;
  const collectionId = data.collection_id !== undefined ? (data.collection_id || null) : existing.collection_id;

  db.prepare(`
    UPDATE recipes SET
      collection_id = ?, title = ?, description = ?, ingredients = ?, instructions = ?,
      prep_time = ?, cook_time = ?, total_time = ?, servings = ?, notes = ?,
      source_url = ?, image_path = ?, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(
    collectionId, title, description, ingredients, instructions,
    prepTime, cookTime, totalTime, servings, notes,
    sourceUrl, imagePath, id, userId
  );

  // Handle tags if provided
  if (data.tags !== undefined) {
    setTags(userId, id, Array.isArray(data.tags) ? data.tags : []);
  }

  return getById(userId, id);
}

/**
 * Permanently delete a recipe and its images.
 */
function remove(userId, id) {
  const db = getDb();
  const recipe = db.prepare('SELECT id, image_path FROM recipes WHERE id = ? AND user_id = ?').get(id, userId);
  if (!recipe) return;

  db.transaction(() => {
    db.prepare('DELETE FROM recipe_tags WHERE recipe_id = ? AND user_id = ?').run(id, userId);
    db.prepare('DELETE FROM recipes WHERE id = ? AND user_id = ?').run(id, userId);
  })();

  // Delete image files
  const imageDir = path.join(config.imagesDir, String(id));
  if (fs.existsSync(imageDir)) {
    fs.rmSync(imageDir, { recursive: true, force: true });
  }
}

/**
 * Soft delete — set status='deleted', record timestamp.
 */
function softDelete(userId, id) {
  const db = getDb();
  db.prepare(`
    UPDATE recipes SET status = 'deleted', deleted_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(id, userId);
}

/**
 * Archive a recipe.
 */
function archive(userId, id) {
  const db = getDb();
  db.prepare(`
    UPDATE recipes SET status = 'archived', archived_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(id, userId);
}

/**
 * Restore a recipe to active.
 */
function restore(userId, id) {
  const db = getDb();
  db.prepare(`
    UPDATE recipes SET status = 'active', archived_at = NULL, deleted_at = NULL, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(id, userId);
}

/**
 * Toggle the is_favorite flag.
 * @returns {number} new is_favorite value
 */
function toggleFavorite(userId, id) {
  const db = getDb();
  db.prepare(`
    UPDATE recipes SET is_favorite = CASE WHEN is_favorite = 1 THEN 0 ELSE 1 END, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(id, userId);
  const recipe = db.prepare('SELECT is_favorite FROM recipes WHERE id = ? AND user_id = ?').get(id, userId);
  return recipe ? recipe.is_favorite : 0;
}

/**
 * Move a recipe to a different collection.
 */
function moveToCollection(userId, id, collectionId) {
  const db = getDb();
  db.prepare(`
    UPDATE recipes SET collection_id = ?, updated_at = datetime('now')
    WHERE id = ? AND user_id = ?
  `).run(collectionId || null, id, userId);
}

/**
 * Reorder recipes within a collection.
 */
function reorder(userId, collectionId, orderedRecipeIds) {
  const db = getDb();
  const stmt = db.prepare('UPDATE recipes SET sort_order = ? WHERE id = ? AND user_id = ?');
  db.transaction(() => {
    for (let i = 0; i < orderedRecipeIds.length; i++) {
      stmt.run(i, orderedRecipeIds[i], userId);
    }
  })();
}

/**
 * Sync tags for a recipe. Creates new tags as needed.
 */
function setTags(userId, recipeId, tagNames) {
  const db = getDb();
  const cleanNames = tagNames
    .map(n => (typeof n === 'string' ? n.trim() : ''))
    .filter(n => n.length > 0);

  db.transaction(() => {
    // Remove existing tag links
    db.prepare('DELETE FROM recipe_tags WHERE recipe_id = ? AND user_id = ?').run(recipeId, userId);

    if (cleanNames.length === 0) return;

    const findTag = db.prepare('SELECT id FROM tags WHERE name = ? AND user_id = ?');
    const insertTag = db.prepare('INSERT INTO tags (user_id, name) VALUES (?, ?)');
    const linkTag = db.prepare('INSERT INTO recipe_tags (user_id, recipe_id, tag_id) VALUES (?, ?, ?)');

    for (const name of cleanNames) {
      let tag = findTag.get(name, userId);
      if (!tag) {
        const result = insertTag.run(userId, name);
        tag = { id: result.lastInsertRowid };
      }
      linkTag.run(userId, recipeId, tag.id);
    }
  })();
}

/**
 * Get aggregate stats for the dashboard.
 */
function getStats(userId) {
  const db = getDb();
  const totalRecipes = db.prepare("SELECT COUNT(*) AS c FROM recipes WHERE status = 'active' AND user_id = ?").get(userId).c;
  const totalCollections = db.prepare('SELECT COUNT(*) AS c FROM collections WHERE user_id = ?').get(userId).c;
  const totalTags = db.prepare('SELECT COUNT(*) AS c FROM tags WHERE user_id = ?').get(userId).c;
  const totalFavorites = db.prepare("SELECT COUNT(*) AS c FROM recipes WHERE status = 'active' AND is_favorite = 1 AND user_id = ?").get(userId).c;
  const totalArchived = db.prepare("SELECT COUNT(*) AS c FROM recipes WHERE status = 'archived' AND user_id = ?").get(userId).c;
  const totalDeleted = db.prepare("SELECT COUNT(*) AS c FROM recipes WHERE status = 'deleted' AND user_id = ?").get(userId).c;
  return { totalRecipes, totalCollections, totalTags, totalFavorites, totalArchived, totalDeleted };
}

/**
 * Update a recipe's image path directly.
 */
function updateImagePath(userId, id, imagePath) {
  const db = getDb();
  db.prepare('UPDATE recipes SET image_path = ? WHERE id = ? AND user_id = ?').run(imagePath, id, userId);
}

module.exports = {
  getAll, getById, getRecent, getFavorites,
  create, update, delete: remove,
  softDelete, archive, restore,
  toggleFavorite, moveToCollection, reorder,
  setTags, getStats, updateImagePath,
};
