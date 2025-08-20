const net = require('net');
const EventEmitter = require('events');

class BiometricListener extends EventEmitter {
  constructor(port = 8080, host = '0.0.0.0') {
    super();
    this.port = port;
    this.host = host;
    this.server = null;
    this.clients = new Set();
  }

  start() {
    this.server = net.createServer((socket) => {
      console.log(`Biometric device connected: ${socket.remoteAddress}:${socket.remotePort}`);
      this.clients.add(socket);

      // Handle incoming data
      socket.on('data', (data) => {
        try {
          const message = data.toString().trim();
          console.log('Received biometric data:', message);
          
          // Parse the message based on SecureEye protocol
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
    // This method needs to be customized based on SecureEye's message format
    // Common formats might be JSON, XML, or custom delimited strings
    
    try {
      // Example parsing - adjust based on your device's actual format
      let biometricData;
      
      // If the message is JSON
      if (message.startsWith('{')) {
        biometricData = JSON.parse(message);
      }
      // If the message is XML (SecureEye S560 format)
      else if (message.startsWith('<?xml') || message.includes('<Message>')) {
        biometricData = this.parseSecureEyeXML(message);
      }
      // If the message is comma-separated values
      else if (message.includes(',')) {
        const parts = message.split(',');
        biometricData = {
          userId: parts[0],
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

  parseSecureEyeXML(xmlMessage) {
    // Parse SecureEye S560 XML format
    try {
      // Extract key fields using regex (simple XML parsing)
      const getUserId = (xml) => {
        const match = xml.match(/<UserID>(\d+)<\/UserID>/);
        return match ? match[1] : null;
      };

      const getField = (xml, fieldName) => {
        const match = xml.match(new RegExp(`<${fieldName}>(.*?)<\/${fieldName}>`));
        return match ? match[1] : null;
      };

      const userId = getUserId(xmlMessage);
      const event = getField(xmlMessage, 'Event');
      const verifMode = getField(xmlMessage, 'VerifMode');
      const attendStat = getField(xmlMessage, 'AttendStat');
      const terminalType = getField(xmlMessage, 'TerminalType');
      const deviceUID = getField(xmlMessage, 'DeviceUID');
      const transID = getField(xmlMessage, 'TransID');
      
      // Build timestamp from individual components
      const year = getField(xmlMessage, 'Year');
      const month = getField(xmlMessage, 'Month');
      const day = getField(xmlMessage, 'Day');
      const hour = getField(xmlMessage, 'Hour');
      const minute = getField(xmlMessage, 'Minute');
      const second = getField(xmlMessage, 'Second');
      
      let timestamp = new Date().toISOString();
      if (year && month && day && hour && minute && second) {
        // Create proper ISO timestamp
        const isoDate = new Date(
          parseInt(year),
          parseInt(month) - 1, // Month is 0-indexed in JS
          parseInt(day),
          parseInt(hour),
          parseInt(minute),
          parseInt(second)
        );
        timestamp = isoDate.toISOString();
      }

      // Determine status based on event type and verification mode
      let status = 'unknown';
      if (event === 'TimeLog' && verifMode === 'FP' && userId) {
        // Successful fingerprint attendance logging
        status = 'authorized';
      } else if (event === 'Enroll' || event === 'EnrollUser' || event === 'UserEnroll') {
        // Enrollment events
        status = 'enrollment_success';
      } else if (event === 'Delete' || event === 'DeleteUser') {
        // User deletion events
        status = 'user_deleted';
      }

      return {
        userId: userId,
        timestamp: timestamp,
        status: status,
        deviceId: deviceUID || terminalType,
        event: event,
        verifMode: verifMode,
        attendStat: attendStat,
        terminalType: terminalType,
        transactionId: transID,
        rawMessage: xmlMessage
      };

    } catch (error) {
      console.error('Error parsing SecureEye XML:', error);
      return {
        rawMessage: xmlMessage,
        timestamp: new Date().toISOString(),
        status: 'parse_error',
        error: error.message
      };
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
