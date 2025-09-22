const express = require('express');
const router = express.Router();
const {
  getMemberBiometricStatus,
  getMemberBiometricDetails,
  startEnrollment,
  stopEnrollment,
  cancelEnrollment,
  removeBiometricData,
  manualEnrollment,
  getEnrollmentStatus,
  getBiometricEvents,
  getSystemStatus,
  getMembersWithoutBiometric,
  getMembersWithBiometric,
  testConnection,
  // ESP32 specific endpoints
  unlockDoorRemotely,
  startRemoteEnrollment,
  getDeviceStatus,
  getAllDevices,
  esp32Webhook,
  // Hybrid cache endpoints
  validateBiometricId,
  updateMemberCache
} = require('../controllers/biometricController');

// System status and info
router.get('/status', getSystemStatus);
router.get('/enrollment/status', getEnrollmentStatus);
router.post('/test-connection', testConnection);

// Member biometric management
router.get('/members/without-biometric', getMembersWithoutBiometric);
router.get('/members/with-biometric', getMembersWithBiometric);
router.get('/members/:memberId/status', getMemberBiometricStatus);
router.get('/members/:memberId/details', getMemberBiometricDetails);
router.post('/members/:memberId/enroll', startEnrollment);
router.post('/members/:memberId/manual-enroll', manualEnrollment);
router.delete('/members/:memberId/biometric', removeBiometricData);

// Enrollment management
router.post('/enrollment/stop', stopEnrollment);
router.post('/enrollment/cancel', cancelEnrollment);

// Events and logs
router.get('/events', getBiometricEvents);

// ESP32 Device Control Routes
router.post('/devices/:deviceId/unlock', unlockDoorRemotely);
router.post('/devices/:deviceId/enroll', startRemoteEnrollment);
router.get('/devices/:deviceId/status', getDeviceStatus);
router.get('/devices', getAllDevices);

// ESP32 Webhook - receives data from ESP32 devices
router.post('/esp32-webhook', esp32Webhook);

// Hybrid cache endpoints for fast validation
router.post('/validate', validateBiometricId);
router.post('/cache-update', updateMemberCache);

module.exports = router;
