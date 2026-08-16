const {
  TOKEN_COOKIE_NAME,
  verifyPassword,
  signToken,
  getTokenExpiryMs,
  findStaffByUsername,
  getHashToCompare,
  isLocked,
  recordFailedAttempt,
  recordSuccessfulLogin,
} = require('../../services/authService');
const logger = require('../../utils/logger').child({ service: 'authController' });

const BASE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  maxAge: 12 * 60 * 60 * 1000,
};

// `secure` must reflect whether THIS request is actually HTTPS, not just
// NODE_ENV — this app's typical deployment (Windows Service, LAN-only,
// no TLS termination) runs with NODE_ENV=production over plain HTTP. Hardcoding
// secure:true there set a cookie the browser would silently refuse to send
// back on every subsequent request: login looked successful (200 + Set-Cookie)
// but the session never actually persisted.
function cookieOptions(req) {
  return { ...BASE_COOKIE_OPTIONS, secure: req.secure };
}

exports.login = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ success: false, message: 'Username and password required' });
    }

    // Always run bcrypt, even for an unknown/inactive username (against a fixed
    // dummy hash) — otherwise the fast 401 for "no such user" is distinguishable
    // by response time from the slow 401 for "wrong password", leaking which
    // usernames exist. See getHashToCompare in authService.
    const staff = await findStaffByUsername(username);
    const valid = await verifyPassword(password, getHashToCompare(staff));

    if (!staff || !staff.is_active) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (await isLocked(staff)) {
      return res
        .status(423)
        .json({ success: false, message: 'Account temporarily locked. Try again later.' });
    }

    if (!valid) {
      await recordFailedAttempt(staff);
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    await recordSuccessfulLogin(staff);
    const token = signToken(staff);
    const options = cookieOptions(req);
    const maxAge = getTokenExpiryMs(token) ?? options.maxAge;
    res.cookie(TOKEN_COOKIE_NAME, token, { ...options, maxAge });
    res.json({
      success: true,
      staff: { id: staff.id, username: staff.username, role: staff.role },
    });
  } catch (error) {
    logger.error({ err: error }, 'login failed');
    res.status(500).json({ success: false, message: 'Login failed' });
  }
};

exports.logout = (req, res) => {
  res.clearCookie(TOKEN_COOKIE_NAME, cookieOptions(req));
  res.json({ success: true });
};

exports.me = (req, res) => {
  res.json({ success: true, staff: req.staff });
};
