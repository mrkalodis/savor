const express = require('express');
const router = express.Router();
const shoppingListService = require('../services/shopping-list-service');
const recipeService = require('../services/recipe-service');
const collectionService = require('../services/collection-service');
const mealPlanService = require('../services/meal-plan-service');

// GET /shopping-list
router.get('/shopping-list', async (req, res, next) => {
  try {
    const items = shoppingListService.getItems();
    const collections = await collectionService.getAllWithCounts();
    const recipesData = await recipeService.getAll({ limit: 1000 });

    res.render('layouts/main', {
      title: 'Shopping List',
      view: 'shopping-list',
      items,
      recipes: recipesData.recipes || [],
      sidebarCollections: collections,
      currentPath: '/shopping-list'
    });
  } catch (err) {
    next(err);
  }
});

// POST /shopping-list - Add custom item
router.post('/shopping-list', async (req, res, next) => {
  try {
    const { name, quantity } = req.body;
    if (!name || !name.trim()) {
      throw new Error('Item name is required');
    }

    shoppingListService.addItem(name, quantity || '');
    res.redirect('/shopping-list');
  } catch (err) {
    next(err);
  }
});

// POST /shopping-list/check - Toggle checked status
router.post('/shopping-list/check', async (req, res, next) => {
  try {
    const { id, checked } = req.body;
    const itemId = parseInt(id, 10);
    const isChecked = checked === '1' || checked === 1 || checked === 'true' || checked === true;

    shoppingListService.toggleItem(itemId, isChecked);

    if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
      return res.json({ success: true });
    }
    res.redirect('/shopping-list');
  } catch (err) {
    next(err);
  }
});

// POST /shopping-list/recipe - Add ingredients from a recipe
router.post('/shopping-list/recipe', async (req, res, next) => {
  try {
    const { recipe_id } = req.body;
    if (!recipe_id) {
      throw new Error('Recipe ID is required');
    }

    shoppingListService.addFromRecipe(parseInt(recipe_id, 10));
    res.redirect('/shopping-list');
  } catch (err) {
    next(err);
  }
});

// POST /shopping-list/clear-checked - Clear bought items
router.post('/shopping-list/clear-checked', async (req, res, next) => {
  try {
    shoppingListService.clearChecked();
    res.redirect('/shopping-list');
  } catch (err) {
    next(err);
  }
});

// POST /shopping-list/clear-all - Clear everything
router.post('/shopping-list/clear-all', async (req, res, next) => {
  try {
    shoppingListService.clearAll();
    res.redirect('/shopping-list');
  } catch (err) {
    next(err);
  }
});

// POST /shopping-list/bulk-import-meals - Import ingredients for all meals in a date range
router.post('/shopping-list/bulk-import-meals', async (req, res, next) => {
  try {
    const { startDate, endDate } = req.body;
    if (!startDate || !endDate) {
      throw new Error('Start date and end date are required');
    }

    const meals = mealPlanService.getForDateRange(startDate, endDate);
    const recipesToImport = meals.filter(m => m.recipe_id);
    
    let totalImported = 0;
    for (const meal of recipesToImport) {
      totalImported += shoppingListService.addFromRecipe(meal.recipe_id);
    }

    res.redirect(`/shopping-list?success=Imported ingredients from ${recipesToImport.length} planned meals.`);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
