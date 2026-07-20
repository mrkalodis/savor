const express = require('express');
const router = express.Router();
const mealPlanService = require('../services/meal-plan-service');
const recipeService = require('../services/recipe-service');
const collectionService = require('../services/collection-service');

// Helper to get Monday of a given date
function getMonday(d) {
  const dateObj = new Date(d);
  const day = dateObj.getDay();
  const diff = dateObj.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(dateObj.setDate(diff));
}

// Helper to format Date object as YYYY-MM-DD in local time
function formatDate(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// GET /meal-planner
router.get('/meal-planner', async (req, res, next) => {
  try {
    const today = new Date();
    let selectedDate = today;

    if (req.query.week) {
      const parts = req.query.week.split('-');
      if (parts.length === 3) {
        selectedDate = new Date(parts[0], parts[1] - 1, parts[2]);
      }
    }

    const monday = getMonday(selectedDate);
    const weekDates = [];
    
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      weekDates.push({
        dateStr: formatDate(d),
        dayName: d.toLocaleDateString('en-US', { weekday: 'long' }),
        dayNum: d.getDate(),
        monthName: d.toLocaleDateString('en-US', { month: 'short' }),
        isToday: formatDate(d) === formatDate(today)
      });
    }

    const startStr = weekDates[0].dateStr;
    const endStr = weekDates[6].dateStr;

    // Fetch meal plans for the week
    const plans = mealPlanService.getForDateRange(startStr, endStr);

    // Group plans by date and meal_type
    const planGrid = {};
    for (const plan of plans) {
      if (!planGrid[plan.date]) {
        planGrid[plan.date] = {
          breakfast: [],
          lunch: [],
          dinner: [],
          snack: []
        };
      }
      if (planGrid[plan.date][plan.meal_type]) {
        planGrid[plan.date][plan.meal_type].push(plan);
      }
    }

    // Get all active recipes for selection dropdown/modal
    const recipesData = await recipeService.getAll({ limit: 1000 });
    const collections = await collectionService.getAllWithCounts();

    // Calculate dates for next and previous week links
    const prevWeek = new Date(monday);
    prevWeek.setDate(monday.getDate() - 7);
    const nextWeek = new Date(monday);
    nextWeek.setDate(monday.getDate() + 7);

    res.render('layouts/main', {
      title: 'Meal Planner',
      view: 'meal-planner',
      weekDates,
      planGrid,
      recipes: recipesData.recipes || [],
      sidebarCollections: collections,
      currentPath: '/meal-planner',
      currentWeekMonday: startStr,
      prevWeekStr: formatDate(prevWeek),
      nextWeekStr: formatDate(nextWeek)
    });
  } catch (err) {
    next(err);
  }
});

// POST /meal-planner - Add a planned meal
router.post('/meal-planner', async (req, res, next) => {
  try {
    const { recipe_id, custom_item, date, meal_type, redirect_week } = req.body;
    
    if (!date || !meal_type) {
      throw new Error('Date and meal type are required');
    }

    mealPlanService.addMealPlan({
      recipe_id: recipe_id ? parseInt(recipe_id, 10) : null,
      custom_item: custom_item || null,
      date,
      meal_type
    });

    res.redirect(`/meal-planner?week=${redirect_week || date}`);
  } catch (err) {
    next(err);
  }
});

// POST /meal-planner/:id/delete - Delete a planned meal
router.post('/meal-planner/:id/delete', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const redirectWeek = req.body.redirect_week;
    
    mealPlanService.removeMealPlan(id);

    if (redirectWeek) {
      res.redirect(`/meal-planner?week=${redirectWeek}`);
    } else {
      res.redirect('/meal-planner');
    }
  } catch (err) {
    next(err);
  }
});

module.exports = router;
