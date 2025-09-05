const pool = require('../../config/sqlite');

// Create a new referral
const createReferral = async (req, res) => {
    try {
        const { referrer_id, referred_id } = req.body;

        if (!referrer_id || !referred_id) {
            return res.status(400).json({ message: 'Referrer ID and referred ID are required' });
        }

        if (referrer_id === referred_id) {
            return res.status(400).json({ message: 'A member cannot refer themselves' });
        }

        // Check if referral system is enabled
        const settingsResult = await pool.query('SELECT value FROM settings WHERE key = $1', ['referral_system_enabled']);
        const referralEnabled = settingsResult.rows[0]?.value === 'true';

        if (!referralEnabled) {
            return res.status(400).json({ message: 'Referral system is not enabled' });
        }

        // Get referral discount amount
        const discountResult = await pool.query('SELECT value FROM settings WHERE key = $1', ['referral_discount_amount']);
        const discountAmount = parseFloat(discountResult.rows[0]?.value || '100');

        // Check if referrer exists and is not admin
        const referrerResult = await pool.query('SELECT id, is_admin FROM members WHERE id = $1', [referrer_id]);
        if (referrerResult.rows.length === 0) {
            return res.status(404).json({ message: 'Referrer not found' });
        }

        if (referrerResult.rows[0].is_admin) {
            return res.status(400).json({ message: 'Admin users cannot be referrers' });
        }

        // Check if referred member exists
        const referredResult = await pool.query('SELECT id FROM members WHERE id = $1', [referred_id]);
        if (referredResult.rows.length === 0) {
            return res.status(404).json({ message: 'Referred member not found' });
        }

        // Check if referral already exists for this referred member
        const existingReferral = await pool.query('SELECT id FROM referrals WHERE referred_id = $1', [referred_id]);
        if (existingReferral.rows.length > 0) {
            return res.status(400).json({ message: 'This member has already been referred' });
        }

        // Create the referral
        const result = await pool.query(
            'INSERT INTO referrals (referrer_id, referred_id, discount_amount, status) VALUES ($1, $2, $3, $4)',
            [referrer_id, referred_id, discountAmount, 'pending']
        );

        res.status(201).json({
            message: 'Referral created successfully',
            referral: {
                id: result.lastID,
                referrer_id,
                referred_id,
                discount_amount: discountAmount,
                status: 'pending'
            }
        });

    } catch (error) {
        console.error('Error creating referral:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// Get all referrals
const getReferrals = async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM referrals ORDER BY created_at DESC');
        res.json({ referrals: result.rows });
    } catch (error) {
        console.error('Error fetching referrals:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// Apply referral discount to referrer's next payment
const applyReferralDiscount = async (req, res) => {
    try {
        const { referral_id } = req.params;

        // Get referral details
        const referralResult = await pool.query('SELECT * FROM referrals WHERE id = $1', [referral_id]);
        if (referralResult.rows.length === 0) {
            return res.status(404).json({ message: 'Referral not found' });
        }

        const referral = referralResult.rows[0];

        if (referral.status !== 'pending') {
            return res.status(400).json({ message: 'Referral discount has already been applied' });
        }

        // Get referrer's next unpaid invoice
        const invoiceResult = await pool.query(`
            SELECT i.id, i.amount, i.member_id
            FROM invoices i
            WHERE i.member_id = $1 AND i.status = 'unpaid'
            ORDER BY i.due_date ASC
            LIMIT 1
        `, [referral.referrer_id]);

        if (invoiceResult.rows.length === 0) {
            return res.status(400).json({ message: 'No unpaid invoices found for referrer' });
        }

        const invoice = invoiceResult.rows[0];
        const newAmount = Math.max(0, invoice.amount - referral.discount_amount);

        // Update invoice amount
        await pool.query('UPDATE invoices SET amount = $1 WHERE id = $2', [newAmount, invoice.id]);

        // Update referral status
        await pool.query(
            'UPDATE referrals SET status = $1, applied_at = $2 WHERE id = $3',
            ['applied', new Date().toISOString(), referral_id]
        );

        res.json({
            message: 'Referral discount applied successfully',
            invoice_id: invoice.id,
            original_amount: invoice.amount,
            new_amount: newAmount,
            discount_applied: referral.discount_amount
        });

    } catch (error) {
        console.error('Error applying referral discount:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

module.exports = {
    createReferral,
    getReferrals,
    applyReferralDiscount
};
