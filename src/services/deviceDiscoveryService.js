const { Bonjour } = require('bonjour-service');
const logger = require('../utils/logger').child({ service: 'deviceDiscoveryService' });

// Browses for ESP32 door locks advertising _gmgmt-doorlock._tcp via mDNS
// (see startMDNSAdvertising() in esp32_door_lock.ino). This is a
// LAN-presence list, not the source of truth for device identity/state —
// that's still the `devices` table, populated by heartbeats/webhooks (see
// esp32Webhook). The gap this fills is the window between a device joining
// WiFi and its first heartbeat, so the frontend "Add Device" flow can show
// it without the user typing an IP address.
//
// Entries expire on their own via bonjour-service's 'down' event (TTL
// expiry / explicit goodbye packet) rather than a manual sweep, since that
// mirrors actual LAN presence more closely than a fixed timeout would.
class DeviceDiscoveryService {
  constructor() {
    this._bonjour = null;
    this._browser = null;
    this._devices = new Map(); // device_id -> { device_id, ip_address, firmware_version, host, port, last_seen }
  }

  start() {
    if (this._bonjour) return; // already started

    try {
      this._bonjour = new Bonjour();
      this._browser = this._bonjour.find({ type: 'gmgmt-doorlock' }, (service) => {
        this._handleUp(service);
      });
      this._browser.on('up', (service) => this._handleUp(service));
      this._browser.on('down', (service) => this._handleDown(service));
      logger.info('✅ mDNS device discovery started (_gmgmt-doorlock._tcp)');
    } catch (err) {
      logger.error(
        { err },
        'failed to start mDNS device discovery — falling back to heartbeat-only registration'
      );
    }
  }

  stop() {
    if (this._browser) {
      this._browser.stop();
      this._browser = null;
    }
    if (this._bonjour) {
      this._bonjour.destroy();
      this._bonjour = null;
    }
    this._devices.clear();
  }

  _handleUp(service) {
    const deviceId = service.txt && service.txt.device_id;
    if (!deviceId) return; // not one of ours, or advertised before TXT records were set

    const ip = (service.addresses || []).find((a) => a.includes('.')) || service.addresses?.[0];

    this._devices.set(deviceId, {
      device_id: deviceId,
      ip_address: ip || null,
      firmware_version: service.txt.firmware_version || null,
      host: service.host || null,
      port: service.port || null,
      last_seen: new Date().toISOString(),
    });
  }

  _handleDown(service) {
    const deviceId = service.txt && service.txt.device_id;
    if (deviceId) {
      this._devices.delete(deviceId);
    }
  }

  // Devices currently visible on the LAN via mDNS, regardless of whether
  // they're already claimed/registered in the `devices` table — callers
  // (the /api/devices/discover route) are responsible for cross-referencing
  // against known devices if they want to filter to "new" ones only.
  getDiscoveredDevices() {
    return Array.from(this._devices.values());
  }
}

module.exports = new DeviceDiscoveryService();
