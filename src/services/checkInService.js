const { pool } = require('../config/sqlite');
const settingsCache = require('./settingsCache');
const logger = require('../utils/logger').child({ service: 'checkIn' });

/**
 * Shared check-in/checkout engine (face check-in plan Section 3.5).
 *
 * Attendance/session/plan logic previously lived in three near-duplicate
 * places: biometricIntegration.logMemberAttendance(), attendanceController's
 * performCheckIn(), and biometricController.validateBiometricId(). This module
 * is the single implementation; callers pass options that preserve their
 * modality's historical behavior:
 *
 * - Fingerprint (biometricIntegration): enforceAuthorization=false (attendance
 *   is recorded even for plan-expired members — the plan check only gates the
 *   access-granted notification, as before), session windows apply to both
 *   directions, no checkout dwell requirement.
 * - Face (faceBiometricController): enforceAuthorization=true — check-in
 *   requires an active member and valid plan/grace status because the result
 *   directly drives a door unlock. Checkout is deliberately NOT gated by
 *   plan validity or session windows: a member whose plan lapses mid-workout
 *   must still be able to leave (safety, not business logic). Checkout only
 *   requires a minimum dwell time since check-in so a lingering face near the
 *   camera isn't flipped to "checked out" moments after checking in.
 *
 * Reason vocabulary matches what POST /api/biometric/validate already returns
 * so clients share one denial dictionary.
 */

const parseTimeToMinutes = (hhmm) => {
  const [h, m] = String(hhmm || '00:00')
    .split(':')
    .map(Number);
  return h * 60 + (m || 0);
};

function getSessionWindows() {
  return {
    morningStart: parseTimeToMinutes(settingsCache.get('morning_session_start', '05:00')),
    morningEnd: parseTimeToMinutes(settingsCache.get('morning_session_end', '11:00')),
    eveningStart: parseTimeToMinutes(settingsCache.get('evening_session_start', '16:00')),
    eveningEnd: parseTimeToMinutes(settingsCache.get('evening_session_end', '22:00')),
  };
}

function sessionOf(minutesSinceMidnight, windows) {
  if (minutesSinceMidnight >= windows.morningStart && minutesSinceMidnight <= windows.morningEnd) {
    return 'morning';
  }
  if (minutesSinceMidnight >= windows.eveningStart && minutesSinceMidnight <= windows.eveningEnd) {
    return 'evening';
  }
  return null;
}

// Mirrors logMemberAttendance's ESP32 timestamp handling: device timestamps are
// local time and are stored verbatim to avoid timezone conversion; the derived
// date string is taken from the same local instant.
function resolveEventTime(timestamp) {
  if (timestamp) {
    const parsed = new Date(timestamp);
    if (!isNaN(parsed.getTime())) {
      const localDate = new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000);
      return { now: parsed, dateStr: localDate.toISOString().split('T')[0], timeStr: timestamp };
    }
    logger.warn(`⚠️ Failed to parse device timestamp "${timestamp}", using server time instead`);
  }
  const now = new Date();
  return { now, dateStr: now.toISOString().split('T')[0], timeStr: now.toISOString() };
}

async function logEvent(eventContext, member, eventType, timeStr, success, extra = {}) {
  if (!eventContext) return;
  try {
    await pool.query(
      `INSERT INTO biometric_events
         (member_id, biometric_id, event_type, device_id, timestamp, success, error_message, raw_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        member.id,
        eventContext.biometricRef != null ? String(eventContext.biometricRef) : null,
        eventType,
        eventContext.deviceId || 'unknown',
        timeStr,
        success ? 1 : 0,
        extra.error_message || null,
        JSON.stringify({ ...(eventContext.raw || {}), action: eventType, ...extra.details }),
      ]
    );
  } catch (error) {
    logger.error({ err: error }, 'error logging biometric event');
  }
}

async function getTodayAttendance(memberId, dateStr) {
  const result = await pool.query(
    'SELECT * FROM attendance WHERE member_id = ? AND date = ? ORDER BY check_in_time DESC LIMIT 1',
    [memberId, dateStr]
  );
  return result.rows[0] || null;
}

async function updateLastVisit(memberId) {
  try {
    await pool.query('UPDATE members SET last_visit = ? WHERE id = ?', [
      new Date().toISOString(),
      memberId,
    ]);
  } catch (error) {
    logger.error({ err: error }, 'error updating last visit');
  }
}

// Plan/grace check mirroring validateBiometricId: only members whose plan has a
// duration are payment-gated; grace expiry auto-deactivates the member. Members
// without a plan (admins, special cases) are not denied here — same as /validate.
async function checkPlanAuthorization(member) {
  if (!member.membership_plan_id || !member.duration_days) {
    return { ok: true };
  }
  const { checkMemberPaymentStatus } = require('../utils/dateUtils');
  try {
    const gracePeriodDays = settingsCache.getGracePeriodDays();
    const paymentStatus = checkMemberPaymentStatus(
      { join_date: member.join_date, membership_plan_id: member.membership_plan_id },
      { duration_days: member.duration_days },
      member.last_payment_date,
      gracePeriodDays
    );
    if (paymentStatus.gracePeriodExpired) {
      try {
        await pool.query('UPDATE members SET is_active = 0 WHERE id = ?', [member.id]);
        logger.info(`🔄 Automatically deactivated member ${member.id} due to expired grace period`);
        // Keep the ESP32 member cache in sync with the deactivation, same as
        // validateBiometricId does (lazy require avoids a module cycle).
        try {
          const { invalidateESP32Cache } = require('../api/controllers/biometricController');
          if (invalidateESP32Cache) await invalidateESP32Cache();
        } catch (cacheError) {
          logger.error({ err: cacheError }, 'error invalidating ESP32 cache');
        }
      } catch (deactivationError) {
        logger.error({ err: deactivationError }, 'error deactivating member');
      }
      return {
        ok: false,
        reason: 'payment_overdue_grace_expired',
        details: { daysOverdue: paymentStatus.daysOverdue },
      };
    }
    if (paymentStatus.isOverdue) {
      logger.info(
        `⚠️ Member ${member.id} is overdue but within grace period (${paymentStatus.daysOverdue} days overdue)`
      );
    }
  } catch (paymentError) {
    // Same posture as the code this was extracted from: a payment-check error
    // is logged but does not deny access.
    logger.error({ err: paymentError }, 'error checking payment status');
  }
  return { ok: true };
}

/**
 * Process a check-in or checkout scan for a member.
 *
 * @param {number} memberId
 * @param {object} options
 * @param {string} options.modality  'fingerprint' | 'face' | 'manual'
 * @param {string} [options.deviceId]
 * @param {string} [options.timestamp]  Device-local timestamp string (ESP32 format)
 * @param {number} [options.matchScore]  Face match similarity, recorded in events
 * @param {boolean} [options.enforceAuthorization=true]  Gate the CHECK-IN
 *   direction on member.is_active and plan/grace validity. Fingerprint passes
 *   false to preserve its historical "log attendance regardless" behavior.
 * @param {boolean} [options.enforceSessionWindowsOnCheckout=false]  Fingerprint
 *   historically applied session windows before the checkout toggle; face must
 *   not (members must always be able to leave).
 * @param {number} [options.minCheckoutDwellMinutes=0]  Minimum minutes since
 *   check-in before a second scan is treated as checkout instead of a
 *   duplicate check-in attempt.
 * @param {object} [options.eventContext]  When set, outcomes are logged to
 *   biometric_events: { biometricRef, deviceId, raw }.
 *
 * @returns {Promise<{authorized: boolean, action: 'checkin'|'checkout'|null,
 *   reason: string, member: object|null, attendanceId?: number, at: Date}>}
 *   Never throws for business denials; `authorized` gates any door unlock.
 */
async function processCheckIn(memberId, options = {}) {
  const {
    modality = 'manual',
    deviceId,
    timestamp,
    matchScore,
    enforceAuthorization = true,
    enforceSessionWindowsOnCheckout = false,
    minCheckoutDwellMinutes = 0,
  } = options;
  const eventContext = options.eventContext ? { deviceId, ...options.eventContext } : null;

  const { now, dateStr, timeStr } = resolveEventTime(timestamp);
  const deny = (reason, member = null, extra = {}) => ({
    authorized: false,
    action: null,
    reason,
    member,
    at: now,
    ...extra,
  });

  // Single lookup with plan + payment data (mirrors validateBiometricId's query).
  const memberResult = await pool.query(
    `SELECT
       m.id, m.name, m.is_active, m.is_admin, m.membership_plan_id, m.join_date,
       m.photo_url,
       mp.duration_days,
       (SELECT MAX(p.payment_date)
        FROM payments p
        JOIN invoices i ON p.invoice_id = i.id
        WHERE i.member_id = m.id) as last_payment_date
     FROM members m
     LEFT JOIN membership_plans mp ON m.membership_plan_id = mp.id
     WHERE m.id = ?`,
    [memberId]
  );
  const member = memberResult.rows[0];
  if (!member) {
    return deny('member_not_found');
  }

  const isAdmin = member.is_admin === 1;
  const windows = getSessionWindows();
  const currentSession = sessionOf(now.getHours() * 60 + now.getMinutes(), windows);

  const existing = await getTodayAttendance(member.id, dateStr);

  // ---- Checkout direction -------------------------------------------------
  if (existing && !existing.check_out_time) {
    if (enforceSessionWindowsOnCheckout && !isAdmin && !currentSession) {
      await logEvent(eventContext, member, 'session_violation', timeStr, false, {
        error_message: 'Check-in outside session windows',
      });
      return deny('outside_session_windows', member);
    }

    if (minCheckoutDwellMinutes > 0) {
      const checkInTime = new Date(existing.check_in_time);
      const dwellMinutes = (now.getTime() - checkInTime.getTime()) / 60000;
      if (isNaN(dwellMinutes) || dwellMinutes < minCheckoutDwellMinutes) {
        await logEvent(eventContext, member, 'dwell_time_not_met', timeStr, false, {
          error_message: `Checkout requires ${minCheckoutDwellMinutes} min dwell; scan ignored as duplicate check-in`,
          details: { dwellMinutes: Math.round(dwellMinutes * 10) / 10 },
        });
        return deny('dwell_time_not_met', member);
      }
    }

    // Deliberately NOT gated by is_active or plan validity — a member must
    // always be able to leave (plan Section 3.5).
    await pool.query('UPDATE attendance SET check_out_time = ? WHERE id = ?', [
      timeStr,
      existing.id,
    ]);
    await updateLastVisit(member.id);
    await logEvent(eventContext, member, 'checkout', timeStr, true, {
      details: matchScore != null ? { matchScore } : undefined,
    });
    logger.info({ memberId: member.id, memberName: member.name, modality }, 'member checked out');
    return {
      authorized: true,
      action: 'checkout',
      reason: 'checked_out',
      member,
      attendanceId: existing.id,
      at: now,
    };
  }

  // ---- Check-in direction --------------------------------------------------
  // Note: the "already completed today" outcome is decided AFTER the session
  // gates below, preserving the original ordering — a member who completed a
  // morning session and scans in the evening gets cross_session_violation,
  // not already_completed.
  if (enforceAuthorization && member.is_active !== 1) {
    await logEvent(eventContext, member, 'member_inactive', timeStr, false, {
      error_message: 'Member is deactivated',
    });
    return deny('member_inactive', member);
  }

  if (!isAdmin) {
    if (!currentSession) {
      await logEvent(eventContext, member, 'session_violation', timeStr, false, {
        error_message: 'Check-in outside session windows',
      });
      logger.info(
        { memberId: member.id, memberName: member.name, currentTime: now.toLocaleTimeString() },
        'check-in outside session windows'
      );
      return deny('outside_session_windows', member);
    }

    if (settingsCache.getBoolean('cross_session_checkin_restriction', true)) {
      const todayCheckIns = await pool.query(
        `SELECT check_in_time FROM attendance
         WHERE member_id = ? AND DATE(check_in_time) = DATE(?)
         ORDER BY check_in_time DESC LIMIT 1`,
        [member.id, dateStr]
      );
      if (todayCheckIns.rows.length > 0) {
        const existingTime = new Date(todayCheckIns.rows[0].check_in_time);
        const existingSession = sessionOf(
          existingTime.getHours() * 60 + existingTime.getMinutes(),
          windows
        );
        if (existingSession && existingSession !== currentSession) {
          await logEvent(eventContext, member, 'cross_session_violation', timeStr, false, {
            error_message: `Cross-session check-in blocked: ${existingSession} → ${currentSession}`,
            details: { existing_session: existingSession, current_session: currentSession },
          });
          logger.info(
            { memberId: member.id, memberName: member.name, existingSession, currentSession },
            'cross-session check-in blocked'
          );
          return deny('cross_session_violation', member, {
            details: `Already checked in during ${existingSession} session`,
          });
        }
      }
    }
  }

  // ---- Already completed today (same session) -------------------------------
  if (existing) {
    await logEvent(eventContext, member, 'already_completed', timeStr, true);
    logger.info(
      { memberId: member.id, memberName: member.name, modality },
      'member already completed session today'
    );
    return deny('already_completed', member);
  }

  if (enforceAuthorization) {
    const planCheck = await checkPlanAuthorization(member);
    if (!planCheck.ok) {
      await logEvent(eventContext, member, 'plan_violation', timeStr, false, {
        error_message: planCheck.reason,
        details: planCheck.details,
      });
      return deny(planCheck.reason, member);
    }
  }

  const inserted = await pool.query(
    'INSERT INTO attendance (member_id, check_in_time, date) VALUES (?, ?, ?)',
    [member.id, timeStr, dateStr]
  );
  await updateLastVisit(member.id);
  await logEvent(eventContext, member, 'checkin', timeStr, true, {
    details: matchScore != null ? { matchScore } : undefined,
  });
  logger.info({ memberId: member.id, memberName: member.name, modality }, 'member checked in');
  return {
    authorized: true,
    action: 'checkin',
    reason: 'checked_in',
    member,
    attendanceId: inserted.lastInsertId,
    at: now,
  };
}

module.exports = { processCheckIn };
