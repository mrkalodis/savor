const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { config } = require('../config');
const recipeService = require('../services/recipe-service');
const imageService = require('../services/image-service');
const { formatDuration } = require('../utils/time-parser');
const { safeJsonParse } = require('../utils/sanitize');

const upload = multer({
  dest: path.join(config.dataDir, 'tmp'),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// GET /recipes/:id/export/json - Download recipe as JSON file
router.get('/recipes/:id/export/json', async (req, res, next) => {
  try {
    const recipe = await recipeService.getById(req.params.id);
    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    const filename = `${recipe.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.json`;
    const jsonData = JSON.stringify(recipe, null, 2);

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(jsonData);
  } catch (err) {
    next(err);
  }
});

// POST /recipes/import/json - Import recipe from JSON file
router.post('/recipes/import/json', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).redirect(req.get('Referer') || '/recipes');
    }

    const fileContent = fs.readFileSync(req.file.path, 'utf-8');
    const recipeData = safeJsonParse(fileContent);

    if (!recipeData) {
      // Clean up temp file
      fs.unlinkSync(req.file.path);
      return res.status(400).redirect(req.get('Referer') || '/recipes');
    }

    // Remove id and metadata fields to create a fresh recipe
    delete recipeData.id;
    delete recipeData.created_at;
    delete recipeData.updated_at;

    const recipe = await recipeService.create(recipeData);

    // Save image from URL if present in imported data
    if (recipeData.image_url) {
      try {
        await imageService.saveFromUrl(recipeData.image_url, recipe.id);
      } catch (imgErr) {
        console.error('Failed to save imported image:', imgErr.message);
      }
    }

    // Set tags if present
    if (recipeData.tags && Array.isArray(recipeData.tags)) {
      await recipeService.setTags(recipe.id, recipeData.tags);
    }

    // Clean up temp file
    try {
      fs.unlinkSync(req.file.path);
    } catch (e) {
      // ignore cleanup errors
    }

    res.redirect(`/recipes/${recipe.id}`);
  } catch (err) {
    // Clean up temp file on error
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (e) {
        // ignore cleanup errors
      }
    }
    next(err);
  }
});

// GET /recipes/:id/export/print - Standalone printable page (no layout)
router.get('/recipes/:id/export/print', async (req, res, next) => {
  try {
    const recipe = await recipeService.getById(req.params.id);
    if (!recipe) {
      return res.status(404).json({ error: 'Recipe not found' });
    }

    res.render('print', {
      title: `Print - ${recipe.title}`,
      formatDuration,
      recipe,
      layout: false
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
