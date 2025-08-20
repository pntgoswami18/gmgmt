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
// Update an invoice
router.put('/invoices/:id', paymentController.updateInvoice);
// Delete an invoice
router.delete('/invoices/:id', paymentController.deleteInvoice);
// Delete a payment
router.delete('/:id', paymentController.deletePayment);

module.exports = router;
