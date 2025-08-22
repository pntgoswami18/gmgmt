const net = require('net');
const EventEmitter = require('events');
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
    console.log(`🖥️  Starting biometric listener on ${os.platform()} ${os.arch()}`);
    
    this.server = net.createServer((socket) => {
      console.log(`📱 Biometric device connected: ${socket.remoteAddress}:${socket.remotePort}`);
      console.log(`🌐 Server platform: ${os.platform()}, Total connections: ${this.clients.size + 1}`);
      this.clients.add(socket);

      // Handle incoming data
      socket.on('data', (data) => {
        try {
          const message = data.toString().trim();
          console.log('Received biometric data:', message);
          
          // Parse the message based on device protocol
          this.parseAndHandleBiometricData(message, socket);
        } catch (error) {
          console.error('Error processing biometric data:', error);
          this.emit('error', error);
        }
      });

      // Handle client disconnection
      socket.on('close', () => {
        console.log('Biometric device disconnected');
        this.clients.delete(socket);
        this.emit('deviceDisconnected');
      });

      // Handle socket errors
      socket.on('error', (error) => {
        console.error('Socket error:', error);
        this.clients.delete(socket);
        this.emit('error', error);
      });

      this.emit('deviceConnected', socket);
    });

    this.server.listen(this.port, this.host, () => {
      console.log(`Biometric listener started on ${this.host}:${this.port}`);
      this.emit('serverStarted');
    });

    this.server.on('error', (error) => {
      console.error('Server error:', error);
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
          biometricData.memberId = biometricData.memberId || biometricData.employeeId || biometricData.userId;
        }
        
        // ESP32 specific handling
        if (biometricData.deviceType === 'esp32_door_lock') {
          console.log(`📱 ESP32 Door Lock message from ${biometricData.deviceId}`);
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
          deviceId: parts[3]
        };
      }
      // If the message is a simple string format
      else {
        biometricData = {
          rawMessage: message,
          timestamp: new Date().toISOString()
        };
      }

      console.log('Parsed biometric data:', biometricData);
      
      // Emit events based on authorization status
      if (biometricData.status === 'authorized' || biometricData.status === '1') {
        this.emit('accessGranted', biometricData);
      } else if (biometricData.status === 'unauthorized' || biometricData.status === '0') {
        this.emit('accessDenied', biometricData);
      } else if (biometricData.status === 'enrollment_success' || 
                 biometricData.status === 'enrollment_failed' ||
                 biometricData.status === 'enrollment_progress' ||
                 biometricData.status === 'enrolled' ||
                 biometricData.enrollmentStep) {
        this.emit('enrollmentData', biometricData);
      } else {
        this.emit('unknownMessage', biometricData);
      }

      // Send acknowledgment back to device if required
      this.sendAcknowledgment(socket, biometricData);
      
    } catch (error) {
      console.error('Error parsing biometric data:', error);
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
      this.clients.forEach(client => {
        client.end();
      });
      this.clients.clear();

      this.server.close(() => {
        console.log('Biometric listener stopped');
        this.emit('serverStopped');
      });
    }
  }

  broadcast(message) {
    // Send message to all connected devices
    this.clients.forEach(client => {
      client.write(message);
    });
  }
}

module.exports = BiometricListener;
