const pool = require('../../config/database');
const { sendEmail } = require('../../services/emailService');

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
    const { name, email, membership_type } = req.body;
    try {
        const newMember = await pool.query(
            'INSERT INTO members (name, email, membership_type) VALUES ($1, $2, $3) RETURNING *',
            [name, email, membership_type]
        );
        
        // Send welcome email
        await sendEmail('welcome', [name, email]);
        
        res.status(201).json(newMember.rows[0]);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

// Update a member
exports.updateMember = async (req, res) => {
    const { id } = req.params;
    const { name, email, membership_type } = req.body;
    try {
        const updatedMember = await pool.query(
            'UPDATE members SET name = $1, email = $2, membership_type = $3 WHERE id = $4 RETURNING *',
            [name, email, membership_type, id]
        );
        if (updatedMember.rows.length === 0) {
            return res.status(404).json({ message: 'Member not found' });
        }
        res.json(updatedMember.rows[0]);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

// Delete a member
exports.deleteMember = async (req, res) => {
    const { id } = req.params;
    try {
        const deletedMember = await pool.query('DELETE FROM members WHERE id = $1 RETURNING *', [id]);
        if (deletedMember.rowCount === 0) {
            return res.status(404).json({ message: 'Member not found' });
        }
        res.json({ message: 'Member deleted successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
