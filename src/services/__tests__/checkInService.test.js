const test = require('node:test');
const { mock } = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown } = require('./testDb');
const settingsCache = require('../settingsCache');
const { hhmm, nowMinutes, awayWindow } = require('./sessionWindowTestUtils');

let db;
let checkInService;

// The service derives its "today" from the LOCAL calendar date — attendance
// days and session windows are both local concepts. (The UTC-derived date the
// pre-refactor code used split early-morning visits across two date buckets
// on UTC-positive timezones.)
const dateStrOf = (d) => {
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().split('T')[0];
};
const todayStr = () => dateStrOf(new Date());

// Local-time ISO string (no Z) — parsed as local time, like ESP32 timestamps.
// Seconds are preserved (not zeroed) so sub-minute dwell math in the service
// isn't skewed by up to a minute depending on when the test happens to run.
// Zeroing seconds was originally the root cause of a flaky failure in
// "re-entry near the top of the dwell window reports 1 minute, never 0"
// below: it could push a nominal 14.5-minute-old check-in stamp up to 59s
// earlier, tipping dwellMinutes over the 15-minute checkout threshold on
// roughly half of all real-clock runs. That test has since been reworked to
// bypass localIso entirely (it pins check-in and scan to the same reference
// instant via explicit full-precision timestamps, for a margin of exactly
// 30s every run instead of "usually enough"), but this fix still applies to
// every other dwell-relative test in the file that goes through localIso's
// default insertAttendance() path.
const localIso = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` +
  `T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;

async function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
  await settingsCache.refresh();
}

// Puts "now" inside the morning window and keeps the evening window far away.
//
// MIDNIGHT SAFETY: sessionOf() uses non-wrapping start<=t<=end comparisons, so
// helper windows must never cross midnight — naive `hhmm(m - 60)` at 00:20
// produces a 23:20–01:20 "window" that matches nothing and every session-gated
// test fails between roughly 21:00 and 03:00 wall-clock. clamp/awayWindow (see
// sessionWindowTestUtils) keep every derived minute inside a single day.
async function openSessionWindowNow() {
  const m = nowMinutes();
  await setSetting('morning_session_start', hhmm(m - 60));
  await setSetting('morning_session_end', hhmm(m + 60));
  // "Evening" only needs to exist somewhere that does NOT contain now.
  const [evStart, evEnd] = awayWindow(m, 240, 300);
  await setSetting('evening_session_start', hhmm(evStart));
  await setSetting('evening_session_end', hhmm(evEnd));
}

// Closes both windows: places them on whichever side of "now" fits in-day.
async function closeAllSessionWindowsNow() {
  const m = nowMinutes();
  const [aStart, aEnd] = awayWindow(m, 120, 180);
  const [bStart, bEnd] = awayWindow(m, 240, 300);
  await setSetting('morning_session_start', hhmm(aStart));
  await setSetting('morning_session_end', hhmm(aEnd));
  await setSetting('evening_session_start', hhmm(bStart));
  await setSetting('evening_session_end', hhmm(bEnd));
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

function insertAttendance(
  memberId,
  checkInDate,
  { checkedOut = false, date, rawCheckInTime } = {}
) {
  const info = db
    .prepare(
      'INSERT INTO attendance (member_id, check_in_time, check_out_time, date) VALUES (?, ?, ?, ?)'
    )
    .run(
      memberId,
      rawCheckInTime !== undefined ? rawCheckInTime : localIso(checkInDate),
      checkedOut ? localIso(new Date()) : null,
      date || todayStr()
    );
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

// Safety net for tests that fake the clock via `mock.timers` (the global
// tracker imported above, not a test-context-scoped one, so it does NOT
// auto-reset between tests): a test that throws before its own try/finally
// resets the clock — or a future test that forgets to reset at all — would
// otherwise leak fake time into every test that runs after it. `reset()` is
// a no-op when the clock isn't currently mocked, so this is safe to run
// unconditionally after every test.
test.afterEach(() => {
  mock.timers.reset();
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
  await closeAllSessionWindowsNow();

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
  // Fully synthetic clock: fixed windows + explicit device timestamps, so the
  // "checked in earlier today" scenario exists at any wall-clock time (it
  // physically can't right after midnight).
  await setSetting('morning_session_start', '08:00');
  await setSetting('morning_session_end', '11:00');
  await setSetting('evening_session_start', '17:00');
  await setSetting('evening_session_end', '19:00');
  await setSetting('cross_session_checkin_restriction', 'true');

  const memberId = insertMember({ name: 'CrossSession' });
  const today = todayStr();
  // Completed morning session (checked out) inside the morning window.
  insertAttendance(memberId, null, {
    checkedOut: true,
    rawCheckInTime: `${today}T09:00:00`,
  });

  // currentSession is derived from the server's wall clock, not the
  // device-reported timestamp (clock-trust fix in checkInService.js), so the
  // server clock — not just the `timestamp` option below — must be placed in
  // the evening window for this scan to land there.
  mock.timers.enable({ apis: ['Date'], now: new Date(`${today}T18:00:00`) });
  try {
    const result = await checkInService.processCheckIn(memberId, {
      modality: 'face',
      timestamp: `${today}T18:00:00`, // evening scan (device-reported time, stored verbatim)
      eventContext: { biometricRef: 'face' },
    });
    assert.equal(result.authorized, false);
    assert.equal(result.reason, 'cross_session_violation');
  } finally {
    mock.timers.reset();
  }

  await openSessionWindowNow();
});

test('session-window decision ignores a skewed device clock: a fingerprint unit reporting a timestamp outside the real session window must not force an incorrect denial', async () => {
  // Real server clock is inside the (real-time-relative) session window...
  await openSessionWindowNow();

  // ...but this simulates a device whose onboard clock is wrong and reports
  // a timestamp far outside any configured session window. Pre-fix,
  // currentSession was computed from this device-reported `now`, so a wrong
  // device clock could wrongly deny a check-in that is happening right now,
  // during an open session window, on the server's own clock.
  // awayWindow keeps this offset (3-4 hours from real "now") on whichever
  // side of midnight fits in-day, same MIDNIGHT SAFETY concern as the window
  // helpers above.
  const [skewedMinute] = awayWindow(nowMinutes(), 180, 240);
  const skewedDeviceTimestamp = `${todayStr()}T${hhmm(skewedMinute)}:00`;

  const memberId = insertMember({ name: 'SkewedSessionDevice' });
  const result = await checkInService.processCheckIn(memberId, {
    modality: 'fingerprint',
    enforceAuthorization: false,
    timestamp: skewedDeviceTimestamp,
    eventContext: { biometricRef: 'fingerprint' },
  });

  assert.equal(result.authorized, true, JSON.stringify(result));
  assert.equal(result.action, 'checkin');
  assert.equal(result.reason, 'checked_in');

  // The device-reported time is still stored verbatim for the attendance
  // record itself — only the session-window *decision* uses the server clock.
  const row = db.prepare('SELECT check_in_time FROM attendance WHERE member_id = ?').get(memberId);
  assert.equal(row.check_in_time, skewedDeviceTimestamp);
});

test('cross-session check-in is still blocked when the earlier check-in was recorded by a device with a skewed clock', async () => {
  // The earlier session's `date` bucket is correctly today (per the
  // day-bucket fix), but its stored check_in_time is verbatim from a device
  // clock that was on a wholly different calendar day (e.g. dead RTC battery
  // at the time of that scan). The cross-session lookup must key off the
  // `date` column, not DATE(check_in_time) — otherwise it silently stops
  // matching this row and lets a second, same-day session through.
  await setSetting('morning_session_start', '08:00');
  await setSetting('morning_session_end', '11:00');
  await setSetting('evening_session_start', '17:00');
  await setSetting('evening_session_end', '19:00');
  await setSetting('cross_session_checkin_restriction', 'true');

  const memberId = insertMember({ name: 'CrossSessionSkewedEarlier' });
  insertAttendance(memberId, null, {
    checkedOut: true,
    date: todayStr(),
    rawCheckInTime: '1970-01-01T09:00:00',
  });

  // currentSession is derived from the server's wall clock (clock-trust fix),
  // so the server clock — not just the `timestamp` option below — must be
  // placed in the evening window for this scan to land there.
  const today = todayStr();
  mock.timers.enable({ apis: ['Date'], now: new Date(`${today}T18:00:00`) });
  try {
    const result = await checkInService.processCheckIn(memberId, {
      modality: 'face',
      timestamp: `${today}T18:00:00`, // evening scan, normal device clock
      eventContext: { biometricRef: 'face' },
    });
    assert.equal(result.authorized, false);
    assert.equal(result.reason, 'cross_session_violation');
  } finally {
    mock.timers.reset();
  }

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
  await closeAllSessionWindowsNow();

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

test('re-entry within dwell: scan shortly after check-in is authorized (door unlocks) with no checkout and no new row', async () => {
  const memberId = insertMember({ name: 'Lingerer' });
  const checkIn = new Date();
  checkIn.setMinutes(checkIn.getMinutes() - 2);
  const attendanceId = insertAttendance(memberId, checkIn);

  const result = await checkInService.processCheckIn(memberId, {
    modality: 'face',
    minCheckoutDwellMinutes: 15,
    eventContext: { biometricRef: 'face' },
  });
  // Member stepped out and walked back in — let them through (authorized so the
  // door unlocks) but don't check them out or double-log attendance.
  assert.equal(result.authorized, true, JSON.stringify(result));
  assert.equal(result.action, 'reentry');
  assert.equal(result.reason, 'already_checked_in');
  assert.equal(result.attendanceId, attendanceId, 'stays on the same open row');
  assert.ok(
    result.minutesUntilCheckout >= 12 && result.minutesUntilCheckout <= 15,
    `expected ~13 min until checkout, got ${result.minutesUntilCheckout}`
  );

  const rows = db.prepare('SELECT * FROM attendance WHERE member_id = ?').all(memberId);
  assert.equal(rows.length, 1, 'must NOT create a duplicate attendance row');
  assert.equal(rows[0].check_out_time, null, 'must NOT be flipped to checked out');

  const events = eventsFor(memberId);
  assert.equal(events.at(-1).event_type, 'reentry');
  assert.equal(events.at(-1).success, 1);
});

test('re-entry within dwell: deactivated member is refused re-admission (not authorized), but the open row is untouched', async () => {
  const memberId = insertMember({ name: 'Lapsed', isActive: 0 });
  const checkIn = new Date();
  checkIn.setMinutes(checkIn.getMinutes() - 2);
  const attendanceId = insertAttendance(memberId, checkIn);

  const result = await checkInService.processCheckIn(memberId, {
    modality: 'face',
    minCheckoutDwellMinutes: 15,
    eventContext: { biometricRef: 'face' },
  });
  // Re-entry is re-admission INTO the building, so a member deactivated after
  // check-in must not be let back in on the strength of the stale open row.
  assert.equal(result.authorized, false, JSON.stringify(result));
  assert.equal(result.reason, 'member_inactive');
  assert.equal(result.action, null);

  // The open row is neither closed nor duplicated — they can still check OUT
  // once the dwell elapses (that path is intentionally ungated).
  const rows = db.prepare('SELECT * FROM attendance WHERE member_id = ?').all(memberId);
  assert.equal(rows.length, 1, 'must NOT create a duplicate attendance row');
  assert.equal(rows[0].check_out_time, null, 'open row must be left intact for a later checkout');

  const events = eventsFor(memberId);
  assert.equal(events.at(-1).event_type, 'member_inactive');
  assert.equal(events.at(-1).success, 0);
});

test('re-entry within dwell: fingerprint (enforceAuthorization=false) admits a deactivated member, unlike face', async () => {
  const memberId = insertMember({ name: 'LapsedFingerprint', isActive: 0 });
  const checkIn = new Date();
  checkIn.setMinutes(checkIn.getMinutes() - 2);
  insertAttendance(memberId, checkIn);

  const result = await checkInService.processCheckIn(memberId, {
    modality: 'fingerprint',
    enforceAuthorization: false,
    minCheckoutDwellMinutes: 15,
    eventContext: { biometricRef: 'fingerprint' },
  });
  // Fingerprint's is_active gate on re-entry is intentionally skipped
  // (enforceAuthorization: false, matching its historical "always logs
  // attendance" behavior) — unlike face, which denies this same scenario
  // with member_inactive (see the preceding test).
  assert.equal(result.authorized, true, JSON.stringify(result));
  assert.equal(result.action, 'reentry');
  assert.equal(result.reason, 'already_checked_in');

  const rows = db.prepare('SELECT * FROM attendance WHERE member_id = ?').all(memberId);
  assert.equal(rows.length, 1, 'must NOT create a duplicate attendance row');
  assert.equal(rows[0].check_out_time, null, 'must NOT be flipped to checked out');
});

test('re-entry near the top of the dwell window reports 1 minute, never 0 (Math.max floor)', async () => {
  const memberId = insertMember({ name: 'AlmostOut' });

  // 14.5 min into a 15-min dwell → raw ceil(0.5) = 1; the sub-minute remainder
  // must surface as "1 minute until checkout", not "0".
  //
  // Both the check-in row and the scan are pinned to the SAME fixed reference
  // instant, 14.5 minutes apart, via explicit full-precision timestamps
  // (rawCheckInTime / timestamp) — NOT via localIso(), which hardcodes ":00"
  // seconds and so truncates to whole minutes. Truncating both sides down to
  // their respective minute starts turns the intended 14.5-minute gap into
  // anywhere from ~14 to ~15+ minutes depending on the seconds-value of `now`
  // when the test happens to run, occasionally tipping dwellMinutes to >= 15
  // and flipping this to a checkout (observed as a flake correlated with wall
  // time, not DB load). Full-precision timestamps make the gap exactly 14.5
  // minutes regardless of when the test runs.
  const now = new Date();
  const checkIn = new Date(now.getTime() - 14.5 * 60000);
  insertAttendance(memberId, checkIn, { rawCheckInTime: checkIn.toISOString() });

  const result = await checkInService.processCheckIn(memberId, {
    modality: 'face',
    minCheckoutDwellMinutes: 15,
    timestamp: now.toISOString(),
    eventContext: { biometricRef: 'face' },
  });
  assert.equal(result.authorized, true, JSON.stringify(result));
  assert.equal(result.action, 'reentry');
  assert.equal(result.minutesUntilCheckout, 1, 'sub-minute remainder must clamp to 1, not 0');
});

test('fingerprint checkout is blocked outside session windows (historical behavior preserved)', async () => {
  const memberId = insertMember({ name: 'FpCheckout' });
  const checkIn = new Date();
  checkIn.setMinutes(checkIn.getMinutes() - 60);
  insertAttendance(memberId, checkIn);

  await closeAllSessionWindowsNow();

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

// ---------------------------------------------------------------------------
// Safety-critical additions (multi-agent review of PR #18)
// ---------------------------------------------------------------------------

test('DEACTIVATED member can still check out (face) — the headline exit guarantee', async () => {
  // "Active member gets auto-deactivated mid-workout" is a real flow
  // (paymentDeactivationService / grace expiry). The checkout branch must
  // ignore is_active entirely.
  const memberId = insertMember({ name: 'DeactivatedInside' });
  const checkIn = new Date();
  checkIn.setMinutes(checkIn.getMinutes() - 45);
  insertAttendance(memberId, checkIn);
  db.prepare('UPDATE members SET is_active = 0 WHERE id = ?').run(memberId);

  const result = await checkInService.processCheckIn(memberId, {
    modality: 'face',
    enforceAuthorization: true,
    minCheckoutDwellMinutes: 15,
  });
  assert.equal(result.authorized, true, JSON.stringify(result));
  assert.equal(result.action, 'checkout');

  const row = db.prepare('SELECT check_out_time FROM attendance WHERE member_id = ?').get(memberId);
  assert.ok(row.check_out_time, 'deactivated member must be checked out');
});

test('open session + later-session scan => CHECKOUT (deliberate divergence from pre-refactor)', async () => {
  // On main this yielded cross_session_violation and the member could never
  // check out that day. Now an open row always means checkout; the
  // cross-session gate still applies to fresh check-ins.
  await setSetting('cross_session_checkin_restriction', 'true');
  // Synthetic clock (see cross-session test above): fixed windows + explicit
  // timestamps, deterministic at any wall-clock time.
  await setSetting('morning_session_start', '08:00');
  await setSetting('morning_session_end', '11:00');
  await setSetting('evening_session_start', '17:00');
  await setSetting('evening_session_end', '19:00');

  const memberId = insertMember({ name: 'OpenMorningSession' });
  // Open (never checked out) morning-session row.
  insertAttendance(memberId, null, { rawCheckInTime: `${todayStr()}T09:00:00` });

  const result = await checkInService.processCheckIn(memberId, {
    modality: 'face',
    timestamp: `${todayStr()}T18:00:00`, // evening scan
  });
  assert.equal(result.authorized, true, JSON.stringify(result));
  assert.equal(result.action, 'checkout');

  await openSessionWindowNow();
});

test('dwell boundary: scan at exactly the dwell minimum is a checkout, not a duplicate', async () => {
  const memberId = insertMember({ name: 'BoundaryDweller' });
  const checkIn = new Date();
  checkIn.setMinutes(checkIn.getMinutes() - 15);
  insertAttendance(memberId, checkIn);

  const result = await checkInService.processCheckIn(memberId, {
    modality: 'face',
    minCheckoutDwellMinutes: 15,
  });
  assert.equal(result.authorized, true, JSON.stringify(result));
  assert.equal(result.action, 'checkout');
});

test('dwell decision ignores a skewed device clock: a fingerprint unit reporting a timestamp far ahead of real time must not force an immediate checkout', async () => {
  const memberId = insertMember({ name: 'SkewedDevice' });
  // Real check-in 2 minutes ago (server-observed time), well within a 15-min dwell.
  const checkIn = new Date(Date.now() - 2 * 60000);
  insertAttendance(memberId, checkIn, { rawCheckInTime: checkIn.toISOString() });

  // Simulates a second ESP32 unit whose onboard clock is 30 minutes ahead of
  // real time. Pre-fix, dwell math used this device-reported value directly,
  // so (skewed "now" - real checkInTime) would read as ~32 minutes elapsed —
  // past the 15-min dwell — and wrongly flip this to a checkout.
  const skewedDeviceTimestamp = new Date(Date.now() + 30 * 60000).toISOString();

  const result = await checkInService.processCheckIn(memberId, {
    modality: 'fingerprint',
    enforceAuthorization: false,
    minCheckoutDwellMinutes: 15,
    timestamp: skewedDeviceTimestamp,
  });
  assert.equal(result.authorized, true, JSON.stringify(result));
  assert.equal(
    result.action,
    'reentry',
    'must be a re-entry — the real elapsed time is ~2 minutes, not ~32'
  );

  const rows = db.prepare('SELECT * FROM attendance WHERE member_id = ?').all(memberId);
  assert.equal(rows.length, 1, 'must NOT create a duplicate attendance row');
  assert.equal(
    rows[0].check_out_time,
    null,
    'must NOT be flipped to checked out by a skewed device clock'
  );
});

test('corrupt check_in_time on the open row denies with invalid_attendance_record, not a dwell lie', async () => {
  const memberId = insertMember({ name: 'CorruptRow' });
  insertAttendance(memberId, new Date(), { rawCheckInTime: 'not-a-timestamp' });

  const result = await checkInService.processCheckIn(memberId, {
    modality: 'face',
    minCheckoutDwellMinutes: 15,
    eventContext: { biometricRef: 'face' },
  });
  assert.equal(result.authorized, false);
  assert.equal(result.reason, 'invalid_attendance_record');
  const events = eventsFor(memberId);
  assert.equal(events.at(-1).event_type, 'invalid_attendance_record');
});

test("day rollover: face checkout closes yesterday's open row (allowCrossDateCheckout)", async () => {
  const memberId = insertMember({ name: 'Overnighter' });
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(21, 30, 0, 0);
  insertAttendance(memberId, yesterday, { date: dateStrOf(yesterday) });

  // Without the flag (fingerprint historical behavior): no row today, so the
  // scan lands in the check-in direction.
  const withoutFlag = await checkInService.processCheckIn(memberId, {
    modality: 'fingerprint',
    enforceAuthorization: false,
  });
  assert.equal(withoutFlag.action, 'checkin', 'day-scoped behavior preserved without the flag');
  // Remove the row that scan created so the flag case is isolated.
  db.prepare('DELETE FROM attendance WHERE member_id = ? AND date = ?').run(memberId, todayStr());

  const result = await checkInService.processCheckIn(memberId, {
    modality: 'face',
    minCheckoutDwellMinutes: 15,
    allowCrossDateCheckout: true,
  });
  assert.equal(result.authorized, true, JSON.stringify(result));
  assert.equal(result.action, 'checkout');
  const row = db
    .prepare('SELECT check_out_time FROM attendance WHERE member_id = ? AND date = ?')
    .get(memberId, dateStrOf(yesterday));
  assert.ok(row.check_out_time, "yesterday's open row must be the one closed");
});

test('concurrent scans for one member serialize: exactly one row, checked out', async () => {
  // Face (HTTP) and fingerprint (TCP) can fire near-simultaneously for the
  // same member. Unserialized, both read "no open row" and both INSERT.
  const memberId = insertMember({ name: 'Simultaneous' });
  const [first, second] = await Promise.all([
    checkInService.processCheckIn(memberId, {
      modality: 'fingerprint',
      enforceAuthorization: false,
    }),
    checkInService.processCheckIn(memberId, {
      modality: 'fingerprint',
      enforceAuthorization: false,
    }),
  ]);

  const rows = db.prepare('SELECT * FROM attendance WHERE member_id = ?').all(memberId);
  assert.equal(rows.length, 1, 'must not create duplicate attendance rows');
  assert.deepEqual([first.action, second.action].sort(), ['checkin', 'checkout']);
  assert.ok(rows[0].check_out_time, 'second scan became the checkout');
});

test('attendance date is bucketed by LOCAL calendar date', async () => {
  const memberId = insertMember({ name: 'LocalDate' });
  const result = await checkInService.processCheckIn(memberId, {
    modality: 'fingerprint',
    enforceAuthorization: false,
  });
  assert.equal(result.authorized, true);
  const row = db.prepare('SELECT date FROM attendance WHERE member_id = ?').get(memberId);
  assert.equal(row.date, todayStr(), 'date column must be the local date, not the UTC one');
});

test('attendance day bucket ignores a device clock reporting the wrong calendar day', async () => {
  // Must not depend on real wall-clock time being inside the default session
  // windows (see MIDNIGHT SAFETY note on openSessionWindowNow above) — this
  // test drives the check-in direction, which is session-gated.
  await openSessionWindowNow();
  const memberId = insertMember({ name: 'DateSkewDevice' });
  // Simulates a device whose onboard clock is wrong by more than a skew
  // within the day — e.g. a dead RTC battery resetting to the Unix epoch —
  // not just wrong minutes/hours but a wholly different calendar day. The
  // event is really happening right now on the server.
  const result = await checkInService.processCheckIn(memberId, {
    modality: 'fingerprint',
    enforceAuthorization: false,
    timestamp: '1970-01-01T10:00:00',
  });
  assert.equal(result.authorized, true, JSON.stringify(result));
  const row = db
    .prepare('SELECT date, check_in_time FROM attendance WHERE member_id = ?')
    .get(memberId);
  assert.equal(
    row.date,
    todayStr(),
    'date bucket must be the server local date, not the device-reported one'
  );
  // The device-reported instant is still stored verbatim for the record
  // itself — only the day-BUCKET decision uses the server clock.
  assert.equal(row.check_in_time, '1970-01-01T10:00:00');
});

test('re-entry/checkout lookup finds an open row despite a device clock reporting the wrong calendar day', async () => {
  const memberId = insertMember({ name: 'DateSkewLookup' });
  // Open row exists under TODAY's real (server) date bucket.
  insertAttendance(memberId, new Date());

  // Second scan's device clock claims a wholly different calendar day. Pre-fix,
  // this would have looked up (and found nothing under) the wrong day's
  // bucket, so the scan landed in the check-in direction — a duplicate open
  // row for a member who is actually still inside their first, still-open
  // visit — instead of correctly finding and closing it.
  const result = await checkInService.processCheckIn(memberId, {
    modality: 'fingerprint',
    enforceAuthorization: false,
    timestamp: '1970-01-01T10:00:00',
  });
  assert.equal(result.authorized, true, JSON.stringify(result));
  assert.equal(
    result.action,
    'checkout',
    'must find and close the open row despite the device reporting a different calendar day'
  );

  const rows = db.prepare('SELECT * FROM attendance WHERE member_id = ?').all(memberId);
  assert.equal(
    rows.length,
    1,
    'must not create a duplicate attendance row under the wrong-day bucket'
  );
});
