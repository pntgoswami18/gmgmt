const { pool } = require('../../config/sqlite');

// Get all settings
exports.getAllSettings = async (req, res) => {
    console.log('getAllSettings called');
    try {
        console.log('Executing settings query...');
        const settingsResult = await pool.query('SELECT key, value FROM settings');
        console.log('Settings query result:', settingsResult.rows);
        
        const settings = {};
        for (const row of settingsResult.rows) {
            let value = row.value;
            settings[row.key] = value;
        }
        
        console.log('Final settings object:', settings);
        res.json(settings);
    } catch (err) {
        console.error('Error getting all settings', err);
        res.status(500).json({ message: 'Failed to get settings' });
    }
};

// Get a setting by key
exports.getSetting = async (req, res) => {
    const { key } = req.params;
    try {
        const setting = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
        if (setting.rows.length === 0) {
            return res.status(404).json({ message: 'Setting not found' });
        }
        let value = setting.rows[0].value;
        res.json({ key, value });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// Update multiple settings at once
exports.updateAllSettings = async (req, res) => {
    const settings = req.body;
    try {
        await pool.query('BEGIN');

        for (const key in settings) {
            if (Object.hasOwnProperty.call(settings, key)) {
                let value = settings[key];

                if (value === undefined || value === null) {
                    value = null;
                } else if (typeof value !== 'string' && typeof value !== 'number') {
                    // Store booleans and other primitives as strings in TEXT column
                    value = String(value);
                }

                const query = `
                    INSERT INTO settings (key, value)
                    VALUES ($1, $2)
                    ON CONFLICT (key) DO UPDATE
                    SET value = EXCLUDED.value;
                `;
                
                await pool.query(query, [key, value]);
            }
        }
        
        await pool.query('COMMIT');
        res.json({ message: 'Settings updated successfully' });
    } catch (err) {
        await pool.query('ROLLBACK');
        console.error('Error updating all settings', err);
        res.status(500).json({ message: 'Failed to update settings' });
    }
};

// Upload a logo
exports.uploadLogo = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ message: 'No file uploaded' });
    }
    const logoUrl = `/uploads/${req.file.filename}`;
    try {
        await pool.query('INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [ 'gym_logo', logoUrl ]);
        res.json({ message: 'Logo uploaded successfully', logoUrl });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
