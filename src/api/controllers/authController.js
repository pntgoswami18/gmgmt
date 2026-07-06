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

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  maxAge: 12 * 60 * 60 * 1000,
};

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
    const maxAge = getTokenExpiryMs(token) ?? COOKIE_OPTIONS.maxAge;
    res.cookie(TOKEN_COOKIE_NAME, token, { ...COOKIE_OPTIONS, maxAge });
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
  res.clearCookie(TOKEN_COOKIE_NAME, COOKIE_OPTIONS);
  res.json({ success: true });
};

exports.me = (req, res) => {
  res.json({ success: true, staff: req.staff });
};
