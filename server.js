const express = require('express');
const path = require('path');
const { config, ensureDirectories } = require('./src/config');
const { initDatabase, closeDatabase } = require('./src/database');

// Ensure data directories exist before anything else
ensureDirectories();

// Initialize database
const db = initDatabase();

// Create Express app
const app = express();

// ============================================================
// VIEW ENGINE
// ============================================================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ============================================================
// MIDDLEWARE
// ============================================================

// Parse form data and JSON
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));

// Serve uploaded images
app.use('/images/recipes', express.static(config.imagesDir, { maxAge: '7d' }));

// Method override for PUT/DELETE from HTML forms
app.use((req, res, next) => {
  if (req.body && req.body._method) {
    req.method = req.body._method.toUpperCase();
    delete req.body._method;
  }
  next();
});

// Auth middleware (conditional — checks if auth is enabled)
const { authMiddleware } = require('./src/middleware/auth');
app.use(authMiddleware);

// Make common data available to all templates
const settingsService = require('./src/services/settings-service');
const collectionService = require('./src/services/collection-service');
const recipeService = require('./src/services/recipe-service');

const ACCENT_COLORS = {
  purple: { primary: '#6366f1', hover: '#4f46e5', glow: 'rgba(99, 102, 241, 0.15)' },
  blue: { primary: '#3b82f6', hover: '#2563eb', glow: 'rgba(59, 130, 246, 0.15)' },
  green: { primary: '#10b981', hover: '#059669', glow: 'rgba(16, 185, 129, 0.15)' },
  orange: { primary: '#f97316', hover: '#ea580c', glow: 'rgba(249, 115, 22, 0.15)' },
  red: { primary: '#ef4444', hover: '#dc2626', glow: 'rgba(239, 68, 68, 0.15)' }
};

app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.appName = 'Savor';
  
  if (req.user) {
    res.locals.theme = settingsService.get(req.user.id, 'theme') || 'system';
    
    // Resolve accent color
    const selectedAccent = settingsService.get(req.user.id, 'accent_color') || 'purple';
    res.locals.activeAccent = selectedAccent;
    res.locals.accentColors = ACCENT_COLORS[selectedAccent] || ACCENT_COLORS.purple;
    
    // Load collections for sidebar (lightweight query)
    res.locals.sidebarCollections = collectionService.getAllWithCounts(req.user.id);
    
    // Load sidebar counts for archive and trash
    try {
      const stats = recipeService.getStats(req.user.id);
      res.locals.archivedCount = stats.totalArchived || 0;
      res.locals.deletedCount = stats.totalDeleted || 0;
    } catch (err) {
      res.locals.archivedCount = 0;
      res.locals.deletedCount = 0;
    }
    
    // Load AI configuration
    res.locals.aiEnabled = settingsService.get(req.user.id, 'ai_enabled') === '1';
    res.locals.aiEndpoint = settingsService.get(req.user.id, 'ai_endpoint') || 'http://localhost:11434';
    res.locals.aiModel = settingsService.get(req.user.id, 'ai_model') || 'qwen2.5:1.5b';
  } else {
    res.locals.theme = 'system';
    res.locals.activeAccent = 'purple';
    res.locals.accentColors = ACCENT_COLORS.purple;
    res.locals.sidebarCollections = [];
    res.locals.archivedCount = 0;
    res.locals.deletedCount = 0;
    res.locals.aiEnabled = false;
    res.locals.aiEndpoint = 'http://localhost:11434';
    res.locals.aiModel = 'qwen2.5:1.5b';
  }
  
  next();
});

// ============================================================
// ROUTES
// ============================================================
const indexRoutes = require('./src/routes/index');
const recipeRoutes = require('./src/routes/recipes');
const collectionRoutes = require('./src/routes/collections');
const apiRoutes = require('./src/routes/api');
const shareRoutes = require('./src/routes/share');
const settingsRoutes = require('./src/routes/settings');
const backupRoutes = require('./src/routes/backup');
const mealPlannerRoutes = require('./src/routes/meal-planner');
const shoppingListRoutes = require('./src/routes/shopping-list');
const aiRoutes = require('./src/routes/ai');

app.use('/', indexRoutes);
app.use('/', recipeRoutes);
app.use('/', collectionRoutes);
app.use('/api', apiRoutes);
app.use('/', shareRoutes);
app.use('/', settingsRoutes);
app.use('/', backupRoutes);
app.use('/', mealPlannerRoutes);
app.use('/', shoppingListRoutes);
app.use('/', aiRoutes);

// ============================================================
// ERROR HANDLING
// ============================================================
const { notFoundHandler, errorHandler } = require('./src/middleware/error-handler');
app.use(notFoundHandler);
app.use(errorHandler);

// ============================================================
// START SERVER
// ============================================================
const server = app.listen(config.port, () => {
  console.log(`
  ╔═══════════════════════════════════════╗
  ║                                       ║
  ║   🍽️  Savor Recipe Manager            ║
  ║                                       ║
  ║   Running on http://localhost:${String(config.port).padEnd(5)} ║
  ║   Data dir: ${config.dataDir.slice(0, 24).padEnd(24)} ║
  ║                                       ║
  ╚═══════════════════════════════════════╝
  `);
});

// Attach WebSocket Server for Cook Mode synchronization
const { initWebSocketServer } = require('./src/services/websocket-server');
initWebSocketServer(server);


// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n[Savor] Shutting down gracefully...');
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('\n[Savor] Shutting down gracefully...');
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
});

module.exports = app;
