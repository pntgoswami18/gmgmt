# Phase 3 — Performance & Consistency: Implementation Plan

**Branch:** `phase3-perf` (based on `main`)

---

## Overview

Two items: one performance fix with real latency impact (settings cache), one consistency cleanup (DB result contract) to reduce confusion and future bugs.

---

## Item 8 — Generalize `settingsCache` (`src/services/settingsCache.js`)

### Problem

The current `SettingsCache` only caches 2 of the ~25 settings keys:
- `payment_grace_period_days`
- `cross_session_checkin_restriction`

Every other settings read hits the DB directly on each request. The hot paths:

| Location | Keys read per call | Called when |
|---|---|---|
| `attendanceController.js:20` | 5 (`morning_session_start/end`, `evening_session_start/end`, `cross_session_checkin_restriction`) | Every check-in |
| `biometricController.js:1779` | 4+ session/payment keys | Every biometric door scan |
| `biometricIntegration.js:164` | 4+ keys | Every TCP event from ESP32 |
| `reportController.js:373` | `payment_reminder_days_after_due` | Every reminder list load |
| `referralController.js:17,25` | `referral_system_enabled`, `referral_discount_amount` | Every referral check |
| `memberController.js:216` | `referral_system_enabled` | Every member create |
| `utils/dateUtils.js:152` | `payment_grace_period_days` | Already cached — remove direct read |
| `whatsappService.js:21,31,182,183` | `whatsapp_welcome_enabled`, `whatsapp_welcome_message` | Every biometric enrollment |

### Fix

**Expand `settingsCache` to a full key/value map** loaded once at startup and refreshed every 5 minutes (same cadence as now). Add a generic `get(key, defaultValue)` method. Add explicit `invalidate()` call in `settingsController.updateAllSettings` so settings changes take effect immediately without waiting for the auto-refresh.

#### Changes to `settingsCache.js`

```js
async refresh() {
  // Load ALL settings, not just 2 keys
  const result = await pool.query('SELECT key, value FROM settings');
  const map = new Map(result.rows.map(r => [r.key, r.value]));
  this._map = map;
  this._lastUpdate = Date.now();
}

get(key, defaultValue = null) {
  return this._map.has(key) ? this._map.get(key) : defaultValue;
}

getBoolean(key, defaultValue = false) {
  const v = this.get(key);
  if (v === null || v === undefined) return defaultValue;
  return v === 'true' || v === true;
}

getInt(key, defaultValue = 0) {
  const v = parseInt(this.get(key), 10);
  return Number.isFinite(v) ? v : defaultValue;
}
```

Keep `getGracePeriodDays()` and `getCrossSessionEnabled()` as thin wrappers over `get()` for backward compatibility with existing callers in `biometricController.js`.

#### Changes to `settingsController.js`

After a successful `updateAllSettings`, call `settingsCache.invalidate()` so the cache immediately reflects the new values:

```js
const settingsCache = require('../../services/settingsCache');
// ... at end of updateAllSettings after pool.query('COMMIT'):
await settingsCache.invalidate();
```

#### Replace direct DB reads

Replace each `pool.query('SELECT value FROM settings WHERE key = ?', [key])` call with `settingsCache.get(key, default)`:

| File | Current | Replacement |
|---|---|---|
| `attendanceController.js:20` | 5-key IN query | `settingsCache.get(key, default)` ×5 |
| `biometricController.js:1779` | 4-key IN query | `settingsCache.get(key, default)` ×4 |
| `biometricIntegration.js:164` | 4-key IN query | `settingsCache.get(key, default)` ×4 |
| `reportController.js:373` | single key | `settingsCache.getInt('payment_reminder_days_after_due', 7)` |
| `referralController.js:17,25` | two single-key queries | `settingsCache.getBoolean(...)`, `settingsCache.getInt(...)` |
| `memberController.js:216` | single key | `settingsCache.getBoolean('referral_system_enabled', false)` |
| `utils/dateUtils.js:152` | single key | `settingsCache.getInt('payment_grace_period_days', 3)` |
| `whatsappService.js:21,31,182,183` | two single-key queries ×2 | `settingsCache.getBoolean(...)`, `settingsCache.get(...)` |

### Acceptance criteria

- `settingsCache.get(key)` returns the correct value for any key stored in the `settings` table.
- Attendance check-in makes **zero** settings DB queries (was 1 query for 5 keys).
- Biometric door scan makes **zero** settings DB queries (was 1 query for 4+ keys).
- After `PUT /api/settings`, the in-memory cache is immediately updated — a subsequent check-in reflects the new values without waiting 5 minutes.
- `getGracePeriodDays()` and `getCrossSessionEnabled()` continue to work for existing callers.
- No direct `SELECT … FROM settings WHERE key` remains in any hot-path file (attendance, biometric, whatsapp, dateUtils).

---

## Item 9 — Standardize the DB result contract (`src/config/sqlite.js` + callers)

### Problem

The `execute()` function returns different shapes depending on the query type:

| Query type | `rows` | `rowCount` | `lastInsertId` |
|---|---|---|---|
| SELECT / RETURNING | result rows | `rows.length` | absent |
| INSERT / UPDATE / DELETE (no RETURNING) | `[]` | `info.changes` | `info.lastInsertRowid` (INSERT only) |

The codebase mixes two patterns for "did this SELECT return any rows?":
- `result.rows.length === 0` — explicit and unambiguous ✅
- `result.rowCount === 0` — works for SELECT (= `rows.length`), but also means "0 rows changed" for mutations — easy to misread ⚠️

Additionally the `$N → ?` shim runs on every query but the codebase inconsistently mixes `$1`/`$2` style (legacy) with `?` style. This makes it impossible to visually distinguish parameterized from un-parameterized queries at a glance.

### Fix (two-part)

#### Part A — Consistent result access pattern

Rule: **use `.rows.length` to check SELECT results; use `.rowCount` only for UPDATE/DELETE to check rows affected.** Eliminate `rowCount === 0` checks on SELECT results.

Affected locations (`.rowCount` used on a SELECT result):
- `classController.js:131` — `if (existing.rowCount === 0)` → `if (existing.rows.length === 0)`
- `paymentController.js:113` — `if (existing.rowCount === 0)` (checking invoice SELECT) → `.rows.length === 0`
- `paymentController.js:324,378,399,451` — `if (result.rowCount === 0)` on SELECT → `.rows.length === 0`
- `planController.js:51` — `if (existing.rowCount === 0)` → `.rows.length === 0`
- `memberController.js:498` — `if (existing.rowCount === 0)` → `.rows.length === 0`

Keep `rowCount` usage for UPDATE/DELETE in `attendanceController.js` (lines 70, 132, 161) — those check mutation results, which is the correct use of `rowCount`.

#### Part B — Document (not remove) the `$N` shim

The shim in `execute()` rewrites `$1, $2, …` → `?` before every query. Rather than migrating all callers (which risks introducing bugs), add a clear comment explaining the dual-style support. This is a low-risk clarity improvement; a full migration is deferred.

```js
// Supports both PostgreSQL-style positional placeholders ($1, $2, …) and
// SQLite-style (?) interchangeably. The shim rewrites $N → ? before execution.
// New code should use ? directly; $N support exists for legacy callers.
function replacePgParamsWithQMarks(sql) { … }
```

### Acceptance criteria

- No `result.rowCount === 0` check remains on a SELECT query result (only on UPDATE/DELETE).
- `result.rows.length` is the sole pattern for "did this query return any rows?".
- The `$N → ?` shim is documented with a comment explaining its purpose.
- All existing functionality continues to work unchanged.

---

## Execution order

1. **Item 8** — `settingsCache.js` core changes first, then `settingsController.js`, then replace callers in parallel across files.
2. **Item 9A** — `.rowCount` cleanup in controllers (6 locations). Independent of Item 8.
3. **Item 9B** — Documentation comment in `sqlite.js`. 1-line change, apply last.

## Test plan

- Run `PATH="/Users/punitgoswami/.nvm/versions/node/v22.21.1/bin:$PATH" npx jest src/services/__tests__/ --no-coverage`
- Run `npm run esp32:test`
- Manual: hit `GET /api/attendance` (check-in) → confirm no settings SELECT in server logs
- Manual: update a setting via `PUT /api/settings` → immediately check-in → confirm new value is used
- Manual: `GET /api/reports/financial` → confirm payment reminder days matches DB setting
