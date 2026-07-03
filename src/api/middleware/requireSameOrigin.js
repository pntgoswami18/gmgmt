// Reject state-mutating requests that come from a different origin (CSRF guard).
//
// Requests without an Origin or Referer header pass through untouched — this is
// intentional so non-browser clients (ESP32 devices fetching firmware, curl, the
// biometric listener) keep working. Only a browser request whose Origin/Referer
// host does not match the server Host is rejected.
function requireSameOrigin(req, res, next) {
  const origin = req.headers.origin;
  const referer = req.headers.referer;
  if (origin || referer) {
    const host = req.headers.host;
    const source = origin || referer;
    try {
      const sourceHost = new URL(source).host;
      if (!host || sourceHost !== host) {
        return res.status(403).json({ success: false, message: 'Forbidden' });
      }
    } catch {
      // Malformed Origin/Referer — reject
      return res.status(403).json({ success: false, message: 'Forbidden' });
    }
  }
  next();
}

module.exports = requireSameOrigin;
