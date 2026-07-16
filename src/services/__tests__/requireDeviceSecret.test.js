const test = require('node:test');
const assert = require('node:assert/strict');
const requireDeviceSecret = require('../../api/middleware/requireDeviceSecret');

function mockRes() {
  const res = { _status: 200, _body: null };
  res.status = (code) => {
    res._status = code;
    return res;
  };
  res.json = (body) => {
    res._body = body;
    return res;
  };
  return res;
}

test('requireDeviceSecret — skips check when DEVICE_SHARED_SECRET is unset', () => {
  delete process.env.DEVICE_SHARED_SECRET;
  let nextCalled = false;
  requireDeviceSecret({ headers: {}, query: {} }, mockRes(), () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
});

test('requireDeviceSecret — 401s when secret is set but header/query missing', () => {
  process.env.DEVICE_SHARED_SECRET = 'topsecret';
  const res = mockRes();
  let nextCalled = false;
  requireDeviceSecret({ headers: {}, query: {} }, res, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(res._status, 401);
  delete process.env.DEVICE_SHARED_SECRET;
});

test('requireDeviceSecret — 401s on wrong header value', () => {
  process.env.DEVICE_SHARED_SECRET = 'topsecret';
  const res = mockRes();
  requireDeviceSecret({ headers: { 'x-device-secret': 'wrong' }, query: {} }, res, () => {});
  assert.equal(res._status, 401);
  delete process.env.DEVICE_SHARED_SECRET;
});

test('requireDeviceSecret — passes with correct header value', () => {
  process.env.DEVICE_SHARED_SECRET = 'topsecret';
  let nextCalled = false;
  requireDeviceSecret({ headers: { 'x-device-secret': 'topsecret' }, query: {} }, mockRes(), () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  delete process.env.DEVICE_SHARED_SECRET;
});

test('requireDeviceSecret — passes with correct query param (firmware download path)', () => {
  process.env.DEVICE_SHARED_SECRET = 'topsecret';
  let nextCalled = false;
  requireDeviceSecret({ headers: {}, query: { device_secret: 'topsecret' } }, mockRes(), () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  delete process.env.DEVICE_SHARED_SECRET;
});
