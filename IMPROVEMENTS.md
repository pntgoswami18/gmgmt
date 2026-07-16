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

## Phase 4 — Code Quality ✅ Complete

**Branch:** `phase4-code-quality` (based on `main`) → merged to `main` via PR #13, with follow-up fixes in `phase1-3-review-fixes` (PR #14) | **Plan:** [`docs/phase4-plan.md`](docs/phase4-plan.md)

### 10. Structured logging and error handling ✅
**Files:** across the codebase (329 `console.*` calls across 19 files)

Replace all `console.log/error/warn` calls with `pino` — a level-gated structured logger. `LOG_LEVEL=silent` in test env eliminates log noise; JSON output in production; `pino-pretty` for dev. Per-service child loggers carry `{ service }` context automatically. Fix the silent `catch (_) {}` in `sqlite.js:423` which swallows schema migration errors invisibly (change to `log.warn`). Add a comment to the intentional ROLLBACK swallow at `sqlite.js:459`.

### 11. Unit and integration test coverage ✅
**Directory:** `src/services/__tests__/`

Only `biometricIntegration.test.js` exists with a single test. CLAUDE.md requires both unit and integration tests for all changes. Add tests using `node:test` against an in-memory SQLite DB (no mocks) for:
- Payment flow: createInvoice, recordManualPayment, referral discount, deletePayment
- Member CRUD: create, duplicate phone rejection, referral, update, delete, setActiveStatus
- Report queries: financial summary date/search/pagination, payment reminders with NaN-safe setting

---

## Phase 5 — Authentication ✅ Complete

**Branch:** none (built directly on `main`) | **Plan:** [`declarative-knitting-globe.md`](/Users/punitgoswami/.claude/plans/declarative-knitting-globe.md)

The entire API is unauthenticated. `JWT_SECRET`, `jsonwebtoken`, and `bcryptjs` are present in the codebase (`package.json`) but completely unused. The server binds to `0.0.0.0`. This was previously deferred by explicit decision — the app was assumed to run on a trusted LAN — but the desktop running the app is also internet-connected, so the "LAN-only" boundary isn't a hard guarantee (malware, a misconfigured router, or a VPN client on the host could all reach the API). Two independent layers were planned:

### Part A — Staff login (web UI) ✅ Complete
- New `staff` table (`username`, `password_hash`, `role`, `is_active`, `failed_attempts`, `locked_until`) in `src/config/sqlite.js` — separate from `members.is_admin`, which is an unrelated gym-member business flag, not a login credential.
- `src/services/authService.js` (bcryptjs hash/verify, jsonwebtoken sign/verify, account lockout after 5 failed attempts, bootstrap admin seeding), `src/api/controllers/authController.js`, `src/api/routes/auth.js` (`POST /api/auth/login` with its own 5-attempts/15-min rate limiter, `POST /api/auth/logout`, `GET /api/auth/me`), `src/api/middleware/requireAuth.js`.
- Token delivered via an **httpOnly cookie** (`gmgmt_token`, not `Authorization` header/localStorage) — avoids XSS token theft and pairs with the existing CSRF guard (`requireSameOrigin.js`). Server refuses to start without `JWT_SECRET` set (mirrors the existing `CORS_ORIGINS` wildcard check).
- `requireAuth` applied globally to all `/api/*` routes except `/api/auth/*` and the ESP32 device endpoints (`esp32-webhook`, `validate`, `cache-update`, `firmware/download/:id`) that remain open pending Part B.
- Bootstrap: seeds one admin account from `INITIAL_ADMIN_USERNAME`/`INITIAL_ADMIN_PASSWORD` env vars if the `staff` table is empty on first boot.
- Frontend: shared `client/src/api/client.js` axios instance (`withCredentials: true`) — all 12 components that called `axios` directly now import this instead — plus `AuthContext`, `Login` page, a loading/login gate in `App.js`, and a logout icon in the `AppBar`.
- Tests: `src/services/__tests__/auth.test.js` (hash/verify, token round-trip, login success/failure/lockout, `requireAuth` middleware) — 6 tests, all passing alongside the existing suite.
- Verified end-to-end in a real browser: login → dashboard loads → logout → redirected back to login; confirmed protected routes 401 without a session and the ESP32 endpoints stay open.
- Side fix: found and fixed a pre-existing bug in `biometricController.js` (`testConnection`) — a duplicated `let resolvedHost` block left over from a prior merge — that threw a `SyntaxError` and crashed the entire server on startup on Node 22. Also fixed the dev proxy (`client/package.json`) pointing at `localhost:3001`, which intermittently fails when `localhost` resolves to `::1` before `127.0.0.1`; changed to `127.0.0.1:3001` explicitly.

### Part B — ESP32 device authentication ✅ Complete
Found during Phase 5 research: `POST /api/biometric/esp32-webhook`, `/api/biometric/validate`, `/api/biometric/cache-update`, and `GET /api/firmware/download/:id` accepted requests from anyone — a device's identity is just a self-declared `device_id` string with no credential check.

- Devices self-register with no pairing flow (`INSERT OR REPLACE INTO devices` on first webhook/heartbeat), so implemented **one shared secret for all devices** (`DEVICE_SHARED_SECRET` env var) rather than a per-device pairing flow.
- `src/api/middleware/requireDeviceSecret.js` compares an `X-Device-Secret` header (or a `?device_secret=` query param, for the firmware-download case below) via `crypto.timingSafeEqual`; skipped entirely when `DEVICE_SHARED_SECRET` is unset (dev default, matches the `CORS_ORIGINS` unset-is-permissive pattern).
- Firmware (`esp32_door_lock/esp32_door_lock.ino`): added a `device_secret` preference (loaded/saved like `device_id`), a config-portal field, and an `addDeviceSecretHeader()` helper sending `X-Device-Secret` on all 4 outbound HTTP calls (heartbeat, async webhook, `/validate`, `/cache-update`). **Not touched:** the OTA update path (`performOTAUpdate()` / `httpUpdate.update(...)`) — that library doesn't make custom headers easy to add and it's a safety-critical path that can't be compile-tested here. Instead, `src/api/routes/firmware.js`'s OTA-trigger route embeds the secret as a `?device_secret=` query param directly in the download URL it hands the device, so the device just follows the URL it's given with no firmware change needed for that endpoint.
- Rollout: ship the firmware update via existing OTA first (secret sent but not yet enforced since `DEVICE_SHARED_SECRET` stays unset), confirm all devices report the new `firmware_version`, then set `DEVICE_SHARED_SECRET` on the backend to start enforcing — avoids bricking devices mid-rollout.
- Tests: `src/services/__tests__/requireDeviceSecret.test.js` (5 tests — unset-secret bypass, missing/wrong/correct header, correct query param).
- Verified against a running backend: with the secret unset, all 4 endpoints work with no header; with it set, requests with no/wrong header/query 401, correct header/query pass, and staff login/session auth continues to work unaffected alongside it.
- **Not verified:** the `.ino` firmware changes were reviewed carefully but not compiled (no Arduino toolchain in this environment) — build and flash-test on real hardware before relying on it.

---

## Tracked — Not Currently Scheduled

### Magic-byte upload validation ⏸
Deferred from Phase 1. Client-supplied `Content-Type`/file extension is spoofable; true validation requires reading the first bytes of the uploaded file and comparing against known image magic bytes, which requires buffering the stream before `multer` writes it to disk. Not scheduled.
