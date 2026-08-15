const test = require('node:test');
const assert = require('node:assert/strict');

// Exercises the mDNS event handling directly rather than through start()/stop(),
// which would require real network access (multicast) — not appropriate for
// the unit test suite. start()/stop() are thin wiring around bonjour-service
// and are exercised manually per the ESP32 test plan instead.
const DeviceDiscoveryService = require('../deviceDiscoveryService').constructor;

test('records a device on "up" and it is retrievable by getDiscoveredDevices', () => {
  const svc = new DeviceDiscoveryService();
  svc._handleUp({
    txt: { device_id: 'DOOR_001', firmware_version: '1.2.0' },
    addresses: ['10.0.0.42'],
    host: 'gmgmt-doorlock-door_001.local',
    port: 80,
  });

  const devices = svc.getDiscoveredDevices();
  assert.equal(devices.length, 1);
  assert.equal(devices[0].device_id, 'DOOR_001');
  assert.equal(devices[0].ip_address, '10.0.0.42');
  assert.equal(devices[0].firmware_version, '1.2.0');
});

test('ignores services with no device_id TXT record (not one of ours)', () => {
  const svc = new DeviceDiscoveryService();
  svc._handleUp({ txt: {}, addresses: ['10.0.0.1'] });
  assert.equal(svc.getDiscoveredDevices().length, 0);
});

test('removes a device on "down"', () => {
  const svc = new DeviceDiscoveryService();
  svc._handleUp({ txt: { device_id: 'DOOR_001' }, addresses: ['10.0.0.42'] });
  assert.equal(svc.getDiscoveredDevices().length, 1);

  svc._handleDown({ txt: { device_id: 'DOOR_001' } });
  assert.equal(svc.getDiscoveredDevices().length, 0);
});
