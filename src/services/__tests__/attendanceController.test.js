const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown } = require('./testDb');
const settingsCache = require('../settingsCache');

let db;
let attendanceController;

const dateStrOf = (d) => {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().split('T')[0];
};
const todayStr = () => dateStrOf(new Date());

async function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
  await settingsCache.refresh();
}

function insertMember({ name = 'Test', isActive = 1, isAdmin = 0 } = {}) {
  const info = db
    .prepare('INSERT INTO members (name, is_active, is_admin) VALUES (?, ?, ?)')
    .run(name, isActive, isAdmin);
  return info.lastInsertRowid;
}

function insertAttendance(memberId, { checkedOut = true, date, rawCheckInTime } = {}) {
  const info = db
    .prepare(
      'INSERT INTO attendance (member_id, check_in_time, check_out_time, date) VALUES (?, ?, ?, ?)'
    )
    .run(
      memberId,
      rawCheckInTime,
      checkedOut ? new Date().toISOString() : null,
      date || todayStr()
    );
  return info.lastInsertRowid;
}

function mockRes() {
  const res = { _status: 200, _body: null };
  res.status = (code) => {
    res._status = code;
    return res;
  };
  res.json = (body) => {
    res._body = body;
    return res;
  };
  return res;
}

test.before(async () => {
  db = await setup();
  attendanceController = require('../../api/controllers/attendanceController');
});

test.after(async () => {
  await teardown();
});

test('cross-session check-in is still blocked when the earlier check-in was recorded by a device with a skewed clock', async () => {
  // The earlier session's `date` bucket is correctly today (server-derived),
  // but its stored check_in_time is verbatim from a device clock that was on
  // a wholly different calendar day. The cross-session lookup must key off
  // the `date` column, not DATE(check_in_time) — otherwise it silently stops
  // matching this row and lets a second, same-day session through.
  await setSetting('morning_session_start', '08:00');
  await setSetting('morning_session_end', '11:00');
  await setSetting('evening_session_start', '17:00');
  await setSetting('evening_session_end', '19:00');
  await setSetting('cross_session_checkin_restriction', 'true');

  const memberId = insertMember({ name: 'CrossSessionSkewedEarlier' });
  insertAttendance(memberId, {
    checkedOut: true,
    date: todayStr(),
    rawCheckInTime: '1970-01-01T09:00:00',
  });

  const today = todayStr();
  mock.timers.enable({ apis: ['Date'], now: new Date(`${today}T18:00:00`) });
  try {
    const res = mockRes();
    await attendanceController.checkIn({ body: { memberId } }, res);
    assert.equal(res._status, 409, 'a same-day earlier session must still block the evening scan');
    assert.match(res._body.message, /already checked in/i);
  } finally {
    mock.timers.reset();
  }
});

test('attendance row inserted by checkIn is bucketed by the LOCAL calendar date, not UTC', async () => {
  await setSetting('morning_session_start', '08:00');
  await setSetting('morning_session_end', '11:00');
  await setSetting('evening_session_start', '17:00');
  await setSetting('evening_session_end', '19:00');

  const memberId = insertMember({ name: 'LocalDateBucket' });
  const today = todayStr();
  mock.timers.enable({ apis: ['Date'], now: new Date(`${today}T09:30:00`) });
  try {
    const res = mockRes();
    await attendanceController.checkIn({ body: { memberId } }, res);
    assert.equal(res._status, 200);
  } finally {
    mock.timers.reset();
  }

  const row = db.prepare('SELECT date FROM attendance WHERE member_id = ?').get(memberId);
  assert.equal(row.date, today, 'date column must be populated with the local date on insert');
});
