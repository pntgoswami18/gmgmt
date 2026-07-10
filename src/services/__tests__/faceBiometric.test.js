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
  await faceController.faceCheckIn({ body: { memberId, matchScore: 0.9 } }, res);
  assert.equal(res._status, 403);
  assert.equal(res._body.authorized, false);

  await setSetting('face_checkin_enabled', 'true');

  // Below server-side threshold → rejected regardless of client claim.
  res = mockRes();
  await faceController.faceCheckIn({ body: { memberId, matchScore: 0.3 } }, res);
  assert.equal(res._body.authorized, false);
  assert.equal(res._body.reason, 'below_match_threshold');

  // Not enrolled → rejected even with a high claimed score.
  const stranger = insertMember('Stranger');
  res = mockRes();
  await faceController.faceCheckIn({ body: { memberId: stranger, matchScore: 0.9 } }, res);
  assert.equal(res._body.authorized, false);
  assert.equal(res._body.reason, 'not_enrolled');

  // Valid claim → authorized check-in; no door configured → command not sent.
  res = mockRes();
  await faceController.faceCheckIn({ body: { memberId, matchScore: 0.9 } }, res);
  assert.equal(res._body.authorized, true, JSON.stringify(res._body));
  assert.equal(res._body.action, 'checkin');
  assert.equal(res._body.doorCommandSent, false);
  assert.equal(res._body.memberName, 'Walker');
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
