const { TOKEN_COOKIE_NAME, verifyToken } = require('../../services/authService');

// Verifies the JWT carried in the httpOnly session cookie and attaches the
// decoded staff identity to req.staff. Applied to all /api routes except
// /api/auth/login and the ESP32 device endpoints (see app.js).
function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies[TOKEN_COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authenticated' });
  }
  try {
    req.staff = verifyToken(token);
    next();
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired session' });
  }
}

module.exports = requireAuth;
