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

test('falls back to the raw address when only an IPv6 literal is advertised', () => {
  const svc = new DeviceDiscoveryService();
  svc._handleUp({
    txt: { device_id: 'DOOR_IPV6' },
    addresses: ['fe80::1234:5678'],
  });

  const devices = svc.getDiscoveredDevices();
  assert.equal(devices.length, 1);
  assert.equal(devices[0].ip_address, 'fe80::1234:5678');
});

test('re-advertising the same device_id replaces the previous entry (e.g. DHCP renewal)', () => {
  const svc = new DeviceDiscoveryService();
  svc._handleUp({
    txt: { device_id: 'DOOR_001', firmware_version: '1.0.0' },
    addresses: ['10.0.0.42'],
    port: 80,
  });
  const first = svc.getDiscoveredDevices()[0];

  svc._handleUp({
    txt: { device_id: 'DOOR_001', firmware_version: '1.1.0' },
    addresses: ['10.0.0.99'],
    port: 81,
  });

  const devices = svc.getDiscoveredDevices();
  assert.equal(devices.length, 1, 'second advertisement replaces, not duplicates');
  assert.equal(devices[0].ip_address, '10.0.0.99');
  assert.equal(devices[0].firmware_version, '1.1.0');
  assert.equal(devices[0].port, 81);
  assert.notEqual(devices[0].last_seen, undefined);
  assert.notEqual(first.ip_address, devices[0].ip_address);
});

test('start() is idempotent — a second call does not create a second Bonjour browser', () => {
  const bonjourModulePath = require.resolve('bonjour-service');
  const serviceModulePath = require.resolve('../deviceDiscoveryService');

  let constructCount = 0;
  class FakeBonjour {
    constructor() {
      constructCount++;
    }
    find() {
      return { on() {}, stop() {} };
    }
    destroy() {}
  }

  const originalBonjourCache = require.cache[bonjourModulePath];
  require.cache[bonjourModulePath] = {
    id: bonjourModulePath,
    filename: bonjourModulePath,
    loaded: true,
    exports: { Bonjour: FakeBonjour },
  };
  delete require.cache[serviceModulePath];

  try {
    const FreshDeviceDiscoveryService = require('../deviceDiscoveryService').constructor;
    const svc = new FreshDeviceDiscoveryService();

    svc.start();
    svc.start();

    assert.equal(constructCount, 1, 'second start() call must be a no-op guarded by this._bonjour');
    svc.stop();
  } finally {
    if (originalBonjourCache) {
      require.cache[bonjourModulePath] = originalBonjourCache;
    } else {
      delete require.cache[bonjourModulePath];
    }
    delete require.cache[serviceModulePath];
  }
});
