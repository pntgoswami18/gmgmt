require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const { initializeDatabase } = require('./config/sqlite');
const requireSameOrigin = require('./api/middleware/requireSameOrigin');
const WebSocket = require('ws');
const http = require('http');
const logger = require('./utils/logger');
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
const referralRoutes = require('./api/routes/referrals');
const paymentDeactivationRoutes = require('./api/routes/paymentDeactivation');

// Security headers. crossOriginResourcePolicy is relaxed so the React app on a
// different port can still load uploaded images from /uploads.
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    contentSecurityPolicy: false, // CSP is managed by the frontend build; avoid breaking it here
  })
);

// Restrict CORS to configured origins. Set CORS_ORIGINS to a comma-separated list
// (e.g. "http://localhost:3000,https://gym.example.com"). When unset, allow all —
// preserves existing dev behaviour but lets production lock it down.
const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);
if (corsOrigins.includes('*') && corsOrigins.length > 0) {
  logger.error(
    '❌ CORS_ORIGINS contains "*" — wildcards cannot be used with credentials. ' +
      'Set explicit origins or leave CORS_ORIGINS unset for dev.'
  );
  process.exit(1);
}
app.use(
  cors(
    corsOrigins.length > 0
      ? {
          origin: corsOrigins,
          credentials: true,
        }
      : {}
  )
);

app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));

// Throttle the API to blunt brute-force and abuse. Static assets and the SPA
// fallback are not rate limited.
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: Number(process.env.RATE_LIMIT_MAX) || 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: 'Too many requests, please try again later.' },
});
app.use('/api', apiLimiter);

// CSRF guard: block cross-origin browser requests that mutate state. Non-browser
// clients (ESP32 devices, the biometric listener) send no Origin header and pass through.
app.use('/api', (req, res, next) => {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }
  return requireSameOrigin(req, res, next);
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
app.use('/api/firmware', require('./api/routes/firmware'));
app.use('/api/referrals', referralRoutes);
app.use('/api/payment-deactivation', paymentDeactivationRoutes);

// Serve frontend build after API routes so /api/* is not intercepted
const path = require('path');
app.use(express.static(path.join(__dirname, '../client/build')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/build/index.html'));
});

// Initialize database and start server
const PORT = process.env.PORT || 3001;

// Create HTTP server for WebSocket support
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({
  server,
  path: '/ws', // Add a specific path for WebSocket connections
});

// WebSocket connection handling
wss.on('connection', (ws, req) => {
  logger.info(
    { remoteAddress: req.socket.remoteAddress, biometricAvailable: !!app.biometricIntegration },
    'WebSocket client connected'
  );

  // Add client to biometric integration if available
  if (app.biometricIntegration) {
    logger.info('🔌 Adding WebSocket client to biometric integration');
    app.biometricIntegration.addWebSocketClient(ws);
  } else {
    logger.info('⚠️ Biometric integration not available - WebSocket client not added');
  }

  ws.on('close', () => {
    logger.info('🔌 WebSocket client disconnected');
    if (app.biometricIntegration) {
      app.biometricIntegration.removeWebSocketClient(ws);
    }
  });

  ws.on('error', (error) => {
    logger.error({ err: error }, 'webSocket error');
    if (app.biometricIntegration) {
      app.biometricIntegration.removeWebSocketClient(ws);
    }
  });

  // Send welcome message
  ws.send(
    JSON.stringify({
      type: 'connection_established',
      message: 'WebSocket connection established successfully',
      timestamp: new Date().toISOString(),
    })
  );
});

const startServer = async () => {
  try {
    await initializeDatabase();
    logger.info('Database initialized successfully');

    // Initialize settings cache for performance optimization
    const settingsCache = require('./services/settingsCache');
    await settingsCache.initialize();
    logger.info('✅ Settings cache initialized');

    server.listen(PORT, '0.0.0.0', () => {
      logger.info(`Server running on port ${PORT} and accessible from all interfaces`);
      logger.info(`🔌 WebSocket server ready for real-time enrollment updates`);
    });

    // Start biometric integration if enabled
    if (process.env.ENABLE_BIOMETRIC === 'true') {
      logger.info('🔐 ENABLE_BIOMETRIC is true, starting biometric integration...');
      try {
        const BiometricIntegration = require('./services/biometricIntegration');
        const { setBiometricIntegration } = require('./api/controllers/biometricController');
        const {
          setBiometricIntegration: setFirmwareBiometricIntegration,
        } = require('./api/routes/firmware');
        const biometricPort = process.env.BIOMETRIC_PORT || 8080;

        logger.info({ port: biometricPort }, 'creating biometric integration instance');
        const biometricIntegration = new BiometricIntegration(biometricPort);

        logger.info('🔐 Starting biometric integration...');
        biometricIntegration.start();

        logger.info('🔐 Connecting integration with controller...');
        setBiometricIntegration(biometricIntegration);
        setFirmwareBiometricIntegration(biometricIntegration);

        // Store reference for potential cleanup
        app.biometricIntegration = biometricIntegration;
        logger.info('✅ Biometric integration started successfully');
      } catch (error) {
        logger.error({ err: error }, 'failed to start biometric integration');
      }
    } else {
      logger.info('⚠️ ENABLE_BIOMETRIC is not true, biometric integration disabled');
    }

    // Start automatic payment deactivation service
    logger.info('🔄 Starting automatic payment deactivation service...');
    try {
      const PaymentDeactivationService = require('./services/paymentDeactivationService');
      const paymentDeactivationService = new PaymentDeactivationService();

      // Run deactivation check every 6 hours (21600000 ms)
      const deactivationInterval = 6 * 60 * 60 * 1000; // 6 hours

      // Run initial check after 1 minute
      setTimeout(async () => {
        try {
          logger.info('🔄 Running initial payment deactivation check...');
          const result = await paymentDeactivationService.checkAndDeactivateOverdueMembers();
          logger.info({ result }, 'initial payment deactivation check completed');
        } catch (error) {
          logger.error({ err: error }, 'error in initial payment deactivation check');
        }
      }, 60000); // 1 minute delay

      // Set up recurring deactivation checks every 6 hours
      setInterval(async () => {
        try {
          logger.info('🔄 Running scheduled payment deactivation check...');
          const result = await paymentDeactivationService.checkAndDeactivateOverdueMembers();
          logger.info({ result }, 'scheduled payment deactivation check completed');
        } catch (error) {
          logger.error({ err: error }, 'error in scheduled payment deactivation check');
        }
      }, deactivationInterval);

      // Set up daily comprehensive check at 2 AM
      const dailyCheckInterval = 24 * 60 * 60 * 1000; // 24 hours
      const now = new Date();
      const next2AM = new Date(now);
      next2AM.setHours(2, 0, 0, 0);
      if (next2AM <= now) {
        next2AM.setDate(next2AM.getDate() + 1);
      }
      const timeUntil2AM = next2AM.getTime() - now.getTime();

      setTimeout(() => {
        // Run daily check
        const runDailyCheck = async () => {
          try {
            logger.info('🔄 Running daily comprehensive payment deactivation check...');
            const result = await paymentDeactivationService.checkAndDeactivateOverdueMembers();
            logger.info({ result }, 'daily payment deactivation check completed');
          } catch (error) {
            logger.error({ err: error }, 'error in daily payment deactivation check');
          }
        };

        runDailyCheck();

        // Set up recurring daily checks
        setInterval(runDailyCheck, dailyCheckInterval);
      }, timeUntil2AM);

      logger.info(
        `✅ Automatic payment deactivation service started (every 6 hours + daily at 2 AM)`
      );
    } catch (error) {
      logger.error({ err: error }, 'failed to start payment deactivation service');
    }
  } catch (error) {
    logger.error({ err: error }, 'failed to start server');
    process.exit(1);
  }
};

startServer();

module.exports = app;
