const Database = require('better-sqlite3');
const path = require('path');
const { config } = require('./config');

let db = null;

/**
 * Initialize the SQLite database with WAL mode, foreign keys, and schema.
 * Returns the database instance.
 */
function initDatabase() {
  if (db) return db;

  db = new Database(config.dbPath);

  // Performance and safety pragmas
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  db.pragma('cache_size = -64000'); // 64MB cache

  // Run schema migrations
  runMigrations();

  // Seed default admin user if database is empty
  const crypto = require('crypto');
  const count = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (count.count === 0) {
    db.transaction(() => {
      const salt = crypto.randomBytes(32).toString('hex');
      const hash = crypto.scryptSync('recipe', salt, 64).toString('hex');
      
      const info = db.prepare('INSERT INTO users (id, email, password_hash, salt, is_admin) VALUES (1, ?, ?, ?, 1)')
        .run('admin@local', hash, salt);
      
      const adminId = info.lastInsertRowid;
      
      // Seed default settings for admin
      const insertSetting = db.prepare('INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)');
      insertSetting.run(adminId, 'ai_enabled', '1');
      insertSetting.run(adminId, 'ai_endpoint', 'http://localhost:11434');
      insertSetting.run(adminId, 'ai_model', 'llama3.2:1b');
      insertSetting.run(adminId, 'theme', 'system');
      insertSetting.run(adminId, 'accent_color', 'purple');
      insertSetting.run(adminId, 'onboarding_complete', '1');
      
      // Seed default pantry staples for admin
      const staples = [
        'salt', 'black pepper', 'water', 'cooking spray', 'olive oil',
        'vegetable oil', 'butter', 'sugar', 'flour', 'pepper',
        'kosher salt', 'salt and pepper'
      ];
      const insertStaple = db.prepare('INSERT OR IGNORE INTO pantry_staples (name, user_id) VALUES (?, ?)');
      for (const staple of staples) {
        insertStaple.run(staple, adminId);
      }
    })();
    console.log('[DB] Seeded default admin user (admin@local / recipe)');
  }

  // Migration: Auto-upgrade default model from qwen2.5:0.5b to llama3.2:1b
  try {
    db.prepare("UPDATE settings SET value = 'llama3.2:1b' WHERE key = 'ai_model' AND value = 'qwen2.5:0.5b'").run();
  } catch (e) {
    console.error('[DB] Migration error updating default model:', e);
  }

  return db;
}

/**
 * Get the current database instance.
 */
function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Close the database connection gracefully.
 */
function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

/**
 * Run all schema migrations.
 */
function runMigrations() {
  // Create migrations tracking table
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const applied = new Set(
    db.prepare('SELECT name FROM migrations').all().map(r => r.name)
  );

  for (const migration of migrations) {
    if (!applied.has(migration.name)) {
      db.transaction(() => {
        db.exec(migration.sql);
        db.prepare('INSERT INTO migrations (name) VALUES (?)').run(migration.name);
      })();
      console.log(`[DB] Applied migration: ${migration.name}`);
    }
  }
}

// ============================================================
// MIGRATIONS
// ============================================================
const migrations = [
  {
    name: '001_initial_schema',
    sql: `
      -- Collections
      CREATE TABLE IF NOT EXISTS collections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT DEFAULT '',
        color TEXT DEFAULT '#6366f1',
        icon TEXT DEFAULT 'folder',
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      -- Recipes
      CREATE TABLE IF NOT EXISTS recipes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        collection_id INTEGER REFERENCES collections(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        ingredients TEXT DEFAULT '[]',
        instructions TEXT DEFAULT '[]',
        prep_time INTEGER,
        cook_time INTEGER,
        total_time INTEGER,
        servings TEXT DEFAULT '',
        notes TEXT DEFAULT '',
        source_url TEXT DEFAULT '',
        image_path TEXT DEFAULT '',
        is_favorite INTEGER DEFAULT 0,
        status TEXT DEFAULT 'active',
        sort_order INTEGER DEFAULT 0,
        archived_at TEXT,
        deleted_at TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      -- Tags
      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE
      );

      CREATE TABLE IF NOT EXISTS recipe_tags (
        recipe_id INTEGER NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (recipe_id, tag_id)
      );

      -- Full-Text Search
      CREATE VIRTUAL TABLE IF NOT EXISTS recipes_fts USING fts5(
        title,
        description,
        ingredients,
        instructions,
        notes,
        content='recipes',
        content_rowid='id'
      );

      -- FTS sync triggers
      CREATE TRIGGER IF NOT EXISTS recipes_ai AFTER INSERT ON recipes BEGIN
        INSERT INTO recipes_fts(rowid, title, description, ingredients, instructions, notes)
        VALUES (new.id, new.title, new.description, new.ingredients, new.instructions, new.notes);
      END;

      CREATE TRIGGER IF NOT EXISTS recipes_ad AFTER DELETE ON recipes BEGIN
        INSERT INTO recipes_fts(recipes_fts, rowid, title, description, ingredients, instructions, notes)
        VALUES ('delete', old.id, old.title, old.description, old.ingredients, old.instructions, old.notes);
      END;

      CREATE TRIGGER IF NOT EXISTS recipes_au AFTER UPDATE ON recipes BEGIN
        INSERT INTO recipes_fts(recipes_fts, rowid, title, description, ingredients, instructions, notes)
        VALUES ('delete', old.id, old.title, old.description, old.ingredients, old.instructions, old.notes);
        INSERT INTO recipes_fts(rowid, title, description, ingredients, instructions, notes)
        VALUES (new.id, new.title, new.description, new.ingredients, new.instructions, new.notes);
      END;

      -- Authentication (optional)
      CREATE TABLE IF NOT EXISTS auth (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER DEFAULT 0,
        password_hash TEXT,
        salt TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        created_at TEXT DEFAULT (datetime('now')),
        expires_at TEXT NOT NULL
      );

      -- Settings
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      -- Indexes
      CREATE INDEX IF NOT EXISTS idx_recipes_collection ON recipes(collection_id);
      CREATE INDEX IF NOT EXISTS idx_recipes_favorite ON recipes(is_favorite);
      CREATE INDEX IF NOT EXISTS idx_recipes_status ON recipes(status);
      CREATE INDEX IF NOT EXISTS idx_recipes_title ON recipes(title);
      CREATE INDEX IF NOT EXISTS idx_recipes_source_url ON recipes(source_url);
      CREATE INDEX IF NOT EXISTS idx_recipes_sort_order ON recipes(collection_id, sort_order);
      CREATE INDEX IF NOT EXISTS idx_collections_sort_order ON collections(sort_order);
      CREATE INDEX IF NOT EXISTS idx_recipe_tags_recipe ON recipe_tags(recipe_id);
      CREATE INDEX IF NOT EXISTS idx_recipe_tags_tag ON recipe_tags(tag_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
    `,
  },
  {
    name: '002_utilities_schema',
    sql: `
      -- Meal plans table
      CREATE TABLE IF NOT EXISTS meal_plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
        custom_item TEXT,
        date TEXT NOT NULL,
        meal_type TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      );

      -- Shopping list table
      CREATE TABLE IF NOT EXISTS shopping_list (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipe_id INTEGER REFERENCES recipes(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        quantity TEXT DEFAULT '',
        checked INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_meal_plans_date ON meal_plans(date);
      CREATE INDEX IF NOT EXISTS idx_shopping_list_checked ON shopping_list(checked);
    `,
  },
  {
    name: '003_pantry_staples_schema',
    sql: `
      -- Pantry staples table
      CREATE TABLE IF NOT EXISTS pantry_staples (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE
      );

      -- Default staples insertions
      INSERT OR IGNORE INTO pantry_staples (name) VALUES 
        ('salt'),
        ('black pepper'),
        ('water'),
        ('cooking spray'),
        ('olive oil'),
        ('vegetable oil'),
        ('butter'),
        ('sugar'),
        ('flour'),
        ('pepper'),
        ('kosher salt'),
        ('salt and pepper'),
        ('salt & pepper');
    `,
  },
  {
    name: '004_ai_chats_schema',
    sql: `
      CREATE TABLE IF NOT EXISTS ai_chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        messages TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_ai_chats_updated ON ai_chats(updated_at DESC);
    `,
  },
  {
    name: '005_multi_tenant',
    sql: `
      PRAGMA foreign_keys=off;

      -- Create users table
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        is_admin INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );

      -- Drop legacy auth table
      DROP TABLE IF EXISTS auth;

      -- Add user_id to all tables (allow NULL initially so FK doesn't fail on existing rows)
      ALTER TABLE sessions ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
      ALTER TABLE collections ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
      ALTER TABLE recipes ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
      ALTER TABLE meal_plans ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
      ALTER TABLE shopping_list ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
      ALTER TABLE ai_chats ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
      ALTER TABLE settings ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
      
      ALTER TABLE tags ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
      ALTER TABLE pantry_staples ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;

      -- Insert default admin user if rows exist
      INSERT INTO users (id, email, password_hash, salt, is_admin)
      SELECT 1, 'admin@local', 'migration', 'migration', 1
      WHERE EXISTS (SELECT 1 FROM recipes LIMIT 1) OR EXISTS (SELECT 1 FROM collections LIMIT 1);

      -- Assign existing data to admin user (user_id = 1) if it exists
      UPDATE collections SET user_id = 1 WHERE user_id IS NULL AND EXISTS (SELECT 1 FROM users WHERE id = 1);
      UPDATE recipes SET user_id = 1 WHERE user_id IS NULL AND EXISTS (SELECT 1 FROM users WHERE id = 1);
      UPDATE meal_plans SET user_id = 1 WHERE user_id IS NULL AND EXISTS (SELECT 1 FROM users WHERE id = 1);
      UPDATE shopping_list SET user_id = 1 WHERE user_id IS NULL AND EXISTS (SELECT 1 FROM users WHERE id = 1);
      UPDATE ai_chats SET user_id = 1 WHERE user_id IS NULL AND EXISTS (SELECT 1 FROM users WHERE id = 1);
      UPDATE settings SET user_id = 1 WHERE user_id IS NULL AND EXISTS (SELECT 1 FROM users WHERE id = 1);
      UPDATE tags SET user_id = 1 WHERE user_id IS NULL AND EXISTS (SELECT 1 FROM users WHERE id = 1);
      UPDATE pantry_staples SET user_id = 1 WHERE user_id IS NULL AND EXISTS (SELECT 1 FROM users WHERE id = 1);

      PRAGMA foreign_keys=on;
    `
  },
  {
    name: '006_settings_multitenant',
    sql: `
      PRAGMA foreign_keys=off;
      
      -- Create a new settings table with multi-tenant primary key
      CREATE TABLE IF NOT EXISTS settings_new (
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        key TEXT NOT NULL,
        value TEXT,
        PRIMARY KEY (user_id, key)
      );

      -- Copy data from old settings table, default to user 1 if user_id is null
      INSERT OR IGNORE INTO settings_new (user_id, key, value)
      SELECT COALESCE(user_id, 1), key, value FROM settings;

      -- Drop the old table and rename the new one
      DROP TABLE IF EXISTS settings;
      ALTER TABLE settings_new RENAME TO settings;

      PRAGMA foreign_keys=on;
    `
  },
  {
    name: '007_recipe_tags_multitenant',
    sql: `
      PRAGMA foreign_keys=off;
      ALTER TABLE recipe_tags ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
      UPDATE recipe_tags SET user_id = 1 WHERE user_id IS NULL AND EXISTS (SELECT 1 FROM users WHERE id = 1);
      PRAGMA foreign_keys=on;
    `
  }
];

module.exports = { initDatabase, getDb, closeDatabase };
