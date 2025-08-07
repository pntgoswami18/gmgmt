const pool = require('../../config/database');

// Get a setting by key
exports.getSetting = async (req, res) => {
    const { key } = req.params;
    try {
        const setting = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
        if (setting.rows.length === 0) {
            return res.status(404).json({ message: 'Setting not found' });
        }
        let value = setting.rows[0].value;
        if (key === 'membership_types') {
            value = JSON.parse(value);
        }
        res.json({ key, value });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Update a setting
exports.updateSetting = async (req, res) => {
    const { key } = req.params;
    let { value } = req.body;
    console.log(`Updating setting: ${key} to ${value}`); // Added logging
    try {
        if (key === 'membership_types') {
            value = JSON.stringify(value);
        }
        const updatedSetting = await pool.query(
            'UPDATE settings SET value = $1 WHERE key = $2 RETURNING *',
            [value, key]
        );
        if (updatedSetting.rows.length === 0) {
            // If the setting doesn't exist, create it
            const newSetting = await pool.query(
                'INSERT INTO settings (key, value) VALUES ($1, $2) RETURNING *',
                [key, value]
            );
            return res.json(newSetting.rows[0]);
        }
        res.json(updatedSetting.rows[0]);
    } catch (err) {
        console.error(`Error updating setting: ${key}`, err); // Added error logging
        res.status(400).json({ message: err.message });
    }
};

// Upload a logo
exports.uploadLogo = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
    }
    const logoUrl = `/uploads/${req.file.filename}`;
    try {
        await pool.query('UPDATE settings SET value = $1 WHERE key = $2', [logoUrl, 'gym_logo']);
        res.json({ message: 'Logo uploaded successfully', logoUrl });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
