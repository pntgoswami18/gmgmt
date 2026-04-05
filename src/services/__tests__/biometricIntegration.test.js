const test = require('node:test');
const assert = require('node:assert/strict');

const BiometricIntegration = require('../biometricIntegration');
const { pool } = require('../../config/sqlite');

test('startRemoteEnrollment rolls back mode when ESP32 command fails', async () => {
  const integration = new BiometricIntegration();
  const originalPoolQuery = pool.query;
  const originalSendESP32Command = integration.sendESP32Command;
  const originalStopEnrollmentMode = integration.stopEnrollmentMode.bind(integration);
  const stopReasons = [];

  try {
    pool.query = async () => ({ rows: [{ name: 'Test Member' }] });
    integration.sendESP32Command = async () => {
      throw new Error('HTTP timeout after 10000ms');
    };
    integration.stopEnrollmentMode = (reason) => {
      stopReasons.push(reason);
      return originalStopEnrollmentMode(reason);
    };

    await assert.rejects(
      () => integration.startRemoteEnrollment('esp32-test-device', 123),
      /HTTP timeout/
    );

    assert.equal(integration.getEnrollmentStatus().active, false);
    assert.deepEqual(stopReasons, ['command_failed']);
  } finally {
    pool.query = originalPoolQuery;
    integration.sendESP32Command = originalSendESP32Command;
    integration.stopEnrollmentMode = originalStopEnrollmentMode;
    integration.stopEnrollmentMode('test_cleanup');
  }
});
