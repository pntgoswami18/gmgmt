const test = require('node:test');
const assert = require('node:assert/strict');

const BiometricIntegration = require('../biometricIntegration');
const { pool } = require('../../config/sqlite');

test('startRemoteEnrollment rolls back mode when ESP32 command fails', async () => {
  const integration = new BiometricIntegration();
  const originalPoolQuery = pool.query;
  const originalSendESP32Command = integration.sendESP32Command;
  const originalStopEnrollmentMode = integration.stopEnrollmentMode.bind(integration);
  const stopReasons = [];

  try {
    pool.query = async () => ({ rows: [{ name: 'Test Member' }] });
    integration.sendESP32Command = async () => {
      throw new Error('HTTP timeout after 10000ms');
    };
    integration.stopEnrollmentMode = (reason) => {
      stopReasons.push(reason);
      return originalStopEnrollmentMode(reason);
    };

    await assert.rejects(
      () => integration.startRemoteEnrollment('esp32-test-device', 123),
      /HTTP timeout/
    );

    assert.equal(integration.getEnrollmentStatus().active, false);
    assert.deepEqual(stopReasons, ['command_failed']);
  } finally {
    pool.query = originalPoolQuery;
    integration.sendESP32Command = originalSendESP32Command;
    integration.stopEnrollmentMode = originalStopEnrollmentMode;
    integration.stopEnrollmentMode('test_cleanup');
  }
});

// ---------------------------------------------------------------------------
// logMemberAttendance notify dispatch (multi-agent review of PR #18): a typo
// in the reason → notify switch would silently kill live check-in broadcasts —
// nothing else asserts them.
// ---------------------------------------------------------------------------

const { setup, teardown } = require('./testDb');
const settingsCache = require('../settingsCache');
const { hhmm, nowMinutes, awayWindow } = require('./sessionWindowTestUtils');

test('logMemberAttendance dispatches the right WebSocket notification per outcome', async () => {
  const db = await setup();
  try {
    // Open the morning session window around "now" so check-in/checkout pass.
    // sessionOf() cannot represent windows that cross midnight, so
    // hhmm/awayWindow (see sessionWindowTestUtils) keep the window in-day —
    // otherwise this test would be flaky right around midnight.
    const mins = nowMinutes();
    const set = (k, v) =>
      db
        .prepare(
          'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
        )
        .run(k, String(v));
    set('morning_session_start', hhmm(mins - 60));
    set('morning_session_end', hhmm(mins + 60));
    const [evS, evE] = awayWindow(mins, 240, 300);
    set('evening_session_start', hhmm(evS));
    set('evening_session_end', hhmm(evE));
    await settingsCache.refresh();

    const memberId = db
      .prepare('INSERT INTO members (name, is_active) VALUES (?, 1)')
      .run('Dispatch Subject').lastInsertRowid;
    const member = { id: memberId, name: 'Dispatch Subject' };

    const integration = new BiometricIntegration();
    const calls = [];
    integration.notifyCheckIn = (mem) => calls.push(['checkin', mem.id]);
    integration.notifyCheckOut = (mem) => calls.push(['checkout', mem.id]);
    integration.notifyAlreadyCompleted = (mem) => calls.push(['already_completed', mem.id]);

    // 1st scan → check-in broadcast.
    const first = await integration.logMemberAttendance(member, null, {
      userId: '9',
      deviceId: 'd',
    });
    assert.equal(first.reason, 'checked_in');
    // 2nd scan → checkout broadcast (no dwell requirement on fingerprint).
    const second = await integration.logMemberAttendance(member, null, {
      userId: '9',
      deviceId: 'd',
    });
    assert.equal(second.reason, 'checked_out');
    // 3rd scan (session complete) → already_completed broadcast.
    const third = await integration.logMemberAttendance(member, null, {
      userId: '9',
      deviceId: 'd',
    });
    assert.equal(third.reason, 'already_completed');

    assert.deepEqual(calls, [
      ['checkin', memberId],
      ['checkout', memberId],
      ['already_completed', memberId],
    ]);
  } finally {
    await teardown();
  }
});
