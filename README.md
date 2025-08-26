# Gym Management Software

This is a comprehensive Gym Management Software built with a Node.js backend and a React frontend. It provides a full suite of tools for gym owners and staff to manage their members, schedules, bookings, and payments efficiently.

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

---

## ESP32 Biometric Door Lock Integration

This project supports ESP32-based fingerprint door lock systems for attendance check-ins and access control. The ESP32 devices connect via WiFi and communicate using JSON over TCP/IP.

### What we store
- A mapping between your app's `member_id` and the device's `device_user_id` in the `member_biometrics` table.
- Optionally, a fingerprint template string for backup/migration purposes.

### Configurable working hours
Working hours are editable in Settings and enforced by the backend during check-in:
- Morning session: `morning_session_start`–`morning_session_end` (default 05:00–11:00)
- Evening session: `evening_session_start`–`evening_session_end` (default 16:00–22:00)

### Device Communication
ESP32 devices communicate via TCP/IP using JSON messages:
- **Connection**: ESP32 connects to server via WiFi
- **Protocol**: JSON over TCP/IP
- **Events**: Real-time fingerprint scan events and device status
- **Control**: Remote door unlock and fingerprint enrollment

### Managing biometric links for members
- In the admin UI, open Members → "Biometric" on a member.
- Enter the `device_user_id` configured on the ESP32 device.
- This calls `PUT /api/members/:id/biometric` and stores the mapping.
- You can also manage via API:
  - `PUT /api/members/:id/biometric`
  - Body: `{ "device_user_id": "1234", "template": "<optional base64>" }`

### Check-in from devices or apps
- ESP32 device call: Automatic JSON message sent on fingerprint scan
- Direct app/server call: `POST /api/attendance/check-in` with `{ memberId: 42 }` or `{ device_user_id: "1234" }`
- Device/webhook call: `POST /api/attendance/device-webhook` with `{ device_user_id: "1234" }`

### Error handling
- Out-of-hours: backend returns `400` with a message reflecting current configured hours.
- Duplicate daily check-in: backend returns `409` with `Member has already checked in today.`
- Unknown device user: backend returns `404` if no `member_biometrics` mapping is present.

### ESP32 Features
- **Hardware**: ESP32 + AS608 Optical Fingerprint Sensor + Door Lock Control
- **Connectivity**: WiFi-based, no additional gateway required
- **Real-time**: Live event streaming and device monitoring
- **Remote Control**: Unlock doors and enroll fingerprints remotely
- **Status Monitoring**: Device health, connectivity, and performance tracking

### ESP32 Setup and Configuration

#### Prerequisites
- **Hardware**: ESP32 + AS608 Fingerprint Sensor + Door Lock
- **Software**: Node.js 16+, npm
- **Network**: WiFi network for ESP32 connectivity

#### Quick Setup
1. **Install Required Arduino Libraries**:
   - `ArduinoJson` by Benoit Blanchon (version 6.x)
   - `Adafruit Fingerprint Sensor Library` by Adafruit

2. **Upload ESP32 Firmware**:
   - Open `esp32_door_lock/esp32_door_lock.ino` in Arduino IDE
   - Select board: **Tools → Board → ESP32 Arduino → ESP32 Dev Module**
   - Upload firmware

3. **Configure Device**:
   - Access `http://ESP32_IP/config` in browser
   - Enter WiFi credentials and server settings
   - Device will restart automatically

4. **Verify Connection**:
   - Check Serial Monitor at 115200 baud
   - Look for "SYSTEM READY - Waiting for fingerprints"

#### Hardware Connections
- **AS608 Sensor**: RX→Pin16, TX→Pin17, VCC→5V, GND→GND
- **Door Lock**: Relay→Pin18, 12V power supply
- **Status LEDs**: Green→Pin19, Red→Pin21, Blue→Pin22
- **Buzzer**: Pin23
- **Buttons**: Enroll→Pin4, Override→Pin5

#### Configuration Management
The ESP32 supports dynamic, environment-driven configuration:

1. **Web Interface**: `http://ESP32_IP/config` - User-friendly configuration form
2. **API Endpoints**: REST API for programmatic configuration
3. **Remote Management**: Configure from gym management system
4. **Development Defaults**: Optional `config.h` file for custom defaults

#### Critical Port Configuration
**IMPORTANT**: The ESP32 must connect to the **main server port** (PORT in .env), NOT the BIOMETRIC_PORT:

- **✅ Correct**: ESP32 port = 3001 (matches main server PORT)
- **❌ Wrong**: ESP32 port = 8080 (causes HTTP timeout errors)

#### Testing Commands
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

## Email Automation

The system automatically sends emails for:

1. **Welcome Email:** Sent when a new member is registered
2. **Booking Confirmation:** Sent when a member books a class
3. **Payment Confirmation:** Sent when a payment is successfully processed

All emails use professional HTML templates with gym branding.

## Analytics & Reporting

The dashboard provides comprehensive analytics including:

- **Summary Statistics:** Total members, revenue, new members this month, active schedules, unpaid members this month
- **Member Growth:** 12-month trend of new member registrations
- **Revenue Analytics:** Monthly revenue trends over the past year
- **Popular Classes:** Rankings of classes by total bookings
- **Attendance Trends:** Daily check-in statistics for the last 30 days

## Current Behavior Notes

- Attendance check-ins are only allowed during Morning (05:00–11:00) or Evening (16:00–22:00) sessions, and a member can check in only once per calendar date.
- Attendance view supports date range filtering (default: current week) with full-day coverage (00:00:00 to 23:59:59).
- In the Financials "Record Manual Payment" modal, selecting a member fetches their unpaid invoices and lets you auto-fill invoice and amount by selection.
- Dashboard cards are clickable and navigate to filtered views (e.g., unpaid members or pending payments).
- Dashboard card visibility can be configured in Settings.

### Branding & Theme
- Settings → Accent Colors lets you configure:
  - Primary/Secondary mode: Solid or Gradient
  - Gradient editor (Linear/Radial, angle, color stops)
- Exposed CSS variables for custom styling: `--accent-primary-color`, `--accent-secondary-color`, `--accent-primary-bg`, `--accent-secondary-bg`.
- Secondary accent is applied to: contained/outlined buttons, h4/h5 headings (gradient text), section header borders, and invoice header label.

### Invoices
- Open from Financials → Recent Payment History by clicking a row.
- Print: prints only the invoice area.
- Download: generates a PDF via html2canvas + jsPDF (no print dialog).
- Send via WhatsApp: opens WhatsApp Web with a prefilled message to the member's phone number.

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

## Troubleshooting and Common Issues

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
