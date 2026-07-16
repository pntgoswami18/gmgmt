# Phase 4 — Code Quality: Implementation Plan

**Branch:** `phase4-code-quality` (based on `main`)

---

## Overview

Two items: replace 329 unstructured `console.*` calls with a level-gated logger
(eliminates log noise in tests, enables production log control), and add unit/
integration test coverage for the three untested flows most likely to regress.

---

## Item 10 — Structured Logging

### Problem

329 `console.log/error/warn` calls across 19 files with no level gating:

| File | Count |
|---|---|
| `services/biometricIntegration.js` | 122 |
| `api/controllers/biometricController.js` | 91 |
| `app.js` | 31 |
| `services/paymentDeactivationService.js` | 19 |
| `services/biometricListener.js` | 13 |
| `services/whatsappService.js` | 9 |
| `api/routes/firmware.js` | 8 |
| `startBiometricListener.js` | 7 |
| other files (10) | 29 |

Consequences:
- Tests emit hundreds of lines of output, hiding real failures
- No way to silence debug-level logs in production without patching
- No structured fields — searching logs by memberId, deviceId, or
  operationName requires grepping free-form strings

There are two silent `catch` blocks in `sqlite.js` worth fixing:
- **Line 423** — swallows all errors from the schema migration block (ALTER
  TABLE, UPDATE columns). A migration failure silently leaves the DB in a
  broken state and the server boots as if nothing happened.
- **Line 459** — `catch (_) {}` inside `runInTransaction` wrapping the
  ROLLBACK. This one is intentional (swallowing secondary ROLLBACK errors so
  the original error propagates); it should get a comment to make the intent
  clear.

### Chosen logger: `pino`

`pino` is the right fit here:
- Zero-cost disabled levels (debug logs are no-ops when `LOG_LEVEL=info`)
- Structured JSON output in production; pretty-printed in dev via `pino-pretty`
- Tiny surface area — `log.info({memberId}, 'checked in')` is all the API
- `pino.child({context})` for per-service sub-loggers with automatic context fields
- Widely used in Express/Node ecosystems; `better-sqlite3` projects commonly pair with it

### Logger module

Create `src/utils/logger.js`:

```js
const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'test' ? 'silent' : 'info'),
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
      : undefined,
});

module.exports = logger;
```

Key points:
- `LOG_LEVEL=silent` in test env suppresses all output automatically
- `pino-pretty` for human-readable dev/staging output; raw JSON for production
  (piped to log aggregator)
- `pino-pretty` installed as a `devDependency` — not required in production

### Migration strategy

**Do not do a mass mechanical replacement.** Instead, categorise and translate:

| Old pattern | New pattern | Rationale |
|---|---|---|
| `console.error('Error doing X:', err)` | `log.error({ err }, 'doing X failed')` | `err` as structured field, not string concat |
| `console.log('✅ Member checked in: ...')` | `log.info({ memberId }, 'member checked in')` | Strip emoji; structured fields |
| `console.log('🔌 WebSocket client connected')` | `log.debug('websocket client connected')` | Connection chatter is debug-level |
| `console.log('Biometric device connected:', addr)` | `log.info({ remoteAddress: addr }, 'biometric device connected')` | Structured |
| Startup banners (`console.log('Server running...')`) | `log.info({ port }, 'server started')` | Keep as info |

**Level assignment rules:**
- `error` — unhandled exceptions, failed DB queries, failed HTTP calls to ESP32
- `warn` — recoverable anomalies (grace period expired, unknown device, member
  already checked in today)
- `info` — normal operational events: server start, biometric device connected/
  disconnected, member check-in, payment recorded, enrollment started/completed
- `debug` — high-frequency chatter: WebSocket client connected/disconnected,
  every TCP heartbeat, per-field log lines (currently the 3–4 line `console.log`
  blocks describing a single event)

**Per-service child loggers:**

Each service/controller creates a child logger so every log line automatically
carries the service name:

```js
const logger = require('../utils/logger').child({ service: 'biometricIntegration' });
```

### Fix: sqlite.js line 423 silent catch

Change the swallowing catch to log a warning:

```js
} catch (migrationError) {
  // Migration errors are non-fatal but must be visible — a silent failure
  // here leaves the DB schema incomplete and causes runtime errors later.
  logger.warn({ err: migrationError }, 'DB schema migration step failed');
}
```

### Fix: sqlite.js line 459 intentional ROLLBACK swallow

Add a comment clarifying the intent (no behaviour change):

```js
try {
  db.exec('ROLLBACK');
} catch (_) {
  // Swallow ROLLBACK errors so the original error is what propagates.
  // A failed ROLLBACK means the transaction was already rolled back or
  // the connection is broken — either way the original error is the one
  // the caller needs to see.
}
```

### Acceptance criteria

- No `console.log/error/warn` remains in any `src/` file
- `LOG_LEVEL=silent npx jest` produces no log output from application code
- `LOG_LEVEL=debug node src/app.js` produces structured output for every
  biometric event
- The schema migration catch in sqlite.js logs a warning instead of silencing
- The ROLLBACK catch has a comment explaining the intentional swallow

---

## Item 11 — Unit and Integration Test Coverage

### Problem

Only one test file exists (`src/services/__tests__/biometricIntegration.test.js`)
with a single test case. CLAUDE.md requires unit + integration tests for all
changes. The three flows most likely to regress silently:

1. **Payment flow** — createInvoice, recordManualPayment, referral discount
   application. These touch transactions, RETURNING *, and rowCount/rows checks
   that were just changed in Phase 2–3.

2. **Member CRUD** — createMember (with and without referral), updateMember,
   UNIQUE constraint handling for phone. The error message fix in Phase 2 makes
   this a regression risk if touched again.

3. **Report queries** — financial summary with date filters, payment reminder
   list. These had SQL injection fixes in Phase 1 and a NaN-guard fix.

### Test approach

Use Node's built-in `node:test` runner (already used in the existing test file)
with `better-sqlite3` against an **in-memory database** for isolation. No mocks
for the DB — the point is to test the real query behaviour.

Each test file:
1. Creates an in-memory SQLite DB (`new Database(':memory:')`)
2. Runs the same schema init as production (`initializeDatabase`)
3. Calls the controller function with a lightweight request/response shim
4. Asserts the response status and body

### New test files

#### `src/services/__tests__/paymentFlow.test.js`

Tests for `paymentController.js`:

| Test | What it verifies |
|---|---|
| `createInvoice — creates invoice and returns it` | RETURNING * gives back the new row; `invoice.id` is set |
| `createInvoice — infers plan from member when plan_id omitted` | the plan lookup branch works |
| `recordManualPayment — creates payment and marks invoice paid` | transaction commits; invoice status updated |
| `recordManualPayment — fails if invoice not found` | 404 response; no payment row created |
| `recordManualPayment — applies referral discount` | discount deducted from amount; referral row updated |
| `deletePayment — removes payment and resets invoice` | payment deleted; invoice reverts to unpaid |

#### `src/services/__tests__/memberCrud.test.js`

Tests for `memberController.js`:

| Test | What it verifies |
|---|---|
| `createMember — creates member and returns it` | RETURNING * gives back the row with `id` |
| `createMember — rejects duplicate phone` | 409 response; error message is "already exists for this phone" |
| `createMember — fallback error message for other UNIQUE violations` | message is "A member with these details already exists." (not "email already exists") |
| `createMember — applies referral discount when referral_system_enabled` | plan amount reduced; referral row created |
| `updateMember — updates fields and returns updated row` | name/phone change reflected in response |
| `deleteMember — removes member and cleans up biometrics` | member gone; biometric rows cascade deleted |
| `setActiveStatus — deactivates member` | `is_active = 0` in DB |

#### `src/services/__tests__/reportQueries.test.js`

Tests for `reportController.js`:

| Test | What it verifies |
|---|---|
| `getFinancialSummary — date filter applies correctly` | records outside range excluded |
| `getFinancialSummary — search filter works` | member name search returns matching records only |
| `getFinancialSummary — pagination limits results` | page=1,limit=2 returns 2 records; totalPages correct |
| `getPaymentReminders — uses setting for days-after-due` | members with overdue invoices appear; others excluded |
| `getPaymentReminders — NaN-safe when setting missing` | defaults to 7 days; no crash |

### Test infrastructure

A shared helper `src/services/__tests__/testDb.js`:

```js
const Database = require('better-sqlite3');
const { initializeDatabase } = require('../../config/sqlite');

function createTestDb() {
  // Swap the module's db to an in-memory instance for the duration of the test
  // ... returns { db, cleanup }
}
```

The helper swaps the module singleton for an in-memory DB, runs schema init,
and restores the original DB in `cleanup()`. This lets the controller functions
run against real SQL without touching the on-disk DB.

### Acceptance criteria

- `npx jest src/services/__tests__/` passes with all new tests green
- No test touches the on-disk `gmgmt.sqlite`
- Tests run in under 5 seconds total (SQLite in-memory is fast)
- Each test is independent — order does not matter

---

## Execution order

1. **Install pino** — `npm install pino && npm install --save-dev pino-pretty`
2. **Create `src/utils/logger.js`** — the shared logger module
3. **Migrate logging file-by-file**, largest first:
   a. `biometricIntegration.js` (122 calls)
   b. `biometricController.js` (91 calls)
   c. `app.js` (31 calls)
   d. `paymentDeactivationService.js` (19 calls)
   e. remaining files in batch
4. **Fix sqlite.js** — migration catch and ROLLBACK comment
5. **Write test helper** (`testDb.js`)
6. **Write paymentFlow.test.js**
7. **Write memberCrud.test.js**
8. **Write reportQueries.test.js**

## Test plan

- `LOG_LEVEL=silent npx jest src/services/__tests__/ --no-coverage` — all tests pass, no log output
- `npm run dev` — verify startup logs appear in human-readable format
- `npm run biometric:start` — verify biometric events log with structured fields
- `npm run esp32:test` — existing integration tests still pass
