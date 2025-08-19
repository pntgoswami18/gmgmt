require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { initializeDatabase } = require('./config/sqlite');
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
const biometricRoutes = require('./api/routes/biometric');

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
app.use('/api/biometric', biometricRoutes);

// Serve frontend build after API routes so /api/* is not intercepted
const path = require('path');
app.use(express.static(path.join(__dirname, '../client/build')));
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../client/build/index.html'));
});

// Initialize database and start server
const PORT = process.env.PORT || 3001;

const startServer = async () => {
    try {
        await initializeDatabase();
        console.log('Database initialized successfully');
        
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`Server running on port ${PORT} and accessible from all interfaces`);
        });

        // Start biometric integration if enabled
        if (process.env.ENABLE_BIOMETRIC === 'true') {
            const BiometricIntegration = require('./services/biometricIntegration');
            const { setBiometricIntegration } = require('./api/controllers/biometricController');
            const biometricPort = process.env.BIOMETRIC_PORT || 8080;
            
            console.log('🔐 Starting biometric integration...');
            const biometricIntegration = new BiometricIntegration(biometricPort);
            biometricIntegration.start();
            
            // Connect integration with controller
            setBiometricIntegration(biometricIntegration);
            
            // Store reference for potential cleanup
            app.biometricIntegration = biometricIntegration;
        }
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
};

startServer();

module.exports = app;
