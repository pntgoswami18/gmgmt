# Gym Management Software

This is a comprehensive Gym Management Software built with a Node.js backend and a React frontend. It provides a full suite of tools for gym owners and staff to manage their members, schedules, bookings, and payments efficiently.

## Table of Contents

- [Features](#features)
- [Technology Stack](#technology-stack)
- [Installation & Setup](#installation--setup)
- [Running the Application](#running-the-application)
- [API Endpoints](#api-endpoints)
- [ESP32 Biometric Integration](#esp32-biometric-integration)
- [Database Schema](#database-schema)
- [Services](#services)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [Windows Standalone Build](#windows-standalone-build-service--installer-sqlite)
- [Documentation Structure](#documentation-structure)
- [Future Enhancements](#future-enhancements)
- [Support](#support)

## Features

The application is built with a comprehensive feature set that includes:

### Backend API Features
*   **Member Management:** Full CRUD (Create, Read, Update, Delete) operations for gym members with automated welcome emails.
*   **Biometric Attendance:** API endpoints to log member check-ins from ESP32 fingerprint devices with attendance history tracking and configurable working hours.
*   **Class & Schedule Management:** Complete system for creating fitness classes and scheduling them with capacity management.
*   **Online Booking System:** Members can book and cancel class spots with overbooking prevention and automated confirmation emails.
*   **Billing & Payments:** Membership plans, invoices, and manual payment recording.
*   **Automated Communications:** Email notifications for member registration, class bookings, and payment confirmations.
*   **Advanced Analytics:** Comprehensive reporting system with member growth, attendance trends, revenue analytics, and popular class rankings.

### Frontend Admin Dashboard Features
*   **Multi-page Navigation:** Professional dashboard with React Router navigation between different management sections.
*   **Member Management Interface:** Add, view, edit, and delete gym members with real-time data updates.
*   **Consolidated Biometric Management:** Unified ESP32 fingerprint enrollment with device selection, guided enrollment process, manual member-device linking, and real-time enrollment monitoring.
*   **Class & Schedule Management:** Create and manage fitness classes with integrated schedule management (schedules accessible as a tab under Classes).
*   **Attendance Tracking Interface:** View member attendance history and simulate biometric check-ins for testing. Enforces session-based check-ins (Morning 05:00–11:00, Evening 16:00–22:00) with a single check-in allowed per calendar date.
*   **Financial Management Interface:** Create membership plans and manage billing. Record manual payments against invoices, including auto-creating an invoice if none exists.
*   **Analytics Dashboard:** Real-time reporting with summary statistics, growth trends, revenue tracking, and popular class analytics. Dashboard cards are clickable and deep-link to filtered sections (e.g., unpaid members, pending payments).
*   **Advanced Settings Management:** Centralized settings with tabbed interface including General settings and comprehensive ESP32 device management (Device Manager, Monitor, Analytics accessible as tabs under Settings).
*   **ESP32 Configuration:** User-configurable ESP32 connection settings including device host/port and local listener host/port with clear defaults and help text.
*   **Material UI Navigation:** Enhanced left navigation with icons and active-route highlighting.
*   **Branding & Accent Colors:** Configure Primary and Secondary accents as Solid or Gradient in Settings. A gradient editor lets you adjust mode (Linear/Radial), angle, and color stops. Accents are used across buttons, headings, and section headers.
*   **Dashboard Card Visibility:** Toggle which summary cards are shown on the Dashboard in Settings.
*   **Invoices:** Click recent payments to open a printable invoice. Print generates a print-out of only the invoice; Download PDF creates a file (no print dialog). Share via WhatsApp opens WhatsApp Web with a prefilled message.

## Technology Stack

-   **Backend:**
    -   Node.js with Express.js framework
    -   SQLite database for local data storage
    -   (Optional) Payment gateway integration — currently disabled
    -   Nodemailer for automated email communications
    -   JWT for authentication (ready for future implementation)
-   **Frontend:**
    -   React.js with React Router for multi-page navigation
    -   Axios for API communication
    -   Responsive design with professional styling
    -   📖 **See [client/README.md](client/README.md) for detailed frontend documentation**

---

## Installation & Setup

Follow these steps to get the application running on your local machine.

### Prerequisites

-   [Node.js](https://nodejs.org/) (which includes npm)
-   SQLite (automatically included with Node.js dependencies)

### 1. Install Dependencies

First, install the necessary npm packages for both the backend server and the frontend client.

```bash
# Install backend dependencies from the root directory
npm install

# Navigate to the client directory and install frontend dependencies
cd client
npm install
cd ..
```

### 2. Configure Environment Variables

Create a `.env` file in the root of the project (`gmgmt/`). This file will store your configuration and secret keys.

Copy the following into the `.env` file and replace the placeholder values with your actual credentials.

```env
# SQLite Database (automatically created)
# No database configuration required

# JSON Web Token Secret (for future authentication features)
JWT_SECRET=your_super_secret_jwt_key

# Payment gateway configuration (disabled)

# Email Configuration (for automated notifications)
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password

# ESP32 Biometric Integration (optional)
ENABLE_BIOMETRIC=true
BIOMETRIC_PORT=8080
BIOMETRIC_HOST=0.0.0.0
```

**Note for Email Setup:** For Gmail, you'll need to use an "App Password" instead of your regular password. Enable 2-factor authentication and generate an app password in your Google Account settings.

**Note for JWT Secret:** It is critical to use a strong, randomly-generated secret for your JWT key. You can generate one from your terminal with the following command:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Note:** Card payment gateway is disabled in this build. Use manual payments.

The application will automatically create the SQLite database file and required tables when it first starts.

---

## Running the Application

You will need to run the backend and frontend servers in two separate terminals.

**1. Start the Backend Server:**

Open a terminal in the project's root directory and run:

```bash
npm start
```

The backend API will be running on `http://localhost:3001` by default (or `PORT` env var if set).

**2. Start the Frontend Application:**

Open a second terminal and navigate to the `client` directory:

```bash
cd client
npm start
```

The React development server will open the admin dashboard in your browser at `http://localhost:3000`.

### 3. Access the Dashboard

Once both servers are running, you can access the different sections of the admin dashboard:

- **Dashboard:** Analytics and reporting overview
- **Members:** Manage gym members (add, edit, delete)
- **Biometric:** Consolidated ESP32 fingerprint enrollment and device management
- **Classes:** Manage fitness classes and schedules (schedules now under Classes tab)
- **Attendance:** Track member attendance and simulate check-ins
- **Financials:** Manage membership plans and view payment integration
- **Settings:** General settings and ESP32 device management (Device Manager, Monitor, Analytics tabs)

---

## API Endpoints

The backend provides the following REST API endpoints:

| Feature      | Method | Endpoint                    | Description                                |
|--------------|--------|-----------------------------|--------------------------------------------|
| **Members**  | `GET`  | `/api/members`              | Get all members                            |
|              | `POST` | `/api/members`              | Create a new member                        |
|              | `GET`  | `/api/members/:id`          | Get a single member by ID                  |
|              | `PUT`  | `/api/members/:id`          | Update a member                            |
|              | `DELETE`|`/api/members/:id`          | Delete a member                            |
| **Attendance**| `POST`| `/api/attendance/check-in`  | Log a member check-in by `memberId` or `device_user_id` (uses configurable working hours; one check-in per calendar date) |
|              | `POST` | `/api/attendance/device-webhook` | Webhook for device push events (uses `device_user_id` mapping) |
|              | `GET`  | `/api/attendance/:memberId?start=YYYY-MM-DD&end=YYYY-MM-DD` | Get attendance history for a member filtered by date range |
| **Classes**  | `GET`  | `/api/classes`              | Get all classes                            |
|              | `POST` | `/api/classes`              | Create a new class                         |
| **Schedules**| `GET`  | `/api/schedules`            | Get all class schedules                    |
|              | `POST` | `/api/schedules`            | Create a new schedule                      |
| **Bookings** | `POST` | `/api/bookings`             | Book a member into a class                 |
|              | `GET`  | `/api/bookings/member/:memberId`| Get all bookings for a member           |
|              | `PATCH`| `/api/bookings/cancel/:bookingId`| Cancel a booking                       |
| **Plans**    | `GET`  | `/api/plans`                | Get all membership plans                   |
|              | `POST` | `/api/plans`                | Create a new membership plan               |
| **Biometrics** | `PUT` | `/api/members/:id/biometric` | Link or update a member's biometric mapping (`device_user_id` and/or template) |
| **Payments** | `POST` | `/api/payments`             | Card payments disabled (501)               |
|              | `POST` | `/api/payments/manual`      | Record a manual payment (cash/bank/UPI). Auto-creates an invoice if missing/invalid |
|              | `POST` | `/api/payments/invoice`     | Create a new invoice for a member          |
|              | `GET`  | `/api/payments/unpaid?member_id=<id>` | List unpaid invoices for a member |
|              | `GET`  | `/api/payments/:id/invoice` | Invoice details by payment id (for invoice preview) |
|              | `GET`  | `/api/payments/invoices/:id` | Invoice details by invoice id (latest payment included) |
| **Reports**  | `GET`  | `/api/reports/summary`      | Get overall summary statistics (includes unpaidMembersThisMonth) |
|              | `GET`  | `/api/reports/member-growth`| Get member growth over last 12 months     |
|              | `GET`  | `/api/reports/attendance-stats`| Get daily attendance for last 30 days  |
|              | `GET`  | `/api/reports/popular-classes`| Get most popular classes by booking count|
|              | `GET`  | `/api/reports/revenue-stats`| Get monthly revenue for last 12 months    |
|              | `GET`  | `/api/reports/financial-summary` | Get outstanding invoices, payment history, member payment status |
|              | `GET`  | `/api/reports/unpaid-members-this-month` | Members with no payments in the current month |

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

---

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

```
ESP32 Pin Connections Schematic
================================

Power Supply:
┌─────────────────┐    ┌─────────────────┐
│   12V Power     │    │     5V Power    │
│   Supply        │    │    Supply       │
└─────────┬───────┘    └─────────┬───────┘
          │                      │
          │                      │
          ▼                      ▼
    ┌─────────────┐        ┌─────────────┐
    │   Door Lock │        │   AS608     │
    │   Relay     │        │  Fingerprint│
    │             │        │   Sensor    │
    └─────┬───────┘        └─────┬───────┘
          │                      │
          │                      │
          │                      │
    ┌─────▼───────┐        ┌─────▼───────┐
    │   Pin 18    │        │   Pin 16   │
    │  (Relay)    │        │   (RX)     │
    └─────────────┘        └─────────────┘

ESP32 Development Board:
┌─────────────────────────────────────────────────┐
│                                                 │
│  ┌─────────────────────────────────────────┐   │
│  │              ESP32                      │   │
│  │                                         │   │
│  │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐      │   │
│  │  │Pin4 │ │Pin5 │ │Pin16│ │Pin17│      │   │
│  │  │Enroll│ │Override│ │RX   │ │TX   │      │   │
│  │  └─────┘ └─────┘ └─────┘ └─────┘      │   │
│  │                                         │   │
│  │  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐      │   │
│  │  │Pin18│ │Pin19│ │Pin21│ │Pin22│      │   │
│  │  │Relay│ │Green│ │Red  │ │Blue │      │   │
│  │  │     │ │LED  │ │LED  │ │LED  │      │   │
│  │  └─────┘ └─────┘ └─────┘ └─────┘      │   │
│  │                                         │   │
│  │  ┌─────┐                               │   │
│  │  │Pin23│                               │   │
│  │  │Buzzer│                               │   │
│  │  └─────┘                               │   │
│  └─────────────────────────────────────────┘   │
└─────────────────────────────────────────────────┘

Detailed Pin Mapping:
┌─────────────┬─────────────┬─────────────────────┐
│   ESP32 Pin │ Component   │     Connection      │
├─────────────┼─────────────┼─────────────────────┤
│   Pin 4     │ Enroll      │ Push Button (GND)  │
│   Pin 5     │ Override    │ Push Button (GND)  │
│   Pin 16    │ AS608 RX    │ Sensor TX          │
│   Pin 17    │ AS608 TX    │ Sensor RX          │
│   Pin 18    │ Door Lock   │ Relay Module       │
│   Pin 19    │ Green LED   │ LED + Resistor     │
│   Pin 21    │ Red LED     │ LED + Resistor     │
│   Pin 22    │ Blue LED    │ LED + Resistor     │
│   Pin 23    │ Buzzer      │ Buzzer Module      │
│   VIN       │ Power       │ 5V Supply          │
│   GND       │ Ground      │ Common Ground      │
│   3.3V      │ Logic       │ 3.3V Logic Level  │
└─────────────┴─────────────┴─────────────────────┘

Wiring Notes:
• All components share a common ground (GND)
• AS608 sensor operates at 5V but ESP32 pins are 3.3V tolerant
• Relay module requires 12V for door lock operation
• LEDs require current-limiting resistors (220Ω recommended)
• Buttons connect between GPIO pins and GND
• Buzzer can be active (3.3V) or passive (requires driver circuit)
```

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

---

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

---

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

### NTP Time Synchronization Issues

#### Problem Description
The ESP32 door lock system may fail to synchronize time with NTP servers, resulting in the error:
```
⚠️ NTP time synchronization failed - continuing with fallback time
Device will use approximate time based on uptime
```

#### Root Causes & Solutions

**1. Network Firewall Issues**
- **Problem**: Corporate networks, routers, or ISPs often block NTP traffic on port 123
- **Solutions**:
  - Check if port 123 (UDP) is open on your network
  - Contact network administrator to whitelist NTP traffic
  - Use alternative NTP servers that might not be blocked
  - Consider using HTTP-based time services as fallback

**2. DNS Resolution Problems**
- **Problem**: ESP32 cannot resolve NTP server hostnames
- **Solutions**:
  - Verify DNS server configuration in WiFi settings
  - Try using IP addresses instead of hostnames
  - Check if DNS server (8.8.8.8, 1.1.1.1) is accessible

**3. Network Congestion or Slow Connection**
- **Problem**: Network is too slow for NTP requests to complete within timeout
- **Solutions**:
  - Increased timeout from 10s to 30s in the updated code
  - Added multiple NTP servers for redundancy
  - Implemented retry logic with exponential backoff

**4. Router Configuration Issues**
- **Problem**: Router blocks outgoing NTP requests or has restrictive firewall rules
- **Solutions**:
  - Check router's firewall settings
  - Disable "Block WAN Requests" if enabled
  - Whitelist NTP servers in router configuration
  - Update router firmware

**5. ISP Restrictions**
- **Problem**: Internet Service Provider blocks or throttles NTP traffic
- **Solutions**:
  - Contact ISP to confirm NTP access
  - Use alternative NTP servers
  - Consider VPN if allowed

#### Updated Code Improvements

The code has been updated with the following improvements:

**1. Multiple NTP Servers**
```cpp
configTime(TIMEZONE_OFFSET, DST_OFFSET, 
           "pool.ntp.org",           // Primary
           "time.nist.gov",          // Secondary (US)
           "time.google.com",        // Tertiary (Google)
           "time.windows.com");      // Quaternary (Microsoft)
```

**2. Increased Timeout**
- Initial sync: 30 seconds (was 10 seconds)
- Manual resync: 15 seconds
- Periodic resync: Every 30 minutes if time is invalid

**3. Better Error Reporting**
- Detailed error messages with possible causes
- Network diagnostic information
- Time validation to detect invalid years

**4. Automatic Recovery**
- Periodic NTP resynchronization attempts
- Fallback time calculation based on device uptime
- Manual resync via web interface

#### Manual Testing & Debugging

**1. Web Interface Testing**
Access the ESP32 web interface and use the "Resync Time" button:
```
http://[ESP32_IP_ADDRESS]/resync-time
```

**2. Serial Monitor Debugging**
Monitor the serial output for detailed NTP status:
```
🔄 Manual NTP resynchronization requested...
Attempting manual NTP synchronization...
✅ Manual NTP resynchronization successful!
Updated time: 2025-01-01 12:34:56
```

**3. Network Connectivity Test**
Test basic network connectivity from ESP32:
```cpp
// Add this to your code for testing
void testNetworkConnectivity() {
  HTTPClient http;
  http.begin("http://httpbin.org/ip");
  int httpCode = http.GET();
  if (httpCode > 0) {
    Serial.printf("Network test successful: HTTP %d\n", httpCode);
  } else {
    Serial.printf("Network test failed: %s\n", http.errorToString(httpCode).c_str());
  }
  http.end();
}
```

#### Alternative Solutions

**1. HTTP-Based Time Service**
If NTP continues to fail, implement HTTP time service as fallback:
```cpp
String getTimeFromHTTP() {
  HTTPClient http;
  http.begin("http://worldtimeapi.org/api/timezone/Etc/UTC");
  int httpCode = http.GET();
  if (httpCode == 200) {
    String payload = http.getString();
    // Parse JSON response for datetime
    // Example: {"datetime":"2025-01-01T12:34:56.123456+00:00"}
    return payload;
  }
  http.end();
  return "";
}
```

**2. Local Network Time Server**
Set up a local NTP server on your network:
- Use a Raspberry Pi or other device
- Configure it as an NTP server
- Point ESP32 to local IP instead of external servers

**3. RTC Module**
Add a Real-Time Clock module for offline timekeeping:
- DS3231 or PCF8563 RTC module
- Battery backup for power outages
- Manual time setting capability

#### Configuration Recommendations

**1. Network Settings**
- Ensure ESP32 has stable WiFi connection
- Use static IP if DHCP is unreliable
- Configure DNS servers manually if needed

**2. Timezone Configuration**
Verify `config.h` settings:
```cpp
#define TIMEZONE_OFFSET 19800  // UTC+5:30 (India)
#define DST_OFFSET 0           // No daylight saving time
```

**3. Firewall Rules**
Add these rules to your router/firewall:
```
Allow UDP 123 (NTP) outbound to:
- pool.ntp.org
- time.nist.gov
- time.google.com
- time.windows.com
```

#### Monitoring & Maintenance

**1. Regular Checks**
- Monitor serial output for NTP failures
- Check web interface status page
- Verify timestamp accuracy in server logs

**2. Log Analysis**
Look for patterns in NTP failures:
- Time of day (network congestion)
- Specific NTP servers failing
- Network events coinciding with failures

**3. Performance Metrics**
Track NTP sync success rate:
- Successful syncs vs. failures
- Sync duration times
- Fallback time usage frequency

#### Support & Escalation

If NTP issues persist after implementing these solutions:

1. **Network Analysis**: Use network monitoring tools to identify bottlenecks
2. **ISP Contact**: Verify NTP access with your internet provider
3. **Alternative Networks**: Test on different WiFi networks
4. **Hardware Check**: Verify ESP32 WiFi module functionality
5. **Community Support**: Check ESP32 forums for similar issues

#### Quick Fix Checklist

- [ ] Verify WiFi connection stability
- [ ] Check router firewall settings
- [ ] Test DNS resolution
- [ ] Verify NTP port 123 access
- [ ] Update ESP32 code with improved NTP handling
- [ ] Test manual time resync via web interface
- [ ] Monitor serial output for detailed error messages
- [ ] Consider alternative NTP servers
- [ ] Check timezone configuration in config.h

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

---

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

---

## Windows Standalone Build (Service + Installer, SQLite)

This section documents how to ship GMgmt as a self-contained Windows application that runs as a Windows Service and uses SQLite (single-file database). It covers both 32-bit (x86) and 64-bit (x64) Windows.

### Overview

- Backend runs as a Windows Service (listens on `http://localhost:3001`).
- Frontend is prebuilt and served by Express from `client/build`.
- SQLite database file is stored under `%ProgramData%\gmgmt\data\gmgmt.sqlite`.
- Installer copies files, installs the service, creates a firewall rule, and writes an `.env`.
- Two installers are produced: `GMgmt-Setup-x86.exe` and `GMgmt-Setup-x64.exe`.

### Prerequisites (for building installers)

- Windows 10/11 build machine (x64) with Node.js and npm.
- NSIS or WiX Toolset for building the installer (examples below use NSIS).
- Optional: NSSM if you prefer service install via command line instead of bundling `node-windows`.

### 1) Database Configuration

The application uses SQLite by default:

   ```bash
   # SQLite dependency is already included
   # No additional database setup required
   ```

2. Add a small adapter `src/config/sqlite.js` that:
   - Resolves DB path to `%ProgramData%\gmgmt\data\gmgmt.sqlite` (create folders as needed)
   - On start, creates tables if missing (mirroring the current schema)
   - Exposes `initializeDatabase()` and a `query(sql, params)` function

3. In `src/app.js` and controllers:
   - Replace imports from `../../config/database` with `../../config/sqlite`
   - Change `await pool.query(...)` to `query(...)`
   - For inserts that relied on `RETURNING *`, run a follow-up `SELECT` by last insert id if needed

4. Simplify `.env` (no DB host/port required):

   ```env
   PORT=3001
   EMAIL_USER=your_email
   EMAIL_PASS=your_app_password
   ```

### 2) Build the frontend and serve static files

```bash
cd client
npm run build
cd ..
```

Add to `src/app.js` to serve the built UI:

```js
const path = require('path');
app.use(express.static(path.join(__dirname, '../client/build')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/build/index.html'));
});
```

### 3) Bundle a Node.js runtime (x86 and x64)

- Use Node 18 for 32-bit support (Node ≥20 dropped 32-bit Windows).
- Place runtimes under your install directory:
  - `vendor/node-win-x64/node.exe`
  - `vendor/node-win-ia32/node.exe`

### 4) Install as a Windows Service

Option A: Programmatic with `node-windows`:

```bash
npm install node-windows --save
```

```js
// scripts/service-install.js
const path = require('path');
const Service = require('node-windows').Service;
const svc = new Service({
  name: 'GMgmt',
  description: 'Gym Management Service',
  script: path.join(__dirname, '..', 'src', 'app.js'),
  workingDirectory: path.join(__dirname, '..'),
  env: [{ name: 'NODE_ENV', value: 'production' }]
});
svc.on('install', () => svc.start());
svc.install();
```

Run:

```bash
node scripts/service-install.js
```

Option B: Using NSSM (no code dependency):

```bash
nssm install GMgmt "C:\\Program Files\\gmgmt\\vendor\\node-win-x64\\node.exe" "C:\\Program Files\\gmgmt\\src\\app.js"
nssm set GMgmt AppDirectory "C:\\Program Files\\gmgmt"
nssm set GMgmt AppStdout "C:\\ProgramData\\gmgmt\\logs\\out.log"
nssm set GMgmt AppStderr "C:\\ProgramData\\gmgmt\\logs\\err.log"
nssm start GMgmt
```

Allow the API port through Windows Firewall:

```bash
netsh advfirewall firewall add rule name="GMgmt API" dir=in action=allow protocol=TCP localport=3001
```

### 5) Build the Installer (NSIS)

Your installer should:

- Copy app files to `C:\\Program Files\\gmgmt` (x64) or `C:\\Program Files (x86)\\gmgmt` (x86)
- Copy the correct Node runtime (`vendor/node-win-<arch>/node.exe`)
- Create `%ProgramData%\\gmgmt\\{data,logs}`
- Write `%ProgramData%\\gmgmt\\.env`
- Install and start the Windows Service (via script or NSSM)
- Add a firewall rule for TCP 3001
- Create Start Menu shortcuts (e.g., open `http://localhost:3001` in default browser)
- Uninstaller should stop/remove the service and optionally preserve `%ProgramData%\\gmgmt` data

Example NSIS snippet:

```nsis
Section
  CreateDirectory "$%ProgramData%\gmgmt\data"
  CreateDirectory "$%ProgramData%\gmgmt\logs"
  nsExec::ExecToLog 'netsh advfirewall firewall add rule name="GMgmt API" dir=in action=allow protocol=TCP localport=3001'
SectionEnd
```

### 6) 32-bit vs 64-bit builds

- Build two artifacts; ensure `better-sqlite3` has binaries for both architectures.
- If building on CI for x86, run `npm ci` with `npm_config_target_arch=ia32`.
- Use Node 18 for x86; x64 can also use Node 18+ (keep in sync with native deps).

### 7) Data Import (Optional)

- If migrating from another database system, export tables to CSV.
- Import CSVs using the SQLite CLI:

```sql
.mode csv
.import members.csv members
.import membership_plans.csv membership_plans
.import invoices.csv invoices
.import payments.csv payments
.import classes.csv classes
.import class_schedules.csv class_schedules
.import bookings.csv bookings
.import attendance.csv attendance
.import member_biometrics.csv member_biometrics
```

Verify foreign keys and adjust IDs if required. SQLite autoincrements without sequences.

### 8) Operator quickstart (after install)

1. Run `GMgmt-Setup-x64.exe` or `GMgmt-Setup-x86.exe`.
2. Browse to `http://localhost:3001` to use the app.
3. Manage the `GMgmt` Windows Service via Services.msc (start/stop) when needed.

---

## Documentation Structure

This project maintains separate documentation for different components:

- **📖 [Main README.md](README.md)** - Project overview, installation, ESP32 integration, troubleshooting, backend API, and development information
- **📖 [Frontend Documentation](client/README.md)** - React components, UI features, styling, and frontend-specific information

Each README focuses on its specific domain while maintaining cross-references for comprehensive understanding. All backend and ESP32-related documentation has been consolidated into this main README.

---

## Future Enhancements

The current application is feature-complete for gym management. Future development could include:

-   A dedicated **Member Portal/Mobile App** for clients to manage their own profiles and bookings.
-   **SMS notifications** integration alongside email communications.
-   **Advanced member retention analytics** with churn prediction.
-   **Point of Sale (POS)** integration for merchandise and additional services.
-   **Wearable device integration** for real-time fitness tracking.
-   **Social features** for member community building.

---

## Support

For technical support or feature requests, please refer to the API documentation above or contact the development team.

### Additional Resources

#### API Endpoints
- **Device Management**: `/api/biometric/devices/*` for device management
- **ESP32 Configuration**: 
  - `GET /api/config` - Retrieve device configuration
  - `POST /api/config` - Update device configuration
- **Device Control**:
  - `POST /unlock` - Emergency unlock
  - `POST /enroll` - Start fingerprint enrollment
- **Status Monitoring**: `/status` - Device status and health information

#### Configuration Files
- **ESP32 Firmware**: `esp32_door_lock/esp32_door_lock.ino`
- **Configuration Template**: `esp32_door_lock/config.h.example`
- **Environment Variables**: `.env` file for server configuration

#### Frontend Components
- **ESP32 Device Manager**: `/client/src/components/ESP32DeviceManager.js`
- **Monitor Interface**: `/client/src/components/ESP32Monitor.js`
- **Analytics Dashboard**: `/client/src/components/ESP32Analytics.js`
- **Settings Integration**: `/client/src/components/Settings.js`

#### Testing Scripts
- **`tools/calculate_timezone_offset.js`**: Timezone offset calculator
- **`tools/test_timestamp_fix.js`**: Timestamp fix verification
- **`tools/test_esp32_integration.js`**: ESP32 integration testing
