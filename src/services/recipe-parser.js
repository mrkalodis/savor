const cheerio = require('cheerio');
const { parseDuration } = require('../utils/time-parser');
const { sanitizeString, sanitizeUrl } = require('../utils/sanitize');

/**
 * Parse a recipe from a URL using a 3-tier cascade:
 * 1. JSON-LD structured data
 * 2. Microdata (schema.org itemprop)
 * 3. Heuristic HTML parsing
 *
 * @param {string} url - The recipe URL to parse
 * @returns {Promise<Object>} Parsed recipe data
 */
async function parseFromUrl(url) {
  const html = await fetchPage(url);
  const $ = cheerio.load(html);

  // Try JSON-LD first (most reliable)
  let recipe = extractJsonLd($);

  // Fall back to Microdata
  if (!recipe) {
    recipe = extractMicrodata($);
  }

  // Fall back to heuristic HTML parsing
  if (!recipe) {
    recipe = extractHeuristic($);
  }

  // Ensure we always return a valid object
  if (!recipe) {
    recipe = {};
  }

  return normalizeRecipe(recipe, url);
}

// ============================================================
// Page Fetcher
// ============================================================

/**
 * Fetch a page using multiple strategies to bypass bot-blocking:
 * 1. Direct fetch with full browser headers
 * 2. Fallback via allorigins.win CORS proxy
 */
async function fetchPage(url) {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Upgrade-Insecure-Requests': '1',
  };

  // Strategy 1: Direct fetch
  try {
    const response = await fetch(url, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(12000),
    });
    // Accept 200 and 404 — some sites (e.g. BBC Good Food) return 404 but still serve full recipe HTML
    // Only hard-reject bot-blocking codes: 402, 403, 429, 503
    const blockingCodes = [402, 403, 429, 503];
    if (!blockingCodes.includes(response.status)) {
      const text = await response.text();
      if (text && text.length > 500) return text;
    }
    console.warn(`Direct fetch got ${response.status} for ${url}, trying proxy...`);
  } catch (err) {
    console.warn(`Direct fetch failed for ${url}: ${err.message}, trying proxy...`);
  }

  // Strategy 2: Fallback via allorigins.win CORS proxy
  try {
    const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}&charset=utf-8`;
    const proxyResponse = await fetch(proxyUrl, {
      signal: AbortSignal.timeout(25000),
    });
    const contentType = proxyResponse.headers.get('content-type') || '';
    if (proxyResponse.ok && contentType.includes('json')) {
      const json = await proxyResponse.json();
      if (json && json.contents && json.contents.length > 500) {
        console.log(`allorigins proxy succeeded for ${url}`);
        return json.contents;
      }
    }
    console.warn(`allorigins proxy returned unexpected content for ${url}`);
  } catch (err) {
    console.warn(`allorigins proxy failed for ${url}: ${err.message}`);
  }

  // Strategy 3: Fallback via thingproxy
  try {
    const thingProxyUrl = `https://thingproxy.freeboard.io/fetch/${url}`;
    const thingResponse = await fetch(thingProxyUrl, {
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
      signal: AbortSignal.timeout(20000),
    });
    if (thingResponse.ok) {
      const text = await thingResponse.text();
      if (text && text.length > 500) {
        console.log(`thingproxy succeeded for ${url}`);
        return text;
      }
    }
  } catch (err) {
    console.warn(`thingproxy also failed for ${url}: ${err.message}`);
  }

  throw new Error(`Unable to fetch recipe page: all strategies failed for ${url}`);
}

// ============================================================
// JSON-LD Extraction
// ============================================================

/**
 * Extract recipe data from JSON-LD script tags.
 * Handles multiple JSON-LD blocks, @graph arrays, and nested structures.
 */
function extractJsonLd($) {
  const scripts = $('script[type="application/ld+json"]');
  if (scripts.length === 0) return null;

  for (let i = 0; i < scripts.length; i++) {
    try {
      const raw = $(scripts[i]).html();
      if (!raw) continue;

      const data = JSON.parse(raw);
      const recipe = findRecipeInJsonLd(data);
      if (recipe) return parseJsonLdRecipe(recipe);
    } catch {
      // Malformed JSON-LD, skip this block
      continue;
    }
  }

  return null;
}

/**
 * Recursively search for a Recipe object in JSON-LD data.
 * Handles top-level objects, arrays, and @graph arrays.
 */
function findRecipeInJsonLd(data) {
  if (!data) return null;

  // Direct Recipe object
  if (isRecipeType(data)) return data;

  // Array of objects (or @graph)
  if (Array.isArray(data)) {
    for (const item of data) {
      const found = findRecipeInJsonLd(item);
      if (found) return found;
    }
    return null;
  }

  // Object with @graph property
  if (data['@graph'] && Array.isArray(data['@graph'])) {
    return findRecipeInJsonLd(data['@graph']);
  }

  return null;
}

/**
 * Check if a JSON-LD object is a Recipe type.
 */
function isRecipeType(obj) {
  if (!obj || typeof obj !== 'object') return false;
  const type = obj['@type'];
  if (!type) return false;

  if (typeof type === 'string') {
    return type === 'Recipe' || type === 'https://schema.org/Recipe' || type === 'http://schema.org/Recipe';
  }

  if (Array.isArray(type)) {
    return type.some(t => t === 'Recipe' || t === 'https://schema.org/Recipe' || t === 'http://schema.org/Recipe');
  }

  return false;
}

/**
 * Parse a JSON-LD Recipe object into our internal format.
 */
function parseJsonLdRecipe(recipe) {
  return {
    title: extractText(recipe.name),
    description: extractText(recipe.description),
    ingredients: extractStringArray(recipe.recipeIngredient),
    instructions: extractInstructions(recipe.recipeInstructions),
    prepTime: parseDuration(recipe.prepTime),
    cookTime: parseDuration(recipe.cookTime),
    totalTime: parseDuration(recipe.totalTime),
    servings: extractServings(recipe.recipeYield),
    notes: extractNotes(recipe),
    imageUrl: extractImageUrl(recipe.image),
    tags: extractTags(recipe),
  };
}

// ============================================================
// Microdata Extraction
// ============================================================

/**
 * Extract recipe data from Microdata (itemprop attributes).
 */
function extractMicrodata($) {
  const recipeEl = $('[itemtype*="schema.org/Recipe"]');
  if (recipeEl.length === 0) return null;

  const scope = recipeEl.first();

  const ingredients = [];
  scope.find('[itemprop="recipeIngredient"], [itemprop="ingredients"]').each(function () {
    const text = $(this).text().trim();
    if (text) ingredients.push(text);
  });

  const instructions = [];
  scope.find('[itemprop="recipeInstructions"]').each(function () {
    const el = $(this);
    // Check for nested HowToStep items
    const steps = el.find('[itemprop="step"], [itemprop="itemListElement"]');
    if (steps.length > 0) {
      steps.each(function () {
        const stepText = $(this).find('[itemprop="text"]').text().trim() || $(this).text().trim();
        if (stepText) instructions.push(stepText);
      });
    } else {
      const text = el.text().trim();
      if (text) instructions.push(text);
    }
  });

  if (ingredients.length === 0 && instructions.length === 0) return null;

  const getItemprop = (prop) => {
    const el = scope.find(`[itemprop="${prop}"]`).first();
    return el.attr('content') || el.text().trim() || '';
  };

  const getItempropTime = (prop) => {
    const el = scope.find(`[itemprop="${prop}"]`).first();
    return el.attr('content') || el.attr('datetime') || el.text().trim() || '';
  };

  const imageEl = scope.find('[itemprop="image"]').first();
  let imageUrl = imageEl.attr('src') || imageEl.attr('content') || imageEl.attr('href') || '';

  return {
    title: getItemprop('name'),
    description: getItemprop('description'),
    ingredients,
    instructions,
    prepTime: parseDuration(getItempropTime('prepTime')),
    cookTime: parseDuration(getItempropTime('cookTime')),
    totalTime: parseDuration(getItempropTime('totalTime')),
    servings: getItemprop('recipeYield'),
    notes: '',
    imageUrl,
    tags: [],
  };
}

// ============================================================
// Heuristic HTML Extraction
// ============================================================

/**
 * Best-effort extraction when no structured data is present.
 * Looks for common patterns in recipe websites.
 */
function extractHeuristic($) {
  const title = $('h1').first().text().trim()
    || $('meta[property="og:title"]').attr('content')
    || $('title').text().trim()
    || '';

  const description = $('meta[name="description"]').attr('content')
    || $('meta[property="og:description"]').attr('content')
    || '';

  const imageUrl = $('meta[property="og:image"]').attr('content')
    || $('meta[name="twitter:image"]').attr('content')
    || '';

  const ingredients = extractListNear($, ['ingredient']);
  const instructions = extractListNear($, ['instruction', 'direction', 'method', 'step', 'preparation']);

  if (!title && ingredients.length === 0 && instructions.length === 0) {
    return null;
  }

  return {
    title,
    description,
    ingredients,
    instructions,
    prepTime: null,
    cookTime: null,
    totalTime: null,
    servings: '',
    notes: '',
    imageUrl,
    tags: [],
  };
}

/**
 * Find list items near a heading containing one of the given keywords.
 */
function extractListNear($, keywords) {
  const results = [];
  const headings = $('h1, h2, h3, h4, h5, h6');

  headings.each(function () {
    const headingText = $(this).text().toLowerCase();
    const matches = keywords.some(kw => headingText.includes(kw));
    if (!matches) return;

    // Look for the next list after this heading
    let sibling = $(this).next();
    let attempts = 0;

    while (sibling.length > 0 && attempts < 5) {
      const tag = sibling.prop('tagName');
      if (tag === 'UL' || tag === 'OL') {
        sibling.find('li').each(function () {
          const text = $(this).text().trim();
          if (text) results.push(normalizeUnicodeFractions(text));
        });
        return false; // Break the .each loop
      }
      // Also check for divs containing lists
      const nestedList = sibling.find('ul, ol');
      if (nestedList.length > 0) {
        nestedList.first().find('li').each(function () {
          const text = $(this).text().trim();
          if (text) results.push(normalizeUnicodeFractions(text));
        });
        return false;
      }
      sibling = sibling.next();
      attempts++;
    }
  });

  return results;
}

// ============================================================
// Field Extractors
// ============================================================

/**
 * Safely extract text from a value that might be a string or object.
 */
function extractText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'object' && value['@value']) return String(value['@value']).trim();
  return String(value).trim();
}

/**
 * Extract an array of strings from a value that might be a string, array, or mixed.
 */
function extractStringArray(value) {
  if (!value) return [];
  if (typeof value === 'string') {
    return value.split('\n').map(s => normalizeUnicodeFractions(s.trim())).filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.map(item => {
      if (typeof item === 'string') return normalizeUnicodeFractions(item.trim());
      if (item && item.text) return normalizeUnicodeFractions(String(item.text).trim());
      if (item && item['@value']) return normalizeUnicodeFractions(String(item['@value']).trim());
      return '';
    }).filter(Boolean);
  }
  return [];
}

/**
 * Extract instructions from recipeInstructions.
 * Handles: plain text, array of strings, HowToStep objects, HowToSection groups.
 */
function extractInstructions(value) {
  if (!value) return [];

  // Single string
  if (typeof value === 'string') {
    return value.split(/\n+/).map(s => s.trim()).filter(Boolean);
  }

  // Array
  if (Array.isArray(value)) {
    const results = [];
    for (const item of value) {
      if (typeof item === 'string') {
        // Plain text step
        const lines = item.split(/\n+/).map(s => s.trim()).filter(Boolean);
        results.push(...lines);
      } else if (item && typeof item === 'object') {
        const type = item['@type'];

        if (type === 'HowToSection') {
          // Section with nested steps
          if (item.name) results.push(`## ${item.name}`);
          if (Array.isArray(item.itemListElement)) {
            for (const step of item.itemListElement) {
              const stepText = extractStepText(step);
              if (stepText) results.push(stepText);
            }
          }
        } else if (type === 'HowToStep') {
          const stepText = extractStepText(item);
          if (stepText) results.push(stepText);
        } else if (item.text) {
          results.push(String(item.text).trim());
        } else if (item['@value']) {
          results.push(String(item['@value']).trim());
        }
      }
    }
    return results.filter(Boolean);
  }

  return [];
}

/**
 * Extract text from a HowToStep object.
 */
function extractStepText(step) {
  if (!step) return '';
  if (typeof step === 'string') return step.trim();
  if (step.text) return String(step.text).trim();
  if (step.description) return String(step.description).trim();
  if (step.name) return String(step.name).trim();
  return '';
}

/**
 * Extract servings from recipeYield.
 * Handles number, string, or array.
 */
function extractServings(value) {
  if (!value) return '';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return String(value[0] || '').trim();
  return '';
}

/**
 * Extract notes from recipe meta fields (e.g., recipe tips, notes).
 */
function extractNotes(recipe) {
  const parts = [];
  if (recipe.cookingMethod) parts.push(`Cooking Method: ${extractText(recipe.cookingMethod)}`);
  if (recipe.recipeCategory) parts.push(`Category: ${extractText(recipe.recipeCategory)}`);
  if (recipe.recipeCuisine) parts.push(`Cuisine: ${extractText(recipe.recipeCuisine)}`);
  return parts.join('\n');
}

/**
 * Extract image URL from various formats.
 * Handles: string, array of strings, ImageObject, array of ImageObjects.
 */
function extractImageUrl(image) {
  if (!image) return '';
  if (typeof image === 'string') return image.trim();
  if (Array.isArray(image)) {
    // Find the first valid image
    for (const img of image) {
      const url = extractImageUrl(img);
      if (url) return url;
    }
    return '';
  }
  if (typeof image === 'object') {
    // ImageObject
    return image.url || image.contentUrl || '';
  }
  return '';
}

/**
 * Extract tags from recipe keywords and category.
 */
function extractTags(recipe) {
  const tags = new Set();

  if (recipe.keywords) {
    const kw = typeof recipe.keywords === 'string'
      ? recipe.keywords.split(',')
      : Array.isArray(recipe.keywords) ? recipe.keywords : [];

    for (const tag of kw) {
      const cleaned = String(tag).trim().toLowerCase();
      if (cleaned && cleaned.length < 50) tags.add(cleaned);
    }
  }

  if (recipe.recipeCategory) {
    const cats = Array.isArray(recipe.recipeCategory) ? recipe.recipeCategory : [recipe.recipeCategory];
    for (const cat of cats) {
      const cleaned = String(cat).trim().toLowerCase();
      if (cleaned) tags.add(cleaned);
    }
  }

  if (recipe.recipeCuisine) {
    const cuisines = Array.isArray(recipe.recipeCuisine) ? recipe.recipeCuisine : [recipe.recipeCuisine];
    for (const c of cuisines) {
      const cleaned = String(c).trim().toLowerCase();
      if (cleaned) tags.add(cleaned);
    }
  }

  return [...tags];
}

// ============================================================
// Normalization
// ============================================================

/**
 * Unicode fraction map for normalizing ingredients.
 */
const UNICODE_FRACTIONS = {
  '\u00BC': '1/4',
  '\u00BD': '1/2',
  '\u00BE': '3/4',
  '\u2150': '1/7',
  '\u2151': '1/9',
  '\u2152': '1/10',
  '\u2153': '1/3',
  '\u2154': '2/3',
  '\u2155': '1/5',
  '\u2156': '2/5',
  '\u2157': '3/5',
  '\u2158': '4/5',
  '\u2159': '1/6',
  '\u215A': '5/6',
  '\u215B': '1/8',
  '\u215C': '3/8',
  '\u215D': '5/8',
  '\u215E': '7/8',
};

/**
 * Replace Unicode fraction characters with their text equivalents.
 */
function normalizeUnicodeFractions(str) {
  if (!str) return '';
  let result = str;
  for (const [char, replacement] of Object.entries(UNICODE_FRACTIONS)) {
    result = result.replace(new RegExp(char, 'g'), replacement);
  }
  return result;
}

/**
 * Normalize and validate the final recipe object.
 */
function normalizeRecipe(recipe, sourceUrl) {
  const title = sanitizeString(recipe.title || '');
  const ingredients = Array.isArray(recipe.ingredients)
    ? recipe.ingredients.map(i => sanitizeString(normalizeUnicodeFractions(i))).filter(Boolean)
    : [];
  const instructions = Array.isArray(recipe.instructions)
    ? recipe.instructions.map(i => sanitizeString(i)).filter(Boolean)
    : [];

  // Calculate totalTime if not provided but prep + cook are
  let totalTime = recipe.totalTime || null;
  if (!totalTime && recipe.prepTime && recipe.cookTime) {
    totalTime = recipe.prepTime + recipe.cookTime;
  }

  return {
    title: title || 'Untitled Recipe',
    description: sanitizeString(recipe.description || ''),
    ingredients,
    instructions,
    prepTime: recipe.prepTime || null,
    cookTime: recipe.cookTime || null,
    totalTime,
    servings: sanitizeString(recipe.servings || ''),
    notes: sanitizeString(recipe.notes || ''),
    sourceUrl: sanitizeUrl(sourceUrl),
    imageUrl: recipe.imageUrl || '',
    tags: Array.isArray(recipe.tags) ? recipe.tags : [],
  };
}

/**
 * Parse a raw JSON-LD object directly.
 */
function parseRawJsonLd(jsonData, url = '') {
  try {
    const recipe = findRecipeInJsonLd(jsonData);
    if (recipe) {
      const parsed = parseJsonLdRecipe(recipe);
      return normalizeRecipe(parsed, url);
    }
  } catch (err) {
    console.error('Error parsing raw JSON-LD:', err.message);
  }
  return null;
}

module.exports = { parseFromUrl, parseRawJsonLd };
