const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown } = require('../../../services/__tests__/testDb');
const settingsCache = require('../../../services/settingsCache');
const {
  hhmm,
  nowMinutes,
  awayWindow,
} = require('../../../services/__tests__/sessionWindowTestUtils');
const { toLocalDateStr } = require('../../../services/checkInService');

let db;
let validateBiometricId;
let sqliteModule;

const todayStr = () => toLocalDateStr(new Date());

async function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
  await settingsCache.refresh();
}

function insertMember({
  name = 'Test',
  biometricId,
  isActive = 1,
  isAdmin = 0,
  planId = null,
  joinDate,
}) {
  const info = db
    .prepare(
      `INSERT INTO members (name, biometric_id, is_active, is_admin, membership_plan_id, join_date)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(name, String(biometricId), isActive, isAdmin, planId, joinDate || todayStr());
  return info.lastInsertRowid;
}

function insertAttendance(memberId, checkInTime, { checkedOut = false, date } = {}) {
  const info = db
    .prepare(
      'INSERT INTO attendance (member_id, check_in_time, check_out_time, date) VALUES (?, ?, ?, ?)'
    )
    .run(memberId, checkInTime, checkedOut ? new Date().toISOString() : null, date || todayStr());
  return info.lastInsertRowid;
}

// Puts "now" inside a window (mirrors checkInService test helpers) so the
// outside_session_windows gate (which validateBiometricId always applies,
// ignoring any device timestamp in the request) doesn't fire before we reach
// the cross-session logic under test.
async function windowContainingNow(prefix) {
  const m = nowMinutes();
  await setSetting(`${prefix}_session_start`, hhmm(m - 60));
  await setSetting(`${prefix}_session_end`, hhmm(m + 60));
}
async function windowAwayFromNow(prefix, lo, hi) {
  const m = nowMinutes();
  const [start, end] = awayWindow(m, lo, hi);
  await setSetting(`${prefix}_session_start`, hhmm(start));
  await setSetting(`${prefix}_session_end`, hhmm(end));
}

function mockReqRes(body) {
  const req = { body };
  let jsonPayload = null;
  let statusCode = 200;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      jsonPayload = payload;
      return this;
    },
  };
  return { req, res, getJson: () => jsonPayload, getStatus: () => statusCode };
}

test.before(async () => {
  db = await setup();
  sqliteModule = require('../../../config/sqlite');
  ({ validateBiometricId } = require('../biometricController'));
  db.prepare(
    "INSERT INTO membership_plans (id, name, price, duration_days) VALUES (1, 'Monthly', 500, 30)"
  ).run();
  await windowContainingNow('morning');
  await windowAwayFromNow('evening', 240, 300);
});

test.after(async () => {
  await teardown();
});

test('unknown biometricId denied with member_not_found', async () => {
  const { req, res, getJson } = mockReqRes({ biometricId: '999999', deviceId: 'dev1' });
  await validateBiometricId(req, res);
  assert.equal(getJson().authorized, false);
  assert.equal(getJson().reason, 'member_not_found');
});

test('inactive member denied with member_inactive', async () => {
  const memberId = insertMember({ name: 'Inactive', biometricId: 1001, isActive: 0 });
  const { req, res, getJson } = mockReqRes({ biometricId: '1001', deviceId: 'dev1' });
  await validateBiometricId(req, res);
  assert.equal(getJson().authorized, false);
  assert.equal(getJson().reason, 'member_inactive');
  assert.equal(getJson().memberId, memberId);
});

test('active member with no open session and no violations is authorized', async () => {
  insertMember({ name: 'Happy', biometricId: 1002 });
  const { req, res, getJson } = mockReqRes({ biometricId: '1002', deviceId: 'dev1' });
  await validateBiometricId(req, res);
  assert.equal(getJson().authorized, true, JSON.stringify(getJson()));
});

test("regression (timezone bug): today_active_sessions is computed from the local calendar date, not date('now') (UTC)", async () => {
  // Before the fix, the SQL used SQLite's date('now') (UTC) to decide "today",
  // which diverges from the JS-local date used everywhere else (attendance
  // rows are written with the local date column, per checkInService's
  // toLocalDateStr). Assert the controller queries with a JS-computed local
  // date parameter instead of embedding date('now') in the SQL text.
  const originalQuery = sqliteModule.pool.query;
  let sawTodayActiveSessionsQuery = false;
  let capturedParams = null;
  sqliteModule.pool.query = async (sql, params) => {
    if (sql.includes('today_active_sessions')) {
      sawTodayActiveSessionsQuery = true;
      capturedParams = params;
      assert.ok(
        !sql.includes("date('now')"),
        "query must not embed SQLite's UTC date('now') literal"
      );
    }
    return originalQuery(sql, params);
  };
  try {
    insertMember({ name: 'TzCheck', biometricId: 1003 });
    const { req, res } = mockReqRes({ biometricId: '1003', deviceId: 'dev1' });
    await validateBiometricId(req, res);
  } finally {
    sqliteModule.pool.query = originalQuery;
  }
  assert.ok(sawTodayActiveSessionsQuery, 'expected the member-lookup query to run');
  assert.ok(
    capturedParams.includes(todayStr()),
    `expected local date ${todayStr()} among query params, got ${JSON.stringify(capturedParams)}`
  );
});

test('regression (leave-blocking bug): member with an open session in a different session window is still authorized (must always be able to leave)', async () => {
  await setSetting('cross_session_checkin_restriction', 'true');
  const memberId = insertMember({ name: 'Leaver', biometricId: 1004 });

  // Open (not checked out) attendance row whose check-in falls in the
  // "evening" window, while real "now" (and the "morning" window) is where
  // this request lands — i.e. the member checked in during one session and is
  // scanning again during the other, having never checked out. Before the
  // fix this hit cross_session_violation and could never leave; the endpoint
  // must authorize it since a scan against an open session is the member
  // trying to leave.
  const eveningMinutes = nowMinutes() < 720 ? nowMinutes() + 270 : nowMinutes() - 270;
  const eveningTimeStr = hhmm(eveningMinutes);
  insertAttendance(memberId, `${todayStr()}T${eveningTimeStr}:00`, { checkedOut: false });

  const { req, res, getJson } = mockReqRes({ biometricId: '1004', deviceId: 'dev1' });
  await validateBiometricId(req, res);
  assert.equal(
    getJson().authorized,
    true,
    `member with an open cross-session attendance row must be authorized to leave: ${JSON.stringify(getJson())}`
  );
});

test('cross-session gate still blocks a FRESH check-in into a second session (no open row)', async () => {
  await setSetting('cross_session_checkin_restriction', 'true');
  const memberId = insertMember({ name: 'FreshCrossSession', biometricId: 1005 });

  // Completed (checked out) session in the "evening" window; now scanning
  // fresh (no open row) during the "morning" window where real "now" lands.
  const eveningMinutes = nowMinutes() < 720 ? nowMinutes() + 270 : nowMinutes() - 270;
  const eveningTimeStr = hhmm(eveningMinutes);
  insertAttendance(memberId, `${todayStr()}T${eveningTimeStr}:00`, { checkedOut: true });

  const { req, res, getJson } = mockReqRes({ biometricId: '1005', deviceId: 'dev1' });
  await validateBiometricId(req, res);
  assert.equal(getJson().authorized, false);
  assert.equal(getJson().reason, 'cross_session_violation');
});

test('member who already completed check-in+check-out THIS session is still authorized to re-enter (door stays permissive; attendance bookkeeping denies separately)', async () => {
  await setSetting('cross_session_checkin_restriction', 'true');
  const memberId = insertMember({ name: 'ReturnedFromCall', biometricId: 1006 });

  // Completed (checked out) session in the SAME window as "now" — e.g. the
  // member checked in, stepped out for a phone call past the checkout dwell
  // window (recorded as a checkout), and is now scanning again to walk back
  // in, still within the same session. The door must still unlock: only
  // cross-session scans should be denied here. checkInService.processCheckIn
  // separately denies this as 'already_completed' for the attendance record
  // — that's correct and untouched by this endpoint.
  const morningTimeStr = hhmm(nowMinutes());
  insertAttendance(memberId, `${todayStr()}T${morningTimeStr}:00`, { checkedOut: true });

  const { req, res, getJson } = mockReqRes({ biometricId: '1006', deviceId: 'dev1' });
  await validateBiometricId(req, res);
  assert.equal(
    getJson().authorized,
    true,
    `same-session re-entry after a completed checkout must still unlock the door: ${JSON.stringify(getJson())}`
  );
});
