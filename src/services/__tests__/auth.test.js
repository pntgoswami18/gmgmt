const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown } = require('./testDb');

function mockRes() {
  const res = { _status: 200, _body: null, _cookies: {}, _cleared: [] };
  res.status = (code) => {
    res._status = code;
    return res;
  };
  res.json = (body) => {
    res._body = body;
    return res;
  };
  res.cookie = (name, value) => {
    res._cookies[name] = value;
    return res;
  };
  res.clearCookie = (name) => {
    res._cleared.push(name);
    return res;
  };
  return res;
}

let db;
let authService;
let authController;
let requireAuth;

test.before(async () => {
  process.env.JWT_SECRET = 'test-secret';
  db = await setup();
  authService = require('../authService');
  authController = require('../../api/controllers/authController');
  requireAuth = require('../../api/middleware/requireAuth');
});

test.after(async () => {
  await teardown();
});

test('hashPassword/verifyPassword — round-trips correctly and rejects wrong password', async () => {
  const hash = await authService.hashPassword('correct-horse');
  assert.ok(await authService.verifyPassword('correct-horse', hash));
  assert.equal(await authService.verifyPassword('wrong', hash), false);
});

test('signToken/verifyToken — round-trips staff identity', () => {
  const token = authService.signToken({ id: 1, username: 'admin', role: 'admin' });
  const decoded = authService.verifyToken(token);
  assert.equal(decoded.sub, 1);
  assert.equal(decoded.username, 'admin');
  assert.equal(decoded.role, 'admin');
});

test('login — rejects unknown username', async () => {
  const req = { body: { username: 'nobody', password: 'x' } };
  const res = mockRes();
  await authController.login(req, res);

  assert.equal(res._status, 401);
  assert.equal(res._body.success, false);
});

test('login — unknown username and known username/wrong password return identical bodies', async () => {
  const hash = await authService.hashPassword('right-pass-carol');
  db.prepare(`INSERT INTO staff (username, password_hash, role) VALUES ('carol', ?, 'staff')`).run(
    hash
  );

  const unknownRes = mockRes();
  await authController.login({ body: { username: 'nobody-at-all', password: 'x' } }, unknownRes);

  const wrongPassRes = mockRes();
  await authController.login({ body: { username: 'carol', password: 'wrong' } }, wrongPassRes);

  assert.equal(unknownRes._status, wrongPassRes._status);
  assert.deepEqual(unknownRes._body, wrongPassRes._body);
});

test('login — succeeds with correct credentials and sets session cookie', async () => {
  const hash = await authService.hashPassword('s3cret!');
  db.prepare(`INSERT INTO staff (username, password_hash, role) VALUES ('alice', ?, 'staff')`).run(
    hash
  );

  const req = { body: { username: 'alice', password: 's3cret!' } };
  const res = mockRes();
  await authController.login(req, res);

  assert.equal(res._body.success, true);
  assert.ok(res._cookies[authService.TOKEN_COOKIE_NAME], 'session cookie should be set');
});

test('login — locks account after repeated failed attempts', async () => {
  const hash = await authService.hashPassword('right-pass');
  db.prepare(`INSERT INTO staff (username, password_hash, role) VALUES ('bob', ?, 'staff')`).run(
    hash
  );

  for (let i = 0; i < 5; i++) {
    const res = mockRes();
    await authController.login({ body: { username: 'bob', password: 'wrong' } }, res);
    assert.equal(res._status, 401);
  }

  const lockedRes = mockRes();
  await authController.login({ body: { username: 'bob', password: 'right-pass' } }, lockedRes);
  assert.equal(lockedRes._status, 423);
});

test('requireAuth — 401s with no cookie, passes through with a valid one', async () => {
  const alice = db.prepare(`SELECT id FROM staff WHERE username = 'alice'`).get();
  const token = authService.signToken({ id: alice.id, username: 'alice', role: 'staff' });

  const blocked = mockRes();
  let nextCalled = false;
  await requireAuth({ cookies: {} }, blocked, () => {
    nextCalled = true;
  });
  assert.equal(blocked._status, 401);
  assert.equal(nextCalled, false);

  const allowed = mockRes();
  const req = { cookies: { [authService.TOKEN_COOKIE_NAME]: token } };
  await requireAuth(req, allowed, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.equal(req.staff.username, 'alice');
});

test('requireAuth — 401s for a valid token whose staff row is deactivated', async () => {
  const hash = await authService.hashPassword('dana-pass');
  const info = db
    .prepare(
      `INSERT INTO staff (username, password_hash, role, is_active) VALUES ('dana', ?, 'staff', 0)`
    )
    .run(hash);

  const token = authService.signToken({
    id: info.lastInsertRowid,
    username: 'dana',
    role: 'staff',
  });
  const res = mockRes();
  let nextCalled = false;
  await requireAuth({ cookies: { [authService.TOKEN_COOKIE_NAME]: token } }, res, () => {
    nextCalled = true;
  });

  assert.equal(res._status, 401);
  assert.equal(nextCalled, false);
});

test('requireAuth — 401s for a valid token whose staff row is currently locked', async () => {
  const hash = await authService.hashPassword('erin-pass');
  const futureLock = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const info = db
    .prepare(
      `INSERT INTO staff (username, password_hash, role, locked_until) VALUES ('erin', ?, 'staff', ?)`
    )
    .run(hash, futureLock);

  const token = authService.signToken({
    id: info.lastInsertRowid,
    username: 'erin',
    role: 'staff',
  });
  const res = mockRes();
  let nextCalled = false;
  await requireAuth({ cookies: { [authService.TOKEN_COOKIE_NAME]: token } }, res, () => {
    nextCalled = true;
  });

  assert.equal(res._status, 401);
  assert.equal(nextCalled, false);
});
