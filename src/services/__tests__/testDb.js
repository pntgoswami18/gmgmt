/**
 * Test helper: creates an in-memory SQLite database with the production schema,
 * then monkey-patches pool.query (and optionally runInTransaction) so controllers
 * run their real SQL against the isolated database without touching the on-disk file.
 *
 * Usage:
 *   const { setup, teardown } = require('./testDb');
 *   let db;
 *   before(async () => { db = await setup(); });
 *   after(async () => { await teardown(); });
 */

const Database = require('better-sqlite3');
const sqliteModule = require('../../config/sqlite');
const settingsCache = require('../../services/settingsCache');

// Mirrors the execute() shim from sqlite.js so controllers see the same return shape
function makeExecute(db) {
  return function execute(sql, params = []) {
    let text = sql.replace(/\$(\d+)/g, '?');
    text = text.replace(/ILIKE/gi, 'LIKE');
    const upper = text.trim().toUpperCase();
    if (upper.startsWith('SELECT') || upper.includes(' RETURNING ')) {
      const rows = db.prepare(text).all(Array.isArray(params) ? params : [params]);
      return { rows, rowCount: rows.length };
    }
    const info = db.prepare(text).run(Array.isArray(params) ? params : [params]);
    return { rows: [], rowCount: info.changes, lastInsertId: info.lastInsertRowid };
  };
}

function buildSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'offline'
    );

    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT UNIQUE,
      phone TEXT,
      membership_type TEXT DEFAULT 'standard',
      membership_plan_id INTEGER,
      join_date TEXT DEFAULT (date('now')),
      address TEXT DEFAULT '',
      birthday TEXT DEFAULT '',
      photo_url TEXT DEFAULT '',
      is_active INTEGER DEFAULT 1,
      biometric_id TEXT,
      biometric_sensor_member_id TEXT DEFAULT '',
      is_admin INTEGER DEFAULT 0,
      last_visit TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS ux_members_phone ON members(phone) WHERE phone IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_members_biometric_id ON members(biometric_id) WHERE biometric_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS membership_plans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      duration_days INTEGER NOT NULL,
      description TEXT
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
      plan_id INTEGER REFERENCES membership_plans(id),
      amount REAL NOT NULL,
      due_date TEXT NOT NULL,
      status TEXT DEFAULT 'unpaid',
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      payment_date TEXT DEFAULT (datetime('now')),
      payment_method TEXT,
      transaction_id TEXT
    );

    CREATE TABLE IF NOT EXISTS member_biometrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
      device_user_id TEXT UNIQUE,
      template TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS referrals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      referrer_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
      referred_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
      discount_amount REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now')),
      applied_at TEXT,
      UNIQUE(referred_id)
    );

    CREATE TABLE IF NOT EXISTS biometric_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
      biometric_id TEXT,
      event_type TEXT NOT NULL,
      device_id TEXT,
      timestamp TEXT NOT NULL,
      success BOOLEAN NOT NULL,
      error_message TEXT,
      raw_data TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS security_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_type TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      details TEXT,
      member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS access_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      device_id TEXT NOT NULL,
      member_id INTEGER,
      access_type TEXT NOT NULL,
      access_result TEXT NOT NULL,
      timestamp TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
      check_in_time TEXT NOT NULL,
      check_out_time TEXT,
      date TEXT DEFAULT (date('now'))
    );

    CREATE TABLE IF NOT EXISTS member_face_embeddings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
      embedding BLOB NOT NULL,
      model_version TEXT NOT NULL,
      quality_score REAL,
      pose_label TEXT,
      consent_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS face_sync_tombstones (
      member_id INTEGER PRIMARY KEY,
      deleted_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS staff (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff',
      is_active INTEGER DEFAULT 1,
      failed_attempts INTEGER DEFAULT 0,
      locked_until TEXT,
      last_login_at TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    INSERT OR IGNORE INTO settings(key, value) VALUES
      ('payment_reminder_days_after_due', '7'),
      ('payment_grace_period_days', '3'),
      ('referral_system_enabled', 'false'),
      ('referral_discount_amount', '100'),
      ('cross_session_checkin_restriction', 'true'),
      ('whatsapp_welcome_enabled', 'false'),
      ('face_checkin_enabled', 'false'),
      ('face_match_threshold', '0.55'),
      ('face_liveness_mode', 'challenge'),
      ('face_model_version', ''),
      ('face_checkout_min_dwell_minutes', '15'),
      ('face_door_device_id', '');
  `);
}

let _originalPoolQuery = null;
let _originalRunInTransaction = null;
let _testDb = null;

async function setup() {
  _testDb = new Database(':memory:');
  buildSchema(_testDb);

  const execute = makeExecute(_testDb);

  // Patch pool.query
  _originalPoolQuery = sqliteModule.pool.query;
  sqliteModule.pool.query = async (sql, params) => execute(sql, params);

  // Patch runInTransaction: run callback with BEGIN/COMMIT on the in-memory db
  _originalRunInTransaction = sqliteModule.runInTransaction;
  sqliteModule.runInTransaction = async (callback) => {
    _testDb.exec('BEGIN');
    try {
      const result = await callback();
      _testDb.exec('COMMIT');
      return result;
    } catch (err) {
      try {
        _testDb.exec('ROLLBACK');
      } catch (_) {}
      throw err;
    }
  };

  // Sync settingsCache to pull from the in-memory db
  await settingsCache.refresh();

  return _testDb;
}

async function teardown() {
  if (_originalPoolQuery) {
    sqliteModule.pool.query = _originalPoolQuery;
    _originalPoolQuery = null;
  }
  if (_originalRunInTransaction) {
    sqliteModule.runInTransaction = _originalRunInTransaction;
    _originalRunInTransaction = null;
  }
  if (_testDb) {
    _testDb.close();
    _testDb = null;
  }
  // Refresh settingsCache back from the real DB
  await settingsCache.refresh();
}

module.exports = { setup, teardown };
