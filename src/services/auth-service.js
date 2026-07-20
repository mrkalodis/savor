const crypto = require('crypto');
const { getDb } = require('../database');

const SESSION_DURATION_DAYS = 7;

/**
 * Check if there are ANY users in the database.
 * If 0 users, the system is in "setup mode".
 */
function hasUsers() {
  const db = getDb();
  const count = db.prepare('SELECT COUNT(*) as count FROM users').get();
  return count.count > 0;
}

/**
 * Register the very first admin user.
 * Also migrates all existing orphaned data to this user (user_id = 1).
 */
function registerAdmin(email, password) {
  const db = getDb();
  if (hasUsers()) {
    throw new Error('An admin user already exists.');
  }

  const salt = crypto.randomBytes(32).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');

  let adminId;
  const transaction = db.transaction(() => {
    const stmt = db.prepare('INSERT INTO users (email, password_hash, salt, is_admin) VALUES (?, ?, ?, 1)');
    const info = stmt.run(email, hash);
    adminId = info.lastInsertRowid;

    // Migrate all orphaned data to this first admin user
    db.prepare('UPDATE collections SET user_id = ? WHERE user_id IS NULL').run(adminId);
    db.prepare('UPDATE recipes SET user_id = ? WHERE user_id IS NULL').run(adminId);
    db.prepare('UPDATE meal_plans SET user_id = ? WHERE user_id IS NULL').run(adminId);
    db.prepare('UPDATE shopping_list SET user_id = ? WHERE user_id IS NULL').run(adminId);
    db.prepare('UPDATE ai_chats SET user_id = ? WHERE user_id IS NULL').run(adminId);
    db.prepare('UPDATE settings SET user_id = ? WHERE user_id IS NULL').run(adminId);
    db.prepare('UPDATE tags SET user_id = ? WHERE user_id IS NULL').run(adminId);
    db.prepare('UPDATE pantry_staples SET user_id = ? WHERE user_id IS NULL').run(adminId);
  });
  transaction();

  return adminId;
}

/**
 * Create a new user (intended for admins to use).
 */
function createUser(email, password, isAdmin = 0) {
  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE email = ? COLLATE NOCASE').get(email);
  if (existing) {
    throw new Error('User with this email already exists.');
  }

  const salt = crypto.randomBytes(32).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');

  const stmt = db.prepare('INSERT INTO users (email, password_hash, salt, is_admin) VALUES (?, ?, ?, ?)');
  const info = stmt.run(email, hash, isAdmin ? 1 : 0);
  
  // Pre-populate pantry staples for the new user
  db.prepare(`
    INSERT INTO pantry_staples (name, user_id) VALUES 
      ('salt', ?), ('black pepper', ?), ('water', ?), ('cooking spray', ?),
      ('olive oil', ?), ('vegetable oil', ?), ('butter', ?), ('sugar', ?),
      ('flour', ?), ('pepper', ?), ('kosher salt', ?), ('salt and pepper', ?)
  `).run(info.lastInsertRowid, info.lastInsertRowid, info.lastInsertRowid, info.lastInsertRowid,
         info.lastInsertRowid, info.lastInsertRowid, info.lastInsertRowid, info.lastInsertRowid,
         info.lastInsertRowid, info.lastInsertRowid, info.lastInsertRowid, info.lastInsertRowid);
         
  return info.lastInsertRowid;
}

/**
 * Login a user by verifying their password.
 */
function login(email, password) {
  const db = getDb();
  const user = db.prepare('SELECT id, password_hash, salt FROM users WHERE email = ? COLLATE NOCASE').get(email);
  
  if (!user) return null;

  const hashBuf = crypto.scryptSync(password, user.salt, 64);
  const dbHashBuf = Buffer.from(user.password_hash, 'hex');
  
  if (hashBuf.length !== dbHashBuf.length) {
    return null;
  }
  const match = crypto.timingSafeEqual(hashBuf, dbHashBuf);
  
  return match ? user.id : null;
}

/**
 * Create a new session for a user.
 */
function createSession(userId) {
  const db = getDb();
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000);

  db.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, datetime(?), datetime(?))')
    .run(token, userId, now.toISOString(), expires.toISOString());

  cleanExpiredSessions();
  return { token, expiresAt: expires };
}

/**
 * Validate a session token and return the associated user object.
 */
function validateSession(token) {
  if (!token) return null;
  const db = getDb();
  const session = db
    .prepare('SELECT s.user_id, u.email, u.is_admin FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = ? AND s.expires_at > datetime(?)')
    .get(token, new Date().toISOString());
  
  if (session) {
    return { id: session.user_id, email: session.email, isAdmin: !!session.is_admin };
  }
  return null;
}

/**
 * Destroy a session.
 */
function destroySession(token) {
  if (!token) return;
  const db = getDb();
  db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

/**
 * Clean up expired sessions.
 */
function cleanExpiredSessions() {
  const db = getDb();
  db.prepare('DELETE FROM sessions WHERE expires_at <= datetime(?)').run(new Date().toISOString());
}

/**
 * Change user password.
 */
function changePassword(userId, currentPassword, newPassword) {
  const db = getDb();
  const user = db.prepare('SELECT password_hash, salt FROM users WHERE id = ?').get(userId);
  if (!user) throw new Error('User not found.');

  const oldHashBuf = crypto.scryptSync(currentPassword, user.salt, 64);
  const dbHashBuf = Buffer.from(user.password_hash, 'hex');
  
  if (oldHashBuf.length !== dbHashBuf.length) throw new Error('Current password is incorrect.');
  const match = crypto.timingSafeEqual(oldHashBuf, dbHashBuf);
  if (!match) throw new Error('Current password is incorrect.');

  const newSalt = crypto.randomBytes(32).toString('hex');
  const newHash = crypto.scryptSync(newPassword, newSalt, 64).toString('hex');

  db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?')
    .run(newHash, newSalt, userId);

  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

/**
 * Admin: Change another user's password (or force reset).
 */
function adminResetPassword(adminId, targetUserId, newPassword) {
  const db = getDb();
  const admin = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(adminId);
  if (!admin || !admin.is_admin) throw new Error('Unauthorized.');

  const newSalt = crypto.randomBytes(32).toString('hex');
  const newHash = crypto.scryptSync(newPassword, newSalt, 64).toString('hex');

  db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?')
    .run(newHash, newSalt, targetUserId);
  
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetUserId);
}

/**
 * Get all users (for admin view).
 */
function getUsers() {
  const db = getDb();
  return db.prepare('SELECT id, email, is_admin, created_at FROM users ORDER BY created_at ASC').all();
}

/**
 * Delete user (Admin only).
 */
function deleteUser(adminId, targetUserId) {
  const db = getDb();
  const admin = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(adminId);
  if (!admin || !admin.is_admin) throw new Error('Unauthorized.');
  if (adminId === targetUserId) throw new Error('Cannot delete yourself.');

  db.prepare('DELETE FROM users WHERE id = ?').run(targetUserId);
}

module.exports = {
  hasUsers,
  registerAdmin,
  createUser,
  login,
  createSession,
  validateSession,
  destroySession,
  cleanExpiredSessions,
  changePassword,
  adminResetPassword,
  getUsers,
  deleteUser
};
