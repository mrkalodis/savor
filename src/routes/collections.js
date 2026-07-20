const express = require('express');
const router = express.Router();
const collectionService = require('../services/collection-service');
const recipeService = require('../services/recipe-service');
const { formatDuration } = require('../utils/time-parser');

// GET /collections - All collections
router.get('/collections', async (req, res, next) => {
  try {
    const collections = await collectionService.getAllWithCounts(req.user.id);

    res.render('layouts/main', {
      title: 'Collections',
      view: 'collections',
      formatDuration,
      collections
    });
  } catch (err) {
    next(err);
  }
});

// POST /collections - Create collection
router.post('/collections', async (req, res, next) => {
  try {
    const collection = await collectionService.create(req.user.id, req.body);
    res.redirect(`/collections/${collection.id}`);
  } catch (err) {
    next(err);
  }
});

// GET /collections/:id - Collection detail with recipes
router.get('/collections/:id', async (req, res, next) => {
  try {
    const collection = await collectionService.getById(req.user.id, req.params.id);
    if (!collection) {
      return res.status(404).render('layouts/main', {
        title: 'Not Found',
        view: '404'
      });
    }

    const page = parseInt(req.query.page, 10) || 1;
    const recipes = await recipeService.getAll(req.user.id, {
      status: 'active',
      collectionId: req.params.id,
      page,
      limit: 20
    });

    const collections = await collectionService.getAllWithCounts(req.user.id);

    res.render('layouts/main', {
      title: collection.name,
      view: 'collection',
      formatDuration,
      collection,
      recipes,
      collections,
      currentPage: page
    });
  } catch (err) {
    next(err);
  }
});

// PUT /collections/:id - Update collection
router.put('/collections/:id', async (req, res, next) => {
  try {
    await collectionService.update(req.user.id, req.params.id, req.body);
    res.redirect(`/collections/${req.params.id}`);
  } catch (err) {
    next(err);
  }
});

// DELETE /collections/:id - Delete collection
router.delete('/collections/:id', async (req, res, next) => {
  try {
    await collectionService.delete(req.user.id, req.params.id);
    res.redirect('/collections');
  } catch (err) {
    next(err);
  }
});

module.exports = router;
