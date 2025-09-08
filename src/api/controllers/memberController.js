const { pool } = require('../../config/sqlite');
const { sendEmail } = require('../../services/emailService');
const { uploadSingle } = require('../../config/multer');

const normalizePhone = (value) => {
    if (value === undefined || value === null) {
        return '';
    }
    const raw = String(value).trim();
    const hasPlus = raw.startsWith('+');
    const digits = raw.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 15) {
        return '';
    }
    return hasPlus ? `+${digits}` : digits;
};

const isValidPhone = (value) => {
    if (value === undefined || value === null) {
        return false;
    }
    const raw = String(value).trim();
    const digits = raw.replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 15;
};

// Get all members with pagination support
exports.getAllMembers = async (req, res) => {
    try {
        const { page = 1, limit = 10, search = '', filter = 'all' } = req.query;
        const pageNum = parseInt(page, 10);
        const limitNum = parseInt(limit, 10);
        const offset = (pageNum - 1) * limitNum;

        // Build search condition
        let searchCondition = '';
        let searchParams = [];
        if (search.trim()) {
            searchCondition = `AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)`;
            const searchTerm = `%${search.trim()}%`;
            searchParams.push(searchTerm, searchTerm, searchTerm);
        }

        // Build filter condition
        let filterCondition = '';
        let filterParams = [];
        if (filter === 'admins') {
            filterCondition = `AND is_admin = 1`;
        } else if (filter === 'members') {
            filterCondition = `AND is_admin != 1`;
        } else if (filter === 'new-this-month') {
            filterCondition = `AND date(join_date) >= date('now','start of month')`;
        } else if (filter === 'unpaid-this-month') {
            // This will be handled separately as it requires a complex query
            filterCondition = `AND is_admin != 1 AND NOT EXISTS (
                SELECT 1 FROM payments p 
                JOIN invoices i ON p.invoice_id = i.id 
                WHERE i.member_id = members.id 
                AND date(p.payment_date) >= date('now','start of month')
            )`;
        }

        // Get total count
        const countQuery = `SELECT COUNT(*) as total FROM members WHERE 1=1 ${searchCondition} ${filterCondition}`;
        const countResult = await pool.query(countQuery, [...searchParams, ...filterParams]);
        const total = parseInt(countResult.rows[0].total, 10);

        // Get paginated results with payment status
        const query = `
            SELECT 
                m.*,
                CASE 
                    WHEN m.is_admin = 1 THEN 0
                    WHEN EXISTS (
                        SELECT 1 FROM invoices i 
                        WHERE i.member_id = m.id 
                        AND i.status = 'unpaid' 
                        AND julianday('now') > julianday(i.due_date)
                    ) THEN 1
                    ELSE 0
                END as has_overdue_payments
            FROM members m
            WHERE 1=1 ${searchCondition} ${filterCondition}
            ORDER BY m.id ASC 
            LIMIT ? OFFSET ?
        `;
        const members = await pool.query(query, [...searchParams, ...filterParams, limitNum, offset]);

        res.json({
            members: members.rows,
            pagination: {
                total,
                page: pageNum,
                limit: limitNum,
                totalPages: Math.ceil(total / limitNum)
            }
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Get a single member by ID
exports.getMemberById = async (req, res) => {
    const { id } = req.params;
    try {
        const member = await pool.query('SELECT * FROM members WHERE id = $1', [id]);
        if (member.rows.length === 0) {
            return res.status(404).json({ message: 'Member not found' });
        }
        res.json(member.rows[0]);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Get detailed member information including payment history and referral discounts
exports.getMemberDetails = async (req, res) => {
    const { id } = req.params;
    try {
        // Get basic member information with plan details
        const memberQuery = `
            SELECT 
                m.*,
                mp.name as plan_name,
                mp.price as plan_price,
                mp.duration_days as plan_duration_days,
                CASE 
                    WHEN m.is_admin = 1 THEN 0
                    WHEN EXISTS (
                        SELECT 1 FROM invoices i 
                        WHERE i.member_id = m.id 
                        AND i.status = 'unpaid' 
                        AND julianday('now') > julianday(i.due_date)
                    ) THEN 1
                    ELSE 0
                END as has_overdue_payments
            FROM members m
            LEFT JOIN membership_plans mp ON m.membership_plan_id = mp.id
            WHERE m.id = ?
        `;
        const memberResult = await pool.query(memberQuery, [id]);
        
        if (memberResult.rows.length === 0) {
            return res.status(404).json({ message: 'Member not found' });
        }

        const member = memberResult.rows[0];

        // Get latest payment history (last 5 payments)
        const paymentHistoryQuery = `
            SELECT 
                p.id,
                p.amount,
                p.payment_date,
                p.payment_method,
                p.transaction_id,
                i.due_date,
                i.status as invoice_status,
                mp.name as plan_name
            FROM payments p
            JOIN invoices i ON p.invoice_id = i.id
            LEFT JOIN membership_plans mp ON i.plan_id = mp.id
            WHERE i.member_id = ?
            ORDER BY p.payment_date DESC
            LIMIT 5
        `;
        const paymentHistory = await pool.query(paymentHistoryQuery, [id]);

        // Get latest invoice status
        const latestInvoiceQuery = `
            SELECT 
                i.id,
                i.amount,
                i.due_date,
                i.status,
                i.created_at,
                mp.name as plan_name
            FROM invoices i
            LEFT JOIN membership_plans mp ON i.plan_id = mp.id
            WHERE i.member_id = ?
            ORDER BY i.due_date DESC
            LIMIT 1
        `;
        const latestInvoice = await pool.query(latestInvoiceQuery, [id]);

        // Get unused referral discount if referral system is enabled
        let unusedReferralDiscount = null;
        const referralSystemQuery = await pool.query('SELECT value FROM settings WHERE key = ?', ['referral_system_enabled']);
        const referralSystemEnabled = referralSystemQuery.rows[0]?.value === 'true';
        
        if (referralSystemEnabled) {
            const referralDiscountQuery = `
                SELECT 
                    r.id,
                    r.discount_amount,
                    r.status,
                    r.created_at,
                    referrer.name as referrer_name
                FROM referrals r
                JOIN members referrer ON r.referrer_id = referrer.id
                WHERE r.referred_id = ? AND r.status = 'pending'
                ORDER BY r.created_at DESC
                LIMIT 1
            `;
            const referralDiscount = await pool.query(referralDiscountQuery, [id]);
            if (referralDiscount.rows.length > 0) {
                unusedReferralDiscount = referralDiscount.rows[0];
            }
        }

        res.json({
            member,
            paymentHistory: paymentHistory.rows,
            latestInvoice: latestInvoice.rows[0] || null,
            unusedReferralDiscount,
            referralSystemEnabled
        });
    } catch (err) {
        console.error('Error fetching member details:', err);
        res.status(500).json({ message: err.message });
    }
};

// Create a new member (email removed)
exports.createMember = async (req, res) => {
    const { name, phone, membership_plan_id, address, birthday, photo_url, is_admin, join_date, due_date } = req.body;
    try {
        if (!phone) {
            return res.status(400).json({ message: 'Phone is required' });
        }
        if (!isValidPhone(phone)) {
            return res.status(400).json({ message: 'Invalid phone number. Use 10–15 digits, with optional leading +' });
        }
        const planId = membership_plan_id === null || membership_plan_id === undefined || membership_plan_id === ''
            ? null
            : parseInt(membership_plan_id, 10);

        const adminStatus = is_admin ? 1 : 0;

        // Use provided join_date or default to current date
        const finalJoinDate = join_date || new Date().toISOString().split('T')[0];

        await pool.query(
            'INSERT INTO members (name, phone, membership_plan_id, address, birthday, photo_url, is_active, is_admin, join_date) VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8)',
            [name, phone || null, planId, address || null, birthday || null, photo_url || null, adminStatus, finalJoinDate]
        );
        const newMember = await pool.query('SELECT * FROM members ORDER BY id DESC LIMIT 1');

        // Send welcome email (do not block on failures)
        // Email removed from member; skip sending welcome email

        res.status(201).json(newMember.rows[0]);
    } catch (err) {
        const lowered = String(err.message || '').toLowerCase();
        if (lowered.includes('unique')) {
            const msg = lowered.includes('phone')
                ? 'A member with this phone number already exists.'
                : 'A member with this email already exists.';
            return res.status(409).json({ message: msg });
        }
        res.status(400).json({ message: err.message });
    }
};

// Update a member (email removed)
exports.updateMember = async (req, res) => {
    const { id } = req.params;
    const { name, phone, address, birthday, photo_url, is_admin, membership_plan_id, join_date } = req.body;
    try {
        // Load existing to allow partial updates while ensuring mandatory fields present post-update
        const existingRes = await pool.query('SELECT name, phone, address, birthday, photo_url, is_admin, membership_plan_id FROM members WHERE id = $1', [id]);
        if (existingRes.rows.length === 0) {
            return res.status(404).json({ message: 'Member not found' });
        }
        const existing = existingRes.rows[0];

        const incomingName = String(name ?? '').trim();
        const finalName = incomingName || String(existing.name || '').trim();
        if (!finalName) {
            return res.status(400).json({ message: 'Name is required' });
        }

        const candidatePhone = (phone === undefined || String(phone).trim() === '') ? String(existing.phone || '') : String(phone || '');
        const finalPhone = normalizePhone(candidatePhone);
        if (!finalPhone) {
            return res.status(400).json({ message: 'Phone is required and must be 10–15 digits (optional leading +).' });
        }

        const safeAddress = address === undefined ? existing.address || null : address || null;
        const safeBirthday = birthday === undefined ? existing.birthday || null : birthday || null;
        const safePhotoUrl = photo_url === undefined ? existing.photo_url || null : photo_url || null;
        const safeAdminStatus = is_admin === undefined ? existing.is_admin : (is_admin ? 1 : 0);
        const safeJoinDate = join_date === undefined ? existing.join_date || new Date().toISOString().split('T')[0] : join_date;
        
        // Handle membership plan ID - admin users should not have membership plans
        let safeMembershipPlanId = null;
        if (is_admin !== 1) {
            if (membership_plan_id !== undefined) {
                safeMembershipPlanId = membership_plan_id ? parseInt(membership_plan_id, 10) : null;
            } else {
                // If not explicitly set, keep existing value
                safeMembershipPlanId = existing.membership_plan_id || null;
            }
        } else {
            // If user is being set as admin, remove any existing membership plan
            safeMembershipPlanId = null;
        }

        await pool.query(
            'UPDATE members SET name = $1, phone = $2, address = $3, birthday = $4, photo_url = $5, is_admin = $6, membership_plan_id = $7, join_date = $8 WHERE id = $9',
            [finalName, finalPhone, safeAddress, safeBirthday, safePhotoUrl, safeAdminStatus, safeMembershipPlanId, safeJoinDate, id]
        );
        const updatedMember = await pool.query('SELECT * FROM members WHERE id = $1', [id]);
        if (updatedMember.rows.length === 0) {
            return res.status(404).json({ message: 'Member not found' });
        }
        res.json(updatedMember.rows[0]);
    } catch (err) {
        const lowered = String(err.message || '').toLowerCase();
        if (lowered.includes('unique')) {
            const msg = lowered.includes('phone')
                ? 'A member with this phone number already exists.'
                : 'A member with this email already exists.';
            return res.status(409).json({ message: msg });
        }
        res.status(400).json({ message: err.message });
    }
};

// Upsert biometric data for a member
exports.upsertBiometric = async (req, res) => {
    const { id } = req.params; // member id
    const { device_user_id, template } = req.body; // template may be base64 string

    if (!device_user_id && !template) {
        return res.status(400).json({ message: 'device_user_id or template is required' });
    }

    try {
        // Ensure member exists
        const member = await pool.query('SELECT id FROM members WHERE id = ?', [id]);
        if (member.rows.length === 0) {
            return res.status(404).json({ message: 'Member not found' });
        }

        // Check if device_user_id is already assigned to another member
        if (device_user_id) {
            const existingMember = await pool.query('SELECT id, name FROM members WHERE biometric_id = ? AND id != ?', [device_user_id, id]);
            if (existingMember.rows.length > 0) {
                return res.status(409).json({ 
                    message: `Device User ID ${device_user_id} is already assigned to another member` 
                });
            }
        }

        // Update member with biometric data
        await pool.query(
            'UPDATE members SET biometric_id = ? WHERE id = ?',
            [device_user_id || null, id]
        );

        // Get updated member data
        const updatedMember = await pool.query('SELECT id, name, biometric_id FROM members WHERE id = ?', [id]);
        
        res.json({ 
            message: 'Biometric data saved', 
            member: updatedMember.rows[0],
            biometric: {
                device_user_id: device_user_id || null,
                template: template || null
            }
        });
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

// Delete a member
exports.deleteMember = async (req, res) => {
    const { id } = req.params;
    try {
        const existing = await pool.query('SELECT id FROM members WHERE id = $1', [id]);
        if (existing.rowCount === 0) {
            return res.status(404).json({ message: 'Member not found' });
        }
        await pool.query('DELETE FROM members WHERE id = $1', [id]);
        res.json({ message: 'Member deleted successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Toggle member active status
exports.setActiveStatus = async (req, res) => {
    const { id } = req.params;
    const { is_active } = req.body;
    try {
        const existing = await pool.query('SELECT id FROM members WHERE id = $1', [id]);
        if (existing.rowCount === 0) {
            return res.status(404).json({ message: 'Member not found' });
        }
        const val = String(is_active) === '0' || is_active === false ? 0 : 1;
        await pool.query('UPDATE members SET is_active = $1 WHERE id = $2', [val, id]);
        const updated = await pool.query('SELECT * FROM members WHERE id = $1', [id]);
        
        // Trigger immediate cache invalidation for ESP32 devices when member status changes
        try {
            const { invalidateESP32Cache } = require('../controllers/biometricController');
            if (invalidateESP32Cache) {
                console.log(`🔄 Member ${id} status changed to ${val === 1 ? 'active' : 'inactive'} - invalidating ESP32 cache`);
                await invalidateESP32Cache();
            }
        } catch (cacheError) {
            console.error('❌ Error invalidating ESP32 cache:', cacheError);
            // Don't fail the main operation if cache invalidation fails
        }
        
        res.json(updated.rows[0]);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};
// Upload member photo
exports.uploadMemberPhoto = [
    (req, res, next) => { req.body.prefix = `member-${req.params.id || 'unknown'}`; next(); },
    uploadSingle('photo'),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ message: 'No file uploaded' });
            }
            const { id } = req.params;
            const photoUrl = `/uploads/${req.file.filename}`;
            if (id) {
                await pool.query('UPDATE members SET photo_url = $1 WHERE id = $2', [photoUrl, id]);
            }
            res.json({ message: 'Photo uploaded successfully', photo_url: photoUrl });
        } catch (err) {
            res.status(500).json({ message: err.message });
        }
    }
];
