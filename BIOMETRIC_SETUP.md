# SecureEye Biometric Integration Setup

This guide will help you set up TCP/IP communication between your SecureEye biometric device and your gym management system.

## Overview

The biometric integration allows your gym management system to:
- Listen for biometric authentication events from SecureEye devices
- Automatically log member attendance when they scan their fingerprint
- Control access based on active membership plans
- Maintain security logs of access attempts

## Prerequisites

1. SecureEye biometric device with TCP/IP communication capability
2. Device and server on the same network (or proper port forwarding configured)
3. Node.js application running (your gym management system)

## Setup Steps

### 1. Configure Your SecureEye Device

**Network Settings:**
- Configure your SecureEye device to send data to your server's IP address
- Set the target port (default: 8080)
- Enable TCP/IP communication mode
- Set the device to "real-time" or "push" mode for immediate data transmission

**Common SecureEye Configuration Steps:**
1. Access device admin panel (usually via web interface or software)
2. Go to Network/Communication settings
3. Set Protocol to TCP/IP
4. Set Server IP to your computer's IP address
5. Set Server Port to 8080 (or your chosen port)
6. Enable "Real-time upload" or "Push data"
7. Save and restart the device

### 2. Database Setup

Add a biometric_id field to your members table:

```sql
ALTER TABLE members ADD COLUMN biometric_id TEXT UNIQUE;
```

Create a security_logs table (optional but recommended):

```sql
CREATE TABLE IF NOT EXISTS security_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    details TEXT,
    member_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

### 3. Environment Configuration

Add these environment variables to your `.env` file:

```env
# Enable biometric integration
ENABLE_BIOMETRIC=true

# Biometric listener port (default: 8080)
BIOMETRIC_PORT=8080

# Biometric listener host (default: 0.0.0.0 for all interfaces)
BIOMETRIC_HOST=0.0.0.0
```

### 4. Member Setup

For each member who will use biometric access:
1. Enroll their fingerprint on the SecureEye device
2. Note the biometric ID assigned by the device
3. Update the member record in your database:

```sql
UPDATE members SET biometric_id = 'DEVICE_USER_ID' WHERE id = MEMBER_ID;
```

## Usage

### Method 1: Integrated with Main Application

Start your gym management system with biometric integration enabled:

```bash
# Set environment variable and start
ENABLE_BIOMETRIC=true npm start
```

### Method 2: Standalone Biometric Listener

Run the biometric listener as a separate process:

```bash
# Using Node.js directly
node src/startBiometricListener.js

# Or make it executable and run
chmod +x src/startBiometricListener.js
./src/startBiometricListener.js
```

### Method 3: Using PM2 (Recommended for Production)

```bash
# Install PM2 if not already installed
npm install -g pm2

# Start with PM2
pm2 start src/startBiometricListener.js --name "biometric-listener"

# Save PM2 configuration
pm2 save

# Set up PM2 to start on boot
pm2 startup
```

## Message Formats

The system can handle various message formats from SecureEye devices:

### JSON Format
```json
{
  "userId": "12345",
  "timestamp": "2024-01-15T10:30:00Z",
  "status": "authorized",
  "deviceId": "DEVICE001"
}
```

### CSV Format
```
12345,2024-01-15T10:30:00Z,authorized,DEVICE001
```

### Simple String Format
```
USER:12345:AUTHORIZED:DEVICE001
```

## Troubleshooting

### Common Issues

**1. Device Not Connecting**
- Check network connectivity between device and server
- Verify firewall settings (port 8080 should be open)
- Ensure the device is configured with correct server IP and port
- Check if another service is using port 8080

**2. Messages Not Being Received**
- Verify the device is sending data in real-time mode
- Check the message format matches what your parser expects
- Look at console logs for parsing errors
- Test with telnet: `telnet YOUR_SERVER_IP 8080`

**3. Members Not Found**
- Ensure biometric_id is set correctly in the members table
- Verify the device is sending the correct user ID format
- Check for case sensitivity issues

**4. Access Control Issues**
- Verify member has an active plan in the database
- Check plan start/end dates
- Ensure the plan status is 'active'

### Testing the Connection

**Test 1: Manual TCP Connection**
```bash
# Test if the port is listening
telnet localhost 8080

# Send test data
USER:12345:AUTHORIZED:DEVICE001
```

**Test 2: Using netcat (nc)**
```bash
# Send test message
echo "USER:12345:AUTHORIZED:DEVICE001" | nc localhost 8080
```

**Test 3: Using curl**
```bash
# For HTTP-like testing (if needed)
curl -X POST -d "USER:12345:AUTHORIZED:DEVICE001" http://localhost:8080
```

### Monitoring

**View Real-time Logs:**
```bash
# If using PM2
pm2 logs biometric-listener

# If running directly
tail -f /path/to/your/logfile
```

**Check System Status:**
```bash
# Check if port is listening
netstat -tlnp | grep 8080

# Check active connections
ss -tnlp | grep 8080
```

## Security Considerations

1. **Network Security:**
   - Use VPN or secure network for device communication
   - Consider using TLS encryption if supported by your device
   - Implement IP whitelisting for device connections

2. **Data Security:**
   - Log all access attempts for audit purposes
   - Implement rate limiting to prevent spam
   - Consider adding device authentication

3. **Access Control:**
   - Regularly review and update member access rights
   - Implement emergency override procedures
   - Log all administrative actions

## Advanced Configuration

### Custom Message Parsing

To modify the message parsing logic, edit the `parseAndHandleBiometricData` method in `src/services/biometricListener.js`:

```javascript
parseAndHandleBiometricData(message, socket) {
  // Your custom parsing logic here
  // Based on your specific SecureEye device format
}
```

### Adding Custom Actions

You can extend the system to perform additional actions:

```javascript
// In biometricIntegration.js
async handleAccessGranted(biometricData) {
  // Existing logic...
  
  // Add custom actions:
  await this.sendWelcomeMessage(member);
  await this.updateLoyaltyPoints(member);
  await this.triggerDoorUnlock();
}
```

### Integration with External Systems

The biometric integration can be extended to work with:
- Door access control systems
- Camera systems for photo capture
- SMS/Email notification services
- Third-party security systems

## Support

If you encounter issues:
1. Check the troubleshooting section above
2. Review the console logs for error messages
3. Verify your SecureEye device documentation for specific protocol details
4. Test the network connection manually

For device-specific configuration, consult your SecureEye device manual or contact their technical support.
