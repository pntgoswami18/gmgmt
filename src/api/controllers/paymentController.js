const { pool } = require('../../config/sqlite');
const { calculateDueDateForPlan } = require('../../utils/dateUtils');

// Card payment processing is disabled (Stripe removed)
exports.processPayment = async (_req, res) => {
    return res.status(501).json({
        message: 'Card payment processing is disabled. Use /api/payments/manual to record payments.'
    });
};

// Create an invoice for a member (manual or pre-payment)
exports.createInvoice = async (req, res) => {
    const { member_id, plan_id, amount, due_date, join_date } = req.body;
    try {
        // If no plan_id provided, try to get member's current plan
        let finalPlanId = plan_id;
        let finalDueDate = due_date;
        
        if (!finalPlanId && member_id) {
            const memberPlan = await pool.query('SELECT membership_plan_id FROM members WHERE id = $1', [member_id]);
            if (memberPlan.rows.length > 0) {
                finalPlanId = memberPlan.rows[0].membership_plan_id;
            }
        }
        
        // If no due_date provided but we have a plan and join_date, calculate it
        if (!finalDueDate && finalPlanId && join_date) {
            const plan = await pool.query('SELECT * FROM membership_plans WHERE id = $1', [finalPlanId]);
            if (plan.rows.length > 0) {
                finalDueDate = calculateDueDateForPlan(join_date, plan.rows[0]);
            }
        }
        
        await pool.query('INSERT INTO invoices (member_id, plan_id, amount, due_date, status) VALUES ($1, $2, $3, $4, $5)', [member_id, finalPlanId || null, amount, finalDueDate, 'unpaid']);
        const newInvoice = await pool.query('SELECT * FROM invoices ORDER BY id DESC LIMIT 1');
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

        // If member_id is provided, check if member is an admin user - admins are exempt from payments
        if (member_id) {
            const memberCheck = await pool.query('SELECT is_admin FROM members WHERE id = $1', [member_id]);
            if (memberCheck.rows.length === 0) {
                return res.status(404).json({ message: 'Member not found' });
            }
            
            if (memberCheck.rows[0].is_admin === 1) {
                return res.status(400).json({ message: 'Admin users are exempt from payments and cannot have payments recorded against them' });
            }
        }

        let ensuredInvoiceId = invoice_id ? parseInt(invoice_id, 10) : null;

        if (!ensuredInvoiceId) {
            // If no plan_id provided, try to get member's current plan
            let finalPlanId = plan_id;
            if (!finalPlanId && member_id) {
                const memberPlan = await pool.query('SELECT membership_plan_id FROM members WHERE id = $1', [member_id]);
                if (memberPlan.rows.length > 0) {
                    finalPlanId = memberPlan.rows[0].membership_plan_id;
                }
            }
            
            await pool.query('INSERT INTO invoices (member_id, plan_id, amount, due_date, status) VALUES ($1, $2, $3, $4, $5)', [member_id || null, finalPlanId || null, normalizedAmount, due_date || new Date().toISOString().slice(0, 10), 'unpaid']);
            const inv = await pool.query('SELECT id FROM invoices ORDER BY id DESC LIMIT 1');
            ensuredInvoiceId = inv.rows[0].id;
        } else {
            const existing = await pool.query('SELECT id FROM invoices WHERE id = $1', [ensuredInvoiceId]);
            if (existing.rowCount === 0) {
                // If no plan_id provided, try to get member's current plan
                let finalPlanId = plan_id;
                if (!finalPlanId && member_id) {
                    const memberPlan = await pool.query('SELECT membership_plan_id FROM members WHERE id = $1', [member_id]);
                    if (memberPlan.rows.length > 0) {
                        finalPlanId = memberPlan.rows[0].membership_plan_id;
                    }
                }
                
                await pool.query('INSERT INTO invoices (member_id, plan_id, amount, due_date, status) VALUES ($1, $2, $3, $4, $5)', [member_id || null, finalPlanId || null, normalizedAmount, due_date || new Date().toISOString().slice(0, 10), 'unpaid']);
                const inv = await pool.query('SELECT id FROM invoices ORDER BY id DESC LIMIT 1');
                ensuredInvoiceId = inv.rows[0].id;
            }
        }

        await pool.query('INSERT INTO payments (invoice_id, amount, payment_method, transaction_id) VALUES ($1, $2, $3, $4)', [ensuredInvoiceId, normalizedAmount, method || 'manual', transaction_id || null]);
        const payment = await pool.query('SELECT * FROM payments ORDER BY id DESC LIMIT 1');

        await pool.query('UPDATE invoices SET status = $1 WHERE id = $2', ['paid', ensuredInvoiceId]);

        // Apply referral discounts if any pending referrals exist for this member
        try {
            const referralResult = await pool.query(`
                SELECT r.id, r.discount_amount, r.referrer_id
                FROM referrals r
                WHERE r.referred_id = (
                    SELECT member_id FROM invoices WHERE id = ?
                ) AND r.status = 'pending'
                ORDER BY r.created_at ASC
                LIMIT 1
            `, [ensuredInvoiceId]);

            if (referralResult.rows.length > 0) {
                const referral = referralResult.rows[0];
                
                // Get referrer's next unpaid invoice
                const nextInvoiceResult = await pool.query(`
                    SELECT i.id, i.amount
                    FROM invoices i
                    WHERE i.member_id = ? AND i.status = 'unpaid' AND i.id != ?
                    ORDER BY i.due_date ASC
                    LIMIT 1
                `, [referral.referrer_id, ensuredInvoiceId]);

                if (nextInvoiceResult.rows.length > 0) {
                    const nextInvoice = nextInvoiceResult.rows[0];
                    const newAmount = Math.max(0, nextInvoice.amount - referral.discount_amount);

                    // Update invoice amount
                    await pool.query('UPDATE invoices SET amount = ? WHERE id = ?', [newAmount, nextInvoice.id]);

                    // Update referral status
                    await pool.query(
                        'UPDATE referrals SET status = ?, applied_at = ? WHERE id = ?',
                        ['applied', new Date().toISOString(), referral.id]
                    );
                }
            }
        } catch (referralError) {
            console.error('Error applying referral discount:', referralError);
            // Don't fail the payment if referral discount fails
        }

        res.status(201).json({ message: 'Manual payment recorded', payment: payment.rows[0], invoice_id: ensuredInvoiceId });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

// Delete a payment and update invoice status back to unpaid
exports.deletePayment = async (req, res) => {
    const { id } = req.params;
    try {
        const paymentId = parseInt(id, 10);
        if (!paymentId || isNaN(paymentId)) {
            return res.status(400).json({ message: 'Invalid payment ID' });
        }

        // Get payment details before deletion
        const paymentResult = await pool.query('SELECT invoice_id, amount FROM payments WHERE id = $1', [paymentId]);
        if (paymentResult.rows.length === 0) {
            return res.status(404).json({ message: 'Payment not found' });
        }

        const { invoice_id } = paymentResult.rows[0];

        // Delete the payment
        await pool.query('DELETE FROM payments WHERE id = $1', [paymentId]);

        // Check if there are any remaining payments for this invoice
        const remainingPayments = await pool.query('SELECT COUNT(*) as count FROM payments WHERE invoice_id = $1', [invoice_id]);
        const hasRemainingPayments = parseInt(remainingPayments.rows[0].count, 10) > 0;

        // Update invoice status based on remaining payments
        const newStatus = hasRemainingPayments ? 'paid' : 'unpaid';
        await pool.query('UPDATE invoices SET status = $1 WHERE id = $2', [newStatus, invoice_id]);

        res.json({ 
            message: 'Payment deleted successfully', 
            invoice_id: invoice_id,
            new_invoice_status: newStatus
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
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
            LEFT JOIN (
                SELECT 
                    invoice_id,
                    id,
                    amount,
                    payment_date,
                    payment_method,
                    transaction_id,
                    ROW_NUMBER() OVER (PARTITION BY invoice_id ORDER BY payment_date DESC) as rn
                FROM payments
            ) p ON p.invoice_id = i.id AND p.rn = 1
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

// Update an existing invoice
exports.updateInvoice = async (req, res) => {
    try {
        const invoiceId = parseInt(req.params.id, 10);
        if (!invoiceId) {
            return res.status(400).json({ message: 'Invalid invoice id' });
        }

        const { member_id, plan_id, amount, due_date } = req.body;

        // Check if invoice exists
        const existingInvoice = await pool.query('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
        if (existingInvoice.rowCount === 0) {
            return res.status(404).json({ message: 'Invoice not found' });
        }

        // Check if invoice has payments - if paid, don't allow editing
        const payments = await pool.query('SELECT COUNT(*) as count FROM payments WHERE invoice_id = $1', [invoiceId]);
        const hasPayments = parseInt(payments.rows[0].count, 10) > 0;
        
        if (hasPayments) {
            return res.status(400).json({ message: 'Cannot edit invoice that has payments. Delete payments first.' });
        }

        // If no plan_id provided, try to get member's current plan
        let finalPlanId = plan_id;
        if (!finalPlanId && member_id) {
            const memberPlan = await pool.query('SELECT membership_plan_id FROM members WHERE id = $1', [member_id]);
            if (memberPlan.rows.length > 0) {
                finalPlanId = memberPlan.rows[0].membership_plan_id;
            }
        }

        // Update the invoice
        await pool.query(
            'UPDATE invoices SET member_id = $1, plan_id = $2, amount = $3, due_date = $4 WHERE id = $5',
            [member_id, finalPlanId || null, amount, due_date, invoiceId]
        );

        // Return updated invoice
        const updatedInvoice = await pool.query('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
        res.json(updatedInvoice.rows[0]);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

// Delete an invoice (only if no payments exist)
exports.deleteInvoice = async (req, res) => {
    try {
        const invoiceId = parseInt(req.params.id, 10);
        if (!invoiceId) {
            return res.status(400).json({ message: 'Invalid invoice id' });
        }

        // Check if invoice exists
        const existingInvoice = await pool.query('SELECT * FROM invoices WHERE id = $1', [invoiceId]);
        if (existingInvoice.rowCount === 0) {
            return res.status(404).json({ message: 'Invoice not found' });
        }

        // Check if invoice has payments - if paid, don't allow deletion
        const payments = await pool.query('SELECT COUNT(*) as count FROM payments WHERE invoice_id = $1', [invoiceId]);
        const hasPayments = parseInt(payments.rows[0].count, 10) > 0;
        
        if (hasPayments) {
            return res.status(400).json({ message: 'Cannot delete invoice that has payments. Delete payments first.' });
        }

        // Delete the invoice
        await pool.query('DELETE FROM invoices WHERE id = $1', [invoiceId]);
        
        res.json({ message: 'Invoice deleted successfully', invoice_id: invoiceId });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
