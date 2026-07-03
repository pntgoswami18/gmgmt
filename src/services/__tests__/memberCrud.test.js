const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown } = require('./testDb');

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

let db;
let memberController;

test.before(async () => {
  db = await setup();
  memberController = require('../../api/controllers/memberController');

  db.prepare(
    `INSERT INTO membership_plans (id, name, price, duration_days) VALUES (1, 'Monthly', 500, 30)`
  ).run();
});

test.after(async () => {
  await teardown();
});

test('createMember — returns new member row with id', async () => {
  const req = { body: { name: 'Bob', phone: '9100000001', membership_plan_id: 1 } };
  const res = mockRes();
  await memberController.createMember(req, res);

  assert.equal(res._status, 201);
  assert.ok(res._body.id, 'member should have an id');
  assert.equal(res._body.name, 'Bob');
  assert.equal(res._body.is_active, 1);
});

test('createMember — rejects duplicate phone with correct message', async () => {
  // First member created with this phone
  db.prepare(`INSERT INTO members (name, phone) VALUES ('Carol', '9100000002')`).run();

  const req = { body: { name: 'Carol2', phone: '9100000002' } };
  const res = mockRes();
  await memberController.createMember(req, res);

  assert.equal(res._status, 409);
  assert.ok(
    res._body.message.toLowerCase().includes('phone'),
    `expected phone error, got: ${res._body.message}`
  );
});

test('createMember — fallback UNIQUE error message is not "email already exists"', async () => {
  // Simulate a UNIQUE violation on a non-phone column by inserting email duplicate
  db.prepare(
    `INSERT INTO members (name, phone, email) VALUES ('Dave', '9100000099', 'dup@test.com')`
  ).run();

  const req = { body: { name: 'Dave2', phone: '9100000098', email: 'dup@test.com' } };
  const res = mockRes();
  await memberController.createMember(req, res);

  if (res._status === 409) {
    assert.ok(
      !res._body.message.toLowerCase().includes('email already exists'),
      `legacy "email already exists" message must not appear: ${res._body.message}`
    );
  }
  // If no UNIQUE on email in schema (email is UNIQUE in our schema), this verifies the fallback path
});

test('updateMember — updates name and returns updated row', async () => {
  const ins = db
    .prepare(`INSERT INTO members (name, phone) VALUES ('Eve', '9100000003') RETURNING id`)
    .get();

  const req = { params: { id: ins.id }, body: { name: 'Eve Updated' } };
  const res = mockRes();
  await memberController.updateMember(req, res);

  assert.equal(res._status, 200);
  assert.equal(res._body.name, 'Eve Updated');
  assert.equal(res._body.id, ins.id);
});

test('deleteMember — removes member and cascades biometric rows', async () => {
  const ins = db
    .prepare(`INSERT INTO members (name, phone) VALUES ('Frank', '9100000004') RETURNING id`)
    .get();
  db.prepare(`INSERT INTO member_biometrics (member_id, device_user_id) VALUES (?, 'slot-42')`).run(
    ins.id
  );

  const req = { params: { id: ins.id } };
  const res = mockRes();
  await memberController.deleteMember(req, res);

  assert.equal(res._status, 200);

  const m = db.prepare('SELECT id FROM members WHERE id = ?').get(ins.id);
  assert.equal(m, undefined, 'member should be deleted');

  const bio = db.prepare('SELECT id FROM member_biometrics WHERE member_id = ?').get(ins.id);
  assert.equal(bio, undefined, 'biometric rows should cascade delete');
});

test('setActiveStatus — deactivates a member', async () => {
  const ins = db
    .prepare(
      `INSERT INTO members (name, phone, is_active) VALUES ('Grace', '9100000005', 1) RETURNING id`
    )
    .get();

  const req = { params: { id: ins.id }, body: { is_active: false } };
  const res = mockRes();
  await memberController.setActiveStatus(req, res);

  assert.equal(res._status, 200);

  const m = db.prepare('SELECT is_active FROM members WHERE id = ?').get(ins.id);
  assert.equal(m.is_active, 0);
});
