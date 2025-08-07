const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const app = express();

const attendanceRoutes = require('./api/routes/attendance');
const bookingRoutes = require('./api/routes/bookings');
const classRoutes = require('./api/routes/classes');
const memberRoutes = require('./api/routes/members');
const paymentRoutes = require('./api/routes/payments');
const planRoutes = require('./api/routes/plans');
const reportRoutes = require('./api/routes/reports');
const scheduleRoutes = require('./api/routes/schedules');
const settingsRoutes = require('./api/routes/settings');

app.use(cors());
app.use(express.json());
app.use(morgan('dev')); // Add this line for logging

app.use('/uploads', express.static('public/uploads'));

app.use('/api/attendance', attendanceRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/members', memberRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/settings', settingsRoutes);

module.exports = app;
