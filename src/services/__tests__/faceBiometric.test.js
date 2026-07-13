const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown } = require('./testDb');
const settingsCache = require('../settingsCache');

let db;
let faceController;

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

const embedding = (seed = 0) => Array.from({ length: 128 }, (_, i) => Math.sin(i + seed));

async function setSetting(key, value) {
  db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value));
  await settingsCache.refresh();
}

// Session windows wide open so faceCheckIn tests hit the face-specific logic.
async function openAllSessions() {
  await setSetting('morning_session_start', '00:00');
  await setSetting('morning_session_end', '23:59');
}

test.before(async () => {
  db = await setup();
  faceController = require('../../api/controllers/faceBiometricController');
  await openAllSessions();
});

test.after(async () => {
  await teardown();
});

function insertMember(name, extra = {}) {
  return db
    .prepare('INSERT INTO members (name, is_active) VALUES (?, ?)')
    .run(name, extra.isActive ?? 1).lastInsertRowid;
}

test('enrollFace: stores samples transactionally and pins model version', async () => {
  const memberId = insertMember('Enrollee');
  const res = mockRes();
  await faceController.enrollFace(
    {
      params: { memberId: String(memberId) },
      body: {
        modelVersion: 'sface_v1_fp32',
        consent: true,
        samples: [
          { embedding: embedding(1), pose: 'front', quality: 0.9 },
          { embedding: embedding(2), pose: 'left', quality: 0.8 },
        ],
      },
    },
    res
  );

  assert.equal(res._status, 200, JSON.stringify(res._body));
  assert.equal(res._body.success, true);
  const rows = db
    .prepare('SELECT * FROM member_face_embeddings WHERE member_id = ? ORDER BY id')
    .all(memberId);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].model_version, 'sface_v1_fp32');
  assert.equal(rows[0].embedding.length, 128 * 4, 'stored as Float32Array bytes');
  assert.ok(rows[0].consent_at, 'consent timestamp recorded');

  // First enrollment pinned the deployment model version.
  assert.equal(settingsCache.get('face_model_version'), 'sface_v1_fp32');
});

test('enrollFace: rejects missing consent, bad dims, and model version mismatch', async () => {
  const memberId = insertMember('Strict');

  let res = mockRes();
  await faceController.enrollFace(
    {
      params: { memberId: String(memberId) },
      body: { modelVersion: 'sface_v1_fp32', samples: [{ embedding: embedding() }] },
    },
    res
  );
  assert.equal(res._status, 400, 'consent required');

  res = mockRes();
  await faceController.enrollFace(
    {
      params: { memberId: String(memberId) },
      body: {
        modelVersion: 'sface_v1_fp32',
        consent: true,
        samples: [{ embedding: [1, 2, 3] }],
      },
    },
    res
  );
  assert.equal(res._status, 400, 'wrong embedding dims rejected');

  res = mockRes();
  await faceController.enrollFace(
    {
      params: { memberId: String(memberId) },
      body: {
        modelVersion: 'some_other_model',
        consent: true,
        samples: [{ embedding: embedding() }],
      },
    },
    res
  );
  assert.equal(res._status, 409, 'model version mismatch rejected');

  assert.equal(
    db.prepare('SELECT COUNT(*) n FROM member_face_embeddings WHERE member_id = ?').get(memberId).n,
    0,
    'no rows stored by rejected attempts'
  );
});

test('re-enrollment replaces prior samples in one transaction', async () => {
  const memberId = insertMember('ReEnrollee');
  const enroll = (n) =>
    faceController.enrollFace(
      {
        params: { memberId: String(memberId) },
        body: {
          modelVersion: 'sface_v1_fp32',
          consent: true,
          samples: Array.from({ length: n }, (_, i) => ({ embedding: embedding(i + 10) })),
        },
      },
      mockRes()
    );
  await enroll(3);
  await enroll(2);
  assert.equal(
    db.prepare('SELECT COUNT(*) n FROM member_face_embeddings WHERE member_id = ?').get(memberId).n,
    2,
    're-enrollment replaces, not appends'
  );
});

test('removeFaceData: deletes rows and writes a sync tombstone', async () => {
  const memberId = insertMember('Removable');
  await faceController.enrollFace(
    {
      params: { memberId: String(memberId) },
      body: {
        modelVersion: 'sface_v1_fp32',
        consent: true,
        samples: [{ embedding: embedding() }],
      },
    },
    mockRes()
  );

  const res = mockRes();
  await faceController.removeFaceData({ params: { memberId: String(memberId) } }, res);
  assert.equal(res._status, 200);
  assert.equal(
    db.prepare('SELECT COUNT(*) n FROM member_face_embeddings WHERE member_id = ?').get(memberId).n,
    0
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) n FROM face_sync_tombstones WHERE member_id = ?').get(memberId).n,
    1,
    'tombstone written for delta sync'
  );

  const again = mockRes();
  await faceController.removeFaceData({ params: { memberId: String(memberId) } }, again);
  assert.equal(again._status, 404, 'second removal reports nothing to remove');
});

test('syncFaceCache: returns gallery with samples and deletedMemberIds', async () => {
  const keptId = insertMember('Kept');
  const removedId = insertMember('Removed');
  for (const id of [keptId, removedId]) {
    await faceController.enrollFace(
      {
        params: { memberId: String(id) },
        body: {
          modelVersion: 'sface_v1_fp32',
          consent: true,
          samples: [{ embedding: embedding(id) }, { embedding: embedding(id + 100) }],
        },
      },
      mockRes()
    );
  }
  await faceController.removeFaceData({ params: { memberId: String(removedId) } }, mockRes());

  const res = mockRes();
  await faceController.syncFaceCache({ body: {} }, res);
  assert.equal(res._status, 200);
  const { members, deletedMemberIds } = res._body.data;
  const kept = members.find((m) => m.memberId === keptId);
  assert.ok(kept, 'kept member present in sync payload');
  assert.equal(kept.samples.length, 2);
  assert.equal(kept.samples[0].length, 128, 'embeddings decoded back to arrays');
  assert.ok(deletedMemberIds.includes(removedId), 'tombstoned member reported as deleted');
  assert.ok(!members.some((m) => m.memberId === removedId));
});

test('faceCheckIn: 403 when feature disabled; denial vocabulary when enabled', async () => {
  const memberId = insertMember('Walker');
  await faceController.enrollFace(
    {
      params: { memberId: String(memberId) },
      body: {
        modelVersion: 'sface_v1_fp32',
        consent: true,
        samples: [{ embedding: embedding() }],
      },
    },
    mockRes()
  );

  // Disabled → 403, endpoint fails closed.
  await setSetting('face_checkin_enabled', 'false');
  let res = mockRes();
  await faceController.faceCheckIn(
    { body: { memberId, matchScore: 0.9, livenessPassed: true } },
    res
  );
  assert.equal(res._status, 403);
  assert.equal(res._body.authorized, false);

  await setSetting('face_checkin_enabled', 'true');

  // Below server-side threshold → rejected regardless of client claim.
  res = mockRes();
  await faceController.faceCheckIn(
    { body: { memberId, matchScore: 0.3, livenessPassed: true } },
    res
  );
  assert.equal(res._body.authorized, false);
  assert.equal(res._body.reason, 'below_match_threshold');
  assert.equal(res._body.memberName ?? null, null, 'denials must not confirm identities');

  // Not enrolled → rejected even with a high claimed score.
  const stranger = insertMember('Stranger');
  res = mockRes();
  await faceController.faceCheckIn(
    { body: { memberId: stranger, matchScore: 0.9, livenessPassed: true } },
    res
  );
  assert.equal(res._body.authorized, false);
  assert.equal(res._body.reason, 'not_enrolled');

  // Valid claim → authorized check-in; no door configured → command not sent.
  res = mockRes();
  await faceController.faceCheckIn(
    { body: { memberId, matchScore: 0.9, livenessPassed: true } },
    res
  );
  assert.equal(res._body.authorized, true, JSON.stringify(res._body));
  assert.equal(res._body.action, 'checkin');
  assert.equal(res._body.doorCommandSent, false);
  assert.equal(res._body.memberName, 'Walker');
});

test('faceCheckIn: re-scan within the dwell window is a re-entry (authorized, no new row, minutesUntilCheckout)', async () => {
  await setSetting('face_checkin_enabled', 'true');
  await setSetting('face_liveness_mode', 'none'); // focus on the attendance branch
  await setSetting('face_checkout_min_dwell_minutes', '15');
  const memberId = insertMember('Returner');
  await faceController.enrollFace(
    {
      params: { memberId: String(memberId) },
      body: { modelVersion: 'sface_v1_fp32', consent: true, samples: [{ embedding: embedding() }] },
    },
    mockRes()
  );

  // First scan → check-in (opens the attendance row).
  let res = mockRes();
  await faceController.faceCheckIn({ body: { memberId, matchScore: 0.9 } }, res);
  assert.equal(res._body.action, 'checkin', JSON.stringify(res._body));

  // Immediate second scan → within dwell → re-entry: authorized (so the door
  // unlocks — same authorized→unlock path as check-in), but no checkout and no
  // duplicate row, and the response carries the minutes until checkout unlocks.
  res = mockRes();
  await faceController.faceCheckIn({ body: { memberId, matchScore: 0.9 } }, res);
  assert.equal(res._body.authorized, true, JSON.stringify(res._body));
  assert.equal(res._body.action, 'reentry');
  assert.equal(res._body.reason, 'already_checked_in');
  assert.equal(res._body.memberName, 'Returner', 'name is shown on an authorized re-entry');
  assert.ok(
    res._body.minutesUntilCheckout >= 1 && res._body.minutesUntilCheckout <= 15,
    `expected a sane minutesUntilCheckout, got ${res._body.minutesUntilCheckout}`
  );

  const rows = db.prepare('SELECT * FROM attendance WHERE member_id = ?').all(memberId);
  assert.equal(rows.length, 1, 'no duplicate attendance row on re-entry');
  assert.equal(rows[0].check_out_time, null, 'not checked out');

  await setSetting('face_liveness_mode', 'challenge');
});

// ---------------------------------------------------------------------------
// Safety-critical additions (multi-agent review of PR #18)
// ---------------------------------------------------------------------------

test('faceCheckIn: liveness enforced server-side unless mode is none', async () => {
  await setSetting('face_checkin_enabled', 'true');
  await setSetting('face_liveness_mode', 'challenge');
  const memberId = insertMember('LivenessSubject');
  await faceController.enrollFace(
    {
      params: { memberId: String(memberId) },
      body: { modelVersion: 'sface_v1_fp32', consent: true, samples: [{ embedding: embedding() }] },
    },
    mockRes()
  );

  // Missing / false livenessPassed → denied before authorization runs.
  for (const livenessPassed of [undefined, false]) {
    const res = mockRes();
    await faceController.faceCheckIn({ body: { memberId, matchScore: 0.9, livenessPassed } }, res);
    assert.equal(res._body.authorized, false);
    assert.equal(res._body.reason, 'liveness_not_passed');
  }
  assert.equal(
    db.prepare('SELECT COUNT(*) n FROM attendance WHERE member_id = ?').get(memberId).n,
    0,
    'no attendance recorded for liveness-failed claims'
  );

  // mode none → liveness not required.
  await setSetting('face_liveness_mode', 'none');
  const res = mockRes();
  await faceController.faceCheckIn({ body: { memberId, matchScore: 0.9 } }, res);
  assert.equal(res._body.authorized, true, JSON.stringify(res._body));
  await setSetting('face_liveness_mode', 'challenge');
});

test('faceCheckIn: embeddings from a superseded model version deny with model_version_mismatch', async () => {
  await setSetting('face_checkin_enabled', 'true');
  const memberId = insertMember('StaleModel');
  await faceController.enrollFace(
    {
      params: { memberId: String(memberId) },
      body: { modelVersion: 'sface_v1_fp32', consent: true, samples: [{ embedding: embedding() }] },
    },
    mockRes()
  );
  // Simulate a model upgrade the member hasn't re-enrolled for.
  db.prepare('UPDATE member_face_embeddings SET model_version = ? WHERE member_id = ?').run(
    'sface_v0_old',
    memberId
  );

  const res = mockRes();
  await faceController.faceCheckIn(
    { body: { memberId, matchScore: 0.9, livenessPassed: true } },
    res
  );
  assert.equal(res._body.authorized, false);
  assert.equal(res._body.reason, 'model_version_mismatch');
});

test('faceCheckIn: garbage face_match_threshold falls back to 0.55, not to no floor', async () => {
  await setSetting('face_checkin_enabled', 'true');
  const memberId = insertMember('ThresholdSubject');
  await faceController.enrollFace(
    {
      params: { memberId: String(memberId) },
      body: { modelVersion: 'sface_v1_fp32', consent: true, samples: [{ embedding: embedding() }] },
    },
    mockRes()
  );
  await setSetting('face_match_threshold', 'banana');

  // NaN threshold must not disable the floor: sub-default score stays denied.
  let res = mockRes();
  await faceController.faceCheckIn(
    { body: { memberId, matchScore: 0.5, livenessPassed: true } },
    res
  );
  assert.equal(res._body.authorized, false);
  assert.equal(res._body.reason, 'below_match_threshold');

  // Above the fallback default → passes the floor.
  res = mockRes();
  await faceController.faceCheckIn(
    { body: { memberId, matchScore: 0.6, livenessPassed: true } },
    res
  );
  assert.equal(res._body.authorized, true, JSON.stringify(res._body));
  await setSetting('face_match_threshold', '0.55');
});

test('syncFaceCache: same-day tombstones propagate with an ISO since (datetime normalization)', async () => {
  const memberId = insertMember('SameDayRevoked');
  await faceController.enrollFace(
    {
      params: { memberId: String(memberId) },
      body: { modelVersion: 'sface_v1_fp32', consent: true, samples: [{ embedding: embedding() }] },
    },
    mockRes()
  );
  await faceController.removeFaceData({ params: { memberId: String(memberId) } }, mockRes());

  // Kiosk synced an hour ago (ISO-8601 with T/Z — the format clients send).
  const since = new Date(Date.now() - 3600 * 1000).toISOString();
  const res = mockRes();
  await faceController.syncFaceCache({ body: { since } }, res);
  assert.equal(res._status, 200);
  assert.ok(
    res._body.data.deletedMemberIds.includes(memberId),
    `same-day deletion must appear in the delta (got ${JSON.stringify(res._body.data.deletedMemberIds)})`
  );

  // Garbage since → 400, not a silently-empty delta.
  const bad = mockRes();
  await faceController.syncFaceCache({ body: { since: 'yesterday-ish' } }, bad);
  assert.equal(bad._status, 400);
});

test('syncFaceCache: embeddings from superseded model versions are not shipped to kiosks', async () => {
  const memberId = insertMember('VersionFiltered');
  await faceController.enrollFace(
    {
      params: { memberId: String(memberId) },
      body: { modelVersion: 'sface_v1_fp32', consent: true, samples: [{ embedding: embedding() }] },
    },
    mockRes()
  );
  db.prepare('UPDATE member_face_embeddings SET model_version = ? WHERE member_id = ?').run(
    'sface_v0_old',
    memberId
  );

  const res = mockRes();
  await faceController.syncFaceCache({ body: {} }, res);
  assert.ok(
    !res._body.data.members.some((m) => m.memberId === memberId),
    'stale-version embeddings must not reach the kiosk gallery'
  );
});

test('getFaceStatus: rejects a non-numeric memberId instead of 500ing', async () => {
  const res = mockRes();
  await faceController.getFaceStatus({ params: { memberId: 'abc' } }, res);
  assert.equal(res._status, 400);
});

test('getFaceStatus and getFaceConfig report current state', async () => {
  const memberId = insertMember('Status');
  await faceController.enrollFace(
    {
      params: { memberId: String(memberId) },
      body: {
        modelVersion: 'sface_v1_fp32',
        consent: true,
        samples: [{ embedding: embedding(), pose: 'front' }],
      },
    },
    mockRes()
  );

  let res = mockRes();
  await faceController.getFaceStatus({ params: { memberId: String(memberId) } }, res);
  assert.equal(res._body.data.enrolled, true);
  assert.equal(res._body.data.samples, 1);
  assert.deepEqual(res._body.data.poses, ['front']);

  res = mockRes();
  await faceController.getFaceConfig({}, res);
  assert.equal(typeof res._body.data.enabled, 'boolean');
  assert.equal(res._body.data.matchThreshold, 0.55);
  assert.equal(res._body.data.livenessMode, 'challenge');
});
