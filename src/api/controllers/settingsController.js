const pool = require('../../config/database');

// Get a setting by key
exports.getSetting = async (req, res) => {
    const { key } = req.params;
    try {
        const setting = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
        if (setting.rows.length === 0) {
            return res.status(404).json({ message: 'Setting not found' });
        }
        res.json({ key, value: setting.rows[0].value });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Update a setting
exports.updateSetting = async (req, res) => {
    const { key } = req.params;
    const { value } = req.body;
    try {
        const updatedSetting = await pool.query(
            'UPDATE settings SET value = $1 WHERE key = $2 RETURNING *',
            [value, key]
        );
        if (updatedSetting.rows.length === 0) {
            return res.status(404).json({ message: 'Setting not found' });
        }
        res.json(updatedSetting.rows[0]);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
};

