# Gym Management Software

This is a comprehensive Gym Management Software built with a Node.js backend and a React frontend. It provides a full suite of tools for gym owners and staff to manage their members, schedules, bookings, and payments efficiently.

## Features

The application is built with a comprehensive feature set that includes:

### Backend API Features
*   **Member Management:** Full CRUD (Create, Read, Update, Delete) operations for gym members with automated welcome emails.
*   **Biometric Attendance:** API endpoints to log member check-ins from biometric devices (Secureye S‑B100CB or similar) with attendance history tracking and configurable working hours.
*   **Class & Schedule Management:** Complete system for creating fitness classes and scheduling them with capacity management.
*   **Online Booking System:** Members can book and cancel class spots with overbooking prevention and automated confirmation emails.
*   **Billing & Payments:** Membership plans, invoices, and manual payment recording.
*   **Automated Communications:** Email notifications for member registration, class bookings, and payment confirmations.
*   **Advanced Analytics:** Comprehensive reporting system with member growth, attendance trends, revenue analytics, and popular class rankings.

### Frontend Admin Dashboard Features
*   **Multi-page Navigation:** Professional dashboard with React Router navigation between different management sections.
*   **Member Management Interface:** Add, view, edit, and delete gym members with real-time data updates.
*   **Class Management Interface:** Create and manage fitness classes with instructor and duration details.
*   **Schedule Management Interface:** Schedule classes with datetime pickers, capacity settings, and visual schedule display.
*   **Attendance Tracking Interface:** View member attendance history and simulate biometric check-ins for testing. Enforces session-based check-ins (Morning 05:00–11:00, Evening 16:00–22:00) with a single check-in allowed per calendar date.
*   **Financial Management Interface:** Create membership plans and manage billing. Record manual payments against invoices, including auto-creating an invoice if none exists.
*   **Analytics Dashboard:** Real-time reporting with summary statistics, growth trends, revenue tracking, and popular class analytics. Dashboard cards are clickable and deep-link to filtered sections (e.g., unpaid members, pending payments).
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
# Gym Management Software

This project provides an end‑to‑end gym management system with an admin dashboard and a Node.js API. Use it to manage members, classes, schedules, attendance, billing and basic analytics.

## High‑level Features

- Member management (create, update, list)
- Class and schedule management
- Attendance tracking with configurable working hours
- Billing: membership plans, invoices, payments (manual)
- Analytics dashboard (summary cards, basic charts)
- Branding controls and accent colors (solid or gradient)

## Technology Stack

- Backend: Node.js, Express, SQLite, Axios, Nodemailer
- Frontend: React, React Router, Material UI, Recharts

## Installation & Setup

### Prerequisites
- Node.js and npm

### 1) Install dependencies

```bash
# From the project root (server)
npm install

# Frontend
cd client
npm install
cd ..
```

### 2) Configure environment variables

Create a `.env` file in the project root:

```env
# Database will be automatically created as SQLite file
# No additional database configuration required

# Optional integrations
# Payment gateway disabled; no secret key required
EMAIL_USER=your_email
EMAIL_PASS=your_app_password
```

### 3) Start the backend

```bash
npm start
```

The API runs at `http://localhost:3001` and auto‑creates the SQLite database and tables on first start.

### 4) Start the frontend

```bash
cd client
npm start
```

The dashboard opens at `http://localhost:3000` and proxies API calls to the backend.


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
- **Classes:** Manage fitness classes
- **Schedules:** Schedule classes and manage capacity
- **Attendance:** Track member attendance and simulate check-ins
- **Financials:** Manage membership plans and view payment integration

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

## Biometric Testing Commands

The application includes cross-platform testing scripts to verify biometric device communication:

### Available Test Scripts

```bash
# Check if biometric service is listening (cross-platform)
npm run biometric:check

# Send comprehensive test messages to verify communication (cross-platform)
npm run biometric:test

# Start the biometric listener service
npm run biometric:start

# Set up biometric database tables
npm run biometric:setup

# Get help for test options
npm run biometric:help

# Start main app with biometric integration enabled
npm run start:with-biometric
```

### Environment Configuration

Configure biometric settings in your `.env` file:

```env
ENABLE_BIOMETRIC=true
BIOMETRIC_PORT=8080
BIOMETRIC_HOST=0.0.0.0
```

**Note:** The test scripts automatically load environment variables from your `.env` file and work on both Windows and Unix-based systems.

📖 **For complete biometric setup and configuration guide, see [BIOMETRIC_INTEGRATION_GUIDE.md](BIOMETRIC_INTEGRATION_GUIDE.md)**

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
- Attendance view supports date range filtering (default: current week).
- In the Financials “Record Manual Payment” modal, selecting a member fetches their unpaid invoices and lets you auto-fill invoice and amount by selection.
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
- Send via WhatsApp: opens WhatsApp Web with a prefilled message to the member’s phone number.

---

## Biometric Device Integration (Secureye S‑B100CB)

This project supports integrating the Secureye S‑B100CB Biometric Fingerprint Scanner for attendance check-ins over IP (Ethernet) or via a small gateway. The device offers TCP/IP communication, 2000 user capacity, and access-control support per the vendor details. See the product page for reference: [Secureye S‑B100CB Biometric Fingerprint Scanner – IP (Ethernet & USB)](https://www.secureye.com/product/s-b100cb-biometric-fingerprint-scanner-ip-ethernet-usb-biometric).

### What we store
- A mapping between your app’s `member_id` and the device’s `device_user_id` in a new table `member_biometrics`.
- Optionally, a fingerprint template string (e.g., base64) if you enroll/capture via an SDK or external tool.

### Configurable working hours
Working hours are editable in Settings and enforced by the backend during check-in:
- Morning session: `morning_session_start`–`morning_session_end` (default 05:00–11:00)
- Evening session: `evening_session_start`–`evening_session_end` (default 16:00–22:00)

### How to wire the device
There are two common ways to integrate the device with the backend:

1) Device push → Backend webhook
- Configure the device (or its management software) to push user events to the backend:
  - URL: `POST /api/attendance/device-webhook`
  - Body: must include a device user field (any of `device_user_id`, `userId`, `UserID`, `EmpCode`, `emp_code`)
  - Example JSON: `{ "device_user_id": "1234" }`
- The backend resolves `device_user_id` → `member_id` via `member_biometrics` and performs the standard check-in with working-hours validation and “one check-in per day”.

2) Local gateway → Backend
- If the device cannot post directly, run a lightweight gateway on the same LAN that reads the device’s logs (via TCP/IP or vendor SDK) and POSTs to `POST /api/attendance/device-webhook` using the same schema as above.

### Managing biometric links for members
- In the admin UI, open Members → “Biometric” on a member.
- Enter the Secureye `device_user_id` you configured on the device (or paste a template if available).
- This calls `PUT /api/members/:id/biometric` and stores the mapping/template.
- You can also upsert via API directly:
  - `PUT /api/members/:id/biometric`
  - Body: `{ "device_user_id": "1234", "template": "<optional base64>" }`

### Check-in from devices or apps
- Direct app/server call: `POST /api/attendance/check-in` with either `{ memberId: 42 }` or `{ device_user_id: "1234" }`
- Device/webhook call: `POST /api/attendance/device-webhook` with `{ device_user_id: "1234" }`

### Error handling
- Out-of-hours: backend returns `400` with a message reflecting current configured hours.
- Duplicate daily check-in: backend returns `409` with `Member has already checked in today.`
- Unknown device user: backend returns `404` if no `member_biometrics` mapping is present.

### Notes
- The device supports TCP/IP and USB. For production, prefer an IP-based configuration and a small webhook/gateway approach for reliability.
- If you use vendor SDKs for template management, store a template string with the member for future migrations; the backend does not need to interpret the template, it only stores it.
- Ensure the device’s internal user IDs match the `device_user_id` you set for each member.

Reference: [Secureye S‑B100CB Biometric Fingerprint Scanner – IP (Ethernet & USB)](https://www.secureye.com/product/s-b100cb-biometric-fingerprint-scanner-ip-ethernet-usb-biometric)

## Windows standalone build (Service + Installer, SQLite)

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

## Future Enhancements

The current application is feature-complete for gym management. Future development could include:

-   A dedicated **Member Portal/Mobile App** for clients to manage their own profiles and bookings.
-   **SMS notifications** integration alongside email communications.
-   **Advanced member retention analytics** with churn prediction.
-   **Point of Sale (POS)** integration for merchandise and additional services.
-   **Wearable device integration** for real-time fitness tracking.
-   **Social features** for member community building.

## Support

For technical support or feature requests, please refer to the API documentation above or contact the development team.
