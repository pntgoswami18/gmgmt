# Gym Management Software

This is a comprehensive Gym Management Software built with a Node.js backend and a React frontend. It provides a full suite of tools for gym owners and staff to manage their members, schedules, bookings, and payments efficiently.

## Features

The application is built with a comprehensive feature set that includes:

### Backend API Features
*   **Member Management:** Full CRUD (Create, Read, Update, Delete) operations for gym members with automated welcome emails.
*   **Biometric Attendance:** API endpoint to simulate and log member check-ins from biometric devices with attendance history tracking.
*   **Class & Schedule Management:** Complete system for creating fitness classes and scheduling them with capacity management.
*   **Online Booking System:** Members can book and cancel class spots with overbooking prevention and automated confirmation emails.
*   **Billing & Payments:** Stripe-integrated payment processing with membership plans and automated payment confirmations.
*   **Automated Communications:** Email notifications for member registration, class bookings, and payment confirmations.
*   **Advanced Analytics:** Comprehensive reporting system with member growth, attendance trends, revenue analytics, and popular class rankings.

### Frontend Admin Dashboard Features
*   **Multi-page Navigation:** Professional dashboard with React Router navigation between different management sections.
*   **Member Management Interface:** Add, view, edit, and delete gym members with real-time data updates.
*   **Class Management Interface:** Create and manage fitness classes with instructor and duration details.
*   **Schedule Management Interface:** Schedule classes with datetime pickers, capacity settings, and visual schedule display.
*   **Attendance Tracking Interface:** View member attendance history and simulate biometric check-ins for testing.
*   **Financial Management Interface:** Create membership plans and manage billing with Stripe integration guidance.
*   **Analytics Dashboard:** Real-time reporting with summary statistics, growth trends, revenue tracking, and popular class analytics.

## Technology Stack

-   **Backend:**
    -   Node.js with Express.js framework
    -   PostgreSQL database with automated schema creation
    -   Stripe API for secure payment processing
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
-   [PostgreSQL](https://www.postgresql.org/download/)

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

### 2. Set Up PostgreSQL Database

You need to have a PostgreSQL server running. Then, create a new database for the application.

```sql
-- Using psql or a GUI tool like pgAdmin
CREATE DATABASE gym_management;
```

### 3. Configure Environment Variables

Create a `.env` file in the root of the project (`gmgmt/`). This file will store your database credentials and other secret keys.

Copy the following into the `.env` file and replace the placeholder values with your actual credentials.

```env
# PostgreSQL Database Configuration
DB_USER=your_postgres_user
DB_HOST=localhost
DB_DATABASE=gym_management
DB_PASSWORD=your_database_password
DB_PORT=5432

# JSON Web Token Secret (for future authentication features)
JWT_SECRET=your_super_secret_jwt_key

# Stripe API Secret Key (for payment processing)
STRIPE_SECRET_KEY=sk_test_...your_stripe_secret_key

# Email Configuration (for automated notifications)
EMAIL_USER=your_email@gmail.com
EMAIL_PASS=your_app_password
```

**Note for Email Setup:** For Gmail, you'll need to use an "App Password" instead of your regular password. Enable 2-factor authentication and generate an app password in your Google Account settings.

**Note for JWT Secret:** It is critical to use a strong, randomly-generated secret for your JWT key. You can generate one from your terminal with the following command:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Note for Stripe Setup:** To get a Stripe secret key, you need a Stripe account. From the Stripe Developer Dashboard, find your "secret key" for test mode (it will start with `sk_test_`).

The application will automatically create the required tables when it first connects to the database.

---

## Running the Application

You will need to run the backend and frontend servers in two separate terminals.

**1. Start the Backend Server:**

Open a terminal in the project's root directory and run:

```bash
npm start
```

The backend API will be running on `http://localhost:3000`.

**2. Start the Frontend Application:**

Open a second terminal and navigate to the `client` directory:

```bash
cd client
npm start
```

The React development server will open the admin dashboard in your browser, typically at `http://localhost:3001`.

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
| **Attendance**| `POST`| `/api/attendance/check-in`  | Log a member check-in (for biometric device) |
|              | `GET`  | `/api/attendance/:memberId` | Get attendance history for a member        |
| **Classes**  | `GET`  | `/api/classes`              | Get all classes                            |
|              | `POST` | `/api/classes`              | Create a new class                         |
| **Schedules**| `GET`  | `/api/schedules`            | Get all class schedules                    |
|              | `POST` | `/api/schedules`            | Create a new schedule                      |
| **Bookings** | `POST` | `/api/bookings`             | Book a member into a class                 |
|              | `GET`  | `/api/bookings/member/:memberId`| Get all bookings for a member           |
|              | `PATCH`| `/api/bookings/cancel/:bookingId`| Cancel a booking                       |
| **Plans**    | `GET`  | `/api/plans`                | Get all membership plans                   |
|              | `POST` | `/api/plans`                | Create a new membership plan               |
| **Payments** | `POST` | `/api/payments`             | Process a payment for an invoice           |
| **Reports**  | `GET`  | `/api/reports/summary`      | Get overall summary statistics             |
|              | `GET`  | `/api/reports/member-growth`| Get member growth over last 12 months     |
|              | `GET`  | `/api/reports/attendance-stats`| Get daily attendance for last 30 days  |
|              | `GET`  | `/api/reports/popular-classes`| Get most popular classes by booking count|
|              | `GET`  | `/api/reports/revenue-stats`| Get monthly revenue for last 12 months    |

---

## Database Schema

The application automatically creates the following database tables:

- **members:** Store member information and membership details
- **classes:** Fitness class definitions with instructors and duration
- **class_schedules:** Scheduled instances of classes with time and capacity
- **bookings:** Member bookings for scheduled classes
- **attendance:** Member check-in/check-out records
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

- **Summary Statistics:** Total members, revenue, new members this month, active schedules
- **Member Growth:** 12-month trend of new member registrations
- **Revenue Analytics:** Monthly revenue trends over the past year
- **Popular Classes:** Rankings of classes by total bookings
- **Attendance Trends:** Daily check-in statistics for the last 30 days

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
