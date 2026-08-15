const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');

// Exercises the manual auth-dispatch middleware in app.js end-to-end through
// the real Express stack (PUBLIC_PATHS / DEVICE_PATHS / FACE_STATION_PATHS /
// FACE_BOOTSTRAP_PATHS branching) — previously untested; every other test
// called controller functions directly, bypassing app.js entirely, so a
// regression in requestPath derivation or an accidental addition to
// PUBLIC_PATHS of a sensitive path would have gone undetected.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret';
process.env.DEVICE_SHARED_SECRET = process.env.DEVICE_SHARED_SECRET || 'test-device-secret';

const app = require('../../../app');

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = http.createServer(app).listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
});

test.after(async () => {
  // fetch()'s undici agent keeps sockets alive by default, which otherwise
  // stalls server.close()'s callback forever waiting for those connections
  // to end on their own — force them closed first.
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

test('GET /api/biometric/ping is reachable with no auth headers at all (PUBLIC_PATHS bypass)', async () => {
  const res = await fetch(`${baseUrl}/api/biometric/ping`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.message, 'pong');
});

test('a sibling protected biometric route still 401s with no auth (PUBLIC_PATHS bypass does not leak to other paths)', async () => {
  const res = await fetch(`${baseUrl}/api/biometric/devices`);
  assert.equal(res.status, 401);
});

test('a protected path appended as a query string on /ping is not smuggled through — requestPath strips the query string', async () => {
  const res = await fetch(`${baseUrl}/api/biometric/ping?x=/api/biometric/devices`);
  // Still resolves to plain /api/biometric/ping (public), not the appended path.
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.message, 'pong');
});

test('DEVICE_PATHS route (esp32-webhook) requires X-Device-Secret once DEVICE_SHARED_SECRET is set', async () => {
  const res = await fetch(`${baseUrl}/api/biometric/esp32-webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ device_id: 'TEST', event: 'heartbeat' }),
  });
  assert.equal(res.status, 401);
});

test('DEVICE_PATHS route accepts a valid X-Device-Secret header', async () => {
  const res = await fetch(`${baseUrl}/api/biometric/esp32-webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Device-Secret': 'test-device-secret' },
    body: JSON.stringify({ device_id: 'TEST', event: 'heartbeat' }),
  });
  assert.notEqual(res.status, 401);
});

test('FACE_STATION_PATHS route fails closed with no device secret', async () => {
  const res = await fetch(`${baseUrl}/api/biometric/face/check-in`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(res.status, 401);
});
