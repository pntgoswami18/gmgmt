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
