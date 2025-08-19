const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

// Resolve data root (Windows-friendly default)
const dataRoot = process.env.WIN_DATA_ROOT || (process.platform === 'win32'
  ? path.join(process.env.ProgramData || 'C:/ProgramData', 'gmgmt')
  : path.join(process.cwd(), 'data'));

const dbPath = path.join(dataRoot, 'data', 'gmgmt.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

function replacePgParamsWithQMarks(sql) {
  // Replace $1, $2 ... with ? for sqlite
  return sql.replace(/\$(\d+)/g, '?');
}

function execute(sql, params = []) {
  const text = replacePgParamsWithQMarks(sql).trim();
  const upper = text.toUpperCase();
  const hasReturning = upper.includes(' RETURNING ');

  if (upper.startsWith('SELECT') || hasReturning) {
    const rows = db.prepare(text).all(params);
    return { rows, rowCount: rows.length };
  }

  // BEGIN/COMMIT/ROLLBACK passthrough
  if (upper === 'BEGIN' || upper === 'COMMIT' || upper === 'ROLLBACK') {
    db.exec(upper);
    return { rows: [], rowCount: 0 };
  }

  const info = db.prepare(text).run(params);
  return { rows: [], rowCount: info.changes, lastInsertId: info.lastInsertRowid };
}

function initializeDatabase() {
  const statements = [
    `CREATE TABLE IF NOT EXISTS members (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       name TEXT NOT NULL,
       email TEXT UNIQUE,
       phone TEXT,
       membership_type TEXT,
       membership_plan_id INTEGER,
       join_date TEXT DEFAULT (date('now')),
       address TEXT,
       birthday TEXT,
       photo_url TEXT
     );`,
    `CREATE TABLE IF NOT EXISTS settings (
       key TEXT PRIMARY KEY,
       value TEXT
     );`,
    `CREATE TABLE IF NOT EXISTS attendance (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
       check_in_time TEXT NOT NULL,
       check_out_time TEXT
     );`,
    `CREATE TABLE IF NOT EXISTS classes (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       name TEXT NOT NULL,
       description TEXT,
       instructor TEXT,
       duration_minutes INTEGER
     );`,
    `CREATE TABLE IF NOT EXISTS class_schedules (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
       start_time TEXT NOT NULL,
       end_time TEXT NOT NULL,
       max_capacity INTEGER
     );`,
    `CREATE TABLE IF NOT EXISTS bookings (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
       schedule_id INTEGER REFERENCES class_schedules(id) ON DELETE CASCADE,
       booking_time TEXT DEFAULT (datetime('now')),
       status TEXT DEFAULT 'confirmed'
     );`,
    `CREATE TABLE IF NOT EXISTS membership_plans (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       name TEXT NOT NULL,
       price REAL NOT NULL,
       duration_days INTEGER NOT NULL,
       description TEXT
     );`,
    `CREATE TABLE IF NOT EXISTS invoices (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
       plan_id INTEGER REFERENCES membership_plans(id),
       amount REAL NOT NULL,
       due_date TEXT NOT NULL,
       status TEXT DEFAULT 'unpaid',
       created_at TEXT DEFAULT (datetime('now'))
     );`,
    `CREATE TABLE IF NOT EXISTS payments (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
       amount REAL NOT NULL,
       payment_date TEXT DEFAULT (datetime('now')),
       payment_method TEXT,
       transaction_id TEXT
     );`,
    `CREATE TABLE IF NOT EXISTS member_biometrics (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
       device_user_id TEXT UNIQUE,
       template TEXT,
       created_at TEXT DEFAULT (datetime('now'))
     );`,
  ];

  const insertDefaultSettings = [
    ['currency', 'INR'],
    ['membership_types', '["Weight Training", "Cardio", "Cardio & Weights Training"]'],
    ['gym_name', 'My Gym'],
    ['gym_logo', 'logo.svg'],
    ['primary_color', '#3f51b5'],
    ['secondary_color', '#f50057'],
    ['primary_color_mode', 'solid'],
    ['secondary_color_mode', 'solid'],
    ['primary_color_gradient', ''],
    ['secondary_color_gradient', ''],
    ['payment_reminder_days', '7'],
    ['morning_session_start', '05:00'],
    ['morning_session_end', '11:00'],
    ['evening_session_start', '16:00'],
    ['evening_session_end', '22:00'],
    ['show_card_total_members', 'true'],
    ['show_card_total_revenue', 'true'],
    ['show_card_new_members_this_month', 'true'],
    ['show_card_unpaid_members_this_month', 'true'],
    ['show_card_active_schedules', 'true'],
  ];

  const trx = db.transaction(() => {
    for (const s of statements) db.prepare(s).run();
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS ux_members_phone ON members(phone) WHERE phone IS NOT NULL;");
    for (const [k, v] of insertDefaultSettings) {
      db.prepare('INSERT OR IGNORE INTO settings(key, value) VALUES(?, ?)').run(k, v);
    }
  });
  trx();
}

const pool = {
  query: async (sql, params) => execute(sql, params),
  connect: async () => ({
    query: async (sql, params) => execute(sql, params),
    release: () => {},
  }),
};

module.exports = { db, pool, initializeDatabase };


