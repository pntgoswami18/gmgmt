const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/bookingController');

// Member books a class
router.post('/', bookingController.bookClass);

// Get all bookings for a specific member
router.get('/member/:memberId', bookingController.getMemberBookings);

// Member cancels a booking
router.patch('/cancel/:bookingId', bookingController.cancelBooking);

module.exports = router;
