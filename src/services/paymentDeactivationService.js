const { pool } = require('../config/sqlite');
const { checkMemberPaymentStatus, getGracePeriodSetting } = require('../utils/dateUtils');
const logger = require('../utils/logger').child({ service: 'paymentDeactivation' });

/**
 * Payment Deactivation Service
 * Automatically deactivates members who have exceeded their payment grace period
 */
class PaymentDeactivationService {
  constructor() {
    this.isRunning = false;
    this.lastRun = null;
    this.deactivatedMembers = [];
  }

  /**
   * Check and deactivate overdue members
   * @returns {Promise<Object>} Summary of deactivation results
   */
  async checkAndDeactivateOverdueMembers() {
    if (this.isRunning) {
      logger.info('⚠️ Payment deactivation service is already running');
      return { error: 'Service already running' };
    }

    this.isRunning = true;
    this.deactivatedMembers = [];

    try {
      logger.info('🔄 Starting payment deactivation check...');

      // Get grace period setting
      const gracePeriodDays = await getGracePeriodSetting(pool);
      logger.info(`📅 Using grace period: ${gracePeriodDays} days`);

      // Get all active members with membership plans
      const membersQuery = `
        SELECT 
          m.id,
          m.name,
          m.email,
          m.phone,
          m.join_date,
          m.membership_plan_id,
          m.is_active,
          mp.name as plan_name,
          mp.duration_days,
          (SELECT MAX(p.payment_date) 
           FROM payments p 
           JOIN invoices i ON p.invoice_id = i.id 
           WHERE i.member_id = m.id) as last_payment_date
        FROM members m
        LEFT JOIN membership_plans mp ON m.membership_plan_id = mp.id
        WHERE m.is_active = 1 
          AND m.is_admin = 0
          AND mp.duration_days IS NOT NULL
        ORDER BY m.name ASC
      `;

      const membersResult = await pool.query(membersQuery);
      const members = membersResult.rows;

      logger.info(`👥 Checking ${members.length} active members for payment status...`);

      let checkedCount = 0;
      let overdueCount = 0;
      let deactivatedCount = 0;

      for (const member of members) {
        checkedCount++;

        try {
          const paymentStatus = checkMemberPaymentStatus(
            member,
            {
              duration_days: member.duration_days,
            },
            member.last_payment_date,
            gracePeriodDays
          );

          if (paymentStatus.error) {
            logger.warn(
              `⚠️ Error checking payment for member ${member.name} (ID: ${member.id}): ${paymentStatus.error}`
            );
            continue;
          }

          if (paymentStatus.isOverdue) {
            overdueCount++;
            logger.info(
              `📊 Member ${member.name} (ID: ${member.id}) is ${paymentStatus.daysOverdue} days overdue`
            );

            if (paymentStatus.gracePeriodExpired) {
              // Deactivate the member
              await this.deactivateMember(member, paymentStatus);
              deactivatedCount++;
            } else {
              logger.info(
                `⏰ Member ${member.name} is overdue but within grace period (${gracePeriodDays - paymentStatus.daysOverdue} days remaining)`
              );
            }
          }
        } catch (memberError) {
          logger.error(
            `❌ Error processing member ${member.name} (ID: ${member.id}):`,
            memberError
          );
        }
      }

      this.lastRun = new Date();

      const summary = {
        timestamp: this.lastRun.toISOString(),
        gracePeriodDays,
        totalMembersChecked: checkedCount,
        overdueMembers: overdueCount,
        deactivatedMembers: deactivatedCount,
        deactivatedMemberDetails: this.deactivatedMembers,
      };

      logger.info({ summary }, 'payment deactivation check completed');
      return summary;
    } catch (error) {
      logger.error({ err: error }, 'error in payment deactivation service');
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Deactivate a member due to expired grace period
   * @param {Object} member - Member object
   * @param {Object} paymentStatus - Payment status object
   */
  async deactivateMember(member, paymentStatus) {
    try {
      // Update member status to inactive
      await pool.query('UPDATE members SET is_active = 0 WHERE id = ?', [member.id]);

      logger.info(
        `🔄 Deactivated member ${member.name} (ID: ${member.id}) - ${paymentStatus.daysOverdue} days overdue`
      );

      // Log the deactivation event
      await this.logDeactivationEvent(member, paymentStatus);

      // Store deactivation details
      this.deactivatedMembers.push({
        memberId: member.id,
        memberName: member.name,
        memberEmail: member.email,
        memberPhone: member.phone,
        planName: member.plan_name,
        daysOverdue: paymentStatus.daysOverdue,
        lastPaymentDate: member.last_payment_date,
        deactivatedAt: new Date().toISOString(),
        reason: 'payment_grace_period_expired',
      });

      // Trigger ESP32 cache invalidation
      try {
        const { invalidateESP32Cache } = require('../api/controllers/biometricController');
        if (invalidateESP32Cache) {
          await invalidateESP32Cache();
          logger.info(`🔄 ESP32 cache invalidated for deactivated member ${member.id}`);
        }
      } catch (cacheError) {
        logger.error({ err: cacheError }, 'error invalidating ESP32 cache');
      }

      // Delete fingerprint slot from sensor to free capacity
      try {
        const { deleteFingerprint } = require('../api/controllers/biometricController');
        if (deleteFingerprint) {
          await deleteFingerprint(member.id);
        }
      } catch (deleteError) {
        logger.error(
          { err: deleteError, memberId: member.id },
          'error deleting fingerprint on deactivation'
        );
      }
    } catch (error) {
      logger.error(
        { err: error, memberId: member.id, memberName: member.name },
        'error deactivating member'
      );
      throw error;
    }
  }

  /**
   * Log deactivation event to biometric_events table
   * @param {Object} member - Member object
   * @param {Object} paymentStatus - Payment status object
   */
  async logDeactivationEvent(member, paymentStatus) {
    try {
      const eventData = {
        member_id: member.id,
        biometric_id: null,
        event_type: 'automatic_deactivation',
        device_id: 'payment_service',
        timestamp: new Date().toISOString(),
        success: true,
        raw_data: JSON.stringify({
          reason: 'payment_grace_period_expired',
          daysOverdue: paymentStatus.daysOverdue,
          lastPaymentDate: member.last_payment_date,
          planName: member.plan_name,
          gracePeriodExpired: paymentStatus.gracePeriodExpired,
        }),
      };

      const query = `
        INSERT INTO biometric_events (
          member_id, biometric_id, event_type, device_id, 
          timestamp, success, raw_data
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `;

      await pool.query(query, [
        eventData.member_id,
        eventData.biometric_id,
        eventData.event_type,
        eventData.device_id,
        eventData.timestamp,
        eventData.success ? 1 : 0,
        eventData.raw_data,
      ]);

      logger.info(`📝 Logged deactivation event for member ${member.id}`);
    } catch (error) {
      logger.error({ err: error }, 'error logging deactivation event');
    }
  }

  /**
   * Get service status and statistics
   * @returns {Object} Service status information
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      lastRun: this.lastRun,
      lastRunFormatted: this.lastRun ? this.lastRun.toLocaleString() : 'Never',
      deactivatedMembersCount: this.deactivatedMembers.length,
      deactivatedMembers: this.deactivatedMembers,
    };
  }

  /**
   * Get members who are overdue but still within grace period
   * @returns {Promise<Array>} List of overdue members within grace period
   */
  async getOverdueMembersWithinGracePeriod() {
    try {
      const gracePeriodDays = await getGracePeriodSetting(pool);

      const membersQuery = `
        SELECT 
          m.id,
          m.name,
          m.email,
          m.phone,
          m.join_date,
          m.membership_plan_id,
          mp.name as plan_name,
          mp.duration_days,
          (SELECT MAX(p.payment_date) 
           FROM payments p 
           JOIN invoices i ON p.invoice_id = i.id 
           WHERE i.member_id = m.id) as last_payment_date
        FROM members m
        LEFT JOIN membership_plans mp ON m.membership_plan_id = mp.id
        WHERE m.is_active = 1 
          AND m.is_admin = 0
          AND mp.duration_days IS NOT NULL
        ORDER BY m.name ASC
      `;

      const membersResult = await pool.query(membersQuery);
      const members = membersResult.rows;
      const overdueMembers = [];

      for (const member of members) {
        try {
          const paymentStatus = checkMemberPaymentStatus(
            member,
            { duration_days: member.duration_days },
            member.last_payment_date,
            gracePeriodDays
          );

          if (paymentStatus.isOverdue && !paymentStatus.gracePeriodExpired) {
            overdueMembers.push({
              ...member,
              daysOverdue: paymentStatus.daysOverdue,
              daysRemainingInGracePeriod: gracePeriodDays - paymentStatus.daysOverdue,
              paymentStatus,
            });
          }
        } catch (error) {
          logger.error({ err: error, memberId: member.id }, 'error checking member payment status');
        }
      }

      return overdueMembers;
    } catch (error) {
      logger.error({ err: error }, 'error getting overdue members');
      return [];
    }
  }
}

module.exports = PaymentDeactivationService;
