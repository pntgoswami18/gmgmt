const express = require('express');
const router = express.Router();
const attendanceController = require('../controllers/attendanceController');

// Endpoint for the biometric device to post a check-in
router.post('/check-in', attendanceController.checkIn);

// Endpoint for staff to get attendance records
router.get('/:memberId', attendanceController.getAttendanceByMember);

module.exports = router;
