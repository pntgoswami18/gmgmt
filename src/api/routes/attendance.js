const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendanceController');

// Endpoint for the biometric device to post a check-in
router.post('/check-in', attendanceController.checkIn);

// Webhook endpoint for ESP32 devices to push events
router.post('/device-webhook', attendanceController.deviceWebhook);

// Endpoint for staff to get attendance records
router.get('/', attendanceController.getAllAttendance);
router.get('/:memberId', attendanceController.getAttendanceByMember);

module.exports = router;
