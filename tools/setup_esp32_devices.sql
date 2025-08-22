-- ESP32 Device Management Schema
-- Run this to add ESP32 device management to your existing database

-- Create devices table for ESP32 door locks
CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT UNIQUE NOT NULL,
    device_type TEXT NOT NULL DEFAULT 'esp32_door_lock',
    device_name TEXT,
    location TEXT,
    ip_address TEXT,
    mac_address TEXT,
    firmware_version TEXT,
    status TEXT DEFAULT 'offline',
    last_heartbeat TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- Create device_commands table for command history
CREATE TABLE IF NOT EXISTS device_commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    command TEXT NOT NULL,
    parameters TEXT,
    sent_at TEXT DEFAULT (datetime('now')),
    executed_at TEXT,
    status TEXT DEFAULT 'pending',
    response TEXT,
    FOREIGN KEY (device_id) REFERENCES devices(device_id)
);

-- Create access_logs table for detailed door access tracking
CREATE TABLE IF NOT EXISTS access_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id TEXT NOT NULL,
    member_id INTEGER,
    access_type TEXT NOT NULL, -- 'fingerprint', 'remote', 'override', 'emergency'
    access_result TEXT NOT NULL, -- 'granted', 'denied'
    fingerprint_id INTEGER,
    reason TEXT,
    timestamp TEXT DEFAULT (datetime('now')),
    additional_data TEXT,
    FOREIGN KEY (device_id) REFERENCES devices(device_id),
    FOREIGN KEY (member_id) REFERENCES members(id)
);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_devices_device_id ON devices(device_id);
CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);
CREATE INDEX IF NOT EXISTS idx_device_commands_device_id ON device_commands(device_id);
CREATE INDEX IF NOT EXISTS idx_device_commands_status ON device_commands(status);
CREATE INDEX IF NOT EXISTS idx_access_logs_device_id ON access_logs(device_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_member_id ON access_logs(member_id);
CREATE INDEX IF NOT EXISTS idx_access_logs_timestamp ON access_logs(timestamp);

-- Insert sample ESP32 device
INSERT OR IGNORE INTO devices (device_id, device_name, location, device_type) 
VALUES ('DOOR_001', 'Main Entrance Door Lock', 'Front Door', 'esp32_door_lock');

-- Create views for easy data access
CREATE VIEW IF NOT EXISTS device_status_view AS
SELECT 
    d.device_id,
    d.device_name,
    d.location,
    d.status,
    d.last_heartbeat,
    d.ip_address,
    COUNT(al.id) as today_access_count,
    MAX(al.timestamp) as last_access
FROM devices d
LEFT JOIN access_logs al ON d.device_id = al.device_id 
    AND date(al.timestamp) = date('now')
GROUP BY d.device_id, d.device_name, d.location, d.status, d.last_heartbeat, d.ip_address;

-- Create trigger to update device updated_at timestamp
CREATE TRIGGER IF NOT EXISTS update_device_timestamp 
    AFTER UPDATE ON devices
BEGIN
    UPDATE devices SET updated_at = datetime('now') WHERE id = NEW.id;
END;

PRAGMA user_version = 3; -- Increment database version
