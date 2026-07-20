const { getDb } = require('../database');
const { normalizeTitle, safeJsonParse } = require('../utils/sanitize');

/**
 * Check for duplicate recipes before importing.
 * Returns match info if a likely duplicate exists.
 */
function checkDuplicate(recipeData) {
  const db = getDb();

  // 1. Exact source URL match (definitive)
  if (recipeData.sourceUrl) {
    const urlMatch = db
      .prepare('SELECT * FROM recipes WHERE source_url = ? AND status != ?')
      .get(recipeData.sourceUrl, 'deleted');

    if (urlMatch) {
      return {
        isDuplicate: true,
        confidence: 1.0,
        existingRecipe: urlMatch,
        matchType: 'url',
      };
    }
  }

  // 2. Normalized title match (strong signal)
  if (recipeData.title) {
    const normalized = normalizeTitle(recipeData.title);
    const allRecipes = db
      .prepare('SELECT * FROM recipes WHERE status != ?')
      .all('deleted');

    for (const recipe of allRecipes) {
      if (normalizeTitle(recipe.title) === normalized) {
        return {
          isDuplicate: true,
          confidence: 0.9,
          existingRecipe: recipe,
          matchType: 'title',
        };
      }
    }

    // 3. Similar title + ingredient overlap (supporting signal)
    const incomingIngredients = normalizeIngredientSet(
      Array.isArray(recipeData.ingredients) ? recipeData.ingredients : safeJsonParse(recipeData.ingredients, [])
    );

    if (incomingIngredients.size > 0) {
      for (const recipe of allRecipes) {
        const titleSimilar = normalizeTitle(recipe.title).includes(normalized) ||
          normalized.includes(normalizeTitle(recipe.title));

        if (titleSimilar) {
          const existingIngredients = normalizeIngredientSet(safeJsonParse(recipe.ingredients, []));
          const similarity = jaccardSimilarity(incomingIngredients, existingIngredients);

          if (similarity > 0.6) {
            return {
              isDuplicate: true,
              confidence: 0.7,
              existingRecipe: recipe,
              matchType: 'similar',
            };
          }
        }
      }
    }
  }

  return { isDuplicate: false, confidence: 0, existingRecipe: null, matchType: null };
}

/**
 * Normalize an ingredient list into a Set of simplified strings for comparison.
 */
function normalizeIngredientSet(ingredients) {
  const set = new Set();
  for (const ing of ingredients) {
    if (typeof ing === 'string' && ing.trim()) {
      // Remove quantities and units, keep the core ingredient
      const normalized = ing
        .toLowerCase()
        .replace(/[\d\/\.\,]+/g, '')
        .replace(/\b(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|g|grams?|kg|ml|liters?|quarts?|pints?|gallons?|pinch|dash|handful)\b/gi, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (normalized.length > 1) {
        set.add(normalized);
      }
    }
  }
  return set;
}

/**
 * Calculate Jaccard similarity between two sets.
 */
function jaccardSimilarity(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 0;

  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

module.exports = { checkDuplicate };
