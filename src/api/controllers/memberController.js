const { pool } = require('../../config/sqlite');
const { sendEmail } = require('../../services/emailService');

const isValidPhone = (value) => {
    if (!value) { return false; }
    const normalized = String(value).trim();
    // Accept E.164 style or plain digits: 10 to 15 digits, optional leading +
    return /^\+?[0-9]{10,15}$/.test(normalized);
};

// Get all members
exports.getAllMembers = async (req, res) => {
    try {
        const allMembers = await pool.query('SELECT * FROM members ORDER BY id ASC');
        res.json(allMembers.rows);
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

// Create a new member
exports.createMember = async (req, res) => {
    const { name, email, phone, membership_type, membership_plan_id } = req.body;
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

        await pool.query('INSERT INTO members (name, email, phone, membership_type, membership_plan_id) VALUES ($1, $2, $3, $4, $5)', [name, email || null, phone || null, membership_type || null, planId]);
        const newMember = await pool.query('SELECT * FROM members ORDER BY id DESC LIMIT 1');

        // Send welcome email (do not block on failures)
        sendEmail('welcome', [name, email]).catch(() => {});

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

// Update a member
exports.updateMember = async (req, res) => {
    const { id } = req.params;
    const { name, email, phone, membership_type } = req.body;
    try {
        if (!phone) {
            return res.status(400).json({ message: 'Phone is required' });
        }
        if (!isValidPhone(phone)) {
            return res.status(400).json({ message: 'Invalid phone number. Use 10–15 digits, with optional leading +' });
        }
        await pool.query('UPDATE members SET name = $1, email = $2, phone = $3, membership_type = $4 WHERE id = $5', [name, email || null, phone || null, membership_type, id]);
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
        const member = await pool.query('SELECT id FROM members WHERE id = $1', [id]);
        if (member.rowCount === 0) {
            return res.status(404).json({ message: 'Member not found' });
        }

        await pool.query(
            `INSERT INTO member_biometrics (member_id, device_user_id, template)
             VALUES ($1, $2, $3)
             ON CONFLICT(device_user_id) DO UPDATE SET member_id = excluded.member_id, template = excluded.template`,
            [id, device_user_id || null, template || null]
        );
        const upsert = await pool.query('SELECT * FROM member_biometrics WHERE device_user_id = $1', [device_user_id || null]);
        res.json({ message: 'Biometric data saved', biometric: upsert.rows[0] });
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
