const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

// Regression test for DBs that picked up idx_members_biometric_id as a
// non-unique index from an older build of this file (CREATE INDEX IF NOT
// EXISTS is name-based, so simply changing the DDL string to CREATE UNIQUE
// INDEX doesn't retrofit an already-created index). initializeDatabase()
// must detect the non-unique index, normalize any '' biometric_id values
// left over from the old buggy backfill, and rebuild the index as UNIQUE.
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gmgmt-legacy-index-test-'));
process.env.WIN_DATA_ROOT = tmpRoot;

// Build the on-disk DB file by hand, simulating the state left by an older
// version of this app, before requiring config/sqlite (whose module-level
// `new Database(dbPath)` would otherwise create the file first).
const dbPath = path.join(tmpRoot, 'data', 'gmgmt.sqlite');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const seedDb = new Database(dbPath);
seedDb.exec(`
  CREATE TABLE members (
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
    biometric_id TEXT DEFAULT '',
    biometric_sensor_member_id TEXT DEFAULT '',
    is_admin INTEGER DEFAULT 0
  );
  CREATE INDEX idx_members_biometric_id ON members(biometric_id) WHERE biometric_id IS NOT NULL;
`);
seedDb.prepare("INSERT INTO members (name, biometric_id) VALUES ('Legacy One', '')").run();
seedDb.prepare("INSERT INTO members (name, biometric_id) VALUES ('Legacy Two', '')").run();
seedDb.close();

const { db, initializeDatabase } = require('../sqlite');

test.after(() => {
  db.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('initializeDatabase repairs a pre-existing non-unique idx_members_biometric_id', () => {
  assert.doesNotThrow(() => initializeDatabase());

  const indexRow = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_members_biometric_id'"
    )
    .get();
  assert.ok(indexRow, 'index must still exist');
  assert.match(indexRow.sql, /UNIQUE/i, 'index must be rebuilt as UNIQUE');

  const rows = db.prepare('SELECT name, biometric_id FROM members ORDER BY id').all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].biometric_id, null, "pre-existing '' must be normalized to NULL");
  assert.equal(rows[1].biometric_id, null, "pre-existing '' must be normalized to NULL");

  // Prove the rebuilt index is actually enforced now.
  db.prepare("UPDATE members SET biometric_id = '99' WHERE name = 'Legacy One'").run();
  assert.throws(() => {
    db.prepare("UPDATE members SET biometric_id = '99' WHERE name = 'Legacy Two'").run();
  }, /UNIQUE constraint failed/);
});
