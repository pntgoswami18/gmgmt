const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_DATABASE,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

pool.on('connect', () => {
  console.log('Connected to the database');
});

const createTables = async () => {
  const memberTable = `
    CREATE TABLE IF NOT EXISTS members (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      email VARCHAR(100) UNIQUE NOT NULL,
      membership_type VARCHAR(100),
      membership_plan_id INTEGER REFERENCES membership_plans(id),
      join_date DATE DEFAULT CURRENT_DATE
    );
  `;

  const settingsTable = `
    CREATE TABLE IF NOT EXISTS settings (
      key VARCHAR(50) PRIMARY KEY,
      value TEXT
    );
  `;

  const insertDefaultSettings = `
    INSERT INTO settings (key, value) VALUES ('currency', 'INR') ON CONFLICT (key) DO NOTHING;
    INSERT INTO settings (key, value) VALUES ('membership_types', '["Weight Training", "Cardio", "Cardio & Weights Training"]') ON CONFLICT (key) DO NOTHING;
    INSERT INTO settings (key, value) VALUES ('gym_name', 'My Gym') ON CONFLICT (key) DO NOTHING;
    INSERT INTO settings (key, value) VALUES ('gym_logo', 'logo.svg') ON CONFLICT (key) DO NOTHING;
    INSERT INTO settings (key, value) VALUES ('primary_color', '#3f51b5') ON CONFLICT (key) DO NOTHING;
    INSERT INTO settings (key, value) VALUES ('secondary_color', '#f50057') ON CONFLICT (key) DO NOTHING;
    INSERT INTO settings (key, value) VALUES ('payment_reminder_days', '7') ON CONFLICT (key) DO NOTHING;
    INSERT INTO settings (key, value) VALUES ('morning_session_start', '05:00') ON CONFLICT (key) DO NOTHING;
    INSERT INTO settings (key, value) VALUES ('morning_session_end', '11:00') ON CONFLICT (key) DO NOTHING;
    INSERT INTO settings (key, value) VALUES ('evening_session_start', '16:00') ON CONFLICT (key) DO NOTHING;
    INSERT INTO settings (key, value) VALUES ('evening_session_end', '22:00') ON CONFLICT (key) DO NOTHING;
  `;



  const attendanceTable = `
    CREATE TABLE IF NOT EXISTS attendance (
      id SERIAL PRIMARY KEY,
      member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
      check_in_time TIMESTAMP NOT NULL,
      check_out_time TIMESTAMP
    );
  `;

  const classTable = `
    CREATE TABLE IF NOT EXISTS classes (
      id SERIAL PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      description TEXT,
      instructor VARCHAR(100),
      duration_minutes INTEGER
    );
  `;

  const scheduleTable = `
    CREATE TABLE IF NOT EXISTS class_schedules (
      id SERIAL PRIMARY KEY,
      class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
      start_time TIMESTAMP NOT NULL,
      end_time TIMESTAMP NOT NULL,
      max_capacity INTEGER
    );
  `;

  const bookingTable = `
  CREATE TABLE IF NOT EXISTS bookings (
    id SERIAL PRIMARY KEY,
    member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
    schedule_id INTEGER REFERENCES class_schedules(id) ON DELETE CASCADE,
    booking_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(20) DEFAULT 'confirmed'
  );
  `;

  const membershipPlanTable = `
    CREATE TABLE IF NOT EXISTS membership_plans (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        price NUMERIC(10, 2) NOT NULL,
        duration_days INTEGER NOT NULL,
        description TEXT
    );
  `;

  const invoiceTable = `
    CREATE TABLE IF NOT EXISTS invoices (
        id SERIAL PRIMARY KEY,
        member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
        plan_id INTEGER REFERENCES membership_plans(id),
        amount NUMERIC(10, 2) NOT NULL,
        due_date DATE NOT NULL,
        status VARCHAR(20) DEFAULT 'unpaid', -- unpaid, paid, overdue
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  const paymentTable = `
    CREATE TABLE IF NOT EXISTS payments (
        id SERIAL PRIMARY KEY,
        invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
        amount NUMERIC(10, 2) NOT NULL,
        payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        payment_method VARCHAR(50), -- e.g., 'stripe', 'cash'
        transaction_id VARCHAR(100) -- For external payment provider reference
    );
  `;

  const biometricTable = `
    CREATE TABLE IF NOT EXISTS member_biometrics (
      id SERIAL PRIMARY KEY,
      member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
      device_user_id VARCHAR(50) UNIQUE,
      template TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  
  try {
    await pool.query(memberTable);
    // Ensure columns exist for backward compatibility
    await pool.query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS membership_type VARCHAR(100);`);
    await pool.query(`ALTER TABLE members ADD COLUMN IF NOT EXISTS membership_plan_id INTEGER REFERENCES membership_plans(id);`);
    await pool.query(settingsTable);
    await pool.query(insertDefaultSettings);
    await pool.query(attendanceTable);
    await pool.query(classTable);
    await pool.query(scheduleTable);
    await pool.query(bookingTable);
    await pool.query(membershipPlanTable);
    await pool.query(invoiceTable);
    await pool.query(paymentTable);
    await pool.query(biometricTable);
    console.log('All tables created successfully');
  } catch (err) {
    console.error('Error creating tables', err.stack);
  }
};

const initializeDatabase = async () => {
  await createTables();
};

module.exports = { pool, initializeDatabase };
