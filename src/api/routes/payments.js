const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

router.post('/', paymentController.processPayment);
router.post('/manual', paymentController.recordManualPayment);
router.post('/invoice', paymentController.createInvoice);
router.get('/unpaid', paymentController.getUnpaidInvoicesByMember);

module.exports = router;
