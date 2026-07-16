const BiometricListener = require('./biometricListener');
const checkInService = require('./checkInService');
const { pool } = require('../config/sqlite');
const whatsappService = require('./whatsappService');
const settingsCache = require('./settingsCache');
const logger = require('../utils/logger').child({ service: 'biometricIntegration' });

class BiometricIntegration {
  constructor(port = 8080) {
    this.listener = new BiometricListener(port);
    this.webSocketClients = new Set(); // Store WebSocket clients
    this.setupEventHandlers();
  }

  setupEventHandlers() {
    // Handle successful access
    this.listener.on('accessGranted', async (biometricData) => {
      logger.debug({ userId: biometricData?.userId }, 'accessGranted event received');
      await this.handleAccessGranted(biometricData);
    });

    // Handle denied access
    this.listener.on('accessDenied', (biometricData) => {
      logger.debug({ userId: biometricData?.userId }, 'accessDenied event received');
      this.handleAccessDenied(biometricData);
    });

    // Handle enrollment data
    this.listener.on('enrollmentData', async (biometricData) => {
      logger.debug({ userId: biometricData?.userId }, 'enrollmentData event received');
      await this.handleEnrollmentData(biometricData);
    });

    // Handle unknown messages
    this.listener.on('unknownMessage', (biometricData) => {
      logger.warn({ messageType: biometricData?.type }, 'unknown biometric message');
    });

    // Handle connection events
    this.listener.on('deviceConnected', (socket) => {
      logger.info({ remoteAddress: socket.remoteAddress }, 'biometric device connected');
    });

    this.listener.on('deviceDisconnected', () => {
      logger.info('Biometric device disconnected');
    });

    // Handle errors
    this.listener.on('error', (error) => {
      logger.error({ err: error }, 'biometric listener error');
    });
  }

  async handleAccessGranted(biometricData) {
    try {
      const { userId, memberId, timestamp } = biometricData;

      logger.debug({ userId, memberId }, 'access granted — biometric data received');

      // Find member using device user ID
      const member = await this.findMemberByBiometricId(userId);

      if (member) {
        logger.info(`👤 Member identified using device user ID: ${userId}`);

        // Log attendance
        await this.logMemberAttendance(member, timestamp, biometricData);

        // Check if member has active plan
        if (await this.hasActivePlan(member)) {
          logger.info(`✅ Access granted: ${member.name} (ID: ${member.id}) via device user ID`);

          // You can add additional actions here:
          // - Send welcome message to display
          // - Log entry in access log
          // - Trigger door unlock signal

          // last_visit is already updated by checkInService inside
          // logMemberAttendance above — no second write here.
          this.notifyAccessGranted(member, biometricData);
        } else {
          logger.info(`❌ Member ${member.name} has no active plan`);
          this.notifyPlanExpired(member, biometricData);
        }
      } else {
        logger.info(`❌ Unknown biometric - User ID: ${userId}`);
        this.notifyUnknownUser(biometricData);
      }
    } catch (error) {
      logger.error({ err: error }, 'error handling access granted');
    }
  }

  handleAccessDenied(biometricData) {
    logger.info({ userId: biometricData?.userId }, 'biometric authentication failed');

    // Log failed attempt
    this.logFailedAttempt(biometricData);

    // You can add security measures here:
    // - Take photo if camera is available
    // - Send alert to admin
    // - Log security event
  }

  async findMemberByBiometricId(biometricId) {
    try {
      // Normalize to a clean integer string so "5", "5.0", 5 all match the same DB row
      const lookupId = String(parseInt(biometricId, 10));
      const query = 'SELECT * FROM members WHERE biometric_id = ?';
      const result = await pool.query(query, [lookupId]);
      return result.rows[0] || null;
    } catch (error) {
      logger.error({ err: error }, 'error finding member by biometric ID');
      return null;
    }
  }

  // Delegates to the shared checkInService (face check-in plan Section 3.5).
  // Options preserve the fingerprint path's historical behavior: attendance is
  // recorded regardless of plan validity (the plan check in handleAccessGranted
  // only gates the access-granted notification) and session windows apply to
  // both directions. Parity with the face path (added later): a re-scan within
  // the checkout dwell window is treated as a RE-ENTRY (the member stepped out
  // and came back), not a checkout — so it doesn't flip the open row to
  // checked-out or create a duplicate. The dwell is configurable via
  // `fingerprint_checkout_min_dwell_minutes`; setting it to 0 restores the old
  // "any second scan is an immediate checkout" behavior.
  async logMemberAttendance(member, timestamp, biometricData = null) {
    try {
      const result = await checkInService.processCheckIn(member.id, {
        modality: 'fingerprint',
        deviceId: biometricData?.deviceId,
        timestamp,
        enforceAuthorization: false,
        enforceSessionWindowsOnCheckout: true,
        minCheckoutDwellMinutes: settingsCache.getInt('fingerprint_checkout_min_dwell_minutes', 15),
        eventContext: biometricData
          ? { biometricRef: biometricData.userId, raw: biometricData }
          : null,
      });

      switch (result.reason) {
        case 'checked_in':
          this.notifyCheckIn(member, result.at);
          break;
        case 'checked_out':
          this.notifyCheckOut(member, result.at);
          break;
        case 'already_checked_in':
          // Re-entry within the dwell window: already checked in, walked back
          // in. Attendance is unchanged (no duplicate row, no checkout).
          this.notifyReentry(member, result.at);
          break;
        case 'already_completed':
          this.notifyAlreadyCompleted(member);
          break;
        default:
          // Denials (session/cross-session violations) are logged to
          // biometric_events by the service; no broadcast, same as before.
          break;
      }
      return result;
    } catch (error) {
      logger.error({ err: error }, 'error logging attendance');
    }
  }

  async hasActivePlan(member) {
    try {
      // Import payment validation utilities
      const { checkMemberPaymentStatus, getGracePeriodSetting } = require('../utils/dateUtils');

      // Check if member has an active plan
      const query = `
        SELECT 
          mp.*,
          (SELECT MAX(p.payment_date) 
           FROM payments p 
           JOIN invoices i ON p.invoice_id = i.id 
           WHERE i.member_id = ?) as last_payment_date
        FROM membership_plans mp
        WHERE mp.id = ?
      `;

      const result = await pool.query(query, [member.id, member.membership_plan_id]);
      const plan = result.rows[0];

      if (!plan) {
        logger.info(`❌ No plan found for member ${member.id}`);
        return false;
      }

      // Check payment status if plan has duration
      if (plan.duration_days) {
        try {
          const gracePeriodDays = getGracePeriodSetting();
          const paymentStatus = checkMemberPaymentStatus(
            member,
            plan,
            plan.last_payment_date,
            gracePeriodDays
          );

          // If grace period has expired, member should be deactivated
          if (paymentStatus.gracePeriodExpired) {
            logger.info(
              `❌ Member ${member.id} payment grace period expired (${paymentStatus.daysOverdue} days overdue)`
            );

            // Automatically deactivate the member
            try {
              await pool.query('UPDATE members SET is_active = 0 WHERE id = ?', [member.id]);
              logger.info(
                `🔄 Automatically deactivated member ${member.id} due to expired grace period`
              );
            } catch (deactivationError) {
              logger.error({ err: deactivationError }, 'error deactivating member');
            }

            return false;
          }

          // If overdue but within grace period, allow access but log warning
          if (paymentStatus.isOverdue) {
            logger.info(
              `⚠️ Member ${member.id} is overdue but within grace period (${paymentStatus.daysOverdue} days overdue)`
            );
          }
        } catch (paymentError) {
          logger.error({ err: paymentError }, 'error checking payment status');
          // Continue with plan check if payment validation fails
        }
      }

      return true; // Plan exists and payment status is valid
    } catch (error) {
      logger.error({ err: error }, 'error checking active plan');
      return false;
    }
  }

  async updateLastVisit(member) {
    try {
      const query = 'UPDATE members SET last_visit = ? WHERE id = ?';
      await pool.query(query, [new Date().toISOString(), member.id]);
      return;
    } catch (error) {
      logger.error({ err: error }, 'error updating last visit');
    }
  }

  notifyCheckIn(member, timestamp) {
    const timeStr = timestamp.toLocaleTimeString();
    const message = `WELCOME:${member.name}:IN:${timeStr}`;
    this.listener.broadcast(message);
    logger.info(`🔓 ${member.name} checked IN at ${timeStr}`);
  }

  notifyCheckOut(member, timestamp) {
    const timeStr = timestamp.toLocaleTimeString();
    const message = `GOODBYE:${member.name}:OUT:${timeStr}`;
    this.listener.broadcast(message);
    logger.info(`🔒 ${member.name} checked OUT at ${timeStr}`);
  }

  notifyReentry(member, timestamp) {
    const timeStr = timestamp.toLocaleTimeString();
    const message = `WELCOME_BACK:${member.name}:IN:${timeStr}`;
    this.listener.broadcast(message);
    logger.info(`🔓 ${member.name} re-entered at ${timeStr} (already checked in)`);
  }

  notifyAlreadyCompleted(member) {
    const message = `COMPLETED:${member.name}`;
    this.listener.broadcast(message);
    logger.info(`ℹ️ ${member.name} already completed today's session`);
  }

  notifyAccessGranted(member, biometricData) {
    // Send success signal back to device or display
    const message = `WELCOME:${member.name}`;
    this.listener.broadcast(message);

    // ESP32 specific responses
    if (biometricData.isESP32Device) {
      this.sendESP32Command(biometricData.deviceId, 'access_granted', {
        memberName: member.name,
        memberId: member.id,
      }).catch((error) => {
        // Fire-and-forget command: swallow rejection to avoid process-level
        // unhandled promise rejection crashes on transient network failures.
        logger.warn(
          `⚠️ Failed to send access_granted command to device ${biometricData.deviceId}:`,
          error.message
        );
      });
    }

    // You could also emit events for your frontend to show notifications
    logger.info(`✅ Access granted: ${member.name}`);
  }

  notifyPlanExpired(member, biometricData) {
    const message = `PLAN_EXPIRED:${member.name}`;
    this.listener.broadcast(message);
    logger.info(`❌ Plan expired: ${member.name}`);
  }

  notifyUnknownUser(biometricData) {
    const message = 'UNKNOWN_USER';
    this.listener.broadcast(message);
    logger.info({ userId: biometricData.userId }, 'unknown biometric user');
  }

  logFailedAttempt(biometricData) {
    // Log failed biometric attempts for security
    logger.info({ userId: biometricData?.userId }, 'failed biometric attempt');

    // You could store this in a security log table
    const securityLog = {
      event_type: 'biometric_failure',
      timestamp: new Date().toISOString(),
      details: JSON.stringify(biometricData),
    };

    // Save to security_logs table if you have one
  }

  start() {
    logger.info('Starting biometric integration...');
    this.listener.start();
  }

  stop() {
    logger.info('Stopping biometric integration...');
    this.listener.stop();
  }

  // Enrollment functionality
  startEnrollmentMode(memberId, memberName, deviceId = null) {
    logger.info(`🎯 Starting enrollment mode for ${memberName} (ID: ${memberId})`);
    this.enrollmentMode = {
      active: true,
      memberId,
      memberName,
      deviceId,
      startTime: new Date(),
      attempts: 0,
      maxAttempts: 3,
    };

    // Send enrollment command to device
    const enrollCommand = `ENROLL:${memberId}:${memberName}`;
    this.listener.broadcast(enrollCommand);

    // Notify WebSocket clients that enrollment has started
    this.sendToWebSocketClients({
      type: 'enrollment_started',
      status: 'active',
      memberId: memberId,
      memberName: memberName,
      maxAttempts: 3,
      message: 'Enrollment started - please scan your fingerprint',
    });

    // Set timeout for enrollment mode
    this.enrollmentTimeout = setTimeout(() => {
      this.stopEnrollmentMode('timeout');
    }, 60000); // 1 minute timeout

    return this.enrollmentMode;
  }

  stopEnrollmentMode(reason = 'manual') {
    if (this.enrollmentMode && this.enrollmentMode.active) {
      logger.info(`🛑 Stopping enrollment mode: ${reason}`);
      this.enrollmentMode.active = false;

      if (this.enrollmentTimeout) {
        clearTimeout(this.enrollmentTimeout);
        this.enrollmentTimeout = null;
      }

      // Send stop enrollment command to device
      this.listener.broadcast('ENROLL:STOP');

      // Notify WebSocket clients that enrollment has stopped
      this.sendToWebSocketClients({
        type: 'enrollment_stopped',
        status: 'inactive',
        memberId: this.enrollmentMode.memberId,
        memberName: this.enrollmentMode.memberName,
        reason: reason,
        message: `Enrollment stopped: ${reason}`,
      });

      const result = { ...this.enrollmentMode, endReason: reason };
      this.enrollmentMode = null;
      return result;
    }
    return null;
  }

  async handleEnrollmentData(biometricData) {
    if (!this.enrollmentMode || !this.enrollmentMode.active) {
      logger.info('❌ Received enrollment data but enrollment mode is not active');
      return false;
    }

    try {
      const { userId, memberId, status, enrollmentStep } = biometricData;

      // Use the memberId from biometricData if available, otherwise use enrollment mode memberId
      const targetMemberId = memberId || this.enrollmentMode.memberId;
      const activeMemberId = String(this.enrollmentMode.memberId);
      const incomingMemberId = targetMemberId != null ? String(targetMemberId) : null;

      if (incomingMemberId && incomingMemberId !== activeMemberId) {
        logger.warn(
          `⚠️ Ignoring enrollment event for member ${incomingMemberId} while active enrollment is for member ${activeMemberId}`
        );
        return false;
      }

      if (status === 'enrollment_success' || status === 'enrolled') {
        // Enrollment successful
        await this.saveBiometricEnrollment(targetMemberId, userId, biometricData);
        logger.info(`✅ Enrollment successful for member ${targetMemberId}`);

        this.listener.broadcast(`ENROLL:SUCCESS:${this.enrollmentMode.memberName}`);
        this.sendToWebSocketClients({
          type: 'enrollment_complete',
          status: 'success',
          memberId: this.enrollmentMode.memberId,
          memberName: this.enrollmentMode.memberName,
          message: 'Enrollment completed successfully',
        });
        this.stopEnrollmentMode('success');
        return true;
      } else if (status === 'enrollment_failed' || status === 'error') {
        // Enrollment failed — only genuine failures count toward the retry limit
        this.enrollmentMode.attempts++;
        logger.info(
          `❌ Enrollment failed for member ${targetMemberId}: ${biometricData.error || 'Unknown error'}`
        );

        if (this.enrollmentMode.attempts >= this.enrollmentMode.maxAttempts) {
          this.listener.broadcast(`ENROLL:FAILED:MAX_ATTEMPTS`);
          this.sendToWebSocketClients({
            type: 'enrollment_complete',
            status: 'failed',
            memberId: targetMemberId,
            memberName: this.enrollmentMode.memberName,
            message: 'Enrollment failed - maximum attempts reached',
            attempts: this.enrollmentMode.attempts,
            maxAttempts: this.enrollmentMode.maxAttempts,
          });
          this.stopEnrollmentMode('max_attempts');
          return false;
        } else {
          const remaining = this.enrollmentMode.maxAttempts - this.enrollmentMode.attempts;
          this.listener.broadcast(`ENROLL:RETRY:${remaining}`);
          this.sendToWebSocketClients({
            type: 'enrollment_progress',
            status: 'retry',
            memberId: targetMemberId,
            memberName: this.enrollmentMode.memberName,
            attempts: this.enrollmentMode.attempts,
            maxAttempts: this.enrollmentMode.maxAttempts,
            message: `Prints mismatch — try again (${remaining} attempt${remaining !== 1 ? 's' : ''} remaining)`,
          });

          // Re-send start_enrollment to the ESP32 so it begins a new scan automatically
          if (this.enrollmentMode.deviceId) {
            try {
              await this.sendESP32Command(this.enrollmentMode.deviceId, 'start_enrollment', {
                memberId: targetMemberId,
                userId: targetMemberId,
                enrollmentId: targetMemberId,
              });
              logger.info(
                `🔄 Re-sent start_enrollment to ${this.enrollmentMode.deviceId} for retry`
              );
            } catch (cmdError) {
              logger.warn(`⚠️ Could not re-send start_enrollment on retry: ${cmdError.message}`);
              // Don't stop enrollment — the user can manually retry from the UI
            }
          }
          return false;
        }
      } else if (status === 'enrollment_progress' || enrollmentStep) {
        // Enrollment in progress - update progress and keep mode active
        logger.info(
          `🔄 Enrollment progress for member ${targetMemberId}: ${enrollmentStep || 'in progress'}`
        );

        // Update enrollment mode with current progress
        this.enrollmentMode.currentStep = enrollmentStep;
        this.enrollmentMode.lastProgressUpdate = new Date();

        this.listener.broadcast(`ENROLL:PROGRESS:${enrollmentStep || 'scanning'}`);
        this.sendToWebSocketClients({
          type: 'enrollment_progress',
          status: 'progress',
          memberId: targetMemberId,
          memberName: this.enrollmentMode.memberName,
          currentStep: enrollmentStep || 'scanning',
          attempts: this.enrollmentMode.attempts,
          maxAttempts: this.enrollmentMode.maxAttempts,
        });
        return false;
      } else if (status === 'enrollment_cancelled') {
        // Enrollment cancelled
        logger.info(`⏹️ Enrollment cancelled for member ${targetMemberId}`);

        this.listener.broadcast(`ENROLL:CANCELLED:${this.enrollmentMode.memberName}`);
        this.sendToWebSocketClients({
          type: 'enrollment_complete',
          status: 'cancelled',
          memberId: targetMemberId,
          memberName: this.enrollmentMode.memberName,
          message: 'Enrollment was cancelled',
        });
        this.stopEnrollmentMode('cancelled');
        return false;
      }

      return false;
    } catch (error) {
      logger.error({ err: error }, 'error handling enrollment data');
      this.listener.broadcast('ENROLL:ERROR');
      this.sendToWebSocketClients({
        type: 'enrollment_complete',
        status: 'error',
        memberId: this.enrollmentMode?.memberId,
        memberName: this.enrollmentMode?.memberName,
        message: 'Enrollment failed due to system error',
      });
      this.stopEnrollmentMode('error');
      return false;
    }
  }

  async saveBiometricEnrollment(memberId, biometricId, enrollmentData) {
    try {
      logger.info({ memberId, biometricId }, 'storing biometric enrollment');

      // Update member with biometric ID
      const updateMemberQuery = 'UPDATE members SET biometric_id = ? WHERE id = ?';
      await pool.query(updateMemberQuery, [biometricId, memberId]);

      // Store template in member_biometrics for later slot restoration on reactivation
      const template = enrollmentData.template || null;
      if (template) {
        await pool.query(
          `INSERT INTO member_biometrics (member_id, device_user_id, template)
           VALUES (?, ?, ?)
           ON CONFLICT(device_user_id) DO UPDATE SET template = excluded.template`,
          [memberId, String(biometricId), template]
        );
        logger.info(`💾 Template stored in member_biometrics for member ${memberId}`);
      } else {
        // Ensure a row exists even without a template so we can track device_user_id
        await pool.query(
          `INSERT OR IGNORE INTO member_biometrics (member_id, device_user_id)
           VALUES (?, ?)`,
          [memberId, String(biometricId)]
        );
      }

      // Log enrollment event
      const enrollmentEvent = {
        member_id: memberId,
        biometric_id: biometricId,
        event_type: 'enrollment',
        device_id: enrollmentData.deviceId || 'unknown',
        timestamp: new Date().toISOString(),
        success: true,
        raw_data: JSON.stringify(enrollmentData),
      };

      await this.logBiometricEvent(enrollmentEvent);

      // Send WhatsApp welcome message for first-time enrollment
      try {
        const memberResult = await pool.query('SELECT name, phone FROM members WHERE id = ?', [
          memberId,
        ]);
        if (memberResult.rows.length > 0) {
          const member = memberResult.rows[0];
          const whatsappResult = await whatsappService.sendWelcomeMessage(
            memberId,
            member.name,
            member.phone
          );

          if (whatsappResult.success) {
            logger.info(`📱 WhatsApp welcome message prepared for ${member.name}`);
            // Broadcast WhatsApp message status to WebSocket clients
            this.sendToWebSocketClients({
              type: 'whatsapp_welcome_sent',
              memberId: memberId,
              memberName: member.name,
              success: true,
              message: 'WhatsApp welcome message prepared successfully',
              whatsappUrl: whatsappResult.whatsappUrl,
              timestamp: new Date().toISOString(),
            });
          } else {
            logger.info(
              `📱 WhatsApp welcome message failed for ${member.name}: ${whatsappResult.error}`
            );
            // Broadcast WhatsApp message failure to WebSocket clients
            this.sendToWebSocketClients({
              type: 'whatsapp_welcome_failed',
              memberId: memberId,
              memberName: member.name,
              success: false,
              error: whatsappResult.error,
              timestamp: new Date().toISOString(),
            });
          }
        }
      } catch (whatsappError) {
        logger.error({ err: whatsappError }, 'error sending WhatsApp welcome message');
        // Broadcast WhatsApp error to WebSocket clients
        this.sendToWebSocketClients({
          type: 'whatsapp_welcome_error',
          memberId: memberId,
          success: false,
          error: whatsappError.message,
          timestamp: new Date().toISOString(),
        });
      }

      logger.info(`💾 Biometric enrollment saved for member ${memberId}`);
      return true;
    } catch (error) {
      logger.error({ err: error }, 'error saving biometric enrollment');
      throw error;
    }
  }

  async logBiometricEvent(eventData) {
    try {
      const query = `
        INSERT INTO biometric_events (
          member_id, biometric_id, event_type, device_id, 
          timestamp, success, error_message, raw_data
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `;

      const result = await pool.query(query, [
        eventData.member_id,
        eventData.biometric_id,
        eventData.event_type,
        eventData.device_id,
        eventData.timestamp,
        eventData.success ? 1 : 0,
        eventData.error_message || null,
        eventData.raw_data,
      ]);
      return result.lastInsertId;
    } catch (error) {
      logger.error({ err: error }, 'error logging biometric event');
      throw error;
    }
  }

  async removeBiometricId(memberId) {
    try {
      // Delete all fingerprint slots from all online devices before clearing DB,
      // so the sensor templates don't linger and cause stale-slot misidentification.
      await this.deleteAllMemberFingerprints(memberId);

      // Belt-and-suspenders: deleteAllMemberFingerprints already sets NULL.
      await pool.query('UPDATE members SET biometric_id = NULL WHERE id = ?', [memberId]);

      // Log removal event
      await this.logBiometricEvent({
        member_id: memberId,
        biometric_id: null,
        event_type: 'removal',
        device_id: 'admin',
        timestamp: new Date().toISOString(),
        success: true,
        raw_data: JSON.stringify({ action: 'biometric_removal' }),
      });

      logger.info(`🗑️ Biometric ID removed for member ${memberId}`);
      return true;
    } catch (error) {
      logger.error({ err: error }, 'error removing biometric ID');
      throw error;
    }
  }

  async getMemberBiometricStatus(memberId) {
    try {
      const query = 'SELECT id, name, biometric_id FROM members WHERE id = ?';

      const memberResult = await pool.query(query, [memberId]);
      const member = memberResult.rows[0];

      if (!member) {
        return null;
      }

      // Get enrollment history
      const historyQuery = `
        SELECT * FROM biometric_events 
        WHERE member_id = ? 
        ORDER BY timestamp DESC 
        LIMIT 10
      `;

      const historyResult = await pool.query(historyQuery, [memberId]);
      const history = historyResult.rows || [];

      return {
        member,
        hasFingerprint: !!member.biometric_id,
        biometricId: member.biometric_id,
        enrollmentHistory: history,
      };
    } catch (error) {
      logger.error({ err: error }, 'error getting member biometric status');
      return null;
    }
  }

  // ESP32 specific methods
  async sendESP32Command(deviceId, command, data = {}) {
    try {
      // Get device IP address from latest heartbeat
      const deviceIP = await this.getDeviceIPAddress(deviceId);

      if (!deviceIP) {
        throw new Error(`Device ${deviceId} IP address not found or device offline`);
      }

      const commandMessage = {
        deviceId: deviceId,
        command: command,
        data: data,
        timestamp: new Date().toISOString(),
        source: 'gym_management_system',
      };

      logger.info(`📱 Sending HTTP command to ESP32 ${deviceId} at ${deviceIP}: ${command}`);

      // Send HTTP POST request to ESP32 device
      const response = await this.sendHTTPCommandToDevice(deviceIP, commandMessage);

      // Log the command
      await this.logESP32Command(deviceId, command, data);

      return response;
    } catch (error) {
      logger.error({ err: error, deviceId }, 'failed to send ESP32 command');
      await this.logESP32Command(deviceId, command, data, error.message);
      throw error;
    }
  }

  async getDeviceIPAddress(deviceId) {
    try {
      // First try to get IP from devices table (most current)
      const devicesQuery = `
        SELECT ip_address FROM devices 
        WHERE device_id = ? AND status = 'online' 
        ORDER BY updated_at DESC 
        LIMIT 1
      `;

      const devicesResult = await pool.query(devicesQuery, [deviceId]);

      if (devicesResult.rows.length > 0 && devicesResult.rows[0].ip_address) {
        logger.info(`📍 Found device IP in devices table: ${devicesResult.rows[0].ip_address}`);
        return devicesResult.rows[0].ip_address;
      }

      // Fallback to biometric_events table for older data
      const eventsQuery = `
        SELECT raw_data FROM biometric_events 
        WHERE device_id = ? AND event_type = 'heartbeat' 
        ORDER BY timestamp DESC 
        LIMIT 1
      `;

      const eventsResult = await pool.query(eventsQuery, [deviceId]);

      if (eventsResult.rows.length === 0) {
        logger.info(`❌ No IP address found for device ${deviceId}`);
        return null;
      }

      const rawData = eventsResult.rows[0].raw_data;
      if (rawData) {
        try {
          const data = JSON.parse(rawData);
          logger.info(`📍 Found device IP in biometric_events: ${data.ip_address}`);
          return data.ip_address;
        } catch (parseError) {
          logger.error({ err: parseError }, 'error parsing heartbeat data');
          return null;
        }
      }

      return null;
    } catch (error) {
      logger.error({ err: error }, 'error getting device IP address');
      return null;
    }
  }

  async sendHTTPCommandToDevice(deviceIP, commandMessage) {
    try {
      const http = require('http');

      const postData = JSON.stringify(commandMessage);

      const options = {
        hostname: deviceIP,
        port: 80,
        path: '/command',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
          'User-Agent': 'GymManagementSystem/1.0',
        },
        timeout: 10000, // Increased timeout to allow ESP32 processing time
      };

      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (fn, value) => {
          if (settled) return;
          settled = true;
          fn(value);
        };

        const req = http.request(options, (res) => {
          let responseData = '';

          res.on('data', (chunk) => {
            responseData += chunk;
          });

          res.on('end', () => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              try {
                const jsonResponse = JSON.parse(responseData);
                logger.info(`✅ ESP32 command sent successfully: ${res.statusCode}`);
                finish(resolve, jsonResponse);
              } catch (parseError) {
                logger.info(
                  `✅ ESP32 command sent successfully: ${res.statusCode} (non-JSON response)`
                );
                finish(resolve, { success: true, response: responseData });
              }
            } else {
              logger.error({ statusCode: res.statusCode }, 'ESP32 command failed');
              finish(reject, new Error(`HTTP ${res.statusCode}: ${responseData}`));
            }
          });
        });

        req.on('error', (error) => {
          logger.error({ err: error }, 'HTTP request error');
          finish(reject, new Error(`HTTP request error: ${error.message}`));
        });

        req.on('timeout', () => {
          logger.error({ timeoutMs: options.timeout }, 'HTTP request timeout to ESP32 device');
          req.destroy();
          finish(reject, new Error(`HTTP timeout after ${options.timeout}ms`));
        });

        req.write(postData);
        req.end();
      });
    } catch (error) {
      logger.error({ err: error }, 'error sending HTTP command');
      // Don't throw - command might still work
      return { success: true, message: 'Command attempted', error: error.message };
    }
  }

  async unlockDoorRemotely(deviceId, reason = 'admin_unlock') {
    logger.info(`🔓 Remote unlock requested for device: ${deviceId}`);

    let commandResult;
    try {
      commandResult = await this.sendESP32Command(deviceId, 'unlock_door', {
        reason,
        duration: 5000, // 5 seconds
      });
    } catch (err) {
      logger.error({ err, deviceId }, 'remote unlock command failed');
      return { success: false, error: err.message };
    }

    if (commandResult?.error) {
      logger.warn(`⚠️ Remote unlock command reported issues: ${commandResult.error}`);
    }

    // The actual unlock acknowledgement is emitted by the ESP32 webhook.
    // We intentionally avoid logging a "remote_unlock" success here to prevent
    // false positives when the device fails to actuate the relay.
    return commandResult;
  }

  async startRemoteEnrollment(deviceId, memberId) {
    logger.info(`👆 Remote enrollment started for member ${memberId} on device ${deviceId}`);

    // Get member name for better user experience
    let memberName = `Member ${memberId}`;
    try {
      const memberResult = await pool.query('SELECT name FROM members WHERE id = ?', [memberId]);
      if (memberResult.rows && memberResult.rows.length > 0) {
        memberName = memberResult.rows[0].name;
      }
    } catch (nameError) {
      logger.warn({ err: nameError }, 'could not fetch member name');
    }

    // Delete all existing fingerprint slots for this member before re-enrolling,
    // so stale slots don't accumulate on the device and cause misidentification.
    await this.deleteAllMemberFingerprints(memberId);

    // Activate server-side enrollment mode so webhook events can be processed
    this.startEnrollmentMode(memberId, memberName, deviceId);

    try {
      // Pass the member ID as the userId to the ESP32 device
      // This creates a direct 1:1 mapping between ESP32 userId and member ID
      await this.sendESP32Command(deviceId, 'start_enrollment', {
        memberId: memberId,
        userId: memberId, // Use member ID as the ESP32 userId
        enrollmentId: memberId,
      });
    } catch (error) {
      // Roll back enrollment mode immediately so failed commands do not leave
      // the server stuck in an "enrollment in progress" state.
      if (
        this.enrollmentMode &&
        this.enrollmentMode.active &&
        String(this.enrollmentMode.memberId) === String(memberId)
      ) {
        this.stopEnrollmentMode('command_failed');
      }
      throw error;
    }

    // Send WebSocket event to notify frontend that enrollment has started
    this.sendToWebSocketClients({
      type: 'enrollment_started',
      status: 'active',
      memberId: memberId,
      memberName: memberName,
      deviceId: deviceId,
      message: `Remote enrollment started for ${memberName} on device ${deviceId}`,
    });

    return { success: true, message: 'Remote enrollment started' };
  }

  async logESP32Command(deviceId, command, data, error = null) {
    try {
      await this.logBiometricEvent({
        member_id: null,
        biometric_id: null,
        event_type: 'esp32_command',
        device_id: deviceId,
        timestamp: new Date().toISOString(),
        success: !error,
        error_message: error || null,
        raw_data: JSON.stringify({ command, data }),
      });
    } catch (logError) {
      logger.error({ err: logError }, 'error logging ESP32 command');
    }
  }

  async getDeviceStatus(deviceId) {
    try {
      // Get latest heartbeat from device
      const query = `
        SELECT * FROM biometric_events 
        WHERE device_id = ? AND event_type = 'heartbeat'
        ORDER BY timestamp DESC 
        LIMIT 1
      `;

      const result = await pool.query(query, [deviceId]);
      const lastHeartbeat = result.rows[0];

      if (!lastHeartbeat) {
        return { status: 'unknown', lastSeen: null };
      }

      const lastSeen = new Date(lastHeartbeat.timestamp);
      const now = new Date();
      const timeDiff = now - lastSeen;

      // Consider device offline if no heartbeat for 5 minutes
      const isOnline = timeDiff < 300000; // 5 minutes in milliseconds

      let parsedData = {};
      try {
        parsedData = JSON.parse(lastHeartbeat.raw_data);
      } catch (e) {
        // Handle parsing errors gracefully
      }

      return {
        status: isOnline ? 'online' : 'offline',
        lastSeen: lastSeen,
        timeSinceLastSeen: timeDiff,
        deviceData: parsedData,
      };
    } catch (error) {
      logger.error({ err: error }, 'error getting device status');
      return { status: 'error', lastSeen: null };
    }
  }

  // Add WebSocket client management methods
  addWebSocketClient(ws) {
    this.webSocketClients.add(ws);
    logger.info(`🔌 WebSocket client connected. Total clients: ${this.webSocketClients.size}`);

    // Send current enrollment status if any
    if (this.enrollmentMode && this.enrollmentMode.active) {
      this.sendToWebSocketClients({
        type: 'enrollment_status',
        status: 'active',
        memberId: this.enrollmentMode.memberId,
        memberName: this.enrollmentMode.memberName,
        attempts: this.enrollmentMode.attempts,
        maxAttempts: this.enrollmentMode.maxAttempts,
        currentStep: this.enrollmentMode.currentStep,
      });
    }
  }

  removeWebSocketClient(ws) {
    this.webSocketClients.delete(ws);
    logger.info(`🔌 WebSocket client disconnected. Total clients: ${this.webSocketClients.size}`);
  }

  sendToWebSocketClients(data) {
    const message = JSON.stringify(data);
    logger.debug(
      { clientCount: this.webSocketClients.size, type: data?.type },
      'sending WebSocket message'
    );

    this.webSocketClients.forEach((client) => {
      if (client.readyState === 1) {
        // WebSocket.OPEN
        try {
          client.send(message);
        } catch (error) {
          logger.error({ err: error }, 'error sending to WebSocket client');
          this.removeWebSocketClient(client);
        }
      } else {
        // Remove disconnected clients
        this.removeWebSocketClient(client);
      }
    });
  }

  // Debug method to check current enrollment status
  getEnrollmentStatus() {
    if (this.enrollmentMode && this.enrollmentMode.active) {
      return {
        active: true,
        memberId: this.enrollmentMode.memberId,
        memberName: this.enrollmentMode.memberName,
        attempts: this.enrollmentMode.attempts,
        maxAttempts: this.enrollmentMode.maxAttempts,
        currentStep: this.enrollmentMode.currentStep,
        startTime: this.enrollmentMode.startTime,
      };
    }
    return { active: false };
  }

  // ==================== SLOT MANAGEMENT ====================

  /**
   * Delete a member's fingerprint slot from every online ESP32 device and clear their biometric_id.
   * Called on member deactivation so the slot is freed for new enrolments.
   * The template row in member_biometrics is intentionally preserved for later restore.
   */
  async deleteFingerprint(memberId) {
    try {
      const memberResult = await pool.query('SELECT biometric_id FROM members WHERE id = ?', [
        memberId,
      ]);
      if (!memberResult.rows.length) return;

      const { biometric_id } = memberResult.rows[0];
      if (!biometric_id) {
        logger.info(`ℹ️ Member ${memberId} has no biometric_id — nothing to delete from sensor`);
        return;
      }

      const slotId = parseInt(biometric_id, 10);
      logger.info(`🗑️ Deleting fingerprint slot ${slotId} for member ${memberId}`);

      // Send delete command to all online devices
      const devicesResult = await pool.query(
        `SELECT device_id FROM devices WHERE status = 'online'`
      );
      for (const device of devicesResult.rows) {
        try {
          await this.sendESP32Command(device.device_id, 'delete_fingerprint', { slotId });
          logger.info(`✅ Fingerprint slot ${slotId} deleted from device ${device.device_id}`);
        } catch (err) {
          logger.error({ err, slotId }, 'failed to delete fingerprint slot');
        }
      }

      // Clear biometric_id on the member record (template row stays intact).
      // NULL, not '' — idx_members_biometric_id is a UNIQUE partial index that
      // exempts NULL but not '', so writing '' here breaks the next member cleared.
      await pool.query('UPDATE members SET biometric_id = ? WHERE id = ?', [null, memberId]);
      logger.info(`✅ biometric_id cleared for member ${memberId}`);
    } catch (error) {
      logger.error({ err: error, memberId }, 'deleteFingerprint failed');
    }
  }

  /**
   * Delete ALL fingerprint slots for a member from every online device and wipe their
   * biometric records. Used before re-enrollment so stale slots don't accumulate.
   */
  async deleteAllMemberFingerprints(memberId) {
    try {
      // Collect every slot ID ever associated with this member
      const memberResult = await pool.query('SELECT biometric_id FROM members WHERE id = ?', [
        memberId,
      ]);
      const biometricsResult = await pool.query(
        'SELECT device_user_id FROM member_biometrics WHERE member_id = ?',
        [memberId]
      );

      const slotIds = new Set();
      const currentId = memberResult.rows[0]?.biometric_id;
      if (currentId) {
        const n = parseInt(currentId, 10);
        if (!isNaN(n) && n > 0) slotIds.add(n);
      }
      for (const row of biometricsResult.rows) {
        const n = parseInt(row.device_user_id, 10);
        if (!isNaN(n) && n > 0) slotIds.add(n);
      }

      if (slotIds.size === 0) {
        logger.info(`ℹ️ Member ${memberId} has no fingerprint slots — nothing to delete`);
        return;
      }

      const devicesResult = await pool.query(
        `SELECT device_id FROM devices WHERE status = 'online'`
      );
      for (const slotId of slotIds) {
        for (const device of devicesResult.rows) {
          try {
            await this.sendESP32Command(device.device_id, 'delete_fingerprint', { slotId });
            logger.info(`✅ Slot ${slotId} deleted from device ${device.device_id}`);
          } catch (err) {
            logger.error({ err, slotId }, 'failed to delete fingerprint slot');
          }
        }
      }

      // Clear DB records so the member starts fresh. NULL, not '' — see comment
      // in deleteFingerprint() above.
      await pool.query('UPDATE members SET biometric_id = ? WHERE id = ?', [null, memberId]);
      await pool.query('DELETE FROM member_biometrics WHERE member_id = ?', [memberId]);
      logger.info(`✅ All ${slotIds.size} fingerprint slot(s) cleared for member ${memberId}`);
    } catch (error) {
      logger.error({ err: error, memberId }, 'deleteAllMemberFingerprints failed');
    }
  }

  /**
   * Sync biometric data across all online devices:
   * - Removes orphaned/duplicate slots from the ESP32 sensor(s) that don't match
   *   the member's current biometric_id in the DB.
   * - Cleans up stale member_biometrics rows (those without a template).
   * Returns a summary object.
   */
  async syncBiometricData() {
    const summary = { stale_slots_deleted: 0, db_rows_removed: 0, errors: 0, members_processed: 0 };
    try {
      // Find member_biometrics rows whose device_user_id no longer matches the member's
      // biometric_id. NULL biometric_id means "no active slot" — every remaining row for
      // that member is orphaned, not just ones that fail to match a nonexistent value.
      const staleResult = await pool.query(`
        SELECT mb.id AS mb_id, mb.member_id, mb.device_user_id, mb.template
        FROM member_biometrics mb
        JOIN members m ON m.id = mb.member_id
        WHERE m.biometric_id IS NULL OR mb.device_user_id != m.biometric_id
      `);

      const devicesResult = await pool.query(
        `SELECT device_id FROM devices WHERE status = 'online'`
      );

      for (const row of staleResult.rows) {
        const slotId = parseInt(row.device_user_id, 10);
        if (!isNaN(slotId) && slotId > 0) {
          for (const device of devicesResult.rows) {
            try {
              await this.sendESP32Command(device.device_id, 'delete_fingerprint', { slotId });
              summary.stale_slots_deleted++;
            } catch (err) {
              logger.error({ err, slotId }, 'failed to delete fingerprint slot');
              summary.errors++;
            }
          }
        }

        // Remove the stale DB row only if it has no template worth keeping
        if (!row.template) {
          await pool.query('DELETE FROM member_biometrics WHERE id = ?', [row.mb_id]);
          summary.db_rows_removed++;
        }
      }

      summary.members_processed = new Set(staleResult.rows.map((r) => r.member_id)).size;
      logger.info({ summary }, 'biometric sync complete');
    } catch (error) {
      logger.error({ err: error }, 'syncBiometricData failed');
      summary.errors++;
    }
    return summary;
  }

  /**
   * Restore a member's fingerprint from the stored template to a new sensor slot.
   * Called on member reactivation — no re-scan required if a template exists.
   * If no template is stored the member will need to re-enrol manually.
   */
  async restoreFingerprint(memberId) {
    try {
      const biometricResult = await pool.query(
        'SELECT template FROM member_biometrics WHERE member_id = ?',
        [memberId]
      );
      if (!biometricResult.rows.length || !biometricResult.rows[0].template) {
        logger.info(`ℹ️ No stored template for member ${memberId} — manual re-enrolment required`);
        return;
      }

      const { template } = biometricResult.rows[0];
      logger.info(`📥 Restoring fingerprint for member ${memberId} from stored template`);

      // Send restore command to the first online device found
      const devicesResult = await pool.query(
        `SELECT device_id FROM devices WHERE status = 'online' LIMIT 1`
      );
      if (!devicesResult.rows.length) {
        logger.info(`⚠️ No online devices found — fingerprint restore deferred`);
        return;
      }

      const deviceId = devicesResult.rows[0].device_id;
      await this.sendESP32Command(deviceId, 'restore_fingerprint', { memberId, template });
      // The ESP32 will POST a restore_success webhook with the new slot ID,
      // which updates members.biometric_id via handleRestoreSuccess below.
      logger.info(
        `📤 restore_fingerprint command sent to device ${deviceId} for member ${memberId}`
      );
    } catch (error) {
      logger.error({ err: error, memberId }, 'restoreFingerprint failed');
    }
  }

  /**
   * Handle the restore_success webhook sent by the ESP32 after a successful template restore.
   * Updates members.biometric_id with the new sensor slot.
   */
  async handleRestoreSuccess(data) {
    const { userId, memberId } = data;
    if (!userId || !memberId) return;

    try {
      await pool.query('UPDATE members SET biometric_id = ? WHERE id = ?', [
        String(userId),
        memberId,
      ]);
      // Keep member_biometrics.device_user_id current
      await pool.query('UPDATE member_biometrics SET device_user_id = ? WHERE member_id = ?', [
        String(userId),
        memberId,
      ]);
      logger.info(`✅ Restore success: member ${memberId} assigned to new slot ${userId}`);
    } catch (error) {
      logger.error({ err: error, memberId }, 'handleRestoreSuccess failed');
    }
  }
}

module.exports = BiometricIntegration;
