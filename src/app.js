require('dotenv').config();
const express = require('express');
const app = express();
require('./config/database'); // This will connect to the DB and create tables

const memberRoutes = require('./api/routes/members');
const attendanceRoutes = require('./api/routes/attendance');
const classRoutes = require('./api/routes/classes');
const scheduleRoutes = require('./api/routes/schedules');
const bookingRoutes = require('./api/routes/bookings');
const planRoutes = require('./api/routes/plans');
const paymentRoutes = require('./api/routes/payments');
const reportRoutes = require('./api/routes/reports');
const settingsRoutes = require('./api/routes/settings');



app.use(express.json());
app.use('/uploads', express.static('public/uploads'));

app.get('/', (req, res) => {
    res.send('Gym Management API is running...');
});

// Routes
app.use('/api/members', memberRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/plans', planRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/settings', settingsRoutes);



const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
