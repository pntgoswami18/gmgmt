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
    // Dwell 0 → any second scan checks out immediately (the historical
    // fingerprint behavior). The re-entry path with a non-zero dwell is covered
    // by the next test.
    set('fingerprint_checkout_min_dwell_minutes', 0);
    await settingsCache.refresh();

    const memberId = db
      .prepare('INSERT INTO members (name, is_active) VALUES (?, 1)')
      .run('Dispatch Subject').lastInsertRowid;
    const member = { id: memberId, name: 'Dispatch Subject' };

    const integration = new BiometricIntegration();
    const calls = [];
    integration.notifyCheckIn = (mem) => calls.push(['checkin', mem.id]);
    integration.notifyCheckOut = (mem) => calls.push(['checkout', mem.id]);
    integration.notifyReentry = (mem) => calls.push(['reentry', mem.id]);
    integration.notifyAlreadyCompleted = (mem) => calls.push(['already_completed', mem.id]);

    // 1st scan → check-in broadcast.
    const first = await integration.logMemberAttendance(member, null, {
      userId: '9',
      deviceId: 'd',
    });
    assert.equal(first.reason, 'checked_in');
    // 2nd scan → checkout broadcast (dwell 0, so an immediate re-scan checks out).
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

test('logMemberAttendance: a re-scan within the dwell window is a re-entry, not a checkout', async () => {
  const db = await setup();
  try {
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
    set('fingerprint_checkout_min_dwell_minutes', 15);
    await settingsCache.refresh();

    const memberId = db
      .prepare('INSERT INTO members (name, is_active) VALUES (?, 1)')
      .run('Returner').lastInsertRowid;
    const member = { id: memberId, name: 'Returner' };

    const integration = new BiometricIntegration();
    const calls = [];
    integration.notifyCheckIn = (mem) => calls.push(['checkin', mem.id]);
    integration.notifyCheckOut = (mem) => calls.push(['checkout', mem.id]);
    integration.notifyReentry = (mem) => calls.push(['reentry', mem.id]);
    integration.notifyAlreadyCompleted = (mem) => calls.push(['already_completed', mem.id]);

    // 1st scan → check-in.
    const first = await integration.logMemberAttendance(member, null, {
      userId: '9',
      deviceId: 'd',
    });
    assert.equal(first.reason, 'checked_in');
    // 2nd scan, immediately (within the 15-min dwell) → re-entry, NOT checkout.
    const second = await integration.logMemberAttendance(member, null, {
      userId: '9',
      deviceId: 'd',
    });
    assert.equal(second.reason, 'already_checked_in');
    assert.equal(second.action, 'reentry');

    // Attendance is untouched: exactly one open row, never checked out.
    const rows = db.prepare('SELECT * FROM attendance WHERE member_id = ?').all(memberId);
    assert.equal(rows.length, 1, 'no duplicate attendance row on re-entry');
    assert.equal(rows[0].check_out_time, null, 'must NOT be flipped to checked out');

    assert.deepEqual(calls, [
      ['checkin', memberId],
      ['reentry', memberId],
    ]);
  } finally {
    await teardown();
  }
});

// ---------------------------------------------------------------------------
// deleteFingerprint / deleteAllMemberFingerprints must clear biometric_id to
// NULL, not '' — idx_members_biometric_id is a UNIQUE partial index that
// exempts NULL but not ''. Writing '' means the *second* member cleared in a
// row (e.g. paymentDeactivationService sweeping several overdue members)
// throws a UNIQUE constraint violation, silently swallowed by the try/catch
// in each method, leaving that member's biometric_id stuck at its old value.
// ---------------------------------------------------------------------------

test('deleteFingerprint clears biometric_id to NULL so a second member can be cleared too', async () => {
  const db = await setup();
  try {
    const memberA = db
      .prepare("INSERT INTO members (name, is_active, biometric_id) VALUES ('A', 1, '101')")
      .run().lastInsertRowid;
    const memberB = db
      .prepare("INSERT INTO members (name, is_active, biometric_id) VALUES ('B', 1, '102')")
      .run().lastInsertRowid;

    const integration = new BiometricIntegration();
    integration.sendESP32Command = async () => ({ success: true });

    await integration.deleteFingerprint(memberA);
    await integration.deleteFingerprint(memberB);

    const rows = db
      .prepare('SELECT id, biometric_id FROM members WHERE id IN (?, ?)')
      .all(memberA, memberB);
    for (const row of rows) {
      assert.equal(row.biometric_id, null, `member ${row.id} must be NULL, not ''`);
    }
  } finally {
    await teardown();
  }
});

test('deleteAllMemberFingerprints clears biometric_id to NULL so a second member can be cleared too', async () => {
  const db = await setup();
  try {
    const memberA = db
      .prepare("INSERT INTO members (name, is_active, biometric_id) VALUES ('A', 1, '201')")
      .run().lastInsertRowid;
    const memberB = db
      .prepare("INSERT INTO members (name, is_active, biometric_id) VALUES ('B', 1, '202')")
      .run().lastInsertRowid;

    const integration = new BiometricIntegration();
    integration.sendESP32Command = async () => ({ success: true });

    await integration.deleteAllMemberFingerprints(memberA);
    await integration.deleteAllMemberFingerprints(memberB);

    const rows = db
      .prepare('SELECT id, biometric_id FROM members WHERE id IN (?, ?)')
      .all(memberA, memberB);
    for (const row of rows) {
      assert.equal(row.biometric_id, null, `member ${row.id} must be NULL, not ''`);
    }
  } finally {
    await teardown();
  }
});

// ---------------------------------------------------------------------------
// syncBiometricData: a member whose biometric_id is NULL (no active slot) has
// nothing to match against, so every leftover member_biometrics row for them
// is orphaned — not just rows that fail to equal a nonexistent value. Before
// this fix, `WHERE m.biometric_id != ''` excluded NULL rows entirely (SQL's
// `NULL != ''` is NULL, not true), so those templates never got cleaned up.
// ---------------------------------------------------------------------------

test('syncBiometricData flags leftover member_biometrics rows for NULL-biometric_id members as stale', async () => {
  const db = await setup();
  try {
    const cleared = db
      .prepare("INSERT INTO members (name, is_active, biometric_id) VALUES ('Cleared', 1, NULL)")
      .run().lastInsertRowid;
    const active = db
      .prepare("INSERT INTO members (name, is_active, biometric_id) VALUES ('Active', 1, '5')")
      .run().lastInsertRowid;

    // Orphaned slot for the cleared member — no template, so it should be deleted outright.
    db.prepare("INSERT INTO member_biometrics (member_id, device_user_id) VALUES (?, '3')").run(
      cleared
    );
    // The active member's slot matches their current biometric_id — not stale.
    db.prepare("INSERT INTO member_biometrics (member_id, device_user_id) VALUES (?, '5')").run(
      active
    );

    db.prepare("INSERT INTO devices (device_id, status) VALUES ('dev1', 'online')").run();

    const integration = new BiometricIntegration();
    const deletedSlots = [];
    integration.sendESP32Command = async (deviceId, command, payload) => {
      if (command === 'delete_fingerprint') deletedSlots.push(payload.slotId);
      return { success: true };
    };

    const summary = await integration.syncBiometricData();

    assert.equal(summary.errors, 0);
    assert.deepEqual(deletedSlots, [3], 'only the orphaned NULL-biometric_id slot is deleted');
    assert.equal(summary.stale_slots_deleted, 1);
    assert.equal(summary.db_rows_removed, 1);

    const remaining = db.prepare('SELECT member_id, device_user_id FROM member_biometrics').all();
    assert.deepEqual(remaining, [{ member_id: active, device_user_id: '5' }]);
  } finally {
    await teardown();
  }
});
