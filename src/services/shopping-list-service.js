const { getDb } = require('../database');
const { safeJsonParse } = require('../utils/sanitize');

// Word-to-number mapping for parsing e.g. "One 8-ounce block"
const wordNumbers = {
  'one': '1', 'two': '2', 'three': '3', 'four': '4', 'five': '5',
  'six': '6', 'seven': '7', 'eight': '8', 'nine': '9', 'ten': '10'
};

// Helper to determine if a unit is weight or packaging based
const isWeightOrPack = (unit) => {
  if (!unit) return false;
  const u = unit.toLowerCase();
  return ['g', 'gram', 'grams', 'kg', 'kilogram', 'kilograms', 'lb', 'lbs', 'pound', 'pounds', 'oz', 'ozs', 'ounce', 'ounces', 'ml', 'l', 'liter', 'liters', 'can', 'cans', 'pack', 'packs', 'tin', 'tins', 'jar', 'jars', 'bottle', 'bottles', 'bag', 'bags', 'block', 'blocks'].includes(u);
};

/**
 * Clean descriptive adjectives and preparation instructions from the ingredient name.
 * e.g., "fresh basil leaves, thinly sliced" -> "basil leaves"
 * e.g., "garlic, finely grated" -> "garlic"
 * e.g., "One 8-ounce block feta cheese, drained" -> "feta cheese"
 */
function cleanIngredientName(name) {
  let clean = name.trim();
  
  // Replace HTML non-breaking spaces
  clean = clean.replace(/&nbsp;/gi, ' ');
  
  // 1. Remove anything in parentheses (e.g. "(halved)", "(6- to 8-oz.)")
  clean = clean.replace(/\s*\([^)]*\)/g, '');

  // 2. Split by comma if the second part is a descriptor
  if (clean.includes(',')) {
    const parts = clean.split(',');
    const firstPart = parts[0].trim();
    const secondPart = parts.slice(1).join(',').trim();
    
    const descRegex = /\b(thinly|finely|coarsely|roughly|freshly|chopped|sliced|drained|grated|peeled|shredded|melted|softened|divided|for serving|to serve|halved|diced|minced|packed|crushed|to taste|cooked)\b/i;
    if (descRegex.test(secondPart) || descRegex.test(firstPart)) {
      clean = firstPart;
    }
  }

  // 3. Strip common recipe adjectives and prep instructions (leading or trailing)
  const trailingRegex = /\b(drained|divided|softened|melted|chopped|sliced|diced|grated|shredded|minced|peeled|halved|for serving|to serve|fresh|raw|dried|ground|powdered|block|blocks)\b/gi;
  clean = clean.replace(trailingRegex, '');
  
  // 4. Strip leading punctuation (periods, hyphens, colons, commas) and extra spaces
  clean = clean.replace(/^[.,\-:\s]+/, '');

  // Clean double spaces and trim
  clean = clean.replace(/\s+/g, ' ').trim();
  
  // Capitalize first letter for visual neatness
  if (clean.length > 0) {
    clean = clean.charAt(0).toUpperCase() + clean.slice(1);
  }
  
  return clean;
}

/**
 * Parse a raw quantity string into a decimal value.
 * Handles: decimals, simple fractions (1/2), mixed fractions (1 1/2), unicode (½), ranges (1-2).
 */
function parseQty(qtyStr) {
  if (!qtyStr) return 0;
  let s = qtyStr.trim();
  
  // Unicode fractions conversion
  const unicodeFractions = {
    '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 0.33, '⅔': 0.66, '⅛': 0.125
  };
  for (const [key, val] of Object.entries(unicodeFractions)) {
    s = s.replace(new RegExp(key, 'g'), ` ${val} `);
  }
  
  s = s.replace(/\s+/g, ' ').trim();
  
  // Check for spaces (e.g. "1 1/2")
  if (s.includes(' ')) {
    const parts = s.split(' ');
    let sum = 0;
    for (const p of parts) {
      sum += parseQty(p);
    }
    return sum;
  }
  
  // Check for divisions (e.g. "1/2")
  if (s.includes('/')) {
    const parts = s.split('/');
    if (parts.length === 2) {
      const num = parseFloat(parts[0]);
      const den = parseFloat(parts[1]);
      if (!isNaN(num) && !isNaN(den) && den !== 0) {
        return num / den;
      }
    }
  }
  
  // Check for ranges (e.g. "1-2" or "1 to 2") -> take first number
  if (s.includes('-')) {
    const parts = s.split('-');
    return parseQty(parts[0]);
  }
  
  const val = parseFloat(s);
  return isNaN(val) ? 0 : val;
}

/**
 * Formats a decimal quantity value back into a clean string (whole numbers, decimals, or fractions).
 */
function formatQty(val) {
  if (val <= 0) return '';
  if (Number.isInteger(val)) return String(val);
  const integerPart = Math.floor(val);
  const decimalPart = val - integerPart;
  
  const tol = 0.02;
  let frac = '';
  if (Math.abs(decimalPart - 0.5) < tol) frac = '1/2';
  else if (Math.abs(decimalPart - 0.25) < tol) frac = '1/4';
  else if (Math.abs(decimalPart - 0.75) < tol) frac = '3/4';
  else if (Math.abs(decimalPart - 0.33) < tol || Math.abs(decimalPart - 0.3) < tol) frac = '1/3';
  else if (Math.abs(decimalPart - 0.66) < tol || Math.abs(decimalPart - 0.7) < tol) frac = '2/3';
  
  if (frac) {
    return integerPart > 0 ? `${integerPart} ${frac}` : frac;
  }
  
  return String(parseFloat(val.toFixed(2)));
}

/**
 * Parse an ingredient line into its components: numeric value, normalized unit, and item name.
 */
function parseIngredientLine(line) {
  let trimmed = line.trim();
  if (!trimmed) return null;

  // Replace leading word numbers (e.g. "One" -> "1")
  const firstWord = trimmed.split(/\s+/)[0].toLowerCase();
  if (wordNumbers[firstWord]) {
    trimmed = wordNumbers[firstWord] + trimmed.slice(firstWord.length);
  }

  // Matches leading numeric quantity (ordered: mixed fractions -> fractions -> decimals/integers)
  const qtyRegex = /^((?:\d+\s+\d+\/\d+|\d+\s*\/\s*\d+|\d+(?:\.\d+)?|\d+\s*-\s*\d+|[¼½¾⅓⅔⅛])\s*)/;
  const qtyMatch = trimmed.match(qtyRegex);
  
  let qtyStr = '';
  let rest = trimmed;
  
  if (qtyMatch) {
    qtyStr = qtyMatch[1].trim();
    rest = trimmed.slice(qtyMatch[1].length).trim();
  }
  
  // Standard units matcher (optionally matches a trailing period, and includes single-letter abbreviations)
  const unitRegex = /^(cups?|tsps?|tbsps?|lbs?|grams?|g|ounces?|oz|ml|l|cans?|packs?|pieces?|slices?|cloves?|pinches?|tins?|bunches?|handfuls?|pints?|quarts?|gallons?|bags?|blocks?|bottles?|jars?|c|t|T)\b\.?/i;
  const unitMatch = rest.match(unitRegex);
  
  let unit = '';
  if (unitMatch) {
    unit = unitMatch[1]; // Keep original case for single-character mapping
    rest = rest.slice(unitMatch[0].length).trim();
  }
  
  // Normalize unit names
  if (unit) {
    const uLower = unit.toLowerCase();
    if (uLower.startsWith('cup') || unit === 'c' || unit === 'C') unit = 'cup';
    else if (unit === 'T') unit = 'tbsp';
    else if (unit === 't') unit = 'tsp';
    else if (uLower.startsWith('tsp') || uLower === 'teaspoon' || uLower === 'teaspoons') unit = 'tsp';
    else if (uLower.startsWith('tbsp') || uLower === 'tablespoon' || uLower === 'tablespoons') unit = 'tbsp';
    else if (uLower.startsWith('lb') || uLower === 'pound' || uLower === 'pounds') unit = 'lb';
    else if (uLower.startsWith('gram') || uLower === 'g') unit = 'g';
    else if (uLower.startsWith('ounce') || uLower === 'oz') unit = 'oz';
    else if (uLower.startsWith('clove')) unit = 'clove';
    else if (uLower.startsWith('pinch')) unit = 'pinch';
    else if (uLower.startsWith('slice')) unit = 'slice';
    else if (uLower.startsWith('can') || uLower === 'tin' || uLower === 'tins') unit = 'can';
    else if (uLower.startsWith('piece')) unit = 'piece';
    else if (uLower.startsWith('bunch')) unit = 'bunch';
    else if (uLower.startsWith('pint')) unit = 'pint';
    else if (uLower.startsWith('quart')) unit = 'quart';
    else if (uLower.startsWith('gallon')) unit = 'gallon';
    else if (uLower.startsWith('bag')) unit = 'bag';
    else if (uLower.startsWith('block')) unit = 'block';
    else if (uLower.startsWith('bottle')) unit = 'bottle';
    else if (uLower.startsWith('jar')) unit = 'jar';
    else unit = uLower;
  }

  // Secondary check: if the rest of the string starts with a weight (e.g. "8-ounce block feta cheese")
  // We extract that as the real quantity/unit and clean the rest
  const secondaryWeightRegex = /^(\d+(?:\.\d+)?)\s*-?\s*(ounces?|oz|grams?|g|lbs?|pounds?)\b/i;
  const secondaryMatch = rest.match(secondaryWeightRegex);
  if (secondaryMatch) {
    qtyStr = secondaryMatch[1];
    let rawUnit = secondaryMatch[2].toLowerCase();
    if (rawUnit.startsWith('ounce') || rawUnit === 'oz') unit = 'oz';
    else if (rawUnit.startsWith('gram') || rawUnit === 'g') unit = 'g';
    else if (rawUnit.startsWith('pound') || rawUnit === 'lb') unit = 'lb';
    rest = rest.slice(secondaryMatch[0].length).trim();
  }
  
  return {
    quantityValue: parseQty(qtyStr),
    unit: unit || '',
    name: rest.trim(),
    originalQtyStr: qtyStr
  };
}

/**
 * Get all shopping list items, unchecked first, then checked.
 */
function getItems() {
  const db = getDb();
  return db.prepare(`
    SELECT sl.*, r.title AS recipe_title
    FROM shopping_list sl
    LEFT JOIN recipes r ON r.id = sl.recipe_id
    ORDER BY sl.checked ASC, sl.id DESC
  `).all();
}

/**
 * Add a single item to the shopping list. Supports smart merging and pantry staples check off.
 */
function addItem(name, quantity = '', recipeId = null) {
  const db = getDb();
  
  // Clean inputs
  const cleanName = cleanIngredientName(name);
  const cleanQty = quantity.trim();

  if (!cleanName) return null;

  // 1. Pantry Staples check: If matched, mark item as pre-checked (checked = 1)
  const isStaple = db.prepare(`
    SELECT id FROM pantry_staples 
    WHERE ? LIKE '%' || name || '%' OR name LIKE '%' || ? || '%'
  `).get(cleanName, cleanName) ? 1 : 0;
  
  // 2. Normalization for duplicate checking (strip trailing 's' for basic plurals)
  let normName = cleanName.toLowerCase();
  if (normName.endsWith('s') && normName.length > 3) {
    normName = normName.slice(0, -1);
  }
  
  // Only merge if not a pre-checked staple
  if (!isStaple) {
    const existing = db.prepare(`
      SELECT id, name, quantity FROM shopping_list 
      WHERE checked = 0 AND (LOWER(name) = ? OR LOWER(name) = ? OR LOWER(name) LIKE ?)
    `).get(normName, normName + 's', '%' + normName + '%');
    
    if (existing) {
      // If both have empty quantities (stripped), they are already combined! Just skip adding duplicate.
      if (!existing.quantity && !cleanQty) {
        return { id: existing.id, merged: true };
      }
      
      // Parse units/quantities to see if compatible
      const oldParsed = parseIngredientLine(existing.quantity ? `${existing.quantity} ${existing.name}` : existing.name);
      const newParsed = parseIngredientLine(cleanQty ? `${cleanQty} ${cleanName}` : cleanName);
      
      if (oldParsed && newParsed) {
        // If units are identical, we check if they are weight/packaging based
        if (oldParsed.unit === newParsed.unit) {
          if (oldParsed.unit && isWeightOrPack(oldParsed.unit)) {
            const totalVal = oldParsed.quantityValue + newParsed.quantityValue;
            const formatted = formatQty(totalVal);
            const mergedQty = `${formatted} ${oldParsed.unit}s`;
            
            db.prepare('UPDATE shopping_list SET quantity = ? WHERE id = ?').run(mergedQty.trim(), existing.id);
            return { id: existing.id, merged: true };
          } else {
            // Otherwise (volume/counts), we already stripped quantities, so it's a duplicate. Skip!
            return { id: existing.id, merged: true };
          }
        }
        // If no units, we check if they are simple count numbers
        else if (!oldParsed.unit && !newParsed.unit) {
          const totalVal = oldParsed.quantityValue + newParsed.quantityValue;
          const formatted = formatQty(totalVal);
          db.prepare('UPDATE shopping_list SET quantity = ? WHERE id = ?').run(formatted.trim(), existing.id);
          return { id: existing.id, merged: true };
        }
      }
    }
  }
  
  // Otherwise, insert new item
  const stmt = db.prepare(`
    INSERT INTO shopping_list (name, quantity, checked, recipe_id)
    VALUES (?, ?, ?, ?)
  `);
  const result = stmt.run(cleanName, cleanQty, isStaple, recipeId);
  return { id: result.lastInsertRowid, merged: false };
}

/**
 * Parse and add all ingredients from a recipe to the shopping list.
 */
function addFromRecipe(recipeId) {
  const db = getDb();
  
  // Double-import protection: Skip importing if unchecked items from this recipe already exist
  const existing = db.prepare('SELECT id FROM shopping_list WHERE checked = 0 AND recipe_id = ?').get(recipeId);
  if (existing) {
    console.log(`[Shopping List] Recipe ID ${recipeId} already has unchecked items. Skipping to avoid duplication.`);
    return 0;
  }

  const recipe = db.prepare('SELECT id, ingredients FROM recipes WHERE id = ?').get(recipeId);
  if (!recipe) throw new Error('Recipe not found');

  const ingredients = safeJsonParse(recipe.ingredients, []);
  if (!Array.isArray(ingredients) || ingredients.length === 0) return 0;

  db.transaction(() => {
    for (const line of ingredients) {
      const parsed = parseIngredientLine(line);
      if (parsed && parsed.name) {
        let qtyStr = '';
        
        // Keep quantities ONLY if they are weight, packaging, or simple count-based units
        // Strip only volume units (cups, tbsp, tsp, pinch, handful, bunch, etc.)
        const isVolume = ['cup', 'tsp', 'tbsp', 'pinch', 'handful', 'bunch', 'clove', 'slice', 'piece'].includes(parsed.unit);
        
        if (!isVolume && parsed.quantityValue > 0) {
          const formatted = formatQty(parsed.quantityValue);
          qtyStr = parsed.unit ? `${formatted} ${parsed.unit}s` : formatted;
        }
        
        addItem(parsed.name, qtyStr, recipe.id);
      }
    }
  })();

  return ingredients.length;
}

/**
 * Toggle check status of a shopping list item.
 */
function toggleItem(id, checked) {
  const db = getDb();
  db.prepare('UPDATE shopping_list SET checked = ? WHERE id = ?').run(checked ? 1 : 0, id);
}

/**
 * Remove an item from the shopping list.
 */
function removeItem(id) {
  const db = getDb();
  db.prepare('DELETE FROM shopping_list WHERE id = ?').run(id);
}

/**
 * Clear all checked/purchased items.
 */
function clearChecked() {
  const db = getDb();
  db.prepare('DELETE FROM shopping_list WHERE checked = 1').run();
}

/**
 * Clear the entire shopping list.
 */
function clearAll() {
  const db = getDb();
  db.prepare('DELETE FROM shopping_list').run();
}

module.exports = {
  getItems,
  addItem,
  addFromRecipe,
  toggleItem,
  removeItem,
  clearChecked,
  clearAll,
  parseIngredientLine,
  cleanIngredientName
};
