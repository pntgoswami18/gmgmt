const pool = require('../config/database');

// Create a new membership plan
exports.createPlan = async (req, res) => {
    const { name, price, duration_days, description } = req.body;
    try {
        const newPlan = await pool.query(
            'INSERT INTO membership_plans (name, price, duration_days, description) VALUES ($1, $2, $3, $4) RETURNING *',
            [name, price, duration_days, description]
        );
        res.status(201).json(newPlan.rows[0]);
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
