const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown } = require('./testDb');
const settingsCache = require('../settingsCache');

let db;
let checkInService;

// Session windows are wall-clock based; tests pin them relative to "now" so
// they are deterministic at any time of day.
const wrap = (mins) => ((mins % 1440) + 1440) % 1440;
const hhmm = (mins) => {
  const m = wrap(mins);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
const nowMinutes = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

// The service derives its "today" from the UTC date string (matching the
// behavior extracted from logMemberAttendance).
const todayStr = () => new Date().toISOString().split('T')[0];

// Local-time ISO string (no Z) — parsed as local time, like ESP32 timestamps.
const localIso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` +
  `T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`;

async function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
  await settingsCache.refresh();
}

// Puts "now" inside the morning window and keeps the evening window far away.
async function openSessionWindowNow() {
  const m = nowMinutes();
  await setSetting('morning_session_start', hhmm(m - 60));
  await setSetting('morning_session_end', hhmm(m + 60));
  await setSetting('evening_session_start', hhmm(m + 120));
  await setSetting('evening_session_end', hhmm(m + 180));
}

function insertMember({ name = 'Test', isActive = 1, isAdmin = 0, planId = null, joinDate }) {
  const info = db
    .prepare(
      `INSERT INTO members (name, is_active, is_admin, membership_plan_id, join_date)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(name, isActive, isAdmin, planId, joinDate || todayStr());
  return info.lastInsertRowid;
}

function insertAttendance(memberId, checkInDate, { checkedOut = false } = {}) {
  const info = db
    .prepare(
      'INSERT INTO attendance (member_id, check_in_time, check_out_time, date) VALUES (?, ?, ?, ?)'
    )
    .run(memberId, localIso(checkInDate), checkedOut ? localIso(new Date()) : null, todayStr());
  return info.lastInsertRowid;
}

const eventsFor = (memberId) =>
  db.prepare('SELECT * FROM biometric_events WHERE member_id = ? ORDER BY id').all(memberId);

test.before(async () => {
  db = await setup();
  checkInService = require('../checkInService');
  db.prepare(
    "INSERT INTO membership_plans (id, name, price, duration_days) VALUES (1, 'Monthly', 500, 30)"
  ).run();
  await openSessionWindowNow();
});

test.after(async () => {
  await teardown();
});

test('face check-in: authorized happy path inserts attendance and logs event', async () => {
  const memberId = insertMember({ name: 'Alice' });
  const result = await checkInService.processCheckIn(memberId, {
    modality: 'face',
    matchScore: 0.72,
    eventContext: { biometricRef: 'face', raw: { modality: 'face' } },
  });

  assert.equal(result.authorized, true);
  assert.equal(result.action, 'checkin');
  assert.equal(result.reason, 'checked_in');
  assert.ok(result.attendanceId);

  const rows = db.prepare('SELECT * FROM attendance WHERE member_id = ?').all(memberId);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].check_out_time, null);

  const events = eventsFor(memberId);
  assert.equal(events.length, 1);
  assert.equal(events[0].event_type, 'checkin');
  assert.equal(events[0].success, 1);

  const member = db.prepare('SELECT last_visit FROM members WHERE id = ?').get(memberId);
  assert.ok(member.last_visit, 'last_visit should be updated');
});

test('unknown member denied with member_not_found', async () => {
  const result = await checkInService.processCheckIn(999999, { modality: 'face' });
  assert.equal(result.authorized, false);
  assert.equal(result.reason, 'member_not_found');
});

test('face check-in: inactive member denied; fingerprint mode still records (historical behavior)', async () => {
  const faceMember = insertMember({ name: 'InactiveFace', isActive: 0 });
  const faceResult = await checkInService.processCheckIn(faceMember, {
    modality: 'face',
    enforceAuthorization: true,
  });
  assert.equal(faceResult.authorized, false);
  assert.equal(faceResult.reason, 'member_inactive');
  assert.equal(
    db.prepare('SELECT COUNT(*) n FROM attendance WHERE member_id = ?').get(faceMember).n,
    0
  );

  const fpMember = insertMember({ name: 'InactiveFp', isActive: 0 });
  const fpResult = await checkInService.processCheckIn(fpMember, {
    modality: 'fingerprint',
    enforceAuthorization: false,
  });
  assert.equal(fpResult.authorized, true);
  assert.equal(
    db.prepare('SELECT COUNT(*) n FROM attendance WHERE member_id = ?').get(fpMember).n,
    1
  );
});

test('check-in outside session windows denied for non-admin, allowed for admin', async () => {
  const m = nowMinutes();
  // Close both windows (place them away from now)
  await setSetting('morning_session_start', hhmm(m + 120));
  await setSetting('morning_session_end', hhmm(m + 180));
  await setSetting('evening_session_start', hhmm(m + 240));
  await setSetting('evening_session_end', hhmm(m + 300));

  const memberId = insertMember({ name: 'OutsideWindow' });
  const denied = await checkInService.processCheckIn(memberId, {
    modality: 'face',
    eventContext: { biometricRef: 'face' },
  });
  assert.equal(denied.authorized, false);
  assert.equal(denied.reason, 'outside_session_windows');
  assert.equal(eventsFor(memberId)[0].event_type, 'session_violation');

  const adminId = insertMember({ name: 'AdminOutside', isAdmin: 1 });
  const adminResult = await checkInService.processCheckIn(adminId, { modality: 'face' });
  assert.equal(adminResult.authorized, true, 'admins bypass session windows');

  await openSessionWindowNow();
});

test('cross-session check-in blocked when restriction enabled', async () => {
  const m = nowMinutes();
  // Now sits in the EVENING window; morning window is earlier today.
  await setSetting('morning_session_start', hhmm(m - 300));
  await setSetting('morning_session_end', hhmm(m - 240));
  await setSetting('evening_session_start', hhmm(m - 30));
  await setSetting('evening_session_end', hhmm(m + 60));
  await setSetting('cross_session_checkin_restriction', 'true');

  const memberId = insertMember({ name: 'CrossSession' });
  // Completed morning session (checked out) at a time inside the morning window.
  const morning = new Date();
  morning.setMinutes(morning.getMinutes() - 270);
  insertAttendance(memberId, morning, { checkedOut: true });

  const result = await checkInService.processCheckIn(memberId, {
    modality: 'face',
    eventContext: { biometricRef: 'face' },
  });
  assert.equal(result.authorized, false);
  assert.equal(result.reason, 'cross_session_violation');

  await openSessionWindowNow();
});

test('plan grace expiry denies face check-in and auto-deactivates member', async () => {
  const memberId = insertMember({
    name: 'Expired',
    planId: 1,
    joinDate: '2025-01-01', // 30-day plan, no payments — far past grace
  });
  const result = await checkInService.processCheckIn(memberId, {
    modality: 'face',
    enforceAuthorization: true,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.reason, 'payment_overdue_grace_expired');

  const member = db.prepare('SELECT is_active FROM members WHERE id = ?').get(memberId);
  assert.equal(member.is_active, 0, 'member should be auto-deactivated');
  assert.equal(
    db.prepare('SELECT COUNT(*) n FROM attendance WHERE member_id = ?').get(memberId).n,
    0
  );
});

test('checkout: authorized even with expired plan, and not gated by session windows (face)', async () => {
  const memberId = insertMember({
    name: 'LeavingExpired',
    planId: 1,
    joinDate: '2025-01-01',
  });
  const checkIn = new Date();
  checkIn.setMinutes(checkIn.getMinutes() - 30);
  insertAttendance(memberId, checkIn);

  // Close all session windows — checkout must still work for face.
  const m = nowMinutes();
  await setSetting('morning_session_start', hhmm(m + 120));
  await setSetting('morning_session_end', hhmm(m + 180));
  await setSetting('evening_session_start', hhmm(m + 240));
  await setSetting('evening_session_end', hhmm(m + 300));

  const result = await checkInService.processCheckIn(memberId, {
    modality: 'face',
    enforceAuthorization: true,
    enforceSessionWindowsOnCheckout: false,
    minCheckoutDwellMinutes: 15,
    eventContext: { biometricRef: 'face' },
  });
  assert.equal(result.authorized, true, 'checkout must not be gated by plan validity');
  assert.equal(result.action, 'checkout');

  const row = db.prepare('SELECT check_out_time FROM attendance WHERE member_id = ?').get(memberId);
  assert.ok(row.check_out_time, 'check_out_time should be set');

  await openSessionWindowNow();
});

test('checkout dwell guard: scan shortly after check-in is ignored as duplicate', async () => {
  const memberId = insertMember({ name: 'Lingerer' });
  const checkIn = new Date();
  checkIn.setMinutes(checkIn.getMinutes() - 2);
  insertAttendance(memberId, checkIn);

  const result = await checkInService.processCheckIn(memberId, {
    modality: 'face',
    minCheckoutDwellMinutes: 15,
    eventContext: { biometricRef: 'face' },
  });
  assert.equal(result.authorized, false);
  assert.equal(result.reason, 'dwell_time_not_met');

  const row = db.prepare('SELECT check_out_time FROM attendance WHERE member_id = ?').get(memberId);
  assert.equal(row.check_out_time, null, 'must NOT be flipped to checked out');
});

test('fingerprint checkout is blocked outside session windows (historical behavior preserved)', async () => {
  const memberId = insertMember({ name: 'FpCheckout' });
  const checkIn = new Date();
  checkIn.setMinutes(checkIn.getMinutes() - 60);
  insertAttendance(memberId, checkIn);

  const m = nowMinutes();
  await setSetting('morning_session_start', hhmm(m + 120));
  await setSetting('morning_session_end', hhmm(m + 180));
  await setSetting('evening_session_start', hhmm(m + 240));
  await setSetting('evening_session_end', hhmm(m + 300));

  const result = await checkInService.processCheckIn(memberId, {
    modality: 'fingerprint',
    enforceAuthorization: false,
    enforceSessionWindowsOnCheckout: true,
  });
  assert.equal(result.authorized, false);
  assert.equal(result.reason, 'outside_session_windows');

  await openSessionWindowNow();
});

test('second scan after completed session is denied with already_completed', async () => {
  const memberId = insertMember({ name: 'DoneToday' });
  insertAttendance(memberId, new Date(), { checkedOut: true });

  const result = await checkInService.processCheckIn(memberId, { modality: 'face' });
  assert.equal(result.authorized, false);
  assert.equal(result.reason, 'already_completed');
});

test('device timestamp string is stored verbatim as check_in_time', async () => {
  const memberId = insertMember({ name: 'Stamped' });
  const stamp = localIso(new Date());
  const result = await checkInService.processCheckIn(memberId, {
    modality: 'fingerprint',
    enforceAuthorization: false,
    timestamp: stamp,
  });
  assert.equal(result.authorized, true);
  const row = db.prepare('SELECT check_in_time FROM attendance WHERE member_id = ?').get(memberId);
  assert.equal(row.check_in_time, stamp);
});
