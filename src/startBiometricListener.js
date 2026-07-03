#!/usr/bin/env node

require('dotenv').config();
const BiometricIntegration = require('./services/biometricIntegration');
const logger = require('./utils/logger').child({ service: 'biometricListener' });

// Configuration
const PORT = process.env.BIOMETRIC_PORT || 8080;
const HOST = process.env.BIOMETRIC_HOST || '0.0.0.0';

logger.info('🔐 Starting ESP32 Biometric Integration...');
logger.info(`📡 Listening on ${HOST}:${PORT}`);
logger.info('📋 Make sure your ESP32 devices are configured to send data to this address');

const biometricIntegration = new BiometricIntegration(PORT);

// Start the integration
biometricIntegration.start();

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('\n🛑 Shutting down biometric integration...');
  biometricIntegration.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.info('\n🛑 Shutting down biometric integration...');
  biometricIntegration.stop();
  process.exit(0);
});

// Keep the process alive
process.on('uncaughtException', (error) => {
  logger.error({ err: error }, 'uncaught Exception');
  // Don't exit, just log the error
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason, promise }, 'unhandled rejection');
  // Don't exit, just log the error
});
