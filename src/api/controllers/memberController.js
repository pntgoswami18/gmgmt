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

// Create a new member (email removed)
exports.createMember = async (req, res) => {
    const { name, phone, membership_plan_id, address, birthday, photo_url, is_admin } = req.body;
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

        await pool.query(
            'INSERT INTO members (name, phone, membership_plan_id, address, birthday, photo_url, is_active, is_admin) VALUES ($1, $2, $3, $4, $5, $6, 1, $7)',
            [name, phone || null, planId, address || null, birthday || null, photo_url || null, adminStatus]
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
    const { name, phone, address, birthday, photo_url, is_admin, membership_plan_id } = req.body;
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
            'UPDATE members SET name = $1, phone = $2, address = $3, birthday = $4, photo_url = $5, is_admin = $6, membership_plan_id = $7 WHERE id = $8',
            [finalName, finalPhone, safeAddress, safeBirthday, safePhotoUrl, safeAdminStatus, safeMembershipPlanId, id]
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
