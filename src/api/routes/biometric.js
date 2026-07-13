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
  updateMemberCache,
  syncBiometricData,
} = require('../controllers/biometricController');
const {
  enrollFace,
  removeFaceData,
  getFaceStatus,
  syncFaceCache,
  faceCheckIn,
  getModelManifest,
  getFaceConfig,
} = require('../controllers/faceBiometricController');

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

// Biometric data sync — cleans stale slots across all online devices
router.post('/sync', syncBiometricData);

// Face check-in (plan Section 4). Enrollment/removal/status are staff-session
// routes (requireAuth, like the rest of /api); the /face/* station routes are
// device-secret guarded — see DEVICE_PATHS in app.js.
router.post('/members/:memberId/face-enroll', enrollFace);
router.delete('/members/:memberId/face', removeFaceData);
router.get('/members/:memberId/face-status', getFaceStatus);
router.post('/face/sync', syncFaceCache);
router.post('/face/check-in', faceCheckIn);
router.get('/face/model-manifest', getModelManifest);
router.get('/face/config', getFaceConfig);

module.exports = router;
