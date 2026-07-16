# Phase 2 — Data Integrity: Implementation Plan

**Branch:** `phase2-data-integrity` (based on `phase1-security`)

---

## Overview

Three bugs that can produce silent data corruption under concurrent load, or mislead callers with wrong error messages.

---

## Item 5 — `runInTransaction` mutex (`src/config/sqlite.js`)

### Problem

`runInTransaction` issues `db.exec('BEGIN')` then `await callback()` on the single shared SQLite connection. Node's event loop can interleave two concurrent calls:

```
Request A: BEGIN
Request B: BEGIN        ← SQLite throws "cannot start a transaction within a transaction"
Request A: (work)       ← or: B's COMMIT closes A's transaction
Request A: COMMIT
```

Result: one of the two requests gets a thrown error or an incomplete transaction silently committed.

### Root cause

better-sqlite3 is synchronous; its own `.transaction()` helper only supports synchronous callbacks and will commit immediately after the first `await`. We need explicit BEGIN/COMMIT, but those must be serialized so no two transactions overlap on the single connection.

### Fix

Add an async mutex via a promise chain at module level in `sqlite.js`:

```js
let _txQueue = Promise.resolve();

async function runInTransaction(callback) {
  let resolve;
  const ticket = new Promise((r) => { resolve = r; });
  const prev = _txQueue;
  _txQueue = ticket;

  await prev; // wait for any in-flight transaction to finish
  db.exec('BEGIN');
  try {
    const result = await callback();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    resolve(); // unblock the next queued transaction
  }
}
```

Any number of concurrent callers queue up; each BEGIN/COMMIT pair completes without interleaving.

### Acceptance criteria

- Two simultaneous `runInTransaction` calls complete without throwing "cannot start a transaction within a transaction".
- The second call's result reflects the first call's committed state (serialized, not interleaved).
- A failing transaction in one call does not affect the other (ROLLBACK is isolated).

---

## Item 6 — Replace `SELECT ORDER BY id DESC LIMIT 1` with `RETURNING *` (10 locations)

### Problem

All INSERT operations are followed by a separate `SELECT … ORDER BY id DESC LIMIT 1` to retrieve the inserted row. Under concurrent traffic, the SELECT can return a _different_ request's row inserted in the gap between the INSERT and the SELECT.

### Root cause

The pattern predates SQLite's `RETURNING` clause. `execute()` in `sqlite.js` already handles `RETURNING` (checks `hasReturning` and routes to `.all()`), so no infrastructure change is needed — only the INSERT queries need updating.

### Fix

Append `RETURNING *` to each INSERT and use the returned row directly. Remove the follow-up SELECT.

**Pattern:**

```js
// Before
await pool.query('INSERT INTO foo (col) VALUES (?)', [val]);
const row = await pool.query('SELECT * FROM foo ORDER BY id DESC LIMIT 1');
return row.rows[0];

// After
const result = await pool.query('INSERT INTO foo (col) VALUES (?) RETURNING *', [val]);
return result.rows[0];
```

**Affected locations (10 total):**

| File | Context |
|---|---|
| `src/api/controllers/memberController.js:287` | `createMember` — INSERT members |
| `src/api/controllers/paymentController.js:41` | `createInvoice` — INSERT invoices |
| `src/api/controllers/paymentController.js:86` | `recordManualPayment` — INSERT invoices (auto-create path) |
| `src/api/controllers/paymentController.js:100` | `recordManualPayment` — INSERT invoices (missing invoice path) |
| `src/api/controllers/paymentController.js:112` | `recordManualPayment` — INSERT payments |
| `src/api/controllers/classController.js:55` | `createClass` — INSERT classes |
| `src/api/controllers/scheduleController.js:37` | `createSchedule` — INSERT class_schedules |
| `src/api/controllers/bookingController.js:18` | `createBooking` — INSERT bookings |
| `src/api/controllers/attendanceController.js:97` | `checkIn` — INSERT attendance |
| `src/api/controllers/planController.js:4` | `createPlan` — INSERT membership_plans |

### Acceptance criteria

- Each INSERT returns the actual inserted row without a follow-up SELECT.
- The `id` in the response matches the row actually inserted by that request (not a concurrent request's row).
- No `ORDER BY id DESC LIMIT 1` remains in any controller for the purpose of fetching a just-inserted row.

---

## Item 7 — Fix misleading UNIQUE-violation error messages (`src/api/controllers/memberController.js`)

### Problem

Two locations (`createMember` line 311 and `updateMember` line 398) catch UNIQUE constraint violations and produce a message. The else-branch says "A member with this email already exists" — but email is never included in the INSERT or UPDATE column lists, so that branch is dead code. Any UNIQUE violation not on `phone` would surface with a confusing email message.

### Root cause

The error handler was written when email was a unique field. Email was later removed from mutations but the error message wasn't updated.

### Fix

In both catch blocks, use the phone branch if the error message names `phone`, otherwise fall back to a generic constraint message:

```js
const msg = lowered.includes('phone')
  ? 'A member with this phone number already exists.'
  : 'A member with this name or details already exists.';
```

This is accurate for all reachable cases (only `ux_members_phone` partial unique index and `members.email` UNIQUE can fire, and email is never set in mutations).

### Acceptance criteria

- POST `/api/members` with a duplicate phone number → 409 with "phone number already exists"
- POST `/api/members` with a duplicate email (if somehow set) → 409 with generic message, not "email already exists"
- No reference to email in member UNIQUE error messages when email is not part of the mutation

---

## Execution order

1. **Item 5** (`sqlite.js`) — independent, no file conflicts
2. **Item 6** (10 controller files) — independent of Item 5; can run in parallel
3. **Item 7** (`memberController.js`) — overlaps with Item 6 (same file); apply after Item 6's memberController change

## Test plan

- Run `npx jest src/services/__tests__/` — existing tests must still pass
- Run `npm run esp32:test` — ESP32 integration tests must pass
- Manual: create two members with the same phone → confirm 409 + correct message
- Manual: record a manual payment → confirm returned `id` is correct
- Manual: two simultaneous payment POSTs → confirm both complete without error
