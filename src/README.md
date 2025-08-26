# Backend Documentation

This directory contains the backend server implementation for the Gym Management Software, including the Node.js API server, ESP32 biometric integration, and database management.

## Table of Contents

- [API Overview](#api-overview)
- [ESP32 Biometric Integration](#esp32-biometric-integration)
- [Database Schema](#database-schema)
- [Services](#services)
- [Troubleshooting](#troubleshooting)
- [Development](#development)

## API Overview

The backend provides a comprehensive REST API for gym management operations. All endpoints are prefixed with `/api/`.

### Core Endpoints

| Feature      | Method | Endpoint                    | Description                                |
|--------------|--------|-----------------------------|--------------------------------------------|
| **Members**  | `GET`  | `/api/members`              | Get all members                            |
|              | `POST` | `/api/members`              | Create a new member                        |
|              | `GET`  | `/api/members/:id`          | Get a single member by ID                  |
|              | `PUT`  | `/api/members/:id`          | Update a member                            |
|              | `DELETE`|`/api/members/:id`          | Delete a member                            |
| **Attendance**| `POST`| `/api/attendance/check-in`  | Log a member check-in by `memberId` or `device_user_id` |
|              | `POST` | `/api/attendance/device-webhook` | Webhook for device push events |
|              | `GET`  | `/api/attendance/:memberId?start=YYYY-MM-DD&end=YYYY-MM-DD` | Get attendance history |
| **Classes**  | `GET`  | `/api/classes`              | Get all classes                            |
|              | `POST` | `/api/classes`              | Create a new class                         |
| **Schedules**| `GET`  | `/api/schedules`            | Get all class schedules                    |
|              | `POST` | `/api/schedules`            | Create a new schedule                      |
| **Bookings** | `POST` | `/api/bookings`             | Book a member into a class                 |
|              | `GET`  | `/api/bookings/member/:memberId`| Get all bookings for a member           |
|              | `PATCH`| `/api/bookings/cancel/:bookingId`| Cancel a booking                       |
| **Plans**    | `GET`  | `/api/plans`                | Get all membership plans                   |
|              | `POST` | `/api/plans`                | Create a new membership plan               |
| **Biometrics** | `PUT` | `/api/members/:id/biometric` | Link or update a member's biometric mapping |
| **Payments** | `POST` | `/api/payments`             | Card payments disabled (501)               |
|              | `POST` | `/api/payments/manual`      | Record a manual payment (cash/bank/UPI)   |
|              | `POST` | `/api/payments/invoice`     | Create a new invoice for a member          |
|              | `GET`  | `/api/payments/unpaid?member_id=<id>` | List unpaid invoices for a member |
|              | `GET`  | `/api/payments/:id/invoice` | Invoice details by payment id              |
|              | `GET`  | `/api/payments/invoices/:id` | Invoice details by invoice id              |
| **Reports**  | `GET`  | `/api/reports/summary`      | Get overall summary statistics             |
|              | `GET`  | `/api/reports/member-growth`| Get member growth over last 12 months     |
|              | `GET`  | `/api/reports/attendance-stats`| Get daily attendance for last 30 days  |
|              | `GET`  | `/api/reports/popular-classes`| Get most popular classes by booking count|
|              | `GET`  | `/api/reports/revenue-stats`| Get monthly revenue for last 12 months    |
|              | `GET`  | `/api/reports/financial-summary` | Get outstanding invoices, payment history |
|              | `GET`  | `/api/reports/unpaid-members-this-month` | Members with no payments this month |

### Authentication & Security

- JWT authentication is ready for future implementation
- All endpoints are currently public (no authentication required)
- CORS is configured for development and production use

### Error Handling

The API uses standard HTTP status codes:
- `200` - Success
- `400` - Bad Request (validation errors)
- `404` - Not Found
- `409` - Conflict (e.g., duplicate check-in)
- `500` - Internal Server Error

## ESP32 Biometric Integration

This project supports ESP32-based fingerprint door lock systems for attendance check-ins and access control. The ESP32 devices connect via WiFi and communicate using JSON over TCP/IP.

### Overview

- **Hardware**: ESP32 + AS608 Fingerprint Sensor + Door Lock Control
- **Connectivity**: WiFi-based, no additional gateway required
- **Real-time**: Live event streaming and device monitoring
- **Remote Control**: Unlock doors and enroll fingerprints remotely
- **Status Monitoring**: Device health, connectivity, and performance tracking

### What We Store

- A mapping between your app's `member_id` and the device's `device_user_id` in the `member_biometrics` table
- Optionally, a fingerprint template string for backup/migration purposes

### Configurable Working Hours

Working hours are editable in Settings and enforced by the backend during check-in:
- Morning session: `morning_session_start`–`morning_session_end` (default 05:00–11:00)
- Evening session: `evening_session_start`–`evening_session_end` (default 16:00–22:00)

### Device Communication

ESP32 devices communicate via TCP/IP using JSON messages:
- **Connection**: ESP32 connects to server via WiFi
- **Protocol**: JSON over TCP/IP
- **Events**: Real-time fingerprint scan events and device status
- **Control**: Remote door unlock and fingerprint enrollment

### Managing Biometric Links for Members

- In the admin UI, open Members → "Biometric" on a member
- Enter the `device_user_id` configured on the ESP32 device
- This calls `PUT /api/members/:id/biometric` and stores the mapping
- You can also manage via API:
  - `PUT /api/members/:id/biometric`
  - Body: `{ "device_user_id": "1234", "template": "<optional base64>" }`

### Check-in from Devices or Apps

- **ESP32 device call**: Automatic JSON message sent on fingerprint scan
- **Direct app/server call**: `POST /api/attendance/check-in` with `{ memberId: 42 }` or `{ device_user_id: "1234" }`
- **Device/webhook call**: `POST /api/attendance/device-webhook` with `{ device_user_id: "1234" }`

### Error Handling

- **Out-of-hours**: Backend returns `400` with a message reflecting current configured hours
- **Duplicate daily check-in**: Backend returns `409` with `Member has already checked in today.`
- **Unknown device user**: Backend returns `404` if no `member_biometrics` mapping is present

## ESP32 Setup and Configuration

### Prerequisites

- **Hardware**: ESP32 + AS608 Fingerprint Sensor + Door Lock
- **Software**: Node.js 16+, npm
- **Network**: WiFi network for ESP32 connectivity

### Quick Setup

#### 1. Install Required Arduino Libraries

**Method 1: Using Arduino IDE Library Manager**
1. Open Arduino IDE
2. Go to **Tools → Manage Libraries...**
3. Search and install the following libraries:
   - `ArduinoJson` by Benoit Blanchon (version 6.x)
   - `Adafruit Fingerprint Sensor Library` by Adafruit

**Method 2: Using Arduino IDE Board Manager**
1. Go to **File → Preferences**
2. Add ESP32 board URL: `https://raw.githubusercontent.com/espressif/arduino-esp32/gh-pages/package_esp32_dev_index.json`
3. Go to **Tools → Board → Boards Manager**
4. Search and install `esp32` by Espressif Systems

#### 2. Upload ESP32 Firmware

1. Open `esp32_door_lock/esp32_door_lock.ino` in Arduino IDE
2. Select the correct board: **Tools → Board → ESP32 Arduino → ESP32 Dev Module**
3. **Configuration Options** (choose one):
   
   **Option A: Use Web Interface** (Recommended)
   - Upload firmware with default settings
   - Configure via web interface after upload (see step 7)
   
   **Option B: Custom Default Configuration**
   ```bash
   # Copy configuration template
   cp esp32_door_lock/config.h.example esp32_door_lock/config.h
   
   # Edit config.h with your preferred defaults:
   # DEFAULT_WIFI_SSID = "YOUR_WIFI_NAME"
   # DEFAULT_WIFI_PASSWORD = "YOUR_WIFI_PASSWORD"  
   # DEFAULT_GYM_SERVER_IP = "YOUR_SERVER_IP"
   # DEFAULT_GYM_SERVER_PORT = 3001  # Must match main server PORT in .env
   ```

4. Connect ESP32 to computer via USB
5. Select the correct port: **Tools → Port → (your ESP32 port)**
6. Click **Upload** button
7. **Configure Device** (if using Option A):
   - Open Serial Monitor at **115200 baud** to see device IP
   - Navigate to `http://ESP32_IP/config` in your browser
   - Enter your WiFi credentials and server settings

#### 3. Hardware Connections

- **AS608 Sensor**: RX→Pin16, TX→Pin17, VCC→5V, GND→GND
- **Door Lock**: Relay→Pin18, 12V power supply
- **Status LEDs**: Green→Pin19, Red→Pin21, Blue→Pin22
- **Buzzer**: Pin23
- **Buttons**: Enroll→Pin4, Override→Pin5

#### 4. Configuration Management

The ESP32 supports dynamic, environment-driven configuration:

1. **Web Interface**: `http://ESP32_IP/config` - User-friendly configuration form
2. **API Endpoints**: REST API for programmatic configuration
3. **Remote Management**: Configure from gym management system
4. **Development Defaults**: Optional `config.h` file for custom defaults

#### 5. Critical Port Configuration

**IMPORTANT**: The ESP32 must connect to the **main server port** (PORT in .env), NOT the BIOMETRIC_PORT:

- **✅ Correct**: ESP32 port = 3001 (matches main server PORT)
- **❌ Wrong**: ESP32 port = 8080 (causes HTTP timeout errors)

#### 6. Testing Commands

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

### Web Interface Features

#### Consolidated Biometric Management (`/biometric`)
- Unified fingerprint enrollment with guided process
- Device selection and real-time enrollment monitoring
- Manual member-device linking
- View biometric events and enrollment status

#### ESP32 Device Management (`/settings/esp32-devices`)
- View all connected ESP32 devices
- Remote door unlock
- Device status monitoring
- Start remote enrollment

#### Real-time Monitor (`/settings/esp32-monitor`)
- Live event stream
- Device health monitoring
- Connection status

#### Analytics (`/settings/esp32-analytics`)
- Usage statistics
- Access logs
- Performance metrics

#### ESP32 Configuration (`/settings`)
- Configure ESP32 device host and port settings
- Set local listener host and port  
- Network configuration with helpful defaults
- Remote configuration of ESP32 devices via API

## Database Schema

The application automatically creates the following database tables:

- **members:** Store member information and membership details (email optional, phone required and unique when provided)
- **classes:** Fitness class definitions with instructors and duration
- **class_schedules:** Scheduled instances of classes with time and capacity
- **bookings:** Member bookings for scheduled classes
- **attendance:** Member check-in records
- **member_biometrics:** Mapping between app members, device user IDs, and optional fingerprint templates
- **membership_plans:** Available membership plans with pricing
- **invoices:** Billing records for members
- **payments:** Payment transaction records

## Services

### Biometric Integration Service

The `biometricIntegration.js` service handles:
- ESP32 device communication
- WebSocket client management
- Enrollment mode management
- Real-time status updates

### Email Service

The `emailService.js` service handles:
- Welcome emails for new members
- Booking confirmation emails
- Payment confirmation emails
- HTML email templates with gym branding

### Biometric Listener Service

The `biometricListener.js` service handles:
- TCP socket connections to ESP32 devices
- Real-time event processing
- Device status monitoring

## Troubleshooting

### ESP32 Integration Issues

#### Port Configuration Problems

**Critical Issue**: ESP32 must connect to the main server port (PORT in .env), NOT the BIOMETRIC_PORT:

- **✅ Correct**: ESP32 port = 3001 (matches main server PORT)
- **❌ Wrong**: ESP32 port = 8080 (causes HTTP timeout errors)

**Verification**:
```bash
# Check your .env file - ESP32 should use the PORT value, not BIOMETRIC_PORT
cat .env | grep PORT
# Should show: PORT=3001 (or your custom port)

# Test the correct endpoint manually
curl -X POST http://YOUR_SERVER_IP:3001/api/biometric/esp32-webhook \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"TEST","event":"test"}'
```

#### WiFi Connection Issues

- **Web Configuration**: Access `http://ESP32_IP/config` to update WiFi credentials
- **Serial Monitor**: Check for detailed WiFi connection logs at 115200 baud
- **Connection Status**: Look for detailed error messages like `NO_SSID_AVAILABLE`, `WRONG_PASSWORD`, `CONNECT_FAILED`

#### Device Not Connecting

- **Firewall**: Check firewall settings for ports 80 (ESP32 web interface) and 3001 (main server)
- **Network Restrictions**: Ensure ESP32 can reach gym server (same network or proper routing)
- **WiFi Requirements**: ESP32 only supports 2.4GHz networks (not 5GHz)
- **MAC Filtering**: Check if router has MAC address filtering enabled

### Timestamp and Timezone Issues

#### Timezone Discrepancy Between Biometric Events and Attendance

**Problem**: Biometric events and attendance records showing different timestamps.

**Root Cause**: Inconsistent timestamp handling between ESP32 device and server.

**Solution**: 
1. **ESP32 Configuration**: Update `esp32_door_lock/config.h` with your gym's timezone:
   ```cpp
   #define TIMEZONE_OFFSET 19800   // UTC+5:30 (India)
   #define TIMEZONE_OFFSET -18000  // UTC-5 (Eastern US)
   #define TIMEZONE_OFFSET 0       // UTC+0 (UK)
   ```

2. **Server-Side Fix**: Already implemented in `src/services/biometricIntegration.js`

3. **Verification**: Both biometric events and attendance records should show identical timestamps

#### Heartbeat Timestamp Issues

**Problem**: Invalid timestamps like "01/01/65090, 00:00:00" in heartbeat events.

**Root Cause**: ESP32 sending heartbeats before NTP time synchronization.

**Solution**: 
1. **NTP Time Synchronization Wait**: ESP32 now waits up to 30 seconds for NTP time
2. **Improved Fallback**: Uses reasonable timestamps instead of raw `millis()`
3. **Heartbeat Validation**: Skips heartbeats with invalid timestamps

#### Attendance Date Filtering Issues

**Problem**: Date range filtering not providing full-day coverage.

**Solution**: 
- Start date automatically includes 00:00:00 hours
- End date automatically includes 23:59:59 hours
- No attendance records are missed due to time precision issues

### Library Installation Issues

- **ArduinoJson.h not found**: Install `ArduinoJson` library via Arduino IDE Library Manager
- **Adafruit_Fingerprint.h not found**: Install `Adafruit Fingerprint Sensor Library` via Library Manager
- **ESP32 board not found**: Add ESP32 board URL in Preferences and install via Board Manager
- **Compilation errors**: Ensure you're using ArduinoJson version 6.x (not 7.x which has breaking changes)

### Serial Monitor Issues

- **Garbled characters at startup** (``): These are normal ESP32 boot messages sent at 74880 baud rate
- **Solution**: Set your Serial Monitor to **115200 baud rate** and ignore the initial garbled text
- **Expected output**: Garbled boot messages followed by clear text after separator lines (`========================================`)

### Database Issues

```bash
# Reset ESP32 database tables
npm run esp32:setup

# Manual database check
sqlite3 data/data/gmgmt.sqlite
.tables
SELECT * FROM devices;
```

### WebSocket Issues

#### Enrollment Stuck in "Enrolling" State

**Problem**: The client UI remains stuck in the "enrolling" state even when the ESP32 has completed enrollment.

**Root Cause**: Communication gap between ESP32 and frontend via WebSocket.

**Solution**: 
1. **Direct WebSocket Updates**: Modified `biometricController.js` to send WebSocket updates immediately when processing ESP32 webhook events
2. **Comprehensive Status Handling**: Added WebSocket updates for all enrollment outcomes (success/failure/cancellation)
3. **Member Name Resolution**: Enhanced member name lookup for better user experience
4. **Enrollment Mode Management**: Added logic to stop enrollment mode when ESP32 completes enrollment

#### WebSocket Connection Issues

**Problem**: Frontend not receiving real-time enrollment status updates.

**Root Cause**: Frontend relying on polling instead of WebSocket connection.

**Solution**: 
1. **WebSocket Server**: Added WebSocket server to `src/app.js` using the `ws` package
2. **Enhanced BiometricIntegration Service**: Added WebSocket client management methods
3. **Frontend WebSocket Integration**: Updated frontend to connect to WebSocket server and handle real-time updates
4. **Fallback Mechanism**: WebSocket is primary, polling remains as fallback

### Enrollment ID Issues

#### ESP32 Always Enrolling with ID 1

**Problem**: ESP32 device was always enrolling fingerprints with ID 1 instead of the member ID that was selected for enrollment.

**Root Cause**: The `startEnrollmentMode()` function was overwriting the `enrollmentID` with `getNextAvailableID()`.

**Solution**: 
1. **Preserve Member ID**: Modified `startEnrollmentMode()` to only set `enrollmentID` if it hasn't been set by a remote command
2. **Reset enrollmentID After Completion**: Added logic to reset `enrollmentID` after enrollment completes (success or failure)
3. **Reset enrollmentID on Cancellation**: Added reset logic when enrollment is cancelled
4. **Enhanced Debugging**: Added comprehensive logging to track the enrollment flow

## Development

### Project Structure

```
src/
├── api/
│   ├── controllers/          # API endpoint handlers
│   ├── middlewares/          # Express middleware
│   └── routes/               # API route definitions
├── config/                   # Configuration files
├── models/                   # Database models
├── services/                 # Business logic services
└── app.js                    # Main application entry point
```

### Environment Variables

Create a `.env` file in the project root with the following variables:

```env
# Server Configuration
PORT=3001
NODE_ENV=development

# Database (SQLite - automatically created)
# No additional configuration required

# JWT Configuration
JWT_SECRET=your_super_secret_jwt_key

# Email Configuration
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password

# ESP32 Biometric Integration
ENABLE_BIOMETRIC=true
BIOMETRIC_PORT=8080
BIOMETRIC_HOST=0.0.0.0
```

### Running in Development

```bash
# Install dependencies
npm install

# Start the development server
npm start

# Start with ESP32 support
npm run start:with-biometric

# Run tests
npm test
```

### Testing ESP32 Integration

```bash
# Setup ESP32 database tables
npm run esp32:setup

# Run integration tests
npm run esp32:test

# Check biometric service status
npm run biometric:check

# Show all available commands
npm run esp32:help
```

### WebSocket Testing

Test WebSocket functionality using:

```bash
# Test WebSocket connection
node -e "
const ws = new (require('ws'))('ws://localhost:3001/ws');
ws.on('open', () => console.log('✅ Connected'));
ws.on('message', (data) => console.log('📡 Received:', data.toString()));
setTimeout(() => ws.close(), 3000);
"
```

### Dependencies

Key dependencies for ESP32 integration:
- `ws` package for WebSocket server functionality
- `sqlite3` for database operations
- `nodemailer` for email notifications
- `crypto` for JWT operations

## Additional Resources

### Configuration Files
- **ESP32 Firmware**: `esp32_door_lock/esp32_door_lock.ino`
- **Configuration Template**: `esp32_door_lock/config.h.example`
- **Environment Variables**: `.env` file for server configuration

### Testing Scripts
- **`tools/calculate_timezone_offset.js`**: Timezone offset calculator
- **`tools/test_timestamp_fix.js`**: Timestamp fix verification
- **`tools/test_esp32_integration.js`**: ESP32 integration testing

### API Endpoints for ESP32
- **Device Management**: `/api/biometric/devices/*` for device management
- **ESP32 Configuration**: 
  - `GET /api/config` - Retrieve device configuration
  - `POST /api/config` - Update device configuration
- **Device Control**:
  - `POST /unlock` - Emergency unlock
  - `POST /enroll` - Start fingerprint enrollment
- **Status Monitoring**: `/status` - Device status and health information

## Future Enhancements

1. **Reconnection Logic**: Automatic WebSocket reconnection
2. **Message Queuing**: Queue messages for offline clients
3. **Authentication**: Secure WebSocket connections
4. **Event History**: Track all enrollment attempts
5. **Device Status**: Real-time ESP32 device status updates
6. **ID Validation**: Verify that the requested member ID is valid
7. **Conflict Detection**: Check if the member ID is already enrolled
8. **ID Range Management**: Ensure member IDs fit within fingerprint sensor capacity
9. **Backup/Restore**: Save fingerprint templates with member ID metadata
10. **Remote ID Management**: Allow remote configuration of ID ranges
