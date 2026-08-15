const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, teardown } = require('../../../services/__tests__/testDb');

let db;
let pingBiometricService;
let getDiscoveredDevices;
let deviceDiscoveryService;

function mockReqRes() {
  const req = {};
  let jsonPayload = null;
  let statusCode = 200;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(payload) {
      jsonPayload = payload;
      return this;
    },
  };
  return { req, res, getJson: () => jsonPayload, getStatus: () => statusCode };
}

test.before(async () => {
  db = await setup();
  ({ pingBiometricService, getDiscoveredDevices } = require('../biometricController'));
  deviceDiscoveryService = require('../../../services/deviceDiscoveryService');
});

test.after(async () => {
  await teardown();
});

test('pingBiometricService responds 200 with no auth/body requirements', () => {
  const { req, res, getJson, getStatus } = mockReqRes();
  pingBiometricService(req, res);
  assert.equal(getStatus(), 200);
  assert.deepEqual(getJson(), { success: true, message: 'pong' });
});

test('getDiscoveredDevices returns devices seen via mDNS that are not yet in the devices table', async () => {
  db.prepare("INSERT INTO devices (device_id, status) VALUES ('DOOR_KNOWN', 'online')").run();

  const original = deviceDiscoveryService.getDiscoveredDevices;
  deviceDiscoveryService.getDiscoveredDevices = () => [
    { device_id: 'DOOR_KNOWN', ip_address: '10.0.0.5', firmware_version: '1.0' },
    { device_id: 'DOOR_NEW', ip_address: '10.0.0.6', firmware_version: '1.0' },
  ];

  try {
    const { req, res, getJson, getStatus } = mockReqRes();
    await getDiscoveredDevices(req, res);

    assert.equal(getStatus(), 200);
    const payload = getJson();
    assert.equal(payload.success, true);
    assert.equal(payload.devices.length, 1);
    assert.equal(payload.devices[0].device_id, 'DOOR_NEW');
  } finally {
    deviceDiscoveryService.getDiscoveredDevices = original;
  }
});

test('getDiscoveredDevices returns an empty list when nothing is currently visible on the LAN', async () => {
  const original = deviceDiscoveryService.getDiscoveredDevices;
  deviceDiscoveryService.getDiscoveredDevices = () => [];

  try {
    const { req, res, getJson, getStatus } = mockReqRes();
    await getDiscoveredDevices(req, res);

    assert.equal(getStatus(), 200);
    assert.deepEqual(getJson(), { success: true, devices: [] });
  } finally {
    deviceDiscoveryService.getDiscoveredDevices = original;
  }
});
