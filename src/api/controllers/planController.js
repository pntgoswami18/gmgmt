const { pool } = require('../../config/sqlite');

// Create a new membership plan
exports.createPlan = async (req, res) => {
    const { name, price, duration_days, description } = req.body;
    try {
        await pool.query('INSERT INTO membership_plans (name, price, duration_days, description) VALUES ($1, $2, $3, $4)', [name, price, duration_days, description]);
        const created = await pool.query('SELECT * FROM membership_plans ORDER BY id DESC LIMIT 1');
        res.status(201).json(created.rows[0]);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

// Get all membership plans
exports.getAllPlans = async (req, res) => {
    try {
        const allPlans = await pool.query('SELECT * FROM membership_plans ORDER BY id ASC');
        res.json(allPlans.rows);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Update a membership plan
exports.updatePlan = async (req, res) => {
    const { id } = req.params;
    const { name, price, duration_days, description } = req.body;
    try {
        await pool.query('UPDATE membership_plans SET name = $1, price = $2, duration_days = $3, description = $4 WHERE id = $5', [name, price, duration_days, description, id]);
        const updated = await pool.query('SELECT * FROM membership_plans WHERE id = $1', [id]);
        if (updated.rows.length === 0) {
            return res.status(404).json({ message: 'Plan not found' });
        }
        res.json(updated.rows[0]);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

// Delete a membership plan
exports.deletePlan = async (req, res) => {
    const { id } = req.params;
    try {
        const existing = await pool.query('SELECT id FROM membership_plans WHERE id = $1', [id]);
        if (existing.rowCount === 0) {
            return res.status(404).json({ message: 'Plan not found' });
        }
        await pool.query('DELETE FROM membership_plans WHERE id = $1', [id]);
        res.json({ message: 'Plan deleted successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
