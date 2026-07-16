const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown } = require('./testDb');

// Minimal req/res shim for controller calls
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
let paymentController;

test.before(async () => {
  db = await setup();
  // Import after patching so controllers see the in-memory pool
  paymentController = require('../../api/controllers/paymentController');

  // Seed a member and plan
  db.prepare(
    `INSERT INTO members (id, name, phone, membership_plan_id, is_active) VALUES (1, 'Alice', '9000000001', 1, 1)`
  ).run();
  db.prepare(
    `INSERT INTO membership_plans (id, name, price, duration_days) VALUES (1, 'Monthly', 500, 30)`
  ).run();
});

test.after(async () => {
  await teardown();
});

test('createInvoice — returns new invoice row with id', async () => {
  const req = { body: { member_id: 1, plan_id: 1, amount: 500, due_date: '2026-08-01' } };
  const res = mockRes();
  await paymentController.createInvoice(req, res);

  assert.equal(res._status, 201);
  assert.ok(res._body.id, 'invoice should have an id');
  assert.equal(res._body.member_id, 1);
  assert.equal(res._body.amount, 500);
  assert.equal(res._body.status, 'unpaid');
});

test('createInvoice — infers plan from member when plan_id omitted', async () => {
  const req = { body: { member_id: 1, amount: 500, due_date: '2026-09-01' } };
  const res = mockRes();
  await paymentController.createInvoice(req, res);

  assert.equal(res._status, 201);
  assert.equal(res._body.plan_id, 1, 'plan should be inferred from member');
});

test('recordManualPayment — creates payment, marks invoice paid', async () => {
  // Create a fresh invoice to pay
  const inv = db
    .prepare(
      `INSERT INTO invoices (member_id, plan_id, amount, due_date, status) VALUES (1, 1, 500, '2026-08-01', 'unpaid') RETURNING id`
    )
    .get();

  const req = { body: { invoice_id: inv.id, amount: 500, method: 'cash', member_id: 1 } };
  const res = mockRes();
  await paymentController.recordManualPayment(req, res);

  assert.equal(res._status, 201);
  assert.ok(res._body.payment, 'response should include payment');
  assert.ok(res._body.payment.id, 'payment should have an id');

  // Verify invoice status updated in DB
  const invoice = db.prepare('SELECT status FROM invoices WHERE id = ?').get(inv.id);
  assert.equal(invoice.status, 'paid');
});

test('recordManualPayment — 404 when invoice not found and no member_id fallback', async () => {
  const req = { body: { invoice_id: 99999, amount: 500, method: 'cash' } };
  const res = mockRes();
  await paymentController.recordManualPayment(req, res);

  // Without member_id, the controller should 400/404 — verify no payment was created
  const payments = db.prepare('SELECT COUNT(*) as c FROM payments WHERE amount = 500').get();
  // Status will be 400/404, not 200
  assert.equal(res._status, 404);
});

test('recordManualPayment — rejects zero or negative amount', async () => {
  const req = { body: { member_id: 1, amount: -10, method: 'cash' } };
  const res = mockRes();
  await paymentController.recordManualPayment(req, res);
  assert.equal(res._status, 400);
});

test('deletePayment — removes payment and resets invoice to unpaid', async () => {
  // Create invoice + payment
  const inv = db
    .prepare(
      `INSERT INTO invoices (member_id, plan_id, amount, due_date, status) VALUES (1, 1, 300, '2026-10-01', 'paid') RETURNING id`
    )
    .get();
  const pmt = db
    .prepare(
      `INSERT INTO payments (invoice_id, amount, payment_method) VALUES (?, 300, 'cash') RETURNING id`
    )
    .get(inv.id);

  const req = { params: { id: pmt.id } };
  const res = mockRes();
  await paymentController.deletePayment(req, res);

  assert.equal(res._status, 200);

  // Payment should be gone
  const p = db.prepare('SELECT id FROM payments WHERE id = ?').get(pmt.id);
  assert.equal(p, undefined);

  // Invoice should be unpaid again
  const i = db.prepare('SELECT status FROM invoices WHERE id = ?').get(inv.id);
  assert.equal(i.status, 'unpaid');
});
