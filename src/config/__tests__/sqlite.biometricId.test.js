const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Regression test for the UNIQUE partial index (idx_members_biometric_id) on a
// fresh database: members.biometric_id must default to NULL, not '', because
// the index only exempts NULL values. Points WIN_DATA_ROOT at an isolated temp
// dir *before* requiring config/sqlite so the module's singleton db is built
// fresh against the real CREATE TABLE + migration path (not the test-only
// schema in services/__tests__/testDb.js, which doesn't reproduce the index).
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gmgmt-sqlite-test-'));
process.env.WIN_DATA_ROOT = tmpRoot;

const { db, initializeDatabase } = require('../sqlite');

test.before(() => {
  initializeDatabase();
});

test.after(() => {
  db.close();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

test('two members with no biometric_id can both be inserted on a fresh database', () => {
  const insert = db.prepare(
    "INSERT INTO members (name, phone, is_active, is_admin, join_date) VALUES (?, ?, 1, 0, date('now'))"
  );

  assert.doesNotThrow(() => insert.run('Member One', '1111111111'));
  assert.doesNotThrow(() => insert.run('Member Two', '2222222222'));

  const rows = db.prepare('SELECT name, biometric_id FROM members ORDER BY id').all();
  assert.equal(rows.length, 2);
  assert.equal(rows[0].biometric_id, null);
  assert.equal(rows[1].biometric_id, null);
});

test('idx_members_biometric_id is created as a genuinely UNIQUE index', () => {
  const row = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_members_biometric_id'"
    )
    .get();
  assert.ok(row, 'index must exist');
  assert.match(row.sql, /UNIQUE/i);
});

test('duplicate non-null biometric_id values are rejected (index is actually enforced)', () => {
  db.prepare(
    "INSERT INTO members (name, biometric_id, join_date) VALUES (?, '42', date('now'))"
  ).run('Dup One');
  assert.throws(() => {
    db.prepare(
      "INSERT INTO members (name, biometric_id, join_date) VALUES (?, '42', date('now'))"
    ).run('Dup Two');
  }, /UNIQUE constraint failed/);
});
