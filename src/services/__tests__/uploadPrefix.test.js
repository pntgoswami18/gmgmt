const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePrefix, sanitizePrefix } = require('../../config/multer');

test('resolvePrefix — invokes getPrefix(req) and flows its return value into the sanitized prefix', () => {
  const req = { params: { id: '42' } };
  const getPrefix = (r) => `member-${r.params.id || 'unknown'}`;

  const base = resolvePrefix(req, getPrefix);

  assert.equal(base, 'member-42');
});

test('resolvePrefix — sanitizes characters returned by getPrefix', () => {
  const req = { params: { id: '../../etc/passwd' } };
  const getPrefix = (r) => `member-${r.params.id}`;

  const base = resolvePrefix(req, getPrefix);

  // Path separators and dots must be stripped so the value is safe to use
  // in a filename.
  assert.equal(base, sanitizePrefix(`member-${req.params.id}`));
  assert.ok(!base.includes('/'));
  assert.ok(!base.includes('..'));
});

test('resolvePrefix — falls back to default prefix when no getPrefix is supplied', () => {
  const req = { params: {} };

  const base = resolvePrefix(req, undefined);

  assert.equal(base, 'upload');
});

test('resolvePrefix — falls back to "unknown" segment when req.params.id is missing', () => {
  const req = { params: {} };
  const getPrefix = (r) => `member-${r.params.id || 'unknown'}`;

  const base = resolvePrefix(req, getPrefix);

  assert.equal(base, 'member-unknown');
});

test('resolvePrefix — propagates a getPrefix error to the caller instead of swallowing it', () => {
  const req = { params: { id: '42' } };
  const getPrefix = () => {
    throw new Error('boom');
  };

  assert.throws(() => resolvePrefix(req, getPrefix), /boom/);
});

test('resolvePrefix error — caller can catch and surface it via a multer-style cb(err) callback', () => {
  const req = { params: { id: '42' } };
  const getPrefix = () => {
    throw new Error('getPrefix exploded');
  };

  // Mirrors the try/catch wrapping done in multer.js's filename callback:
  // any thrown error must be routed through cb(err), not left to escape
  // and crash/hang the request.
  let cbErr = null;
  let cbFilename = null;
  function cb(err, filename) {
    cbErr = err;
    cbFilename = filename;
  }

  try {
    const base = resolvePrefix(req, getPrefix);
    cb(null, base);
  } catch (e) {
    cb(e);
  }

  assert.ok(cbErr instanceof Error);
  assert.equal(cbErr.message, 'getPrefix exploded');
  assert.equal(cbFilename, undefined);
});
