const { pool } = require('../../config/database');

// Card payment processing is disabled (Stripe removed)
exports.processPayment = async (_req, res) => {
    return res.status(501).json({
        message: 'Card payment processing is disabled. Use /api/payments/manual to record payments.'
    });
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

// Get invoice details by payment id (for printable invoice view)
exports.getInvoiceByPaymentId = async (req, res) => {
    try {
        const paymentId = parseInt(req.params.id, 10);
        if (!paymentId) {
            return res.status(400).json({ message: 'Invalid payment id' });
        }

        const result = await pool.query(
            `SELECT 
                p.id               AS payment_id,
                p.amount           AS payment_amount,
                p.payment_date,
                p.payment_method,
                p.transaction_id,
                i.id               AS invoice_id,
                i.amount           AS invoice_amount,
                i.status           AS invoice_status,
                i.due_date,
                i.created_at       AS invoice_created_at,
                m.id               AS member_id,
                m.name             AS member_name,
                m.email            AS member_email,
                m.phone            AS member_phone,
                mp.name            AS plan_name,
                mp.price           AS plan_price,
                mp.duration_days   AS plan_duration_days
            FROM payments p
            JOIN invoices i ON p.invoice_id = i.id
            LEFT JOIN members m ON i.member_id = m.id
            LEFT JOIN membership_plans mp ON i.plan_id = mp.id
            WHERE p.id = $1`,
            [paymentId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'Payment not found' });
        }

        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Get invoice details by invoice id (latest payment if available)
exports.getInvoiceByInvoiceId = async (req, res) => {
    try {
        const invoiceId = parseInt(req.params.id, 10);
        if (!invoiceId) {
            return res.status(400).json({ message: 'Invalid invoice id' });
        }

        const result = await pool.query(
            `SELECT 
                i.id               AS invoice_id,
                i.amount           AS invoice_amount,
                i.status           AS invoice_status,
                i.due_date,
                i.created_at       AS invoice_created_at,
                m.id               AS member_id,
                m.name             AS member_name,
                m.email            AS member_email,
                m.phone            AS member_phone,
                mp.name            AS plan_name,
                mp.price           AS plan_price,
                mp.duration_days   AS plan_duration_days,
                p.id               AS payment_id,
                p.amount           AS payment_amount,
                p.payment_date,
                p.payment_method,
                p.transaction_id
            FROM invoices i
            LEFT JOIN members m ON i.member_id = m.id
            LEFT JOIN membership_plans mp ON i.plan_id = mp.id
            LEFT JOIN LATERAL (
                SELECT id, amount, payment_date, payment_method, transaction_id
                FROM payments
                WHERE invoice_id = i.id
                ORDER BY payment_date DESC
                LIMIT 1
            ) p ON true
            WHERE i.id = $1`,
            [invoiceId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ message: 'Invoice not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
