const express = require('express');
const router = express.Router();
const {
  getMemberBiometricStatus,
  getMemberBiometricDetails,
  startEnrollment,
  stopEnrollment,
  removeBiometricData,
  manualEnrollment,
  getEnrollmentStatus,
  getBiometricEvents,
  getSystemStatus,
  getMembersWithoutBiometric,
  testConnection,
  // ESP32 specific endpoints
  unlockDoorRemotely,
  startRemoteEnrollment,
  getDeviceStatus,
  getAllDevices
} = require('../controllers/biometricController');

// System status and info
router.get('/status', getSystemStatus);
router.get('/enrollment/status', getEnrollmentStatus);
router.post('/test-connection', testConnection);

// Member biometric management
router.get('/members/without-biometric', getMembersWithoutBiometric);
router.get('/members/:memberId/status', getMemberBiometricStatus);
router.get('/members/:memberId/details', getMemberBiometricDetails);
router.post('/members/:memberId/enroll', startEnrollment);
router.post('/members/:memberId/manual-enroll', manualEnrollment);
router.delete('/members/:memberId/biometric', removeBiometricData);

// Enrollment management
router.post('/enrollment/stop', stopEnrollment);

// Events and logs
router.get('/events', getBiometricEvents);

// ESP32 Device Control Routes
router.post('/devices/:deviceId/unlock', unlockDoorRemotely);
router.post('/devices/:deviceId/enroll', startRemoteEnrollment);
router.get('/devices/:deviceId/status', getDeviceStatus);
router.get('/devices', getAllDevices);

module.exports = router;
