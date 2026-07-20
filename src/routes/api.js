const express = require('express');
const router = express.Router();
const multer = require('multer');
const { createWorker } = require('tesseract.js');
const searchService = require('../services/search-service');
const recipeService = require('../services/recipe-service');
const recipeParser = require('../services/recipe-parser');
const duplicateDetector = require('../services/duplicate-detector');
const collectionService = require('../services/collection-service');
const imageService = require('../services/image-service');

// Multer: store uploaded OCR images in memory (no disk write needed)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB max
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  }
});

// GET /search - Search recipes (JSON)
router.get('/search', async (req, res, next) => {
  try {
    const { q, collection, tag, status, limit, offset } = req.query;

    const results = await searchService.search(req.user.id, q, {
      collection,
      tag,
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      offset: offset ? parseInt(offset, 10) : undefined
    });

    res.json(results);
  } catch (err) {
    next(err);
  }
});

// POST /import/preview - Parse URL and return preview
router.post('/import/preview', async (req, res, next) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    const parsed = await recipeParser.parseFromUrl(url);
    const duplicate = await duplicateDetector.checkDuplicate(req.user.id, parsed);

    res.json({
      recipe: parsed,
      duplicate
    });
  } catch (err) {
    const url = req.body.url || '';
    console.warn(`Scraping failed for ${url}:`, err.message);
    res.json({
      recipe: {
        title: '',
        description: '',
        ingredients: [],
        instructions: [],
        prepTime: 0,
        cookTime: 0,
        totalTime: 0,
        servings: '',
        notes: '',
        sourceUrl: url,
        imageUrl: '',
        tags: []
      },
      duplicate: { isDuplicate: false },
      warning: "We couldn't scrape this site automatically, but you can enter the details manually below!"
    });
  }
});

// POST /import/save - Save imported recipe
router.post('/import/save', async (req, res, next) => {
  try {
    const { duplicate_action, ...recipeData } = req.body;

    // Check for duplicates
    const duplicate = await duplicateDetector.checkDuplicate(req.user.id, recipeData);

    if (duplicate.isDuplicate && duplicate_action === 'skip') {
      return res.json({
        skipped: true,
        existingRecipe: duplicate.existingRecipe
      });
    }

    if (duplicate.isDuplicate && duplicate_action === 'update') {
      const updated = await recipeService.update(req.user.id, duplicate.existingRecipe.id, recipeData);
      return res.json({ recipe: updated, updated: true });
    }

    // Create new recipe
    const recipe = await recipeService.create(req.user.id, recipeData);

    // Save image from URL if provided
    if (recipeData.image_url) {
      try {
        const imgPath = await imageService.saveFromUrl(recipeData.image_url, recipe.id);
        if (imgPath) {
          await recipeService.updateImagePath(req.user.id, recipe.id, imgPath);
        }
      } catch (imgErr) {
        // Non-fatal: image save failure shouldn't block recipe creation
        console.error('Failed to save image from URL:', imgErr.message);
      }
    }

    // Set tags if provided
    if (recipeData.tags && recipeData.tags.length > 0) {
      await recipeService.setTags(req.user.id, recipe.id, recipeData.tags);
    }

    res.json({ recipe, created: true });
  } catch (err) {
    next(err);
  }
});

// GET /recipes/:id - Recipe as JSON
router.get('/recipes/:id', async (req, res, next) => {
  try {
    const recipe = await recipeService.getById(req.user.id, req.params.id);
    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    res.json(recipe);
  } catch (err) {
    next(err);
  }
});

// GET /tags - All tags as JSON array
router.get('/tags', async (req, res, next) => {
  try {
    const stats = await recipeService.getStats(req.user.id);
    res.json(stats.tags || []);
  } catch (err) {
    next(err);
  }
});

// GET /tags/search - Search tags
router.get('/tags/search', async (req, res, next) => {
  try {
    const { q } = req.query;
    const stats = await recipeService.getStats(req.user.id);
    const allTags = stats.tags || [];

    const matching = q
      ? allTags.filter(tag =>
          (typeof tag === 'string' ? tag : tag.name)
            .toLowerCase()
            .includes(q.toLowerCase())
        )
      : allTags;

    res.json(matching);
  } catch (err) {
    next(err);
  }
});

// PUT /collections/reorder - Reorder collections
router.put('/collections/reorder', async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: 'ids must be an array' });
    }

    await collectionService.reorder(req.user.id, ids);
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

// PUT /collections/:id/recipes/reorder - Reorder recipes in collection
router.put('/collections/:id/recipes/reorder', async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)) {
      return res.status(400).json({ error: 'ids must be an array' });
    }

    await recipeService.reorder(req.user.id, req.params.id, ids);
    res.sendStatus(200);
  } catch (err) {
    next(err);
  }
});

// POST /import/ocr - OCR scan a recipe image
router.post('/import/ocr', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    // Run Tesseract OCR — PSM 1 = auto OSD, better for multi-column layouts
    const worker = await createWorker('eng');
    await worker.setParameters({ tessedit_pageseg_mode: '1' });
    const { data: { text } } = await worker.recognize(req.file.buffer);
    await worker.terminate();

    const rawText = (text || '').trim();
    if (rawText.length < 20) {
      return res.status(422).json({ error: 'Could not read any text from this image. Try a clearer, higher-contrast photo.' });
    }

    const recipe = parseOcrText(rawText);
    recipe.rawText = rawText; // Send back raw OCR for user reference
    res.json(recipe);
  } catch (err) {
    console.error('OCR error:', err.message);
    res.status(500).json({ error: 'OCR processing failed: ' + err.message });
  }
});

/**
 * Parse raw Tesseract OCR text into recipe fields.
 * Handles:
 * - 2-column layouts (ingredients left / method right)
 * - "INGREDIENTS METHOD" combined header line
 * - "@" and "©" OCR artifacts from circular numbered bullets (step separators)
 * - Garbled/low-quality lines
 */
function parseOcrText(rawText) {
  const allLines = rawText.split(/\n/).map(l => l.trim());

  // ── Helpers ──────────────────────────────────────────────────────────────
  const letterRatio = str => (str.match(/[a-zA-Z]/g) || []).length / Math.max(str.length, 1);
  const isGarbled  = line => line.length < 3 || letterRatio(line) < 0.40 || /^[\W\d_]{3,}$/.test(line);
  const cleanLines = allLines.filter(l => l.length > 0);

  // ── Title: Look for leading ALL-CAPS block (recipe card titles are bold/large) ──
  let titleParts = [];
  for (const line of cleanLines.slice(0, 12)) {
    if (isGarbled(line)) continue;
    // Stop at description-like lines or metadata
    if (/\b(SERVES?|PREP|COOK|CALORIES|INGREDIENTS?|METHOD|INSTRUCTIONS?)\b/i.test(line)) break;
    // ALL CAPS line or first clean short line = title candidate
    if (/^[A-Z][A-Z\s&',!-]+$/.test(line) && line.length > 3) {
      titleParts.push(line.trim());
    } else if (titleParts.length > 0) {
      break; // Title block ended
    }
  }
  const title = titleParts.length > 0
    ? titleParts.join(' ').replace(/\s+/g, ' ')
    : (cleanLines.find(l => !isGarbled(l) && l.length >= 5 && l.length <= 80) || 'Scanned Recipe');

  // ── Servings / Times ──────────────────────────────────────────────────────
  let servings = '';
  const joinedText = cleanLines.join(' ');
  const srvM = joinedText.match(/SERVES?\s+(\d+)|SERVINGS?\s*:?\s*(\d+)/i);
  if (srvM) servings = (srvM[1] || srvM[2]).trim();

  // ── Find where the body (ingredients+instructions) starts ─────────────────
  // Look for combined "INGREDIENTS METHOD" or "INGREDIENTS ... METHOD" header line
  let bodyStart = 0;
  for (let i = 0; i < cleanLines.length; i++) {
    const l = cleanLines[i];
    if (/\bINGREDIENTS\b.{0,20}\bMETHOD\b/i.test(l) ||
        /\bINGREDIENTS\b.{0,20}\bINSTRUCTIONS\b/i.test(l)) {
      bodyStart = i + 1;
      break;
    }
    if (/^\s*INGREDIENTS?\s*$/i.test(l)) {
      bodyStart = i + 1;
      break;
    }
  }

  // ── Parse body lines ─────────────────────────────────────────────────────
  const ingredients  = [];
  const instructions = [];

  // Bullet/marker pattern for ingredients (includes OCR misreads: «, +, •, ◆, ✓)
  const INGR_MARKER = /^[+•·*«◆▪✓✗➤➜→\-]\s*/;

  // Units pattern — used to detect a line is an ingredient even without a bullet
  const UNITS_RE = /\b\d[\d./]*\s*(g|kg|ml|l|oz|lb|tsp|tbsp|cup|cups|clove|bunch|pinch|dash|slice|handful|sprig|can|tin|handful)s?\b/i;

  // Verb patterns that indicate start of an instruction step (after a merged column read)
  const STEP_VERB = /^(Add|Cook|Bake|Stir|Mix|Pour|Heat|Season|Remove|Return|Bring|Cover|Combine|Sprinkle|Slice|Chop|Dice|Drain|Fry|Grill|Roast|Simmer|Boil|Blend|Whisk|Transfer|Place|Serve|Finish|Peel|Cut|Make|Prepare|Top|Fill|Fold|Coat|Roll|Press|Squeeze|Sauté|Saute)\b/i;

  for (let i = bodyStart; i < cleanLines.length; i++) {
    const line = cleanLines[i];
    if (!line || isGarbled(line)) continue;

    // Skip known metadata/header lines
    if (/^(INGREDIENTS?|METHOD|INSTRUCTIONS?|DIRECTIONS?|STEPS?|PER PORTION|STORAGE|NOTES?|NUTRITION|CALORIES|PROTEIN|FAT|CARBS)\b/i.test(line)) continue;

    const hasMarker = INGR_MARKER.test(line);

    if (hasMarker) {
      // Strip leading marker
      let rest = line.replace(INGR_MARKER, '').trim();

      // Case 1: line has "@" or "©" – Tesseract reads circular step-number bullets as "@" or "©"
      // Pattern: "+ 60g chorizo, diced @ Cook the chorizo"
      const atIdx = rest.search(/\s+[@©]\s+/);
      if (atIdx !== -1) {
        const ingPart = rest.slice(0, atIdx).trim();
        const insPart = rest.slice(atIdx).replace(/^\s*[@©]\s*/, '').trim();
        if (ingPart) ingredients.push(ingPart);
        if (insPart && !isGarbled(insPart)) instructions.push(insPart);
        continue;
      }

      // Case 2: 2-column merge — "400g chicken breast, diced Cook the chorizo in..."
      // Detect ingredient part (ends at a prep-word like "diced") then instruction starts with capital verb
      const mergeRe = /^(.+?(?:,\s*(?:diced|chopped|sliced|grated|cooked|minced|peeled|crushed|halved|quartered|shredded|torn|crumbled)))\s+((?:Cook|Add|Stir|Mix|Heat|Season|Remove|Return|Bring|Cover|Combine|Sprinkle|Fry|Simmer|Boil|Bake|Roast|Grill|Place|Pour|Drain|Transfer|Serve|Finish|Top|Peel|Cut|Make|Fill|Fold|Coat|Roll|Sauté|Saute)[a-z\s,.']{10,})/i;
      const mMatch = rest.match(mergeRe);
      if (mMatch) {
        ingredients.push(mMatch[1].trim());
        instructions.push(mMatch[2].trim());
        continue;
      }

      // Case 3: just an ingredient line
      ingredients.push(rest);

    } else {
      // No marker — could be:
      // (a) continuation of an instruction
      // (b) a numbered step "1. Cook the chorizo"
      // (c) a garbled cross-column read
      const cleaned = line.replace(/^(step\s*)?\d+[.):\s]\s*/i, '').trim();
      if (cleaned.length < 5) continue;

      // Skip if this looks like a garbled cross-column fragment with no sentence meaning
      if (letterRatio(cleaned) < 0.5) continue;

      // Accept as instruction text
      instructions.push(cleaned);
    }
  }

  return {
    title,
    servings,
    ingredients: ingredients.join('\n'),
    instructions: instructions.join('\n'),
  };
}

module.exports = router;

