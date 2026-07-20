const { getDb } = require('../database');

/**
 * Get all meal plans between startDate and endDate (inclusive).
 * Returns array of plan entries joined with recipe title/image.
 * @param {string} startDate - YYYY-MM-DD
 * @param {string} endDate - YYYY-MM-DD
 */
function getForDateRange(startDate, endDate) {
  const db = getDb();
  const stmt = db.prepare(`
    SELECT mp.*, r.title AS recipe_title, r.image_path AS recipe_image
    FROM meal_plans mp
    LEFT JOIN recipes r ON r.id = mp.recipe_id
    WHERE mp.date >= ? AND mp.date <= ?
    ORDER BY mp.date ASC, 
      CASE mp.meal_type
        WHEN 'breakfast' THEN 1
        WHEN 'lunch' THEN 2
        WHEN 'dinner' THEN 3
        WHEN 'snack' THEN 4
        ELSE 5
      END ASC, mp.id ASC
  `);
  return stmt.all(startDate, endDate);
}

/**
 * Add a recipe or custom entry to the meal plan.
 */
function addMealPlan(data) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO meal_plans (recipe_id, custom_item, date, meal_type)
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(
    data.recipe_id || null,
    data.custom_item || null,
    data.date,
    data.meal_type
  );
  return { id: result.lastInsertRowid };
}

/**
 * Remove a meal plan entry by ID.
 */
function removeMealPlan(id) {
  const db = getDb();
  db.prepare('DELETE FROM meal_plans WHERE id = ?').run(id);
}

module.exports = {
  getForDateRange,
  addMealPlan,
  removeMealPlan
};
