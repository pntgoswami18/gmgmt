require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { pool, initializeDatabase } = require('./config/database');
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

// Add middleware to log all requests
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    console.log('Headers:', JSON.stringify(req.headers, null, 2));
    next();
});

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

// Initialize database and start server
const PORT = process.env.PORT || 3001;

const startServer = async () => {
    try {
        await initializeDatabase();
        console.log('Database initialized successfully');
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`Server running on port ${PORT} and accessible from all interfaces`);
        });
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();

module.exports = app;
