const express = require('express');
const router = express.Router();
const {
  getMemberBiometricStatus,
  startEnrollment,
  stopEnrollment,
  removeBiometricData,
  getEnrollmentStatus,
  getBiometricEvents,
  getSystemStatus,
  getMembersWithoutBiometric,
  testConnection
} = require('../controllers/biometricController');

// System status and info
router.get('/status', getSystemStatus);
router.get('/enrollment/status', getEnrollmentStatus);
router.post('/test-connection', testConnection);

// Member biometric management
router.get('/members/without-biometric', getMembersWithoutBiometric);
router.get('/members/:memberId/status', getMemberBiometricStatus);
router.post('/members/:memberId/enroll', startEnrollment);
router.delete('/members/:memberId/biometric', removeBiometricData);

// Enrollment management
router.post('/enrollment/stop', stopEnrollment);

// Events and logs
router.get('/events', getBiometricEvents);

module.exports = router;
