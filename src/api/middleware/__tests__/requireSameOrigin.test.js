const test = require('node:test');
const assert = require('node:assert/strict');

const requireSameOrigin = require('../requireSameOrigin');

function makeReq(headers) {
  return { headers };
}

function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

test('passes through requests with no Origin or Referer header', () => {
  const req = makeReq({ host: 'gym.example.com' });
  const res = makeRes();
  let nextCalled = false;

  requireSameOrigin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
  assert.equal(res.statusCode, null);
});

test('allows a request whose Origin host matches the server Host', () => {
  const req = makeReq({ host: 'gym.example.com', origin: 'https://gym.example.com' });
  const res = makeRes();
  let nextCalled = false;

  requireSameOrigin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
});

test('allows a request whose Referer host matches the server Host when Origin is absent', () => {
  const req = makeReq({
    host: 'gym.example.com',
    referer: 'https://gym.example.com/login',
  });
  const res = makeRes();
  let nextCalled = false;

  requireSameOrigin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, true);
});

test('rejects a request whose Origin host differs from the server Host', () => {
  const req = makeReq({ host: 'gym.example.com', origin: 'https://evil.example.com' });
  const res = makeRes();
  let nextCalled = false;

  requireSameOrigin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.success, false);
});

test('rejects same-registrable-domain but different-host Origin (no substring matching)', () => {
  const req = makeReq({ host: 'gym.example.com', origin: 'https://gym.example.com.evil.com' });
  const res = makeRes();
  let nextCalled = false;

  requireSameOrigin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test('rejects when Origin includes a port that the Host header does not', () => {
  const req = makeReq({ host: 'gym.example.com', origin: 'https://gym.example.com:8443' });
  const res = makeRes();
  let nextCalled = false;

  requireSameOrigin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test('rejects a malformed Origin header', () => {
  const req = makeReq({ host: 'gym.example.com', origin: 'not-a-valid-url' });
  const res = makeRes();
  let nextCalled = false;

  requireSameOrigin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});

test('rejects when Origin is present but the server Host header is missing', () => {
  const req = makeReq({ origin: 'https://gym.example.com' });
  const res = makeRes();
  let nextCalled = false;

  requireSameOrigin(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
});
