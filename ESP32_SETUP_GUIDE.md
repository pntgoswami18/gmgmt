# ESP32 Door Lock Setup Guide

## 📋 Prerequisites

- **Hardware**: ESP32 + AS608 Fingerprint Sensor + Door Lock
- **Software**: Node.js 16+, npm
- **Network**: WiFi network for ESP32 connectivity

## 🚀 Quick Setup

### 1. Install and Configure Server

```bash
# Clone and install
git clone <your-repo>
cd gmgmt
npm install
cd client && npm install && cd ..

# Configure environment
cp env.sample .env
# Edit .env and set:
# ENABLE_BIOMETRIC=true
# BIOMETRIC_PORT=8080
# BIOMETRIC_HOST=0.0.0.0

# Setup database
npm run esp32:setup
```

### 2. Upload ESP32 Firmware

1. Open `esp32_door_lock.ino` in Arduino IDE
2. Update WiFi credentials and server IP:
   ```cpp
   const char* ssid = "YOUR_WIFI_NAME";
   const char* password = "YOUR_WIFI_PASSWORD";
   const char* serverURL = "http://YOUR_SERVER_IP:8080";
   ```
3. Upload to ESP32 device

### 3. Start the System

```bash
# Start server with ESP32 support
npm run start:with-biometric

# The server will start on http://localhost:3001
# Frontend dashboard at http://localhost:3000
```

### 4. Verify Setup

```bash
# Test ESP32 integration
npm run esp32:test

# Check device connectivity
npm run esp32:help
```

## 🔧 ESP32 Device Configuration

### Hardware Connections
- **AS608 Sensor**: RX→Pin16, TX→Pin17, VCC→5V, GND→GND
- **Door Lock**: Relay→Pin18, 12V power supply
- **Status LEDs**: Green→Pin19, Red→Pin21, Blue→Pin22
- **Buzzer**: Pin23
- **Buttons**: Enroll→Pin25, Override→Pin26

### Device Settings
1. **WiFi**: Connect ESP32 to same network as server
2. **Server IP**: Configure ESP32 to send data to server IP:8080
3. **Device ID**: Set unique device identifier (default: "DOOR_001")

## 👤 Member Enrollment

### Web Dashboard Method
1. Go to Members → Select Member → "Biometric"
2. Enter device user ID and save
3. Use ESP32 enrollment interface or physical enrollment button

### Direct Device Method
1. Press enrollment button on ESP32 device
2. Follow LED/buzzer prompts to scan fingerprint
3. Device will assign user ID automatically

## 📱 Web Interface Features

### Device Management (`/esp32-devices`)
- View all connected ESP32 devices
- Remote door unlock
- Device status monitoring
- Start remote enrollment

### Real-time Monitor (`/esp32-monitor`)
- Live event stream
- Device health monitoring
- Connection status

### Analytics (`/esp32-analytics`)
- Usage statistics
- Access logs
- Performance metrics

## 🛠️ Essential Commands

```bash
# Setup and testing
npm run esp32:setup          # Setup database tables
npm run esp32:test           # Run integration tests
npm run esp32:help           # Show all available commands

# Server management
npm run start:with-biometric # Start with ESP32 support
npm run biometric:start      # Start biometric service only
npm run biometric:check      # Check service status
```

## 🔍 Troubleshooting

### Device Not Connecting
- Check WiFi credentials in ESP32 code
- Verify server IP and port (8080)
- Check firewall settings

### Fingerprint Not Working
- Ensure AS608 sensor is wired correctly
- Check sensor power (5V required)
- Verify device user ID mapping in database

### Web Interface Issues
- Ensure both backend (port 3001) and frontend (port 3000) are running
- Check browser console for errors
- Verify ESP32 API endpoints are responsive

### Database Issues
```bash
# Reset ESP32 database tables
npm run esp32:setup

# Manual database check
sqlite3 data/data/gmgmt.sqlite
.tables
SELECT * FROM devices;
```

## 📚 Additional Resources

- **API Endpoints**: `/api/biometric/devices/*` for device management
- **Database Schema**: ESP32 devices stored in `devices` table
- **Frontend Components**: ESP32-specific React components in `/client/src/components/ESP32*`
- **Configuration**: Environment variables in `.env` file

## 🎯 Production Deployment

### Security
- Use WPA3 WiFi encryption
- Configure firewall for port 8080
- Set strong device passwords
- Enable HTTPS in production

### Monitoring
- Monitor device connectivity via web dashboard
- Set up alerts for offline devices
- Regular backup of member fingerprint data
- Monitor system performance and logs

---

**For support**: Check troubleshooting section above or review system logs in `/var/log/` or console output.
