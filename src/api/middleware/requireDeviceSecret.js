const crypto = require('crypto');

// Guards the small set of HTTP endpoints ESP32 devices call directly (they can't
// do a login flow). All devices share one secret — there's no per-device pairing
// flow today, devices self-register on first webhook/heartbeat (see devices table).
//
// If DEVICE_SHARED_SECRET is unset, the check is skipped (dev default — matches
// the unset-means-permissive pattern used for CORS_ORIGINS). Once set, every
// request to a guarded route must carry a matching X-Device-Secret header, OR
// (firmware download only) a ?device_secret= query param — the ESP32 OTA library
// doesn't make adding custom headers easy, so the backend embeds the secret
// directly in the download URL it hands the device (see firmware.js).
function requireDeviceSecret(req, res, next) {
  const expected = process.env.DEVICE_SHARED_SECRET;
  if (!expected) {
    return next();
  }

  const provided = req.headers['x-device-secret'] || req.query.device_secret;
  if (!provided) {
    return res.status(401).json({ success: false, message: 'Missing device secret' });
  }

  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(String(provided));
  const valid =
    expectedBuf.length === providedBuf.length && crypto.timingSafeEqual(expectedBuf, providedBuf);

  if (!valid) {
    return res.status(401).json({ success: false, message: 'Invalid device secret' });
  }

  next();
}

module.exports = requireDeviceSecret;
