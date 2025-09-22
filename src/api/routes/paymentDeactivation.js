const express = require('express');
const router = express.Router();
const paymentDeactivationController = require('../controllers/paymentDeactivationController');

// Payment deactivation routes
router.post('/trigger', paymentDeactivationController.triggerPaymentDeactivation);
router.get('/status', paymentDeactivationController.getPaymentDeactivationStatus);
router.get('/overdue-members', paymentDeactivationController.getOverdueMembersWithinGracePeriod);

module.exports = router;
