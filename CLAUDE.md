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
# Backend unit tests (Jest)
npx jest src/services/__tests__/

# Single test file
npx jest src/services/__tests__/biometricIntegration.test.js
```

No dedicated lint script exists. No Docker setup — runs directly with Node.js.

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
- **`src/services/biometricIntegration.js`** (45KB) — Core ESP32 integration manager. Listens for TCP connections from devices, handles fingerprint enrollment/validation events, broadcasts via WebSocket, and maintains a hybrid member cache (5-min auto-refresh + immediate invalidation) to keep door unlock latency under 1 second.
- **`src/services/paymentDeactivationService.js`** — Runs every 6 hours (plus 2 AM daily sweep) to auto-deactivate members with overdue invoices. Triggers ESP32 cache invalidation on deactivation.
- **`src/services/settingsCache.js`** — In-memory cache for app settings to avoid repeated DB reads. Initialized at server startup.
- **`src/services/emailService.js`** — Nodemailer integration for welcome emails, booking confirmations, payment notifications.

### Database Schema
Schema is defined and auto-migrated in `src/config/sqlite.js`. Key tables: `members`, `attendance`, `classes`, `class_schedules`, `bookings`, `membership_plans`, `invoices`, `payments`, `member_biometrics`, `biometric_events`, `firmware_versions`, `security_logs`, `referrals`, `settings`.

The initializer adds missing columns to existing databases (safe for upgrades), runs `ANALYZE`, and inserts default settings on first run.

### Frontend Components
Large monolithic components handle full features — `Member.js` (~140KB), `BiometricEnrollment.js` (~83KB), `Financials.js` (~78KB), `ESP32DeviceManager.js` (~73KB). Route structure and theme are in `client/src/App.js`.

### ESP32 Door Lock
Firmware lives in `esp32_door_lock/esp32_door_lock.ino`. The device connects to the backend TCP port, sends JSON events (fingerprint scans, access results), and receives commands (remote unlock, enroll). OTA firmware updates are managed via the `firmware_versions` table and served as binary files from `public/uploads/`.

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
