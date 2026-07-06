const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/sqlite');
const logger = require('../utils/logger').child({ service: 'authService' });

const TOKEN_COOKIE_NAME = 'gmgmt_token';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '12h';
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// Fixed bcrypt hash of an unrelated password, compared against for unknown/inactive
// accounts so login() always pays the same bcrypt cost — otherwise the fast-path
// 401 for a nonexistent username is distinguishable by response time from the
// slow-path 401 for a wrong password, letting an attacker enumerate usernames.
const DUMMY_HASH = bcrypt.hashSync('a-fixed-placeholder-password', 10);

function getJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set');
  }
  return secret;
}

async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

function signToken(staff) {
  return jwt.sign({ sub: staff.id, username: staff.username, role: staff.role }, getJwtSecret(), {
    expiresIn: JWT_EXPIRES_IN,
  });
}

function verifyToken(token) {
  return jwt.verify(token, getJwtSecret());
}

// Milliseconds until the token's exp claim, for mirroring its lifetime onto the
// session cookie's maxAge. No secret needed — decode() is a plain payload read,
// not a signature check (the token was just signed by this same process).
function getTokenExpiryMs(token) {
  const decoded = jwt.decode(token);
  return decoded && decoded.exp ? decoded.exp * 1000 - Date.now() : null;
}

async function findStaffByUsername(username) {
  const result = await pool.query('SELECT * FROM staff WHERE username = $1', [username]);
  return result.rows[0] || null;
}

async function findStaffById(id) {
  const result = await pool.query('SELECT * FROM staff WHERE id = $1', [id]);
  return result.rows[0] || null;
}

// Real hash for an existing, active account; otherwise the fixed dummy hash — so
// callers can always run bcrypt.compare unconditionally (see DUMMY_HASH above).
function getHashToCompare(staff) {
  return staff && staff.is_active ? staff.password_hash : DUMMY_HASH;
}

async function isLocked(staff) {
  if (!staff.locked_until) return false;
  return new Date(staff.locked_until).getTime() > Date.now();
}

async function recordFailedAttempt(staff) {
  const attempts = (staff.failed_attempts || 0) + 1;
  const lockedUntil =
    attempts >= MAX_FAILED_ATTEMPTS
      ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString()
      : null;
  await pool.query('UPDATE staff SET failed_attempts = $1, locked_until = $2 WHERE id = $3', [
    attempts,
    lockedUntil,
    staff.id,
  ]);
}

async function recordSuccessfulLogin(staff) {
  await pool.query(
    'UPDATE staff SET failed_attempts = 0, locked_until = NULL, last_login_at = $1 WHERE id = $2',
    [new Date().toISOString(), staff.id]
  );
}

/**
 * Seeds one admin account from env vars if the staff table is empty. Lets a fresh
 * install log in for the first time without a separate registration flow.
 */
async function ensureBootstrapAdmin() {
  const result = await pool.query('SELECT COUNT(*) as count FROM staff', []);
  if (result.rows[0].count > 0) return;

  const username = process.env.INITIAL_ADMIN_USERNAME;
  const password = process.env.INITIAL_ADMIN_PASSWORD;
  if (!username || !password) {
    logger.warn(
      'No staff accounts exist and INITIAL_ADMIN_USERNAME/INITIAL_ADMIN_PASSWORD are not set — nobody will be able to log in until an account is created directly in the database.'
    );
    return;
  }

  const passwordHash = await hashPassword(password);
  await pool.query('INSERT INTO staff (username, password_hash, role) VALUES ($1, $2, $3)', [
    username,
    passwordHash,
    'admin',
  ]);
  logger.warn({ username }, 'Seeded bootstrap admin account — log in and change the password');
}

module.exports = {
  TOKEN_COOKIE_NAME,
  hashPassword,
  verifyPassword,
  signToken,
  verifyToken,
  getTokenExpiryMs,
  findStaffByUsername,
  findStaffById,
  getHashToCompare,
  isLocked,
  recordFailedAttempt,
  recordSuccessfulLogin,
  ensureBootstrapAdmin,
};
