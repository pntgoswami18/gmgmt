const fs = require('fs');
const path = require('path');
const { pool, runInTransaction } = require('../../config/sqlite');
const settingsCache = require('../../services/settingsCache');
const checkInService = require('../../services/checkInService');
const logger = require('../../utils/logger').child({ service: 'faceBiometric' });

// Wired from app.js when ENABLE_BIOMETRIC=true, same pattern as
// biometricController.setBiometricIntegration. Face check-in works without it
// (attendance still recorded); only the physical door unlock needs it.
let biometricIntegration = null;
const setBiometricIntegration = (integration) => {
  biometricIntegration = integration;
};

const EMBEDDING_DIM = 128;
const MAX_SAMPLES = 5;
const POSE_LABELS = new Set(['front', 'left', 'right']);
const MAX_DEVICE_ID_LENGTH = 128;
const TOMBSTONE_RETENTION_DAYS = 90;

// Tell connected check-in stations (browser WebSocket clients on /ws) that a
// member's gallery entry changed so they re-sync immediately instead of
// waiting for their periodic delta sync (plan 3.3).
function notifyFaceCacheInvalidated(memberId) {
  try {
    if (biometricIntegration && typeof biometricIntegration.sendToWebSocketClients === 'function') {
      biometricIntegration.sendToWebSocketClients({
        type: 'face_cache_invalidated',
        memberId,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    logger.error({ err: error }, 'error broadcasting face cache invalidation');
  }
}

// Accepts a sample embedding as a JSON array of finite numbers and returns the
// BLOB to store, or null if invalid. Stored as Float32Array bytes (plan 2.2).
function embeddingToBlob(embedding) {
  if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIM) return null;
  if (!embedding.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  return Buffer.from(new Float32Array(embedding).buffer);
}

function blobToEmbedding(blob) {
  const buf = Buffer.isBuffer(blob) ? blob : Buffer.from(blob);
  return Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
}

async function logFaceEvent(memberId, eventType, deviceId, success, details = {}) {
  try {
    await pool.query(
      `INSERT INTO biometric_events
         (member_id, biometric_id, event_type, device_id, timestamp, success, raw_data)
       VALUES (?, 'face', ?, ?, ?, ?, ?)`,
      [
        memberId,
        eventType,
        deviceId || 'admin_ui',
        new Date().toISOString(),
        success ? 1 : 0,
        JSON.stringify({ modality: 'face', ...details }),
      ]
    );
  } catch (error) {
    logger.error({ err: error }, 'error logging face event');
  }
}

// POST /api/biometric/members/:memberId/face-enroll
// Body: { modelVersion, consent: true, samples: [{ embedding, pose, quality }] }
// Replaces any prior enrollment for the member in one transaction (plan 2.3).
const enrollFace = async (req, res) => {
  try {
    const memberId = parseInt(req.params.memberId, 10);
    const { modelVersion, consent, samples } = req.body || {};

    if (!Number.isInteger(memberId) || memberId <= 0) {
      return res.status(400).json({ success: false, message: 'Valid memberId is required' });
    }
    if (consent !== true) {
      return res
        .status(400)
        .json({ success: false, message: 'Enrollment requires recorded consent' });
    }
    if (!modelVersion || typeof modelVersion !== 'string') {
      return res.status(400).json({ success: false, message: 'modelVersion is required' });
    }
    const expectedVersion = settingsCache.get('face_model_version', '');
    if (expectedVersion && modelVersion !== expectedVersion) {
      return res.status(409).json({
        success: false,
        message: `modelVersion mismatch: expected ${expectedVersion}`,
      });
    }
    if (!Array.isArray(samples) || samples.length === 0 || samples.length > MAX_SAMPLES) {
      return res
        .status(400)
        .json({ success: false, message: `samples must contain 1-${MAX_SAMPLES} entries` });
    }
    const blobs = [];
    for (const sample of samples) {
      const blob = embeddingToBlob(sample?.embedding);
      if (!blob) {
        return res.status(400).json({
          success: false,
          message: `each sample.embedding must be an array of ${EMBEDDING_DIM} finite numbers`,
        });
      }
      blobs.push({
        blob,
        pose: POSE_LABELS.has(sample.pose) ? sample.pose : null,
        quality: typeof sample.quality === 'number' ? sample.quality : null,
      });
    }

    const member = await pool.query('SELECT id, name, is_active FROM members WHERE id = ?', [
      memberId,
    ]);
    if (member.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Member not found' });
    }

    const consentAt = new Date().toISOString();
    let pinnedNow = false;
    try {
      await runInTransaction(async () => {
        // First-run convenience: pin the deployment's model version on first
        // enrollment. Read the settings TABLE (not the cache) inside the
        // transaction so two concurrent first enrollments with different
        // versions can't both pin — the second sees the first's pin and, on
        // mismatch, the whole enrollment rolls back.
        const pinnedRow = await pool.query(
          "SELECT value FROM settings WHERE key = 'face_model_version'"
        );
        const pinned = pinnedRow.rows[0]?.value || '';
        if (!pinned) {
          await pool.query(
            "INSERT INTO settings(key, value) VALUES('face_model_version', ?) " +
              'ON CONFLICT(key) DO UPDATE SET value = excluded.value',
            [modelVersion]
          );
          pinnedNow = true;
        } else if (pinned !== modelVersion) {
          const err = new Error(`modelVersion mismatch: expected ${pinned}`);
          err.code = 'MODEL_VERSION_MISMATCH';
          throw err;
        }
        await pool.query('DELETE FROM member_face_embeddings WHERE member_id = ?', [memberId]);
        for (const { blob, pose, quality } of blobs) {
          await pool.query(
            `INSERT INTO member_face_embeddings
               (member_id, embedding, model_version, quality_score, pose_label, consent_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [memberId, blob, modelVersion, quality, pose, consentAt]
          );
        }
        // Re-enrollment supersedes any pending deletion tombstone.
        await pool.query('DELETE FROM face_sync_tombstones WHERE member_id = ?', [memberId]);
      });
    } catch (txError) {
      if (txError.code === 'MODEL_VERSION_MISMATCH') {
        return res.status(409).json({ success: false, message: txError.message });
      }
      throw txError;
    }
    if (pinnedNow) {
      await settingsCache.refresh();
    }

    await logFaceEvent(memberId, 'face_enrollment', null, true, {
      samples: blobs.length,
      modelVersion,
    });
    notifyFaceCacheInvalidated(memberId);
    logger.info(`✅ Face enrollment stored for member ${memberId} (${blobs.length} samples)`);
    res.json({
      success: true,
      message: `Face enrollment completed for ${member.rows[0].name}`,
      data: { memberId, samples: blobs.length, modelVersion },
    });
  } catch (error) {
    logger.error({ err: error }, 'error enrolling face');
    res.status(500).json({ success: false, message: 'Failed to store face enrollment' });
  }
};

// DELETE /api/biometric/members/:memberId/face — mirrors removeBiometricData.
const removeFaceData = async (req, res) => {
  try {
    const memberId = parseInt(req.params.memberId, 10);
    if (!Number.isInteger(memberId) || memberId <= 0) {
      return res.status(400).json({ success: false, message: 'Valid memberId is required' });
    }
    const result = await runInTransaction(async () => {
      const deleted = await pool.query('DELETE FROM member_face_embeddings WHERE member_id = ?', [
        memberId,
      ]);
      if (deleted.rowCount > 0) {
        await pool.query(
          "INSERT INTO face_sync_tombstones(member_id, deleted_at) VALUES(?, datetime('now')) " +
            'ON CONFLICT(member_id) DO UPDATE SET deleted_at = excluded.deleted_at',
          [memberId]
        );
      }
      return deleted.rowCount;
    });

    if (result === 0) {
      return res
        .status(404)
        .json({ success: false, message: 'No face enrollment found for this member' });
    }
    await logFaceEvent(memberId, 'face_removal', null, true, { removedSamples: result });
    notifyFaceCacheInvalidated(memberId);
    res.json({ success: true, message: 'Face data removed', data: { memberId } });
  } catch (error) {
    logger.error({ err: error }, 'error removing face data');
    res.status(500).json({ success: false, message: 'Failed to remove face data' });
  }
};

// GET /api/biometric/members/:memberId/face-status — mirrors getMemberBiometricStatus.
const getFaceStatus = async (req, res) => {
  try {
    const memberId = parseInt(req.params.memberId, 10);
    if (!Number.isInteger(memberId) || memberId <= 0) {
      return res.status(400).json({ success: false, message: 'Valid memberId is required' });
    }
    const rows = await pool.query(
      `SELECT model_version, pose_label, quality_score, consent_at, created_at
       FROM member_face_embeddings WHERE member_id = ? ORDER BY id`,
      [memberId]
    );
    res.json({
      success: true,
      data: {
        memberId,
        enrolled: rows.rows.length > 0,
        samples: rows.rows.length,
        modelVersion: rows.rows[0]?.model_version || null,
        consentAt: rows.rows[0]?.consent_at || null,
        enrolledAt: rows.rows[0]?.created_at || null,
        poses: rows.rows.map((r) => r.pose_label).filter(Boolean),
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'error getting face status');
    res.status(500).json({ success: false, message: 'Failed to get face status' });
  }
};

// POST /api/biometric/face/sync — gallery sync for the check-in station
// (plan 3.3). Body: { since } (ISO timestamp, optional). Returns ALL enrolled
// members' embeddings (including deactivated ones, with isActive flagged so
// the client can grey them out — the server-side check-in re-validates
// is_active regardless) plus deletedMemberIds so the client can prune its
// IndexedDB cache. Embeddings are filtered to the deployment's pinned
// face_model_version: cross-version cosine comparisons are meaningless, so a
// kiosk must never receive vectors from a superseded model (plan 2.2).
const syncFaceCache = async (req, res) => {
  try {
    const { since } = req.body || {};
    if (since && (typeof since !== 'string' || isNaN(Date.parse(since)))) {
      return res
        .status(400)
        .json({ success: false, message: 'since must be an ISO-8601 timestamp' });
    }
    const params = [];
    let whereDelta = '';
    if (since) {
      // datetime(?) normalizes the client's ISO-8601 value ("…T12:00:00Z") to
      // SQLite's storage format ("… 12:00:00") before comparing. Raw string
      // comparison silently fails for same-day values because ' ' < 'T'.
      whereDelta = 'AND f.updated_at > datetime(?)';
      params.push(since);
    }
    let whereVersion = '';
    const pinnedVersion = settingsCache.get('face_model_version', '');
    if (pinnedVersion) {
      whereVersion = 'AND f.model_version = ?';
      params.push(pinnedVersion);
    }

    // Housekeeping: tombstones only need to outlive the longest plausible gap
    // between kiosk syncs; prune the ancient ones so the table stays bounded.
    await pool.query(
      `DELETE FROM face_sync_tombstones WHERE deleted_at < datetime('now', '-${TOMBSTONE_RETENTION_DAYS} days')`
    );

    const rows = await pool.query(
      `SELECT f.member_id, f.embedding, f.model_version, f.pose_label, f.quality_score,
              f.updated_at, m.name, m.photo_url, m.is_active
       FROM member_face_embeddings f
       JOIN members m ON m.id = f.member_id
       WHERE 1=1 ${whereDelta} ${whereVersion}
       ORDER BY f.member_id, f.id`,
      params
    );

    const byMember = new Map();
    for (const row of rows.rows) {
      if (!byMember.has(row.member_id)) {
        byMember.set(row.member_id, {
          memberId: row.member_id,
          name: row.name,
          photoUrl: row.photo_url,
          isActive: row.is_active === 1,
          modelVersion: row.model_version,
          updatedAt: row.updated_at,
          samples: [],
        });
      }
      const entry = byMember.get(row.member_id);
      entry.samples.push(blobToEmbedding(row.embedding));
      if (row.updated_at > entry.updatedAt) entry.updatedAt = row.updated_at;
    }

    const tombstones = await pool.query(
      since
        ? 'SELECT member_id FROM face_sync_tombstones WHERE deleted_at > datetime(?)'
        : 'SELECT member_id FROM face_sync_tombstones',
      since ? [since] : []
    );

    res.json({
      success: true,
      data: {
        members: Array.from(byMember.values()),
        deletedMemberIds: tombstones.rows.map((r) => r.member_id),
        syncedAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'error syncing face cache');
    res.status(500).json({ success: false, message: 'Failed to sync face cache' });
  }
};

// POST /api/biometric/face/check-in — the authorization step for a local match
// claim (plan 3.4/3.5). The client never decides: this re-validates everything,
// and ONLY an authorized result may trigger the door unlock. Denials never send
// an unlock command (fail closed).
const faceCheckIn = async (req, res) => {
  try {
    if (!settingsCache.getBoolean('face_checkin_enabled', false)) {
      return res.status(403).json({ authorized: false, reason: 'face_checkin_disabled' });
    }

    const { memberId, matchScore, livenessPassed } = req.body || {};
    // Free-form client string persisted into biometric_events — bound it.
    const deviceId =
      typeof req.body?.deviceId === 'string'
        ? req.body.deviceId.slice(0, MAX_DEVICE_ID_LENGTH)
        : undefined;
    const numericId = parseInt(memberId, 10);
    if (!Number.isInteger(numericId) || numericId <= 0) {
      return res.status(400).json({ authorized: false, reason: 'invalid_member_id' });
    }

    // Liveness is a v1 gate on the unlock (plan 3.4): unless the deployment
    // explicitly disables it, a claim that skipped or failed the challenge
    // never reaches the authorization step — a buggy kiosk build must not be
    // able to open the door with a photo.
    const livenessMode = settingsCache.get('face_liveness_mode', 'challenge');
    if (livenessMode !== 'none' && livenessPassed !== true) {
      await logFaceEvent(numericId, 'face_match_rejected', deviceId, false, {
        reason: 'liveness_not_passed',
        livenessMode,
      });
      return res.json({ authorized: false, reason: 'liveness_not_passed' });
    }

    // Server-side floor on the claimed match score — a compromised client can
    // lie, but an honest one is stopped from submitting sub-threshold claims.
    // A blanked/garbage setting must fail toward the conservative default, not
    // silently disable the floor (NaN comparisons are always false).
    let threshold = parseFloat(settingsCache.get('face_match_threshold', '0.55'));
    if (!Number.isFinite(threshold)) {
      logger.error(
        `face_match_threshold setting is not a number ("${settingsCache.get('face_match_threshold', '')}") — falling back to 0.55`
      );
      threshold = 0.55;
    }
    if (typeof matchScore !== 'number' || matchScore < threshold) {
      await logFaceEvent(numericId, 'face_match_rejected', deviceId, false, {
        matchScore,
        threshold,
      });
      return res.json({ authorized: false, reason: 'below_match_threshold' });
    }

    // Members can only face-check-in if they are actually enrolled — rejects
    // fabricated memberIds from a client that has no gallery entry for them.
    // Enrollment must be under the CURRENT pinned model version: after a model
    // upgrade, old-version embeddings can't have produced this match honestly
    // (cross-version cosine scores are meaningless — plan 2.2), so stale
    // enrollments deny until the member re-enrolls.
    const pinnedVersion = settingsCache.get('face_model_version', '');
    const enrolled = await pool.query(
      `SELECT COUNT(*) as n,
              SUM(CASE WHEN model_version = ? THEN 1 ELSE 0 END) as current_n
       FROM member_face_embeddings WHERE member_id = ?`,
      [pinnedVersion, numericId]
    );
    const totalEnrolled = enrolled.rows[0]?.n || 0;
    const currentEnrolled = enrolled.rows[0]?.current_n || 0;
    if (totalEnrolled === 0) {
      await logFaceEvent(numericId, 'face_match_rejected', deviceId, false, {
        reason: 'not_enrolled',
      });
      return res.json({ authorized: false, reason: 'not_enrolled' });
    }
    if (pinnedVersion && currentEnrolled === 0) {
      await logFaceEvent(numericId, 'face_match_rejected', deviceId, false, {
        reason: 'model_version_mismatch',
        pinnedVersion,
      });
      return res.json({ authorized: false, reason: 'model_version_mismatch' });
    }

    const result = await checkInService.processCheckIn(numericId, {
      modality: 'face',
      deviceId,
      matchScore,
      enforceAuthorization: true,
      enforceSessionWindowsOnCheckout: false,
      minCheckoutDwellMinutes: settingsCache.getInt('face_checkout_min_dwell_minutes', 15),
      // A member who checked in before midnight must be able to leave after it.
      allowCrossDateCheckout: true,
      eventContext: {
        biometricRef: 'face',
        raw: { modality: 'face', matchScore, livenessPassed: livenessPassed === true },
      },
    });

    // Door unlock: strictly a consequence of authorization succeeding
    // (plan 3.5). Response only ever confirms the command was SENT — the
    // physical unlock confirmation arrives via the ESP32 webhook, same
    // discipline as the fingerprint path (plan 3.4). Full wiring is hardened
    // in Phase 5; the seam is kept fail-closed here.
    let doorCommandSent = false;
    if (result.authorized) {
      const doorDeviceId = settingsCache.get('face_door_device_id', '');
      if (doorDeviceId && biometricIntegration) {
        try {
          await biometricIntegration.unlockDoorRemotely(doorDeviceId, 'face_checkin');
          doorCommandSent = true;
          logger.info(
            { memberId: numericId, doorDeviceId, action: result.action },
            'door_command_sent'
          );
        } catch (unlockError) {
          logger.error({ err: unlockError }, 'face check-in door unlock command failed');
        }
      }
    }

    res.json({
      authorized: result.authorized,
      action: result.action,
      reason: result.reason,
      memberId: result.member?.id ?? numericId,
      // Name only on success: denial responses must not confirm identities to
      // a device-secret holder probing arbitrary memberIds.
      memberName: result.authorized ? result.member?.name || null : null,
      // Present on a re-entry (already checked in, scanned again before the
      // checkout dwell) so the kiosk can tell the member when checkout unlocks.
      minutesUntilCheckout: result.minutesUntilCheckout,
      doorCommandSent,
    });
  } catch (error) {
    logger.error({ err: error }, 'error processing face check-in');
    res.status(500).json({ authorized: false, reason: 'internal_error' });
  }
};

// GET /api/biometric/face/model-manifest — served to the check-in/enrollment
// clients so they load the exact model files this deployment pinned (plan 1.4).
// The manifest file is deployed alongside the model binaries in public/models.
const getModelManifest = async (req, res) => {
  try {
    const manifestPath = path.join(__dirname, '../../../public/models/manifest.json');
    if (!fs.existsSync(manifestPath)) {
      return res.status(404).json({
        success: false,
        message: 'No model manifest deployed — copy the Phase 1 artifacts into public/models',
      });
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    res.json({ success: true, data: manifest });
  } catch (error) {
    logger.error({ err: error }, 'error reading model manifest');
    res.status(500).json({ success: false, message: 'Failed to read model manifest' });
  }
};

// GET /api/biometric/face/config — check-in station bootstrap config.
const getFaceConfig = async (req, res) => {
  try {
    res.json({
      success: true,
      data: {
        enabled: settingsCache.getBoolean('face_checkin_enabled', false),
        matchThreshold: parseFloat(settingsCache.get('face_match_threshold', '0.55')),
        livenessMode: settingsCache.get('face_liveness_mode', 'challenge'),
        modelVersion: settingsCache.get('face_model_version', ''),
        checkoutMinDwellMinutes: settingsCache.getInt('face_checkout_min_dwell_minutes', 15),
        doorDeviceConfigured: settingsCache.get('face_door_device_id', '') !== '',
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'error getting face config');
    res.status(500).json({ success: false, message: 'Failed to get face config' });
  }
};

module.exports = {
  setBiometricIntegration,
  notifyFaceCacheInvalidated,
  enrollFace,
  removeFaceData,
  getFaceStatus,
  syncFaceCache,
  faceCheckIn,
  getModelManifest,
  getFaceConfig,
};
