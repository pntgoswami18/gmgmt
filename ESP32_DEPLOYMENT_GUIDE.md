# ESP32 Door Lock Deployment Guide

## 🚀 Production Deployment Checklist

### Pre-Deployment Requirements
- [ ] Hardware assembled and tested
- [ ] ESP32 firmware uploaded and configured
- [ ] Network infrastructure ready (WiFi, static IP)
- [ ] Gym management system updated with ESP32 support
- [ ] Database schema updated
- [ ] All tests passing

### 1. Environment Setup

#### Server Configuration

**Windows:**
```powershell
# Update your .env file
Add-Content .env "ENABLE_BIOMETRIC=true"
Add-Content .env "BIOMETRIC_PORT=8080"
Add-Content .env "BIOMETRIC_HOST=0.0.0.0"
Add-Content .env "WIN_DATA_ROOT=C:/ProgramData/gmgmt"

# Create data directory
New-Item -ItemType Directory -Force -Path "C:/ProgramData/gmgmt"

# Setup ESP32 database tables
npm run esp32:setup

# Test the integration
npm run esp32:test
```

**Unix/macOS:**
```bash
# Update your .env file
echo "ENABLE_BIOMETRIC=true" >> .env
echo "BIOMETRIC_PORT=8080" >> .env
echo "BIOMETRIC_HOST=0.0.0.0" >> .env

# Setup ESP32 database tables
npm run esp32:setup

# Test the integration
npm run esp32:test
```

#### Network Configuration

**Windows Firewall:**
```powershell
# Allow inbound traffic on port 8080
New-NetFirewallRule -DisplayName "Gym Management Biometric Port" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow

# For production, restrict to specific IP range
New-NetFirewallRule -DisplayName "Gym Management Biometric LAN" -Direction Inbound -Protocol TCP -LocalPort 8080 -RemoteAddress 192.168.1.0/24 -Action Allow

# Check firewall rules
Get-NetFirewallRule -DisplayName "*Gym Management*" | Format-Table
```

**Linux/macOS:**
```bash
# Ensure firewall allows biometric port
sudo ufw allow 8080/tcp

# For production, consider specific IP restrictions
sudo ufw allow from 192.168.1.0/24 to any port 8080
```

### 2. ESP32 Device Configuration

#### WiFi Configuration
Update ESP32 firmware with production settings:
```cpp
// Production WiFi settings
const char* WIFI_SSID = "GYM_NETWORK";
const char* WIFI_PASSWORD = "secure_password";

// Production server settings
const char* GYM_SERVER_IP = "192.168.1.100";  // Your server IP
const int GYM_SERVER_PORT = 8080;
const char* DEVICE_ID = "DOOR_MAIN_ENTRANCE";  // Unique per device
```

#### Device Registration
```bash
# Register device in system
curl -X POST http://localhost:3000/api/biometric/devices \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "DOOR_MAIN_ENTRANCE",
    "device_name": "Main Entrance",
    "location": "Front Door",
    "device_type": "esp32_door_lock"
  }'
```

### 3. Physical Installation

#### Mounting Requirements
- **ESP32 Enclosure**: IP65 rated, accessible for maintenance
- **Fingerprint Sensor**: Eye-level mounting (120-150cm height)
- **Door Lock**: Properly aligned with door frame
- **Power Supply**: Protected location, surge protection
- **Network**: Strong WiFi signal, backup ethernet if possible

#### Wiring Safety
- [ ] All 12V connections properly insulated
- [ ] ESP32 powered from regulated 5V supply
- [ ] Relay rated for door lock current
- [ ] Emergency override accessible but secure

### 4. Security Configuration

#### Network Security
```bash
# Change default passwords
# Use WPA3 encryption on WiFi
# Consider VPN for device communication
# Regular security updates

# Monitor device connections
tail -f /var/log/gym-management/biometric.log | grep ESP32
```

#### Access Control
```sql
-- Create admin user for device management
INSERT INTO users (username, role, permissions) 
VALUES ('device_admin', 'admin', 'device_control,biometric_manage');

-- Log all device commands
CREATE TRIGGER log_device_commands 
AFTER INSERT ON device_commands 
FOR EACH ROW 
BEGIN
  INSERT INTO audit_log (action, details, timestamp) 
  VALUES ('device_command', NEW.command, datetime('now'));
END;
```

### 5. Monitoring & Alerting

#### System Monitoring
```bash
# Add to cron for health checks
*/5 * * * * curl -s http://localhost:3000/api/biometric/devices/DOOR_MAIN_ENTRANCE/status || echo "Device offline"

# Monitor system resources
watch -n 5 'ps aux | grep node; free -h; df -h'
```

#### Alert Configuration
```javascript
// Add to biometricIntegration.js
async handleDeviceOffline(deviceId) {
  console.log(`🚨 Device ${deviceId} is offline`);
  
  // Send email alert
  await this.sendAlert(`Device ${deviceId} offline`, 'Device has not sent heartbeat for 10 minutes');
  
  // Log security event
  await this.logSecurityEvent('device_offline', deviceId);
}
```

### 6. Production Startup Sequence

#### Step 1: Start Server Services
```bash
# Using PM2 (recommended)
npm install -g pm2

# Start biometric service
pm2 start src/startBiometricListener.js --name "biometric-listener"

# Start main application with biometric integration
pm2 start src/app.js --name "gym-management" --env production

# Save PM2 configuration
pm2 save
pm2 startup
```

#### Step 2: Verify Server Health
```bash
# Check service status
pm2 status

# Verify biometric listener is running
npm run biometric:check

# Test API endpoints
curl http://localhost:3000/api/biometric/status
```

#### Step 3: Power On ESP32 Devices
```bash
# Monitor device connections
tail -f logs/biometric.log

# Expected output:
# ESP32 device connected: 192.168.1.150:52341
# Heartbeat received from DOOR_MAIN_ENTRANCE
```

#### Step 4: Initial Testing
```bash
# Test full integration
npm run esp32:test

# Test specific device
curl http://localhost:3000/api/biometric/devices/DOOR_MAIN_ENTRANCE/status
```

### 7. User Training & Documentation

#### Staff Training Checklist
- [ ] How to enroll new member fingerprints
- [ ] How to remove member access
- [ ] Emergency override procedures
- [ ] System status monitoring
- [ ] Basic troubleshooting

#### Emergency Procedures
```
1. Power Failure:
   - System automatically recovers when power restored
   - Manual override key available for physical access
   - UPS recommended for critical installations

2. Network Failure:
   - Device continues working in offline mode
   - Access attempts cached locally
   - Data synchronized when network returns

3. Device Malfunction:
   - Use manual override button
   - Contact technical support
   - Backup access methods available

4. Server Failure:
   - Devices continue autonomous operation
   - Local web interface still accessible
   - Manual gym check-in procedures available
```

### 8. Maintenance Schedule

#### Daily Checks
- [ ] Device status dashboard review
- [ ] Failed access attempt analysis
- [ ] System performance monitoring

#### Weekly Maintenance
- [ ] Fingerprint sensor cleaning
- [ ] Device enclosure inspection
- [ ] Network connectivity verification
- [ ] Battery backup testing (if applicable)

#### Monthly Maintenance
- [ ] Firmware update checks
- [ ] Security log review
- [ ] Database optimization
- [ ] Performance benchmarking

#### Quarterly Maintenance
- [ ] Full system backup
- [ ] Hardware stress testing
- [ ] Security audit
- [ ] Documentation updates

### 9. Performance Monitoring

#### Key Metrics to Track
```sql
-- Device uptime monitoring
SELECT 
  device_id,
  COUNT(*) as heartbeat_count,
  MIN(timestamp) as first_heartbeat,
  MAX(timestamp) as last_heartbeat,
  (julianday('now') - julianday(MAX(timestamp))) * 24 * 60 as minutes_since_last_heartbeat
FROM biometric_events 
WHERE event_type = 'heartbeat' 
  AND timestamp > datetime('now', '-24 hours')
GROUP BY device_id;

-- Access success rate
SELECT 
  device_id,
  COUNT(*) as total_attempts,
  SUM(CASE WHEN event_type = 'checkin' THEN 1 ELSE 0 END) as successful_access,
  ROUND(SUM(CASE WHEN event_type = 'checkin' THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as success_rate
FROM biometric_events 
WHERE device_id LIKE 'DOOR_%' 
  AND timestamp > datetime('now', '-7 days')
GROUP BY device_id;
```

#### Performance Dashboards
- Real-time device status
- Daily access statistics
- Member enrollment status
- Network health metrics
- Security event timeline

### 10. Backup & Recovery

#### Database Backup
```bash
# Daily backup script
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
sqlite3 data/gmgmt.sqlite ".backup data/backups/gmgmt_${DATE}.sqlite"

# Keep only last 30 days of backups
find data/backups/ -name "gmgmt_*.sqlite" -mtime +30 -delete
```

#### Configuration Backup
```bash
# Backup ESP32 configurations
mkdir -p backups/esp32_configs/
cp esp32_door_lock.ino backups/esp32_configs/
cp tools/setup_esp32_devices.sql backups/esp32_configs/
```

#### Recovery Procedures
1. **Database Recovery**:
   ```bash
   cp data/backups/gmgmt_YYYYMMDD_HHMMSS.sqlite data/gmgmt.sqlite
   npm restart
   ```

2. **ESP32 Recovery**:
   - Reflash firmware from backup
   - Restore device configuration
   - Re-enroll fingerprints if necessary

3. **Network Recovery**:
   - Verify network configuration
   - Check firewall rules
   - Test device connectivity

### 11. Troubleshooting Guide

#### Common Issues

**Issue**: ESP32 won't connect to WiFi
```bash
# Solution:
1. Check WiFi credentials in firmware
2. Verify network is broadcasting
3. Check signal strength at installation location
4. Try different WiFi channel
```

**Issue**: Fingerprint sensor not responding
```bash
# Solution:
1. Check sensor wiring (VCC, GND, TX, RX)
2. Verify sensor power (3.3V)
3. Clean sensor surface
4. Check serial communication baud rate
```

**Issue**: Door lock not activating
```bash
# Solution:
1. Check relay wiring and power
2. Verify 12V supply to lock
3. Test relay manually
4. Check lock mechanism alignment
```

**Issue**: Server not receiving messages

**Windows:**
```powershell
# Check network connectivity
Test-NetConnection -ComputerName localhost -Port 8080

# Check firewall status
Get-NetFirewallRule -DisplayName "*Gym Management*"

# Monitor TCP connections
netstat -an | findstr 8080

# Test with PowerShell
$client = New-Object System.Net.Sockets.TcpClient
$client.Connect("localhost", 8080)
$client.Connected  # Should return True
$client.Close()

# Windows-specific diagnostics
npm run esp32:test:windows
```

**Linux/macOS:**
```bash
# Solution:
1. Check network connectivity
2. Verify server IP and port
3. Check firewall settings
4. Monitor TCP connections: netstat -an | grep 8080
```

#### Windows-Specific Troubleshooting

**Windows Defender/Antivirus Blocking:**
```powershell
# Add Node.js to Windows Defender exclusions
Add-MpPreference -ExclusionProcess "node.exe"
Add-MpPreference -ExclusionPath "C:\Path\To\Your\Project"

# Check if Windows Defender is blocking the port
Get-MpPreference | Select-Object -ExpandProperty ExclusionProcess
```

**PowerShell Execution Policy:**
```powershell
# Check current execution policy
Get-ExecutionPolicy

# Set execution policy for current user (if needed)
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

**Windows Service Installation:**
```powershell
# Install as Windows service using pm2-windows-service
npm install -g pm2
npm install -g pm2-windows-service

# Create service
pm2-service-install -n "GymManagement"

# Start service
pm2 start src/app.js --name "gym-management"
pm2 save
```

**Network Adapter Issues:**
```powershell
# Check network adapters
Get-NetAdapter | Where-Object {$_.Status -eq "Up"}

# Reset network stack (run as administrator)
netsh winsock reset
netsh int ip reset
# Restart required after this

# Check IP configuration
ipconfig /all
```

**SQLite Issues on Windows:**
```powershell
# Install SQLite tools for Windows
# Download from: https://sqlite.org/download.html
# Add to PATH environment variable

# Alternative: Use Windows Subsystem for Linux (WSL)
wsl --install
# Then run Linux commands in WSL terminal

# Or use better-sqlite3 (included in fallback)
npm install better-sqlite3
```

### 12. Support & Maintenance

#### Contact Information
- **Technical Support**: [Your contact info]
- **Emergency Contact**: [24/7 support if available]
- **Documentation**: [Link to online docs]

#### Version Control
- **Firmware Version**: Track ESP32 firmware versions
- **Server Version**: Track gym management system versions
- **Database Schema**: Track database migration versions

#### Update Procedures
1. **Test Environment**: Always test updates first
2. **Backup**: Create backups before updates
3. **Rollback Plan**: Have rollback procedures ready
4. **Monitoring**: Monitor system after updates

---

## 🎉 Deployment Complete!

Your ESP32 fingerprint door lock system is now ready for production use. The system provides:

- ✅ **Automated Access Control**: Fingerprint-based door entry
- ✅ **Real-time Monitoring**: Live device status and access logs
- ✅ **Remote Management**: Control devices from web dashboard
- ✅ **Secure Integration**: Seamless integration with gym management system
- ✅ **Scalable Architecture**: Easy to add more devices

For ongoing support and feature requests, refer to the maintenance schedule and contact procedures above.
