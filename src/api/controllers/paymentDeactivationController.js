const PaymentDeactivationService = require('../../services/paymentDeactivationService');
const logger = require('../../utils/logger').child({ service: 'paymentDeactivationController' });

// Create a singleton instance
const paymentDeactivationService = new PaymentDeactivationService();

/**
 * Manually trigger payment deactivation check
 */
const triggerPaymentDeactivation = async (req, res) => {
  try {
    logger.info('🔄 Manual payment deactivation triggered');
    
    const result = await paymentDeactivationService.checkAndDeactivateOverdueMembers();
    
    res.json({
      success: true,
      message: 'Payment deactivation check completed',
      data: result
    });
  } catch (error) {
    logger.error({ err: error }, 'error in manual payment deactivation');
    res.status(500).json({
      success: false,
      message: 'Failed to run payment deactivation check',
      error: error.message
    });
  }
};

/**
 * Get payment deactivation service status
 */
const getPaymentDeactivationStatus = async (req, res) => {
  try {
    const status = paymentDeactivationService.getStatus();
    
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    logger.error({ err: error }, 'error getting payment deactivation status');
    res.status(500).json({
      success: false,
      message: 'Failed to get payment deactivation status',
      error: error.message
    });
  }
};

/**
 * Get members who are overdue but still within grace period
 */
const getOverdueMembersWithinGracePeriod = async (req, res) => {
  try {
    const overdueMembers = await paymentDeactivationService.getOverdueMembersWithinGracePeriod();
    
    res.json({
      success: true,
      data: {
        overdueMembers,
        count: overdueMembers.length
      }
    });
  } catch (error) {
    logger.error({ err: error }, 'error getting overdue members');
    res.status(500).json({
      success: false,
      message: 'Failed to get overdue members',
      error: error.message
    });
  }
};

module.exports = {
  triggerPaymentDeactivation,
  getPaymentDeactivationStatus,
  getOverdueMembersWithinGracePeriod,
  paymentDeactivationService
};
