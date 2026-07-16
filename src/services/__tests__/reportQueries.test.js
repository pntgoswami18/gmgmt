const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown } = require('./testDb');
const settingsCache = require('../../services/settingsCache');

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
let reportController;

test.before(async () => {
  db = await setup();
  reportController = require('../../api/controllers/reportController');

  // Seed two members, a plan, invoices, and payments
  db.prepare(
    `INSERT INTO members (id, name, phone, is_active, is_admin) VALUES (1, 'Alice', '9000000001', 1, 0)`
  ).run();
  db.prepare(
    `INSERT INTO members (id, name, phone, is_active, is_admin) VALUES (2, 'Bob', '9000000002', 1, 0)`
  ).run();
  db.prepare(
    `INSERT INTO membership_plans (id, name, price, duration_days) VALUES (1, 'Monthly', 500, 30)`
  ).run();

  // Paid invoice for Alice on 2026-01-10
  db.prepare(
    `INSERT INTO invoices (id, member_id, plan_id, amount, due_date, status) VALUES (1, 1, 1, 500, '2026-01-10', 'paid')`
  ).run();
  db.prepare(
    `INSERT INTO payments (invoice_id, amount, payment_date, payment_method) VALUES (1, 500, '2026-01-10', 'cash')`
  ).run();

  // Paid invoice for Bob on 2026-03-15
  db.prepare(
    `INSERT INTO invoices (id, member_id, plan_id, amount, due_date, status) VALUES (2, 2, 1, 500, '2026-03-15', 'paid')`
  ).run();
  db.prepare(
    `INSERT INTO payments (invoice_id, amount, payment_date, payment_method) VALUES (2, 500, '2026-03-15', 'cash')`
  ).run();

  // Overdue unpaid invoice for Bob (due 60 days ago)
  db.prepare(
    `INSERT INTO invoices (id, member_id, plan_id, amount, due_date, status)
     VALUES (3, 2, 1, 500, date('now', '-60 days'), 'unpaid')`
  ).run();
});

test.after(async () => {
  await teardown();
});

test('getFinancialSummary — date filter excludes records outside range', async () => {
  const req = { query: { startDate: '2026-01-01', endDate: '2026-01-31', table: 'payments' } };
  const res = mockRes();
  await reportController.getFinancialSummary(req, res);

  assert.equal(res._status, 200);
  // Only Alice's Jan payment should appear; Bob's March payment should not
  const names = res._body.paymentHistory.map((r) => r.member_name);
  assert.ok(names.includes('Alice'), 'Alice January payment should be included');
  assert.ok(!names.includes('Bob'), 'Bob March payment should be excluded');
});

test('getFinancialSummary — search filter matches by member name', async () => {
  const req = { query: { search: 'bob', table: 'payments' } };
  const res = mockRes();
  await reportController.getFinancialSummary(req, res);

  assert.equal(res._status, 200);
  const names = res._body.paymentHistory.map((r) => r.member_name);
  assert.ok(
    names.every((n) => n.toLowerCase().includes('bob')),
    'only Bob records expected'
  );
});

test('getFinancialSummary — pagination limits rows returned', async () => {
  const req = { query: { table: 'payments', page: '1', limit: '1' } };
  const res = mockRes();
  await reportController.getFinancialSummary(req, res);

  assert.equal(res._status, 200);
  assert.equal(res._body.paymentHistory.length, 1, 'limit=1 should return exactly 1 row');
  assert.ok(res._body.paymentHistoryTotal >= 2, 'total should reflect all records');
});

test('getFinancialSummary — rejects invalid date format', async () => {
  const req = { query: { startDate: '01-01-2026', table: 'payments' } };
  const res = mockRes();
  await reportController.getFinancialSummary(req, res);

  assert.equal(res._status, 400);
});

test('getPaymentReminders — returns overdue invoices using settings value', async () => {
  // Default setting is 7 days; Bob's invoice is 60 days overdue — should appear
  const req = {};
  const res = mockRes();
  await reportController.getPaymentReminders(req, res);

  assert.equal(res._status, 200);
  assert.ok(Array.isArray(res._body.overdue_invoices));
  const memberIds = res._body.overdue_invoices.map((r) => r.member_id);
  assert.ok(memberIds.includes(2), "Bob's overdue invoice should appear in reminders");
  assert.equal(res._body.reminder_days, 7);
});

test('getPaymentReminders — NaN-safe: missing setting falls back to 7 days', async () => {
  // Remove the setting to simulate a corrupt/missing value
  db.prepare(`DELETE FROM settings WHERE key = 'payment_reminder_days_after_due'`).run();
  await settingsCache.refresh();

  const req = {};
  const res = mockRes();
  await reportController.getPaymentReminders(req, res);

  assert.equal(res._status, 200);
  assert.equal(res._body.reminder_days, 7, 'should default to 7 when setting is missing');

  // Restore for other tests
  db.prepare(
    `INSERT INTO settings(key, value) VALUES ('payment_reminder_days_after_due', '7')`
  ).run();
  await settingsCache.refresh();
});
