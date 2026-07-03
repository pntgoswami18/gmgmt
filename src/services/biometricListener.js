const net = require('net');
const EventEmitter = require('events');
const logger = require('../utils/logger').child({ service: 'biometricListener' });
const os = require('os');

class BiometricListener extends EventEmitter {
  constructor(port = 8080, host = '0.0.0.0') {
    super();
    this.port = port;
    this.host = host;
    this.server = null;
    this.clients = new Set();
  }

  start() {
    logger.info(`🖥️  Starting biometric listener on ${os.platform()} ${os.arch()}`);

    this.server = net.createServer((socket) => {
      logger.info(`📱 Biometric device connected: ${socket.remoteAddress}:${socket.remotePort}`);
      logger.info(
        `🌐 Server platform: ${os.platform()}, Total connections: ${this.clients.size + 1}`
      );
      this.clients.add(socket);

      // Handle incoming data
      socket.on('data', (data) => {
        try {
          const message = data.toString().trim();
          logger.debug({ byteLength: message.length }, 'received biometric data');

          // Parse the message based on device protocol
          this.parseAndHandleBiometricData(message, socket);
        } catch (error) {
          logger.error({ err: error }, 'error processing biometric data');
          this.emit('error', error);
        }
      });

      // Handle client disconnection
      socket.on('close', () => {
        logger.info('Biometric device disconnected');
        this.clients.delete(socket);
        this.emit('deviceDisconnected');
      });

      // Handle socket errors
      socket.on('error', (error) => {
        logger.error({ err: error }, 'socket error');
        this.clients.delete(socket);
        this.emit('error', error);
      });

      this.emit('deviceConnected', socket);
    });

    this.server.listen(this.port, this.host, () => {
      logger.info(`Biometric listener started on ${this.host}:${this.port}`);
      this.emit('serverStarted');
    });

    this.server.on('error', (error) => {
      logger.error({ err: error }, 'server error');
      this.emit('error', error);
    });
  }

  parseAndHandleBiometricData(message, socket) {
    // This method handles various message formats from biometric devices
    // Common formats: JSON, CSV, or custom delimited strings

    try {
      // Example parsing - adjust based on your device's actual format
      let biometricData;

      // If the message is JSON
      if (message.startsWith('{')) {
        biometricData = JSON.parse(message);
        // Ensure we have a memberId field - could be same as userId or different
        if (!biometricData.memberId && biometricData.userId) {
          biometricData.memberId =
            biometricData.memberId || biometricData.employeeId || biometricData.userId;
        }

        // ESP32 specific handling
        if (biometricData.deviceType === 'esp32_door_lock') {
          logger.info({ deviceId: biometricData.deviceId }, 'ESP32 door lock message received');
          biometricData.isESP32Device = true;
        }
      }
      // ESP32 devices use JSON format primarily
      // If the message is comma-separated values
      else if (message.includes(',')) {
        const parts = message.split(',');
        biometricData = {
          userId: parts[0],
          memberId: parts[4] || parts[0], // Member ID might be in 5th position, fallback to userId
          timestamp: parts[1],
          status: parts[2], // 'authorized' or 'unauthorized'
          deviceId: parts[3],
        };
      }
      // If the message is a simple string format
      else {
        biometricData = {
          rawMessage: message,
          timestamp: new Date().toISOString(),
        };
      }

      logger.debug(
        { userId: biometricData?.userId, status: biometricData?.status },
        'parsed biometric data'
      );

      // Emit events based on authorization status
      if (biometricData.status === 'authorized' || biometricData.status === '1') {
        this.emit('accessGranted', biometricData);
      } else if (biometricData.status === 'unauthorized' || biometricData.status === '0') {
        this.emit('accessDenied', biometricData);
      } else if (
        biometricData.status === 'enrollment_success' ||
        biometricData.status === 'enrollment_failed' ||
        biometricData.status === 'enrollment_progress' ||
        biometricData.status === 'enrolled' ||
        biometricData.enrollmentStep
      ) {
        this.emit('enrollmentData', biometricData);
      } else {
        this.emit('unknownMessage', biometricData);
      }

      // Send acknowledgment back to device if required
      this.sendAcknowledgment(socket, biometricData);
    } catch (error) {
      logger.error({ err: error }, 'error parsing biometric data');
      this.emit('parseError', message, error);
    }
  }

  sendAcknowledgment(socket, data) {
    // Send acknowledgment back to the biometric device
    // Format this according to your device's requirements
    const ack = `ACK:${data.userId || 'unknown'}:${Date.now()}\r\n`;
    socket.write(ack);
  }

  stop() {
    if (this.server) {
      // Close all client connections
      this.clients.forEach((client) => {
        client.end();
      });
      this.clients.clear();

      this.server.close(() => {
        logger.info('Biometric listener stopped');
        this.emit('serverStopped');
      });
    }
  }

  broadcast(message) {
    // Send message to all connected devices
    this.clients.forEach((client) => {
      client.write(message);
    });
  }
}

module.exports = BiometricListener;
