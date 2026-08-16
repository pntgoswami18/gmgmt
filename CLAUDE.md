# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

GMGMT is a gym management system with a Node.js/Express backend, React frontend, SQLite database, and ESP32 fingerprint door lock integration via TCP/IP.

## Commands

### Backend
```bash
npm start               # Production start (node src/app.js)
npm run dev             # Development with nodemon hot-reload
```

### Frontend
```bash
cd client && npm start      # Dev server on port 3000
cd client && npm run build  # Production build
```

### Biometric / ESP32
```bash
npm run biometric:start     # Start TCP listener for ESP32 devices
npm run esp32:setup         # Initialize ESP32 database tables
npm run esp32:test          # Run all ESP32 integration tests
npm run esp32:test:api      # Test REST API endpoints only
```

### Running tests
```bash
# Backend unit tests (node:test — the repo does not use jest). Requires
# Node >= 20: on Node 18 the better-sqlite3 native module fails to load
# (NODE_MODULE_VERSION ABI mismatch) and every DB-touching suite errors out.
node --test 'src/**/__tests__/*.test.js'

# Single test file
node --test src/services/__tests__/biometricIntegration.test.js
```

Unit + integration tests are expected for all changes — run both `node --test 'src/**/__tests__/*.test.js'` and `npm run esp32:test` before marking work done. The ESP32 integration tests need the server running (`JWT_SECRET=<any> ENABLE_BIOMETRIC=true BIOMETRIC_PORT=5005 node src/app.js`). Note the recursive glob: test files live under `src/services/__tests__/`, `src/api/controllers/__tests__/`, and `src/api/middleware/__tests__/`, not just `src/services/__tests__/`.

No dedicated lint script exists. No Docker setup — runs directly with Node.js.

## Git Workflow

- Branch names: simple kebab-case descriptive names (e.g., `payment-fix`, `member-search`), no type prefix.
- Commit messages: conventional format — `fix:`, `feat:`, `refactor:`, `docs:`, `test:` prefix followed by a short description.

## Architecture

### Stack
- **Backend**: Express.js on port 3001, SQLite via `better-sqlite3`
- **Frontend**: React 19 + Material-UI on port 3000 (proxies API to 3001)
- **Database**: `./data/data/gmgmt.sqlite` — auto-initialized on first start in `src/config/sqlite.js`
- **Real-time**: WebSocket at `/ws` path for biometric enrollment progress
- **Hardware**: ESP32 devices connect via JSON-over-TCP on port 8080

### Request Flow
```
React (port 3000)
  → Axios HTTP → Express routes (src/api/routes/)
  → Controllers (src/api/controllers/)
  → Services (src/services/) or direct better-sqlite3 queries
  → SQLite
```

### Key Services
- **`src/services/biometricIntegration.js`** (45KB) — Core ESP32 integration manager. Listens for TCP connections from devices, handles fingerprint enrollment/validation events, and broadcasts via WebSocket. Every fingerprint scan does a synchronous `POST /api/biometric/validate` round-trip to the server before unlocking (`checkFingerprint()` in `esp32_door_lock.ino`), bounded by a 3s client-side timeout, and fails closed (denies entry) if the server is unreachable — this replaced an earlier local-cache-backed sub-1s unlock path that could authorize a member with server-revoked access during a temporary outage. The device still maintains a local `memberCache` — refreshed via a periodic paginated sync to `/api/biometric/cache-update` (every `CACHE_UPDATE_INTERVAL`, 5 min) and updated after every validation via `updateCacheEntry()` — but it no longer gates the unlock decision; it now only backs the `cache_size` diagnostic on `/api/cache/invalidate`. Real end-to-end latency depends on LAN round-trip time and hasn't been measured against physical hardware.
- **`src/services/paymentDeactivationService.js`** — Runs every 6 hours (plus 2 AM daily sweep) to auto-deactivate members with overdue invoices. Triggers ESP32 cache invalidation on deactivation.
- **`src/services/settingsCache.js`** — In-memory cache for app settings to avoid repeated DB reads. Initialized at server startup.
- **`src/services/emailService.js`** — Nodemailer integration for welcome emails, booking confirmations, payment notifications.
- **`src/services/deviceDiscoveryService.js`** — Browses mDNS (`_gmgmt-doorlock._tcp`) for ESP32 devices advertising themselves, so the frontend's Add Device flow can find a device before its first heartbeat. Only started when `ENABLE_BIOMETRIC=true`. Not the source of truth for device identity — that's still the `devices` table, populated by heartbeats/webhooks.

### Database Schema
Schema is defined and auto-migrated in `src/config/sqlite.js`. Key tables: `members`, `attendance`, `classes`, `class_schedules`, `bookings`, `membership_plans`, `invoices`, `payments`, `member_biometrics`, `biometric_events`, `firmware_versions`, `security_logs`, `referrals`, `settings`.

The initializer adds missing columns to existing databases (safe for upgrades), runs `ANALYZE`, and inserts default settings on first run.

### Frontend Components
Large monolithic components handle full features — `Member.js` (~140KB), `BiometricEnrollment.js` (~83KB), `Financials.js` (~78KB), `ESP32DeviceManager.js` (~73KB). Route structure and theme are in `client/src/App.js`.

### ESP32 Door Lock
Firmware lives in `esp32_door_lock/esp32_door_lock.ino`. The device connects to the backend TCP port, sends JSON events (fingerprint scans, access results), and receives commands (remote unlock, enroll). OTA firmware updates are managed via the `firmware_versions` table and served as binary files from `public/uploads/`.

**WiFi provisioning**: if the device's stored/config.h WiFi credentials fail to connect, it falls back to a WiFiManager captive portal (`GMGMT-DoorLock-XXXX` AP) instead of going dark — no re-flash needed to move a device to new WiFi. The portal verifies backend reachability via `GET /api/biometric/ping` (unauthenticated — see `PUBLIC_PATHS` in `src/app.js`) before exiting. Requires the `WiFiManager` (tzapu) Arduino library in addition to the existing ones — see `esp32_door_lock/config.h.example`.

### Face Check-In (browser, `public/models/`)
Browser-based face embedding check-in needs three model artifacts served from
the gitignored `public/models/`: a MediaPipe landmarker + WASM runtimes
(fetched/bundled automatically), and `face_embedder_v1_fp32.tflite` (SFace,
converted offline by `tools/face-model/convert.py` — a maintainer-only Python/
TensorFlow pipeline, not something a deployment target runs). The embedder is
published as a sha256-pinned GitHub Release asset
([`face-model-v1`](https://github.com/pntgoswami18/gmgmt/releases/tag/face-model-v1))
and fetched by `tools/face-model/deploy-models.js`. Deployment runs
automatically both via `npm start`/`npm run dev` (`prestart`/`predev`) and
from `src/app.js` at boot — the latter is what actually covers the installed
Windows Service, which launches `node.exe src/app.js` directly and bypasses
npm hooks entirely. See `tools/face-model/README.md` and
`docs/face-checkin-handoff.md` §3.4 for the full deploy story and how to
publish a new embedder build.

## Environment Variables

Key variables (see `.env.sample` for full list):
```
PORT=3001
ENABLE_BIOMETRIC=true
BIOMETRIC_PORT=8080
EMAIL_USER / EMAIL_PASS   # Gmail + app password
JWT_SECRET                # Used for future auth features
WIN_DATA_ROOT             # Override data directory on Windows
```
