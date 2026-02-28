const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { pool } = require('../../config/sqlite');

const FIRMWARE_DIR = path.join(__dirname, '../../../public/uploads/firmware');
const ensureFirmwareDir = () => {
  if (!fs.existsSync(FIRMWARE_DIR)) {
    fs.mkdirSync(FIRMWARE_DIR, { recursive: true });
  }
};

ensureFirmwareDir();

// Reject state-mutating requests that come from a different origin (C1/C3 CSRF guard).
// GET /download is intentionally excluded — ESP32 fetches firmware without a browser Origin header.
function requireSameOrigin(req, res, next) {
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  if (origin || referer) {
    const host = req.headers.host;
    const source = origin || referer;
    if (!source.includes(host)) {
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
  }
  next();
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    ensureFirmwareDir();
    cb(null, FIRMWARE_DIR);
  },
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
const OTA_PENDING_TIMEOUT_MINUTES = Number.parseInt(process.env.OTA_PENDING_TIMEOUT_MINUTES || '5', 10);

async function markTimedOutFirmwareUpdates() {
  const timeoutMinutes = Number.isFinite(OTA_PENDING_TIMEOUT_MINUTES) && OTA_PENDING_TIMEOUT_MINUTES > 0
    ? OTA_PENDING_TIMEOUT_MINUTES
    : 5;

  // Auto-fail stale pending OTA jobs so UI never shows pending forever.
  return pool.query(
    `UPDATE firmware_update_log
     SET status = 'failed',
         error_message = COALESCE(error_message, ?),
         completed_at = datetime('now')
     WHERE status = 'pending'
       AND started_at <= datetime('now', '-' || ? || ' minutes')`,
    [`OTA timed out after ${timeoutMinutes} minutes without completion status`, String(timeoutMinutes)]
  );
}

const setBiometricIntegration = (integration) => {
  biometricIntegration = integration;
};

// Upload a new firmware binary
router.post('/upload', requireSameOrigin, upload.single('firmware'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No firmware file provided' });
    }

    const { version, description } = req.body;
    if (!version || !version.trim()) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'Firmware version is required' });
    }

    const uploadedAt = new Date().toISOString();
    const result = await pool.query(
      `INSERT INTO firmware_versions (version, filename, filepath, file_size, description, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [version.trim(), req.file.filename, req.file.path, req.file.size, description || null, uploadedAt]
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
    res.status(500).json({ success: false, message: 'Failed to upload firmware' });
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
    res.status(500).json({ success: false, message: 'Failed to list firmware' });
  }
});

// Download a firmware binary (used by ESP32 during OTA — no origin check required)
router.get('/download/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM firmware_versions WHERE id = ?', [id]);
    const firmware = (result.rows || [])[0];

    if (!firmware) {
      return res.status(404).json({ success: false, message: 'Firmware not found' });
    }

    // C2: Validate that filepath is within the expected firmware directory
    const resolvedPath = path.resolve(firmware.filepath);
    if (!resolvedPath.startsWith(path.resolve(FIRMWARE_DIR))) {
      console.error('Path traversal attempt blocked for firmware id:', id);
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ success: false, message: 'Firmware file missing from disk' });
    }

    // C4: Sanitize filename before inserting into Content-Disposition header
    const safeFilename = firmware.filename.replace(/["\\\r\n]/g, '_');
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${safeFilename}"`);
    res.setHeader('Content-Length', firmware.file_size);
    fs.createReadStream(resolvedPath).pipe(res);
  } catch (error) {
    console.error('Error downloading firmware:', error);
    res.status(500).json({ success: false, message: 'Failed to download firmware' });
  }
});

// Trigger OTA update on a specific device
router.post('/update/:deviceId', requireSameOrigin, async (req, res) => {
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

    // M7: Prefer SERVER_URL env var; fall back to auto-detected LAN IP
    const downloadUrl = process.env.SERVER_URL
      ? `${process.env.SERVER_URL}/api/firmware/download/${firmwareId}`
      : `http://${getServerIP()}:${process.env.PORT || 3001}/api/firmware/download/${firmwareId}`;

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
      console.error('OTA command failed:', cmdError);
      await pool.query(
        `UPDATE firmware_update_log SET status = 'failed', error_message = ?, completed_at = datetime('now') WHERE id = ?`,
        [cmdError.message, updateLogId]
      );
      return res.status(500).json({
        success: false,
        message: 'Failed to send OTA command to device'
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
    res.status(500).json({ success: false, message: 'Failed to trigger OTA update' });
  }
});

// Get update log for a device (or all devices)
router.get('/log', async (req, res) => {
  try {
    await markTimedOutFirmwareUpdates();

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
    res.status(500).json({ success: false, message: 'Failed to fetch update log' });
  }
});

// Delete a firmware version
router.delete('/:id', requireSameOrigin, async (req, res) => {
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

    // Remove log entries first to satisfy the foreign key constraint
    await pool.query('DELETE FROM firmware_update_log WHERE firmware_id = ?', [id]);
    await pool.query('DELETE FROM firmware_versions WHERE id = ?', [id]);
    res.json({ success: true, message: 'Firmware deleted successfully' });
  } catch (error) {
    console.error('Error deleting firmware:', error);
    res.status(500).json({ success: false, message: 'Failed to delete firmware' });
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
