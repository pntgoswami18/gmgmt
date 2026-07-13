const { pool, runInTransaction } = require('../../config/sqlite');
const settingsCache = require('../../services/settingsCache');
const logger = require('../../utils/logger').child({ service: 'settingsController' });
const { writeUploadedFile } = require('../../config/multer');

// Get all settings
exports.getAllSettings = async (req, res) => {
  logger.info('getAllSettings called');
  try {
    logger.info('Executing settings query...');
    const settingsResult = await pool.query('SELECT key, value FROM settings');
    logger.debug({ rowCount: settingsResult.rows.length }, 'settings query result');

    const settings = {};
    for (const { key, value: rawValue } of settingsResult.rows) {
      let value = rawValue;

      // Try to parse JSON arrays
      if (value && value.startsWith('[') && value.endsWith(']')) {
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

    logger.debug({ keyCount: Object.keys(settings).length }, 'settings loaded');
    res.json(settings);
  } catch (err) {
    logger.error({ err: err }, 'error getting all settings');
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
    await runInTransaction(async () => {
      for (const key in settings) {
        if (Object.hasOwnProperty.call(settings, key)) {
          let value = settings[key];

          if (value === undefined || value === null) {
            value = null;
          } else if (Array.isArray(value)) {
            value = JSON.stringify(value);
          } else if (typeof value !== 'string' && typeof value !== 'number') {
            value = String(value);
          }

          await pool.query('INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)', [
            key,
            value,
          ]);
        }
      }
    });

    await settingsCache.invalidate();
    res.json({ message: 'Settings updated successfully' });
  } catch (err) {
    logger.error({ err }, 'error updating all settings');
    res.status(500).json({ message: 'Failed to update settings' });
  }
};

// Upload a logo
exports.uploadLogo = async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }
  try {
    const filename = await writeUploadedFile(req.file, req.body.prefix);
    const logoUrl = `/uploads/${filename}`;
    await pool.query('INSERT OR REPLACE INTO settings(key,value) VALUES($1,$2)', [
      'gym_logo',
      logoUrl,
    ]);
    await settingsCache.invalidate();
    res.json({ message: 'Logo uploaded successfully', logoUrl });
  } catch (err) {
    if (err.statusCode) {
      res.status(err.statusCode).json({ message: err.message });
    } else {
      // Unexpected failure (e.g. fs write error) — err.message can contain
      // raw filesystem paths, so log it server-side and return a generic
      // message to avoid leaking directory layout to the client.
      logger.error({ err }, 'error uploading logo');
      res.status(500).json({ message: 'Failed to store uploaded file' });
    }
  }
};
