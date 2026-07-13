#!/usr/bin/env node
/*
 * Simulated ESP32 door lock — for local testing of the face check-in flow.
 *
 * Mirrors the real firmware's two touch points with the backend
 * (see esp32_door_lock/esp32_door_lock.ino + src/services/biometricIntegration.js):
 *
 *   1. Self-registration: POST /api/biometric/esp32-webhook  { event:'heartbeat', ... }
 *      -> upserts the `devices` row with status='online' and this box's ip_address.
 *      Repeated on an interval to stay "online".
 *
 *   2. Command channel: the backend unlocks by POSTing to  http://<ip>:80/command
 *      { deviceId, command:'unlock_door', data:{ reason } }.  We serve that here
 *      and "toggle the relay" (just logging), then re-lock after the duration.
 *
 * Because the backend hard-codes port 80 for the command channel, this HTTP
 * server MUST listen on port 80 — which on macOS/Linux needs root, so run with
 * sudo (see the run instructions printed if the bind fails).
 */

const http = require('http');

// Use 127.0.0.1, not "localhost": Node may resolve localhost to IPv6 ::1, but
// the backend binds IPv4 (0.0.0.0), so localhost would ECONNREFUSED on ::1.
const BACKEND = process.env.BACKEND || 'http://127.0.0.1:3001';
const SECRET = process.env.DEVICE_SHARED_SECRET || 'dev-face-secret';
const DEVICE_ID = process.env.DEVICE_ID || 'SIM_DOOR_01';
const LISTEN_IP = process.env.LISTEN_IP || '127.0.0.1';
const LISTEN_PORT = Number(process.env.LISTEN_PORT || 80); // backend hard-codes 80
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS || 30000);

let relayLocked = true; // HIGH = locked, matching the firmware's default
let reLockTimer = null;

function ts() {
  return new Date().toISOString();
}
function log(...a) {
  console.log(`[${ts()}]`, ...a);
}

// ---- 1. Registration heartbeat --------------------------------------------
function sendHeartbeat() {
  const body = JSON.stringify({
    event: 'heartbeat',
    deviceId: DEVICE_ID,
    deviceType: 'esp32_door_lock',
    device_name: 'Simulated Door Lock',
    status: 'online',
    ip_address: LISTEN_IP,
    firmware_version: 'sim-1.0',
    wifi_rssi: -50,
    free_heap: 200000,
    enrolled_prints: 0,
    timestamp: ts(),
  });

  const url = new URL('/api/biometric/esp32-webhook', BACKEND);
  const req = http.request(
    url,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        'X-Device-Secret': SECRET,
        'User-Agent': 'SimulatedESP32DoorLock/1.0',
      },
    },
    (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        if (res.statusCode === 200) {
          log(`💓 heartbeat ok — registered '${DEVICE_ID}' @ ${LISTEN_IP} (online)`);
        } else {
          log(`⚠️  heartbeat HTTP ${res.statusCode}: ${data}`);
          if (res.statusCode === 401) {
            log('   -> device secret rejected. Ensure the backend .env DEVICE_SHARED_SECRET');
            log(`      matches this script's SECRET ("${SECRET}") and the backend was restarted.`);
          }
        }
      });
    }
  );
  req.on('error', (e) =>
    log(`⚠️  heartbeat failed: ${e.message} (is the backend up at ${BACKEND}?)`)
  );
  req.write(body);
  req.end();
}

// ---- 2. Command channel (the door) ----------------------------------------
function handleCommand(payload, res) {
  const command = payload.command;
  const reason = payload.data && payload.data.reason;
  log(`⬇️  command received: '${command}'${reason ? ` (reason: ${reason})` : ''}`);

  if (command === 'unlock_door' || command === 'access_granted') {
    relayLocked = false;
    const durationMs = (payload.data && payload.data.duration) || 5000;
    console.log('');
    log('🔓🔓🔓  DOOR UNLOCKED  🔓🔓🔓  (relay -> LOW)');
    console.log('');
    if (reLockTimer) clearTimeout(reLockTimer);
    reLockTimer = setTimeout(() => {
      relayLocked = true;
      log(`🔒 door re-locked after ${durationMs}ms (relay -> HIGH)`);
    }, durationMs);
  } else {
    log(`ℹ️  command '${command}' acknowledged (no relay action)`);
  }

  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      success: true,
      deviceId: DEVICE_ID,
      command,
      relayLocked,
    })
  );
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/command') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let payload = {};
      try {
        payload = JSON.parse(raw || '{}');
      } catch (_) {
        /* tolerate non-JSON like the firmware does */
      }
      handleCommand(payload, res);
    });
    return;
  }
  // Simple status/health endpoints for poking with curl
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(
    JSON.stringify({
      deviceId: DEVICE_ID,
      relayLocked,
      door: relayLocked ? 'locked' : 'unlocked',
    })
  );
});

server.on('error', (e) => {
  if (e.code === 'EACCES') {
    console.error(`\n❌ Cannot bind port ${LISTEN_PORT} — needs elevated privileges.`);
    console.error(
      '   The backend hard-codes port 80 for the door command channel, so run with sudo:'
    );
    console.error('     sudo DEVICE_SHARED_SECRET=' + SECRET + ' node simulate-esp32-door.js\n');
  } else if (e.code === 'EADDRINUSE') {
    console.error(`\n❌ Port ${LISTEN_PORT} is already in use (another process is bound to it).\n`);
  } else {
    console.error('server error:', e);
  }
  process.exit(1);
});

server.listen(LISTEN_PORT, LISTEN_IP, () => {
  log(`🚪 Simulated ESP32 door lock listening on http://${LISTEN_IP}:${LISTEN_PORT}/command`);
  log(`   device_id = "${DEVICE_ID}"   backend = ${BACKEND}`);
  log('   Enter this device_id as the "Door Device ID" in Settings -> Face Check-In.');
  sendHeartbeat();
  setInterval(sendHeartbeat, HEARTBEAT_MS);
});

process.on('SIGINT', () => {
  log('shutting down simulator');
  process.exit(0);
});
