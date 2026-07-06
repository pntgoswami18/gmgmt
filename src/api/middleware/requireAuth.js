const {
  TOKEN_COOKIE_NAME,
  verifyToken,
  findStaffById,
  isLocked,
} = require('../../services/authService');

// Verifies the JWT carried in the httpOnly session cookie, re-checks the staff
// row is still active/unlocked (so deactivating or locking an account revokes an
// already-issued session instead of waiting out its expiry), and attaches the
// staff identity to req.staff. Applied to all /api routes except /api/auth/login
// and the ESP32 device endpoints (see app.js). Fails closed (401) on any error,
// including a DB error on the staff lookup.
async function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[TOKEN_COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  try {
    const decoded = verifyToken(token);
    const staff = await findStaffById(decoded.sub);
    if (!staff || !staff.is_active || (await isLocked(staff))) {
      return res.status(401).json({ success: false, message: 'Invalid or expired session' });
    }
    req.staff = { id: staff.id, username: staff.username, role: staff.role };
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired session' });
  }
}

module.exports = requireAuth;
