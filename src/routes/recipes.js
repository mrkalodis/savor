const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { config } = require('../config');
const recipeService = require('../services/recipe-service');
const collectionService = require('../services/collection-service');
const imageService = require('../services/image-service');
const searchService = require('../services/search-service');
const { formatDuration } = require('../utils/time-parser');

const upload = multer({
  dest: path.join(config.dataDir, 'tmp'),
  limits: { fileSize: 10 * 1024 * 1024 }
});

// GET /recipes - All active recipes, paginated
router.get('/recipes', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const collectionId = req.query.collection || undefined;
    const tag = req.query.tag || undefined;
    const q = req.query.q || undefined;
    const favorites = req.query.favorites === '1' ? true : undefined;

    let recipes;
    if (q) {
      const searchRes = await searchService.search(req.user.id, q, {
        collection: collectionId,
        tag,
        status: 'active',
        limit: 20,
        offset: (page - 1) * 20
      });
      const totalPages = Math.max(1, Math.ceil(searchRes.total / 20));
      recipes = {
        recipes: searchRes.results,
        total: searchRes.total,
        page,
        totalPages
      };
    } else {
      recipes = await recipeService.getAll(req.user.id, {
        status: 'active',
        collectionId,
        tag,
        page,
        limit: 20,
        favorites
      });
    }

    const collections = await collectionService.getAllWithCounts(req.user.id);

    res.render('layouts/main', {
      title: favorites ? 'Favorite Recipes' : (q ? `Search: "${q}"` : 'Recipes'),
      view: 'recipes',
      formatDuration,
      recipes,
      collections,
      currentPage: page,
      currentCollection: collectionId,
      currentTag: tag,
      currentSearch: q,
      sidebarCollections: collections,
      currentPath: '/recipes',
      isFavorites: !!favorites
    });
  } catch (err) {
    next(err);
  }
});

// GET/POST /recipes/new - Create form
router.all('/recipes/new', async (req, res, next) => {
  try {
    const collections = await collectionService.getAll(req.user.id);

    if (req.query.import || req.body.url) {
      let preScraped = null;
      let importUrl = req.query.url || req.body.url || '';
      
      if (req.body.recipe_json) {
        try {
          const rawJson = JSON.parse(req.body.recipe_json);
          const { parseRawJsonLd } = require('../services/recipe-parser');
          preScraped = parseRawJsonLd(rawJson, importUrl);
        } catch (err) {
          console.warn('Failed to parse recipe_json from bookmarklet:', err.message);
        }
      }

      return res.render('layouts/main', {
        title: 'Import Recipe',
        view: 'recipe-import',
        formatDuration,
        collections,
        importUrl,
        preScraped: preScraped ? JSON.stringify(preScraped) : null
      });
    }

    res.render('layouts/main', {
      title: 'New Recipe',
      view: 'recipe-form',
      formatDuration,
      mode: 'create',
      recipe: {},
      collections
    });
  } catch (err) {
    next(err);
  }
});

// POST /recipes/new/ai - Import from AI Chat
router.post('/recipes/new/ai', async (req, res, next) => {
  try {
    const rawText = req.body.text || '';
    const collections = await collectionService.getAll(req.user.id);
    
    // Strip markdown asterisks to make parsing bulletproof
    const cleanText = rawText.replace(/\*/g, '');

    let title = '';
    let ingredients = [];
    let instructions = [];
    let servings = '';
    let prepTime = '';
    let cookTime = '';
    let totalTime = '';
    let description = '';

    // 1. Parse Title
    const titleMatch = cleanText.match(/Title:\s*(.*)/i) || 
                       cleanText.match(/^#+\s*(.*)/m);
    if (titleMatch) {
      title = titleMatch[1].replace(/[_#]/g, '').trim();
    } else {
      // Look for the first short non-header line that might be a title
      const lines = cleanText.split('\n').map(l => l.trim());
      for (const line of lines) {
        if (line && line.length < 80 && 
            !line.toLowerCase().includes('ingredient') && 
            !line.toLowerCase().includes('instruction') && 
            !line.toLowerCase().startsWith('here is') && 
            !line.toLowerCase().startsWith('sure')) {
          title = line.replace(/[_#]/g, '').trim();
          break;
        }
      }
    }

    // 2. Parse Ingredients
    const ingBlock = cleanText.match(/Ingredients?:?([\s\S]*?)(?:Instructions?:?|Directions?:?)/i);
    if (ingBlock) {
      ingredients = ingBlock[1].split('\n')
        .map(i => i.replace(/^[-*•\s]+/, '').trim()) // Strip list bullets and spaces
        .filter(i => i.length > 0 && !i.toLowerCase().includes('ingredient'));
    }
    
    // 3. Parse Instructions
    const instBlock = cleanText.match(/(?:Instructions?:?|Directions?:?)([\s\S]*)$/i);
    if (instBlock) {
      instructions = instBlock[1].split('\n')
        .map(i => i.replace(/^(\d+\.|[-*•])\s+/, '').trim()) // Strip step numbers/bullets
        .filter(i => i.length > 0 && !i.toLowerCase().includes('instruction'));
    }

    // 4. Parse Servings
    const servingsMatch = cleanText.match(/(?:Servings|Serves|Yield):\s*(.*)/i);
    if (servingsMatch) servings = servingsMatch[1].replace(/[_#]/g, '').trim();

    // 5. Parse Times
    const prepMatch = cleanText.match(/(?:Prep\s*Time|Prep):\s*(\d+)/i);
    if (prepMatch) prepTime = prepMatch[1].trim();

    const cookMatch = cleanText.match(/(?:Cook\s*Time|Cook):\s*(\d+)/i);
    if (cookMatch) cookTime = cookMatch[1].trim();

    const totalMatch = cleanText.match(/(?:Total\s*Time|Total):\s*(\d+)/i);
    if (totalMatch) totalTime = totalMatch[1].trim();

    // 6. Parse Description
    const lines = cleanText.split('\n').map(l => l.trim());
    let descLines = [];
    for (const line of lines) {
      if (!line) continue;
      if (line.startsWith('#') || line.toLowerCase().startsWith('title:')) {
        continue;
      }
      if (line.toLowerCase().startsWith('ingredients') || line.toLowerCase().startsWith('instructions')) {
        break;
      }
      if (line.toLowerCase().includes('servings:') || line.toLowerCase().includes('serves:') || line.toLowerCase().includes('time:')) {
        continue;
      }
      if (line.toLowerCase().startsWith('here is') || line.toLowerCase().startsWith('sure,')) {
        continue;
      }
      descLines.push(line);
    }
    description = descLines.join(' ').replace(/[_#]/g, '').trim();
    if (description.length > 300) {
      description = description.substring(0, 300) + '...';
    }
    
    if (!title && ingredients.length === 0 && instructions.length === 0) {
      instructions = cleanText.split('\n').filter(i => i.trim().length > 0);
      title = 'AI Generated Recipe';
    } else if (!title) {
      title = 'AI Generated Recipe';
    }

    res.render('layouts/main', {
      title: 'New AI Recipe',
      view: 'recipe-form',
      formatDuration,
      mode: 'create',
      recipe: { 
        title, 
        description,
        ingredients, 
        instructions, 
        servings,
        prep_time: prepTime,
        cook_time: cookTime,
        total_time: totalTime
      },
      collections
    });
  } catch (err) {
    next(err);
  }
});

// POST /recipes - Save new recipe
router.post('/recipes', upload.single('image'), async (req, res, next) => {
  try {
    const data = req.body;

    // Parse tags from comma-separated string
    if (typeof data.tags === 'string') {
      data.tags = data.tags
        .split(',')
        .map(t => t.trim())
        .filter(Boolean);
    }

    const recipe = await recipeService.create(req.user.id, data);

    // Handle image upload
    if (req.file) {
      const imgPath = await imageService.saveFromUpload(req.user.id, req.file, recipe.id);
      if (imgPath) {
        await recipeService.updateImagePath(req.user.id, recipe.id, imgPath);
      }
    }

    // Set tags if provided
    if (data.tags && data.tags.length > 0) {
      await recipeService.setTags(req.user.id, recipe.id, data.tags);
    }

    res.redirect(`/recipes/${recipe.id}`);
  } catch (err) {
    next(err);
  }
});

// GET /recipes/:id - View recipe
router.get('/recipes/:id', async (req, res, next) => {
  try {
    const recipe = await recipeService.getById(req.user.id, req.params.id);
    if (!recipe) {
      return res.status(404).render('layouts/main', {
        title: 'Not Found',
        view: '404'
      });
    }

    const collections = await collectionService.getAllWithCounts(req.user.id);

    res.render('layouts/main', {
      title: recipe.title,
      view: 'recipe-view',
      formatDuration,
      recipe,
      collections
    });
  } catch (err) {
    next(err);
  }
});

// GET /recipes/:id/edit - Edit form
router.get('/recipes/:id/edit', async (req, res, next) => {
  try {
    const recipe = await recipeService.getById(req.user.id, req.params.id);
    if (!recipe) {
      return res.status(404).render('layouts/main', {
        title: 'Not Found',
        view: '404'
      });
    }

    const collections = await collectionService.getAll(req.user.id);

    res.render('layouts/main', {
      title: `Edit - ${recipe.title}`,
      view: 'recipe-form',
      formatDuration,
      mode: 'edit',
      recipe,
      collections
    });
  } catch (err) {
    next(err);
  }
});

// PUT & POST /recipes/:id - Update recipe (supports multipart forms without method-override parsing issues)
const handleRecipeUpdate = async (req, res, next) => {
  try {
    const data = req.body;

    // Parse tags from comma-separated string
    if (typeof data.tags === 'string') {
      data.tags = data.tags
        .split(',')
        .map(t => t.trim())
        .filter(Boolean);
    }

    await recipeService.update(req.user.id, req.params.id, data);

    // Handle image upload or removal
    if (req.file) {
      const imgPath = await imageService.saveFromUpload(req.user.id, req.file, req.params.id);
      if (imgPath) {
        await recipeService.updateImagePath(req.user.id, req.params.id, imgPath);
      }
    } else if (data.remove_image === '1') {
      await imageService.deleteImages(req.user.id, req.params.id);
      await recipeService.updateImagePath(req.user.id, req.params.id, '');
    }

    // Update tags if provided
    if (data.tags) {
      await recipeService.setTags(req.user.id, req.params.id, data.tags);
    }

    res.redirect(`/recipes/${req.params.id}`);
  } catch (err) {
    next(err);
  }
};
router.put('/recipes/:id', upload.single('image'), handleRecipeUpdate);
router.post('/recipes/:id', upload.single('image'), handleRecipeUpdate);



// POST /recipes/:id/favorite - Toggle favorite
router.post('/recipes/:id/favorite', async (req, res, next) => {
  try {
    await recipeService.toggleFavorite(req.user.id, req.params.id);
    res.redirect(req.get('Referer') || '/');
  } catch (err) {
    next(err);
  }
});

// POST /recipes/:id/move - Move to collection
router.post('/recipes/:id/move', async (req, res, next) => {
  try {
    await recipeService.moveToCollection(req.user.id, req.params.id, req.body.collection_id);
    res.redirect(req.get('Referer') || '/');
  } catch (err) {
    next(err);
  }
});

// POST /recipes/:id/archive - Archive recipe
router.post('/recipes/:id/archive', async (req, res, next) => {
  try {
    await recipeService.archive(req.user.id, req.params.id);
    res.redirect(req.get('Referer') || '/');
  } catch (err) {
    next(err);
  }
});

// POST /recipes/:id/restore - Restore recipe
router.post('/recipes/:id/restore', async (req, res, next) => {
  try {
    await recipeService.restore(req.user.id, req.params.id);
    res.redirect(req.get('Referer') || '/');
  } catch (err) {
    next(err);
  }
});

// POST /recipes/:id/delete - Soft delete
router.post('/recipes/:id/delete', async (req, res, next) => {
  try {
    await recipeService.softDelete(req.user.id, req.params.id);
    res.redirect(req.get('Referer') || '/');
  } catch (err) {
    next(err);
  }
});

// DELETE /recipes/:id - Permanent delete
router.delete('/recipes/:id', async (req, res, next) => {
  try {
    await imageService.deleteImages(req.user.id, req.params.id);
    await recipeService.delete(req.user.id, req.params.id);
    
    const referer = req.get('Referer') || '';
    if (referer.includes('/trash')) {
      res.redirect('/trash');
    } else {
      res.redirect('/recipes');
    }
  } catch (err) {
    next(err);
  }
});

// GET /recipes/:id/print - Print view
router.get('/recipes/:id/print', async (req, res, next) => {
  try {
    const recipe = await recipeService.getById(req.user.id, req.params.id);
    if (!recipe) {
      return res.status(404).render('layouts/main', {
        title: 'Not Found',
        view: '404'
      });
    }

    res.render('layouts/main', {
      title: `Print - ${recipe.title}`,
      view: 'print',
      formatDuration,
      recipe
    });
  } catch (err) {
    next(err);
  }
});

// GET /archive - Archived recipes
router.get('/archive', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;

    const recipes = await recipeService.getAll(req.user.id, {
      status: 'archived',
      page,
      limit: 20
    });

    const collections = await collectionService.getAllWithCounts(req.user.id);

    res.render('layouts/main', {
      title: 'Archived Recipes',
      view: 'archive',
      formatDuration,
      recipes,
      collections,
      currentPage: page,
      status: 'archived'
    });
  } catch (err) {
    next(err);
  }
});

// GET /trash - Deleted recipes
router.get('/trash', async (req, res, next) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;

    const recipes = await recipeService.getAll(req.user.id, {
      status: 'deleted',
      page,
      limit: 20
    });

    const collections = await collectionService.getAllWithCounts(req.user.id);

    res.render('layouts/main', {
      title: 'Trash',
      view: 'archive',
      formatDuration,
      recipes,
      collections,
      currentPage: page,
      status: 'deleted'
    });
  } catch (err) {
    next(err);
  }
});

// GET /recipes/:id/cook - Standalone Hands-free Cook Mode
router.get('/recipes/:id/cook', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const recipe = await recipeService.getById(req.user.id, id);
    if (!recipe) {
      throw new Error('Recipe not found');
    }

    res.render('cook', {
      title: `${recipe.title} — Cook Mode`,
      recipe,
      formatDuration: require('../utils/time-parser').formatDuration
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
