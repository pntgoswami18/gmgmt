# ESP32 Door Lock Configuration Guide

## Overview

The ESP32 Door Lock now supports dynamic configuration through multiple methods:

1. **Web Interface** (Recommended for initial setup)
2. **API Endpoints** (For integration with gym management system)
3. **Configuration Header File** (For development defaults)

## Configuration Methods

### 1. Web Interface Configuration

**Access**: `http://ESP32_IP/config`

The web interface provides a user-friendly form to configure:
- WiFi SSID and Password
- Device ID
- Gym Server IP and Port

**Features**:
- Real-time WiFi status display
- Automatic restart when needed
- Reset to defaults option
- Input validation

### 2. API Configuration

**Get Current Config**: `GET http://ESP32_IP/api/config`

Returns current configuration as JSON:
```json
{
  "wifi_ssid": "YourNetwork",
  "wifi_password_masked": "Yo****rd",
  "device_id": "DOOR_001",
  "gym_server_ip": "192.168.1.101",
  "gym_server_port": 8080,
  "wifi_status": "CONNECTED",
  "ip_address": "192.168.1.100",
  "wifi_rssi": -45
}
```

**Update Config**: `POST http://ESP32_IP/api/config`

Send JSON with new configuration:
```json
{
  "wifi_ssid": "NewNetwork",
  "wifi_password": "NewPassword",
  "device_id": "DOOR_002",
  "gym_server_ip": "192.168.1.200",
  "gym_server_port": 8080,
  "auto_restart": true
}
```

### 3. Configuration Header File

For development convenience, you can create a `config.h` file:

1. Copy `config.h.example` to `config.h`
2. Update the default values
3. Add `config.h` to `.gitignore` to keep credentials secure

## Configuration Storage

- **Persistent Storage**: Configuration is saved to ESP32's built-in preferences (EEPROM)
- **Automatic Loading**: Configuration is loaded on boot
- **Fallback Values**: If no saved configuration exists, defaults are used

## Configuration Priority

1. **config.h values** (highest priority - deployment/developer defaults)
2. **Saved Preferences** (medium priority - user web interface overrides)
3. **Built-in defaults** (lowest priority - fallback values)

**Important**: When `config.h` exists, its values take precedence on startup. User preferences from the web interface will only override `config.h` values after being explicitly saved through the configuration interface.

## Integration with Gym Management System

The ESP32 can be configured remotely through the gym management web interface:

1. Navigate to Settings → ESP32 Devices → Configuration
2. The system can discover and configure ESP32 devices automatically
3. API endpoints allow seamless integration

## Security Features

- **Password Masking**: Passwords are masked in logs and API responses
- **Secure Storage**: Credentials are stored in encrypted preferences
- **No Hardcoding**: No credentials stored in source code

## Troubleshooting

### WiFi Connection Issues
- Check SSID spelling and case sensitivity
- Verify password is correct
- Ensure network is 2.4GHz (ESP32 doesn't support 5GHz)
- Check for MAC address filtering
- Verify network is not hidden

### Configuration Reset
- Use the web interface "Reset to Defaults" button
- Or create a reset function via API
- Physical reset will restore saved preferences

### API Integration
- Ensure content-type is `application/json`
- Check that JSON is valid
- Verify ESP32 is reachable on the network

## Example Integration Code

```javascript
// Get ESP32 configuration
const response = await fetch('http://192.168.1.100/api/config');
const config = await response.json();

// Update configuration
const updateResponse = await fetch('http://192.168.1.100/api/config', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    wifi_ssid: 'NewNetwork',
    wifi_password: 'NewPassword',
    gym_server_ip: '192.168.1.200',
    auto_restart: true
  })
});
```

## Migration from Hardcoded Configuration

If you're upgrading from hardcoded credentials:

1. The ESP32 will use default fallback values on first boot
2. Configure via web interface or API
3. Remove hardcoded credentials from source code
4. Configuration will persist across reboots and firmware updates
