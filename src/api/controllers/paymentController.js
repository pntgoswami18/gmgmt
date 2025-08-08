const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { pool } = require('../../config/database');
const { sendEmail } = require('../../services/emailService');

// Process a payment for an invoice
exports.processPayment = async (req, res) => {
    const { invoice_id, amount, payment_method_id } = req.body;

    try {
        // Create a PaymentIntent with Stripe
        const paymentIntent = await stripe.paymentIntents.create({
            amount: amount * 100, // Amount in cents
            currency: 'inr',
            payment_method: payment_method_id,
            confirm: true,
        });

        // If payment is successful, record it in the database
        const newPayment = await pool.query(
            'INSERT INTO payments (invoice_id, amount, payment_method, transaction_id) VALUES ($1, $2, $3, $4) RETURNING *',
            [invoice_id, amount, 'stripe', paymentIntent.id]
        );

        // Update the invoice status to 'paid'
        await pool.query('UPDATE invoices SET status = $1 WHERE id = $2', ['paid', invoice_id]);

        // Get member and plan details for confirmation email
        const paymentDetails = await pool.query(`
            SELECT m.name, m.email, mp.name as plan_name, i.amount
            FROM invoices i
            JOIN members m ON i.member_id = m.id
            JOIN membership_plans mp ON i.plan_id = mp.id
            WHERE i.id = $1
        `, [invoice_id]);

        if (paymentDetails.rows.length > 0) {
            const details = paymentDetails.rows[0];
            await sendEmail('paymentConfirmation', [
                details.name,
                details.email,
                details.amount,
                details.plan_name
            ]);
        }

        res.status(201).json({ 
            message: 'Payment processed successfully.',
            payment: newPayment.rows[0]
        });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Create an invoice for a member (manual or pre-payment)
exports.createInvoice = async (req, res) => {
    const { member_id, plan_id, amount, due_date } = req.body;
    try {
        const newInvoice = await pool.query(
            'INSERT INTO invoices (member_id, plan_id, amount, due_date, status) VALUES ($1, $2, $3, $4, $5) RETURNING *',
            [member_id, plan_id || null, amount, due_date, 'unpaid']
        );
        res.status(201).json(newInvoice.rows[0]);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

// Record a manual payment (cash/bank/etc.)
// If invoice_id is missing or invalid, create an invoice automatically
exports.recordManualPayment = async (req, res) => {
    let { invoice_id, amount, method, transaction_id, member_id, plan_id, due_date } = req.body;
    try {
        const normalizedAmount = parseFloat(amount);
        if (Number.isNaN(normalizedAmount) || normalizedAmount <= 0) {
            return res.status(400).json({ message: 'Invalid amount' });
        }

        let ensuredInvoiceId = invoice_id ? parseInt(invoice_id, 10) : null;

        if (!ensuredInvoiceId) {
            const inv = await pool.query(
                'INSERT INTO invoices (member_id, plan_id, amount, due_date, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                [member_id || null, plan_id || null, normalizedAmount, due_date || new Date().toISOString().slice(0, 10), 'unpaid']
            );
            ensuredInvoiceId = inv.rows[0].id;
        } else {
            const existing = await pool.query('SELECT id FROM invoices WHERE id = $1', [ensuredInvoiceId]);
            if (existing.rowCount === 0) {
                const inv = await pool.query(
                    'INSERT INTO invoices (member_id, plan_id, amount, due_date, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                    [member_id || null, plan_id || null, normalizedAmount, due_date || new Date().toISOString().slice(0, 10), 'unpaid']
                );
                ensuredInvoiceId = inv.rows[0].id;
            }
        }

        const payment = await pool.query(
            'INSERT INTO payments (invoice_id, amount, payment_method, transaction_id) VALUES ($1, $2, $3, $4) RETURNING *',
            [ensuredInvoiceId, normalizedAmount, method || 'manual', transaction_id || null]
        );

        await pool.query('UPDATE invoices SET status = $1 WHERE id = $2', ['paid', ensuredInvoiceId]);

        res.status(201).json({ message: 'Manual payment recorded', payment: payment.rows[0], invoice_id: ensuredInvoiceId });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

// Get unpaid invoices for a specific member
exports.getUnpaidInvoicesByMember = async (req, res) => {
    try {
        const memberId = parseInt(req.query.member_id, 10);
        if (!memberId) {
            return res.status(400).json({ message: 'member_id is required' });
        }

        const result = await pool.query(
            `SELECT id, amount, due_date
             FROM invoices
             WHERE member_id = $1 AND status = 'unpaid'
             ORDER BY due_date ASC`,
            [memberId]
        );

        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
