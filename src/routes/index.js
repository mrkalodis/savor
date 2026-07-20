const express = require('express');
const router = express.Router();
const recipeService = require('../services/recipe-service');
const collectionService = require('../services/collection-service');
const settingsService = require('../services/settings-service');
const { formatDuration } = require('../utils/time-parser');

// GET / - Dashboard
router.get('/', async (req, res, next) => {
  try {
    const [recentRecipes, favoriteRecipes, stats, collections] = await Promise.all([
      recipeService.getRecent(req.user.id, 8),
      recipeService.getFavorites(req.user.id, 4),
      recipeService.getStats(req.user.id),
      collectionService.getAllWithCounts(req.user.id)
    ]);

    const onboardingComplete = settingsService.get(req.user.id, 'onboarding_complete');
    const showOnboarding = onboardingComplete !== '1' && stats.totalRecipes === 0 && stats.totalCollections === 0;

    res.render('layouts/main', {
      title: 'Dashboard',
      view: 'home',
      formatDuration,
      recentRecipes,
      favoriteRecipes,
      stats,
      collections,
      showOnboarding
    });
  } catch (err) {
    next(err);
  }
});

// POST /onboarding/complete - Skip wizard
router.post('/onboarding/complete', async (req, res, next) => {
  try {
    settingsService.set(req.user.id, 'onboarding_complete', '1');
    res.redirect('/');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
