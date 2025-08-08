const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');

router.post('/', paymentController.processPayment);
router.post('/manual', paymentController.recordManualPayment);
router.post('/invoice', paymentController.createInvoice);
router.get('/unpaid', paymentController.getUnpaidInvoicesByMember);
router.get('/:id/invoice', paymentController.getInvoiceByPaymentId);
// Alternate path for fetching invoice by payment id
router.get('/invoice/:id', paymentController.getInvoiceByPaymentId);
// Fetch invoice by invoice id directly
router.get('/invoices/:id', paymentController.getInvoiceByInvoiceId);

module.exports = router;
