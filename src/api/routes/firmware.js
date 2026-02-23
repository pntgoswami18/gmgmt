const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { pool } = require('../../config/sqlite');

const FIRMWARE_DIR = path.join(__dirname, '../../../public/uploads/firmware');

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, FIRMWARE_DIR),
  filename: (_req, file, cb) => {
    const unique = Date.now();
    cb(null, `firmware-${unique}${path.extname(file.originalname)}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 4 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === '.bin') {
      cb(null, true);
    } else {
      cb(new Error('Only .bin firmware files are accepted'));
    }
  }
});

let biometricIntegration = null;

const setBiometricIntegration = (integration) => {
  biometricIntegration = integration;
};

// Upload a new firmware binary
router.post('/upload', upload.single('firmware'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No firmware file provided' });
    }

    const { version, description } = req.body;
    if (!version || !version.trim()) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'Firmware version is required' });
    }

    const result = await pool.query(
      `INSERT INTO firmware_versions (version, filename, filepath, file_size, description)
       VALUES (?, ?, ?, ?, ?)`,
      [version.trim(), req.file.filename, req.file.path, req.file.size, description || null]
    );

    res.json({
      success: true,
      message: 'Firmware uploaded successfully',
      firmware: {
        id: result.lastInsertId,
        version: version.trim(),
        filename: req.file.filename,
        file_size: req.file.size,
        description: description || null
      }
    });
  } catch (error) {
    console.error('Error uploading firmware:', error);
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    res.status(500).json({ success: false, message: 'Failed to upload firmware', error: error.message });
  }
});

// List all uploaded firmware versions
router.get('/list', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM firmware_versions ORDER BY uploaded_at DESC'
    );
    res.json({ success: true, firmwares: result.rows || [] });
  } catch (error) {
    console.error('Error listing firmware:', error);
    res.status(500).json({ success: false, message: 'Failed to list firmware', error: error.message });
  }
});

// Download a firmware binary (used by ESP32 during OTA)
router.get('/download/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM firmware_versions WHERE id = ?', [id]);
    const firmware = (result.rows || [])[0];

    if (!firmware) {
      return res.status(404).json({ success: false, message: 'Firmware not found' });
    }

    const filePath = firmware.filepath;
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'Firmware file missing from disk' });
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${firmware.filename}"`);
    res.setHeader('Content-Length', firmware.file_size);
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    console.error('Error downloading firmware:', error);
    res.status(500).json({ success: false, message: 'Failed to download firmware', error: error.message });
  }
});

// Trigger OTA update on a specific device
router.post('/update/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { firmwareId } = req.body;

    if (!firmwareId) {
      return res.status(400).json({ success: false, message: 'firmwareId is required' });
    }

    if (!biometricIntegration) {
      return res.status(503).json({ success: false, message: 'Biometric service not available' });
    }

    const fwResult = await pool.query('SELECT * FROM firmware_versions WHERE id = ?', [firmwareId]);
    const firmware = (fwResult.rows || [])[0];
    if (!firmware) {
      return res.status(404).json({ success: false, message: 'Firmware version not found' });
    }

    // Build the download URL that the ESP32 will fetch from
    const serverPort = process.env.PORT || 3001;
    const serverIP = await getServerIP();
    const downloadUrl = `http://${serverIP}:${serverPort}/api/firmware/download/${firmwareId}`;

    // Log the update attempt
    const logResult = await pool.query(
      `INSERT INTO firmware_update_log (device_id, firmware_id, status) VALUES (?, ?, 'pending')`,
      [deviceId, firmwareId]
    );
    const updateLogId = logResult.lastInsertId;

    // Send OTA command to the device
    try {
      await biometricIntegration.sendESP32Command(deviceId, 'ota_update', {
        url: downloadUrl,
        version: firmware.version,
        updateLogId
      });
    } catch (cmdError) {
      await pool.query(
        `UPDATE firmware_update_log SET status = 'failed', error_message = ?, completed_at = datetime('now') WHERE id = ?`,
        [cmdError.message, updateLogId]
      );
      return res.status(500).json({
        success: false,
        message: 'Failed to send OTA command to device',
        error: cmdError.message
      });
    }

    res.json({
      success: true,
      message: `OTA update triggered for device ${deviceId} with firmware v${firmware.version}`,
      updateLogId,
      downloadUrl
    });
  } catch (error) {
    console.error('Error triggering OTA update:', error);
    res.status(500).json({ success: false, message: 'Failed to trigger OTA update', error: error.message });
  }
});

// Get update log for a device (or all devices)
router.get('/log', async (req, res) => {
  try {
    const { deviceId } = req.query;
    let query = `SELECT ful.*, fv.version as firmware_version
                 FROM firmware_update_log ful
                 JOIN firmware_versions fv ON ful.firmware_id = fv.id`;
    const params = [];

    if (deviceId) {
      query += ' WHERE ful.device_id = ?';
      params.push(deviceId);
    }
    query += ' ORDER BY ful.started_at DESC LIMIT 50';

    const result = await pool.query(query, params);
    res.json({ success: true, logs: result.rows || [] });
  } catch (error) {
    console.error('Error fetching update log:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch update log', error: error.message });
  }
});

// Delete a firmware version
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM firmware_versions WHERE id = ?', [id]);
    const firmware = (result.rows || [])[0];

    if (!firmware) {
      return res.status(404).json({ success: false, message: 'Firmware not found' });
    }

    if (fs.existsSync(firmware.filepath)) {
      fs.unlinkSync(firmware.filepath);
    }

    await pool.query('DELETE FROM firmware_versions WHERE id = ?', [id]);
    res.json({ success: true, message: 'Firmware deleted successfully' });
  } catch (error) {
    console.error('Error deleting firmware:', error);
    res.status(500).json({ success: false, message: 'Failed to delete firmware', error: error.message });
  }
});

function getServerIP() {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

module.exports = router;
module.exports.setBiometricIntegration = setBiometricIntegration;
