# 🔐 Biometric Integration Guide

Complete setup and usage guide for SecureEye biometric integration with your gym management system.

## 📋 Table of Contents

1. [Overview](#overview)
2. [Quick Start](#quick-start)
3. [Device Setup](#device-setup)
4. [System Configuration](#system-configuration)
5. [Member Management](#member-management)
6. [Testing & Debugging](#testing--debugging)
7. [Admin Dashboard](#admin-dashboard)
8. [Troubleshooting](#troubleshooting)
9. [Production Deployment](#production-deployment)
10. [Security & Maintenance](#security--maintenance)

---

## Overview

Your gym management system integrates with SecureEye biometric devices to provide:

- **Automated Check-ins**: Fingerprint-based attendance tracking
- **Access Control**: Plan validation and membership verification
- **Real-time Monitoring**: Live event tracking and status monitoring
- **Secure Enrollment**: Easy fingerprint enrollment for members

### System Architecture
```
SecureEye Device → TCP/IP → Biometric Listener → Integration Service → Database
                                      ↓
Frontend Dashboard ← REST API ← Controller ← Integration Service
```

---

## Quick Start

### 1. Database Setup
```bash
npm run biometric:setup
```

### 2. Environment Configuration
Add to your `.env` file:
```env
ENABLE_BIOMETRIC=true
BIOMETRIC_PORT=8080
BIOMETRIC_HOST=0.0.0.0
```

### 3. Start the System
```bash
# Option A: Integrated with main app
npm run start:with-biometric

# Option B: Separate biometric service
npm run biometric:start
```

### 4. Verify Connection
```bash
npm run biometric:check
```

---

## Device Setup

### SecureEye Device Configuration

**Network Settings:**
- Configure device to send data to your server's IP address
- Set target port to your `BIOMETRIC_PORT` from `.env` file
- Enable TCP/IP communication mode
- Set device to "real-time" or "push" mode

**Configuration Steps:**
1. Access device admin panel (web interface or software)
2. Go to Network/Communication settings
3. Set Protocol to TCP/IP
4. Set Server IP to your computer's IP address
5. Set Server Port to your `BIOMETRIC_PORT` value
6. Enable "Real-time upload" or "Push data"
7. Save and restart the device

### Supported Message Formats

**JSON Format:**
```json
{
  "userId": "12345",
  "timestamp": "2024-01-15T10:30:00Z",
  "status": "authorized",
  "deviceId": "DEVICE001"
}
```

**CSV Format:**
```
12345,2024-01-15T10:30:00Z,authorized,DEVICE001
```

**Simple String Format:**
```
USER:12345:AUTHORIZED:DEVICE001
```

---

## System Configuration

### Environment Variables

Configure these in your `.env` file:

```env
# Enable biometric integration
ENABLE_BIOMETRIC=true

# Biometric listener configuration
BIOMETRIC_PORT=8080
BIOMETRIC_HOST=0.0.0.0

# Optional: Windows data directory
WIN_DATA_ROOT=C:/ProgramData/gmgmt
```

### Database Schema

The system automatically creates these tables:

```sql
-- Enhanced members table
ALTER TABLE members ADD COLUMN biometric_id TEXT UNIQUE;

-- Biometric mapping table
CREATE TABLE member_biometrics (
    id INTEGER PRIMARY KEY,
    member_id INTEGER REFERENCES members(id),
    device_user_id TEXT UNIQUE,
    template TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

-- Biometric events log
CREATE TABLE biometric_events (
    id INTEGER PRIMARY KEY,
    member_id INTEGER,
    biometric_id TEXT,
    event_type TEXT NOT NULL,
    device_id TEXT,
    timestamp TEXT NOT NULL,
    success BOOLEAN NOT NULL,
    error_message TEXT,
    raw_data TEXT
);
```

---

## Member Management

### Enrolling Members

**Via Admin Dashboard:**
1. Navigate to Members → Biometric section
2. Select member to enroll
3. Click "Start Enrollment"
4. Follow on-screen instructions for fingerprint scanning
5. System will confirm successful enrollment

**Via API:**
```bash
# Link device user ID to member
curl -X PUT /api/members/123/biometric \
  -H "Content-Type: application/json" \
  -d '{"device_user_id": "1234", "template": "optional_base64"}'
```

### Member Check-in Flow

1. **First Scan**: Member checks IN, attendance logged
2. **Second Scan**: Member checks OUT (same day)
3. **Plan Validation**: Only active members can access
4. **Working Hours**: Configurable morning/evening sessions

---

## Testing & Debugging

### Built-in Test Commands (Cross-Platform)

```bash
# Check if biometric service is listening
npm run biometric:check

# Send comprehensive test messages
npm run biometric:test

# Get help for all available test options
npm run biometric:help
```

### Manual Testing

**Unix/macOS:**
```bash
# Test connection
echo "USER:12345:AUTHORIZED:TEST001" | nc localhost $BIOMETRIC_PORT
```

**Windows:**
```powershell
# Test using PowerShell
$port = (Get-Content .env | Where-Object {$_ -match "BIOMETRIC_PORT"}).Split("=")[1]
$client = New-Object System.Net.Sockets.TcpClient
$client.Connect("localhost", $port)
$stream = $client.GetStream()
$data = [System.Text.Encoding]::ASCII.GetBytes("USER:12345:AUTHORIZED:TEST001`r`n")
$stream.Write($data, 0, $data.Length)
$client.Close()
```

---

## Admin Dashboard

### System Status Panel
- **Service Health**: Biometric listener status
- **Connected Devices**: Number of active device connections
- **Enrollment Status**: Active enrollment sessions
- **Recent Events**: Live biometric activity feed

### Member Management Features
- **Members Without Biometric**: View and enroll missing members
- **Biometric Status**: Check member enrollment status
- **Event History**: View member's biometric activity
- **Bulk Operations**: Manage multiple enrollments

### Real-time Monitoring
- **Live Event Stream**: All biometric activities
- **Auto-refresh Status**: Live system monitoring  
- **Connection Testing**: Device communication tests

---

## Troubleshooting

### Common Issues

**1. Device Not Connecting**
- ✅ Check network connectivity
- ✅ Verify firewall settings (your `BIOMETRIC_PORT` should be open)
- ✅ Ensure device has correct server IP and port
- ✅ Test with: `npm run biometric:check`

**2. Messages Not Being Received**
- ✅ Verify device is in real-time mode
- ✅ Check message format compatibility
- ✅ Review console logs for errors
- ✅ Test with: `npm run biometric:test`

**3. Members Not Found**
- ✅ Verify biometric_id is set correctly
- ✅ Check device user ID format
- ✅ Review member_biometrics table mapping

**4. Access Control Issues**
- ✅ Verify member has active plan
- ✅ Check plan start/end dates
- ✅ Ensure working hours are configured

### Debug Commands

```bash
# Check port status (Unix/macOS)
netstat -tlnp | grep $BIOMETRIC_PORT

# Check port status (Windows)
netstat -an | findstr :$BIOMETRIC_PORT

# Monitor logs
npm run biometric:start  # Check console output
```

---

## Production Deployment

### Using PM2 (Recommended)

```bash
# Install PM2
npm install -g pm2

# Start biometric service
pm2 start src/startBiometricListener.js --name "biometric-listener"

# Start main app with biometric integration
pm2 start src/app.js --name "gym-management" --env ENABLE_BIOMETRIC=true

# Save configuration
pm2 save

# Auto-start on boot
pm2 startup
```

### Environment Configuration

**Production `.env`:**
```env
NODE_ENV=production
ENABLE_BIOMETRIC=true
BIOMETRIC_PORT=8080
BIOMETRIC_HOST=0.0.0.0

# Database (SQLite for Windows builds)
WIN_DATA_ROOT=C:/ProgramData/gmgmt

# Email notifications
EMAIL_USER=your_email@domain.com
EMAIL_PASS=your_app_password
```

### Monitoring & Alerts

```bash
# View logs
pm2 logs biometric-listener

# Monitor status
pm2 status

# Monitor system resources
pm2 monit
```

---

## Security & Maintenance

### Security Considerations

1. **Network Security:**
   - Use VPN or secure network for device communication
   - Implement IP whitelisting for device connections
   - Consider TLS encryption if device supports it

2. **Data Security:**
   - Log all access attempts for audit purposes
   - Implement rate limiting to prevent spam
   - Regular security log reviews

3. **Access Control:**
   - Regular member access rights review
   - Emergency override procedures
   - Administrative action logging

### Regular Maintenance

- **Weekly**: Review security logs and failed attempts
- **Monthly**: Clean up old event logs and optimize database
- **Quarterly**: Update member biometric data and test device connections
- **Annually**: Full security audit and system backup

### Backup & Recovery

```bash
# Backup biometric data
sqlite3 data/gmgmt.sqlite ".backup backup_$(date +%Y%m%d).sqlite"

# Export member biometric mappings
sqlite3 data/gmgmt.sqlite ".output member_biometrics_backup.csv"
sqlite3 data/gmgmt.sqlite "SELECT * FROM member_biometrics;"
```

---

## API Reference

### Key Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/attendance/check-in` | Member check-in via app |
| `POST` | `/api/attendance/device-webhook` | Device webhook for biometric events |
| `GET` | `/api/biometric/status` | System status |
| `POST` | `/api/biometric/members/:id/enroll` | Start enrollment |
| `DELETE` | `/api/biometric/members/:id/biometric` | Remove biometric data |
| `GET` | `/api/biometric/events` | Get biometric events |

### Success Metrics

**✅ Automated Check-ins**
- Reduce manual attendance tracking by 95%
- Eliminate buddy punching and time fraud
- Real-time attendance visibility

**✅ Streamlined Enrollment**
- 30-second fingerprint enrollment process
- Self-service member onboarding capability
- Reduced admin workload

**✅ Enhanced Security**
- Biometric access control
- Complete audit trail
- Failed attempt monitoring

**✅ Operational Efficiency**
- Automated plan validation
- Reduced front desk bottlenecks
- Real-time member status updates

---

## Support

For technical support:
1. Check this troubleshooting guide
2. Review console logs for error messages
3. Test network connectivity manually
4. Consult SecureEye device documentation

**Testing Tools:**
- `npm run biometric:help` - All available commands
- `npm run biometric:check` - Connection verification
- `npm run biometric:test` - Comprehensive testing
