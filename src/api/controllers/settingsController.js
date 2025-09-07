const { pool } = require('../../config/sqlite');

// Get all settings
exports.getAllSettings = async (req, res) => {
    console.log('getAllSettings called');
    try {
        console.log('Executing settings query...');
        const settingsResult = await pool.query('SELECT key, value FROM settings');
        console.log('Settings query result:', settingsResult.rows);
        
        const settings = {};
        for (const { key, value: rawValue } of settingsResult.rows) {
            let value = rawValue;
            
            // Try to parse JSON arrays
            if (value && (value.startsWith('[') && value.endsWith(']'))) {
                try {
                    value = JSON.parse(value);
                } catch (e) {
                    // If parsing fails, keep the original string value
                }
            }
            
            settings[key] = value;
        }
        
        // Add environment-based settings that are not stored in database
        settings.main_server_port = process.env.PORT || '3001';
        settings.biometric_port_env = process.env.BIOMETRIC_PORT || '8080';
        settings.biometric_host_env = process.env.BIOMETRIC_HOST || '0.0.0.0';
        
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
                } else if (Array.isArray(value)) {
                    // Store arrays as JSON strings
                    value = JSON.stringify(value);
                } else if (typeof value !== 'string' && typeof value !== 'number') {
                    // Store booleans and other primitives as strings in TEXT column
                    value = String(value);
                }

                const query = `
                    INSERT OR REPLACE INTO settings (key, value)
                    VALUES ($1, $2);
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
        await pool.query('INSERT OR REPLACE INTO settings(key,value) VALUES($1,$2)', [ 'gym_logo', logoUrl ]);
        res.json({ message: 'Logo uploaded successfully', logoUrl });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};
