'use strict';

const { getDb } = require('../database');
const { safeJsonParse } = require('../utils/sanitize');

/**
 * Search Service — FTS5 full-text search with bm25 ranking.
 */

/**
 * Search recipes using FTS5.
 * @param {string} query   Search terms
 * @param {Object} options Filter and pagination options
 * @returns {{ results: Array, total: number }}
 */
function search(userId, query, { collection, tag, status = 'active', limit = 50, offset = 0 } = {}) {
  const db = getDb();

  if (!query || !query.trim()) {
    return { results: [], total: 0 };
  }

  // Sanitise query for FTS5 — escape double quotes and wrap each token
  const tokens = query.trim().split(/\s+/).filter(t => t.length > 0);
  const ftsQuery = tokens.map(t => `"${t.replace(/"/g, '""')}"`).join(' ');

  let joins = '';
  const joinParams = [];
  
  let where = "WHERE fts.user_id = ? AND r.user_id = ? AND r.status = ?";
  const whereParams = [userId, userId, status];

  if (collection) {
    where += ' AND r.collection_id = ?';
    whereParams.push(collection);
  }

  if (tag) {
    joins += `
      INNER JOIN recipe_tags rt_filter ON rt_filter.recipe_id = r.id AND rt_filter.user_id = ?
      INNER JOIN tags t_filter ON t_filter.id = rt_filter.tag_id AND t_filter.name = ? AND t_filter.user_id = ?
    `;
    joinParams.push(userId, tag, userId);
  }

  // Count query
  const countSql = `
    SELECT COUNT(*) AS total
    FROM recipes_fts fts
    INNER JOIN recipes r ON r.id = fts.rowid
    ${joins}
    ${where}
    AND fts.recipes_fts MATCH ?
  `;
  const countRow = db.prepare(countSql).get(...joinParams, ...whereParams, ftsQuery);
  const total = countRow ? countRow.total : 0;

  if (total === 0) {
    return { results: [], total: 0 };
  }

  // Results query with bm25 ranking and highlights
  const resultsSql = `
    SELECT
      r.*,
      c.name AS collection_name,
      c.color AS collection_color,
      bm25(recipes_fts, 5.0, 2.0, 1.0, 1.0, 1.0) AS rank,
      highlight(recipes_fts, 0, '<mark>', '</mark>') AS title_highlighted,
      snippet(recipes_fts, 1, '<mark>', '</mark>', '...', 40) AS description_highlighted
    FROM recipes_fts fts
    INNER JOIN recipes r ON r.id = fts.rowid
    LEFT JOIN collections c ON c.id = r.collection_id AND c.user_id = ?
    ${joins}
    ${where}
    AND fts.recipes_fts MATCH ?
    ORDER BY rank ASC
    LIMIT ? OFFSET ?
  `;

  const results = db.prepare(resultsSql).all(userId, ...joinParams, ...whereParams, ftsQuery, limit, offset);

  for (const r of results) {
    r.ingredients = safeJsonParse(r.ingredients, []);
    r.instructions = safeJsonParse(r.instructions, []);
  }

  return { results, total };
}

module.exports = { search };
