#!/usr/bin/env node

require('dotenv').config();
const BiometricIntegration = require('./services/biometricIntegration');

// Configuration
const PORT = process.env.BIOMETRIC_PORT || 8080;
const HOST = process.env.BIOMETRIC_HOST || '0.0.0.0';

console.log('🔐 Starting SecureEye Biometric Integration...');
console.log(`📡 Listening on ${HOST}:${PORT}`);
console.log('📋 Make sure your SecureEye device is configured to send data to this address');

const biometricIntegration = new BiometricIntegration(PORT);

// Start the integration
biometricIntegration.start();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down biometric integration...');
  biometricIntegration.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n🛑 Shutting down biometric integration...');
  biometricIntegration.stop();
  process.exit(0);
});

// Keep the process alive
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Don't exit, just log the error
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit, just log the error
});
