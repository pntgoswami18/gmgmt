# gmgmt — Improvement Plan

This document tracks the phased improvement plan for the gmgmt gym management system, covering security hardening, data integrity, performance, and code quality.

---

## Status legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Complete |
| 🔲 | Pending |
| ⏸ | Deferred |

---

## Phase 1 — Security ✅ Complete

**Branch:** `phase1-security` → merged to `main` via PR #10

### 1. SQL injection fix
**File:** `src/api/controllers/reportController.js`

`getFinancialSummary` was string-interpolating user-supplied `startDate`/`endDate` directly into the query. Fixed by parameterizing all date filter values and `LIMIT`/`OFFSET`. Also fixed a search filter placeholder count mismatch where a single `$1` was used for multiple `LIKE` placeholders — each now has its own `?` with a matching value in the params array.

### 2. CSRF guard (app-wide)
**Files:** `src/api/middleware/requireSameOrigin.js` (new), `src/app.js`, `src/api/routes/firmware.js`

Extracted a shared CSRF middleware using `new URL(source).host === host` exact comparison (the previous `source.includes(host)` substring check was bypassable via a domain like `evil-gym.com` when the server host is `gym.com`). Malformed `Origin`/`Referer` values → 403. Applied globally to all state-mutating `/api` routes (`POST`, `PUT`, `PATCH`, `DELETE`). Requests with no `Origin`/`Referer` header pass through untouched so ESP32 devices (which send raw TCP/HTTP with no browser headers) are unaffected.

### 3. Security headers, rate limiting, and CORS
**File:** `src/app.js`

- Added `helmet` for standard HTTP security headers (`X-Content-Type-Options`, `X-Frame-Options`, etc.). `crossOriginResourcePolicy` is set to `cross-origin` so the React dev server on port 3000 can load uploaded images; CSP is left to the frontend build.
- Added `express-rate-limit`: 1000 requests / 15 minutes / IP by default, configurable via `RATE_LIMIT_MAX` env var.
- Scoped CORS to origins listed in `CORS_ORIGINS` env var (comma-separated). When unset, all origins are allowed (dev default). If `CORS_ORIGINS` contains `*`, the server refuses to start — wildcards are incompatible with credentialed requests.

### 4. Upload hardening
**File:** `src/config/multer.js`

- Extension and MIME type validated against explicit `Set` allowlists (`.jpg`, `.jpeg`, `.png`, `.gif` / matching `image/*` types).
- Filenames are randomized: `{sanitized-prefix}-{timestamp}-{8 random hex bytes}.{ext}`, preventing enumeration and overwrite attacks.
- `sanitizePrefix()` strips all non-alphanumeric characters and truncates to 40 chars, preventing path traversal in filenames.
- Rejection callbacks use `cb(new Error(...))` instead of `cb('string')` so multer error handling works correctly.

### 5. Firmware path traversal
**File:** `src/api/routes/firmware.js`

Added `path.resolve(firmware.filepath).startsWith(path.resolve(FIRMWARE_DIR))` confinement check to the `DELETE /:id` route. The download route already had this check; the delete route was missing it, allowing a tampered DB row to cause deletion of arbitrary files on disk.

### 6. SSRF — `testConnection`
**File:** `src/api/controllers/biometricController.js`

User-supplied `host` and `port` were passed directly to `net.Socket.connect()`. Fixed by:
- Validating `port` is a finite integer in `[1, 65535]`
- Blocking `host` values that start with `127.`, `0.`, `169.254.`, `::1`, `[::1]` (loopback and link-local / cloud metadata endpoints)
- Using the parsed integer `portNum` (not the raw string) in the socket call

### 7. SSRF — `invalidateESP32Cache`
**File:** `src/api/controllers/biometricController.js`

Cache-invalidation HTTP requests were sent to `device.ip_address` from the database without any validation, making it possible to reach loopback or cloud metadata endpoints via a malicious DB entry. Fixed with a two-stage guard:

1. **Raw-string prefix check** — fast path, same blocked prefixes as `testConnection`
2. **Parsed hostname check** — `new URL('http://' + rawIp).hostname` extracts the actual target host, catching `user@host` credential-bypass patterns (e.g. `10.0.0.1@127.0.0.1` resolves to hostname `127.0.0.1`). Malformed input is caught and the device is skipped.

> **Note:** RFC-1918 private ranges (`10.*`, `172.16–31.*`, `192.168.*`) are intentionally not blocked — ESP32 devices are LAN devices whose IPs live in those ranges by design.

### 8. Pagination NaN / full-table dump
**Files:** `attendanceController.js`, `biometricController.js`, `memberController.js`, `reportController.js`

`better-sqlite3` converts `NaN` parameters to `NULL`; `LIMIT NULL` in SQLite means no limit, so a non-numeric `?page` or `?limit` query parameter could dump the full table. Fixed by clamping across all 7 paginated endpoints:

```js
const pageNum = Math.max(1, parseInt(page, 10) || 1);
const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
const offset = (pageNum - 1) * limitNum;
```

### 9. reminderDays NaN
**File:** `src/api/controllers/reportController.js`

A corrupt or missing `payment_reminder_days_after_due` setting could produce `'+NaN days'` as the SQLite `julianday` modifier, causing the query to return wrong results silently. Fixed with `Number.isFinite(rawDays) && rawDays >= 0 ? rawDays : 7`.

### 10. ILIKE → LIKE
**Files:** `attendanceController.js`, `biometricController.js`

SQLite does not support `ILIKE`. The `pool.query` shim rewrites it, but inconsistent usage was flagged. Replaced all 5 occurrences with `LIKE` directly.

### 11. Runtime crash — duplicate SQL argument
**File:** `src/api/controllers/biometricController.js`

`getMemberBiometricDetails` passed the same SQL string as both the query and (in place of) its parameters array — `pool.query(sql, sql)` instead of `pool.query(sql, [memberId])` — causing a runtime crash on every call to that endpoint. Fixed to pass the actual parameters array.

### 12. Node version pin
**File:** `.nvmrc`

`better-sqlite3` is compiled for Node 22. The default shell Node was v18, causing `ERR_DLOPEN_FAILED` on startup. Added `.nvmrc` pinning the project to Node 22.

---

### Deferred from Phase 1

**Magic-byte upload validation** ⏸

Client-supplied `Content-Type` / file extension is spoofable. True validation requires reading the first bytes of the uploaded file and comparing against known image magic bytes (e.g. `FF D8 FF` for JPEG, `89 50 4E 47` for PNG). This requires buffering the stream before `multer` writes it to disk, which is a more invasive change to the upload flow. Implement after Phase 2.

---

## Phase 2 — Data Integrity ✅ Complete

**Branch:** `phase2-data-integrity` (based on `phase1-security`)

### 5. `runInTransaction` serialization ✅
**File:** `src/config/sqlite.js`

The `runInTransaction` helper issues `db.exec('BEGIN')` / `COMMIT` on the single shared connection but `await`s inside the body. Two concurrent requests can interleave: the second `BEGIN` throws (SQLite doesn't allow nested transactions) or the second `COMMIT` closes the first request's transaction. Fixed by adding a module-level promise-chain mutex (`_txQueue`) — each caller chains onto the previous, so BEGIN/COMMIT pairs never overlap.

### 6. Replace `SELECT MAX(id)` after INSERT with `RETURNING *` ✅
**Files:** `memberController.js`, `paymentController.js` (×4), `classController.js`, `bookingController.js`, `attendanceController.js`, `scheduleController.js`, `planController.js`

Ten locations followed the pattern: `INSERT INTO ...` then `SELECT ... ORDER BY id DESC LIMIT 1` to retrieve the new row. Under concurrent load, the `SELECT` could return a different request's row. Replaced all 10 with `INSERT ... RETURNING *` / `RETURNING id`, using the result directly. `execute()` in `sqlite.js` already routed `RETURNING` statements through `.all()`, so no infrastructure change was needed.

### 7. Fix misleading UNIQUE-violation error message ✅
**File:** `src/api/controllers/memberController.js`

Both `createMember` and `updateMember` catch blocks had an else-branch saying "email already exists" — but email is never included in the INSERT/UPDATE column lists, making it dead code. Changed the fallback to "A member with these details already exists." The phone-specific branch (`lowered.includes('phone')`) remains and fires correctly for the `ux_members_phone` partial unique index.

---

## Phase 3 — Performance & Consistency ✅ Complete

**Branch:** `phase3-perf` (merged to `main`)

### 8. Generalize `settingsCache` ✅
**Files:** `src/services/settingsCache.js`, `src/api/controllers/settingsController.js`, and 8 callers

Replaced the narrow 2-key cache with a full `Map`-backed cache loading all settings rows on startup and every 5 minutes. Added `get(key, default)`, `getBoolean(key, default)`, `getInt(key, default)` accessors; kept `getGracePeriodDays()` / `getCrossSessionEnabled()` wrappers for backward compatibility. `settingsController.updateAllSettings` now calls `settingsCache.invalidate()` after commit so changes take effect immediately. Replaced direct `SELECT FROM settings WHERE key` queries in: `attendanceController` (5-key query per check-in), `biometricController` (4-key query per door scan), `biometricIntegration`, `reportController`, `referralController`, `memberController`, `dateUtils`, `whatsappService`.

### 9. Standardize the DB result contract ✅
**Files:** `src/config/sqlite.js`, `classController.js`, `paymentController.js` (×5), `planController.js`, `memberController.js`

- Added comment to `replacePgParamsWithQMarks` documenting the `$N → ?` shim and its backward-compat purpose.
- Replaced 8 occurrences of `result.rowCount === 0` on SELECT results with `result.rows.length === 0` (unambiguous; `rowCount` is now used only on UPDATE/DELETE to check rows affected).

---

## Phase 4 — Code Quality 🔲 Pending

### 10. Structured logging and error handling
**Files:** across the codebase (~183 `console.log` calls)

Replace `console.log` / `console.error` calls with a level-gated logger (e.g. `pino` or `winston`) that can be silenced in tests and configured for production output format. Fix the silent `catch (_) {}` in `sqlite.js:369` which swallows errors invisibly. Remove dead Stripe and placeholder email-notification code.

### 11. Unit and integration test coverage
**Directory:** `src/services/__tests__/`

Only `biometricIntegration.test.js` exists, and it currently contains no active test cases. CLAUDE.md requires both unit and integration tests for all changes. Add tests for:
- Payment flow: transaction creation, referral discount application
- Member CRUD: create, update, UNIQUE constraint handling
- Report queries: financial summary, payment reminders, member growth

---

## Tracked — Not Currently Scheduled

### Authentication
The entire API is unauthenticated. `JWT_SECRET` and `bcryptjs` are present in the codebase but unused. The server binds to `0.0.0.0`, making it reachable on all network interfaces.

This was deferred by explicit decision — the app is intended for a trusted LAN environment. If the deployment moves outside a trusted network, authentication becomes the highest-priority item.
