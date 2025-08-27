/*
 * ESP32 Fingerprint Door Lock System
 * Integrates with Gym Management System
 * 
 * Hardware:
 * - ESP32-WROOM-32 Development Board
 * - AS608 Optical Fingerprint Sensor
 * - 12V Electromagnetic Door Lock
 * - 5V Relay Module
 * - Status LEDs and Buzzer
 * 
 * Compatible with existing biometric integration system
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Adafruit_Fingerprint.h>
#include <WebServer.h>
#include <Preferences.h>
#include <Update.h>
#include <time.h>

// Include configuration file (comment out if config.h doesn't exist)
#include "config.h"

// ==================== CONFIGURATION ====================
// Default WiFi Configuration (fallback values - will be overridden by stored preferences)
#ifndef DEFAULT_WIFI_SSID
const char* DEFAULT_WIFI_SSID = "ESP32_Setup";
#endif
#ifndef DEFAULT_WIFI_PASSWORD
const char* DEFAULT_WIFI_PASSWORD = "configure_me";
#endif

// Default Gym Management System Configuration  
#ifndef DEFAULT_GYM_SERVER_IP
const char* DEFAULT_GYM_SERVER_IP = "10.66.219.230";
#endif
#ifndef DEFAULT_GYM_SERVER_PORT
const int DEFAULT_GYM_SERVER_PORT = 8080;
#endif
#ifndef DEFAULT_DEVICE_ID
const char* DEFAULT_DEVICE_ID = "DOOR_001";
#endif

// Runtime configuration variables (loaded from preferences)
String wifi_ssid = "";
String wifi_password = "";
String gym_server_ip = "";
int gym_server_port = 8080;
String device_id = "";

// Pin Definitions
#define FINGERPRINT_RX_PIN    16
#define FINGERPRINT_TX_PIN    17
#define RELAY_PIN             18      // Controls door lock relay (HIGH=locked, LOW=unlocked)
#define GREEN_LED_PIN         19
#define RED_LED_PIN           21
#define BLUE_LED_PIN          22
#define BUZZER_PIN            23
#define ENROLL_BUTTON_PIN     4
#define OVERRIDE_BUTTON_PIN   5

// Timing Constants
#define DOOR_UNLOCK_TIME      3000    // 3 seconds
#define WIFI_TIMEOUT          30000   // 30 seconds
#define HEARTBEAT_INTERVAL    60000   // 1 minute
#define HTTP_TIMEOUT          15000   // 15 seconds for server communications
#define BUTTON_DEBOUNCE       200     // 200ms

// ==================== GLOBAL OBJECTS ====================
HardwareSerial fingerprintSerial(2);  // Use Serial2 for fingerprint sensor
Adafruit_Fingerprint finger = Adafruit_Fingerprint(&fingerprintSerial);
WebServer webServer(80);               // Web interface for configuration
Preferences preferences;               // Non-volatile storage
HTTPClient http;                       // HTTP client for server communication

// ==================== GLOBAL VARIABLES ====================
bool systemReady = false;
bool enrollmentMode = false;
int enrollmentID = 0;
unsigned long lastHeartbeat = 0;
unsigned long lastButtonCheck = 0;
unsigned long lastNTPResync = 0;  // Track last NTP resync attempt
int fingerprintID = -1;
String deviceStatus = "ready";
struct tm timeinfo;  // Global variable for time functions

// ==================== FUNCTION DECLARATIONS ====================
void sendEnrollmentProgress(String progressStep);
void sendEnrollmentData(int memberID, String status);
void sendBiometricData(int memberID, String status);
void sendHeartbeat();
void sendToServer(String jsonData);
void resyncNTPTime(); // Add NTP resync function declaration

// ==================== TIME FUNCTIONS ====================
void waitForNTPTime() {
  Serial.println("Waiting for NTP time synchronization...");
  
  // Configure multiple NTP servers for redundancy (max 3 supported by ESP32)
  configTime(TIMEZONE_OFFSET, DST_OFFSET, 
             "pool.ntp.org",           // Primary NTP server
             "time.nist.gov",          // Secondary NTP server (US)
             "time.google.com");       // Tertiary NTP server (Google)
  
  // Wait up to 30 seconds for NTP time to be available (increased from 10s)
  unsigned long startTime = millis();
  const unsigned long NTP_TIMEOUT = 30000; // 30 seconds
  
  Serial.println("Attempting NTP synchronization with multiple servers...");
  
  while (!getLocalTime(&timeinfo) && millis() - startTime < NTP_TIMEOUT) {
    Serial.print(".");
    delay(500); // Increased delay to reduce network congestion
    
    // Show progress every 10 seconds
    if ((millis() - startTime) % 10000 < 500) {
      Serial.printf(" [%ds]", (millis() - startTime) / 1000);
    }
  }
  
  if (getLocalTime(&timeinfo)) {
    Serial.println();
    Serial.println("✅ NTP time synchronized successfully!");
    
    char timeString[30];
    strftime(timeString, sizeof(timeString), "%Y-%m-%d %H:%M:%S", &timeinfo);
    Serial.printf("Current time: %s\n", timeString);
    
    // Validate that time is reasonable (not year 1970 or 2038)
    if (timeinfo.tm_year > 120 && timeinfo.tm_year < 138) { // 2020-2038
      Serial.println("✅ Time validation passed - reasonable year detected");
    } else {
      Serial.printf("⚠️ Suspicious year detected: %d\n", timeinfo.tm_year + 1900);
    }
  } else {
    Serial.println();
    Serial.println("❌ NTP time synchronization failed after 30 seconds");
    Serial.println("Possible causes:");
    Serial.println("  - Network firewall blocking NTP traffic (port 123)");
    Serial.println("  - DNS resolution issues");
    Serial.println("  - Network congestion or slow connection");
    Serial.println("  - Router blocking external NTP requests");
    Serial.println("  - ISP throttling or blocking NTP");
    Serial.println();
    Serial.println("Device will use approximate time based on uptime");
    Serial.println("This may affect timestamp accuracy in logs and server communications");
    
    // Try to get network diagnostic info
    if (WiFi.status() == WL_CONNECTED) {
      Serial.printf("Network info - IP: %s, DNS: %s, Gateway: %s\n", 
                    WiFi.localIP().toString().c_str(),
                    WiFi.dnsIP().toString().c_str(),
                    WiFi.gatewayIP().toString().c_str());
    }
  }
}

// Function to manually resynchronize NTP time
void resyncNTPTime() {
  Serial.println("🔄 Manual NTP resynchronization requested...");
  
  // Clear any existing time configuration
  configTime(0, 0, NULL);
  delay(1000);
  
  // Reconfigure with multiple NTP servers (max 3 supported by ESP32)
  configTime(TIMEZONE_OFFSET, DST_OFFSET, 
             "pool.ntp.org",           // Primary NTP server
             "time.nist.gov",          // Secondary NTP server (US)
             "time.google.com");       // Tertiary NTP server (Google)
  
  // Wait for synchronization with shorter timeout for manual sync
  unsigned long startTime = millis();
  const unsigned long MANUAL_NTP_TIMEOUT = 15000; // 15 seconds for manual sync
  
  Serial.println("Attempting manual NTP synchronization...");
  
  while (!getLocalTime(&timeinfo) && millis() - startTime < MANUAL_NTP_TIMEOUT) {
    Serial.print(".");
    delay(500);
    
    // Show progress every 5 seconds
    if ((millis() - startTime) % 5000 < 500) {
      Serial.printf(" [%ds]", (millis() - startTime) / 1000);
    }
  }
  
  if (getLocalTime(&timeinfo)) {
    Serial.println();
    Serial.println("✅ Manual NTP resynchronization successful!");
    
    char timeString[30];
    strftime(timeString, sizeof(timeString), "%Y-%m-%d %H:%M:%S", &timeinfo);
    Serial.printf("Updated time: %s\n", timeString);
  } else {
    Serial.println();
    Serial.println("❌ Manual NTP resynchronization failed");
    Serial.println("Time remains unchanged");
  }
}

// ==================== CONFIGURATION FUNCTIONS ====================
void loadConfiguration() {
  Serial.println("Loading configuration with priority: config.h > preferences > defaults...");
  
  // Debug: Show what defaults are available
  Serial.printf("DEFAULT_WIFI_SSID: '%s'\n", DEFAULT_WIFI_SSID);
  Serial.printf("DEFAULT_WIFI_PASSWORD: '%s' (length: %d)\n", DEFAULT_WIFI_PASSWORD, strlen(DEFAULT_WIFI_PASSWORD));
  Serial.printf("DEFAULT_GYM_SERVER_IP: '%s'\n", DEFAULT_GYM_SERVER_IP);
  Serial.printf("DEFAULT_GYM_SERVER_PORT: %s\n", DEFAULT_GYM_SERVER_PORT);
  Serial.printf("DEFAULT_DEVICE_ID: '%s'\n", DEFAULT_DEVICE_ID);
  
  // PRIORITY 1: Load from config.h if it exists and defines values
  #ifdef CONFIG_H
    Serial.println("Using config.h values as primary configuration source");
    wifi_ssid = DEFAULT_WIFI_SSID;
    wifi_password = DEFAULT_WIFI_PASSWORD;
    gym_server_ip = DEFAULT_GYM_SERVER_IP;
    gym_server_port = String(DEFAULT_GYM_SERVER_PORT).toInt();  // Convert string to int
    device_id = DEFAULT_DEVICE_ID;
  #else
    // PRIORITY 2: Load from preferences if config.h not available
    Serial.println("config.h not found, loading from preferences...");
    wifi_ssid = preferences.getString("wifi_ssid", DEFAULT_WIFI_SSID);
    wifi_password = preferences.getString("wifi_password", DEFAULT_WIFI_PASSWORD);
    gym_server_ip = preferences.getString("server_ip", DEFAULT_GYM_SERVER_IP);
    gym_server_port = preferences.getInt("server_port", String(DEFAULT_GYM_SERVER_PORT).toInt());
    device_id = preferences.getString("device_id", DEFAULT_DEVICE_ID);
  #endif
  
  // Allow preferences to override config.h ONLY if explicitly saved through web interface
  // Check if user has customized configuration via web interface
  if (preferences.getBool("user_configured", false)) {
    Serial.println("User customization detected, checking for preference overrides...");
    
    String pref_wifi_ssid = preferences.getString("wifi_ssid", "");
    String pref_wifi_password = preferences.getString("wifi_password", "");
    String pref_server_ip = preferences.getString("server_ip", "");
    int pref_server_port = preferences.getInt("server_port", 0);
    String pref_device_id = preferences.getString("device_id", "");
    
    // Only override config.h values if preferences contain non-empty values
    if (pref_wifi_ssid.length() > 0 && pref_wifi_ssid != DEFAULT_WIFI_SSID) {
      wifi_ssid = pref_wifi_ssid;
      Serial.println("  Overriding WiFi SSID from preferences");
    }
    if (pref_wifi_password.length() > 0 && pref_wifi_password != DEFAULT_WIFI_PASSWORD) {
      wifi_password = pref_wifi_password;
      Serial.println("  Overriding WiFi password from preferences");
    }
    if (pref_server_ip.length() > 0 && pref_server_ip != DEFAULT_GYM_SERVER_IP) {
      gym_server_ip = pref_server_ip;
      Serial.println("  Overriding server IP from preferences");
    }
    if (pref_server_port > 0 && pref_server_port != String(DEFAULT_GYM_SERVER_PORT).toInt()) {
      gym_server_port = pref_server_port;
      Serial.println("  Overriding server port from preferences");
    }
    if (pref_device_id.length() > 0 && pref_device_id != DEFAULT_DEVICE_ID) {
      device_id = pref_device_id;
      Serial.println("  Overriding device ID from preferences");
    }
  }
  
  Serial.println("========================================");
  Serial.println("FINAL CONFIGURATION LOADED:");
  #ifdef CONFIG_H
    Serial.println("✅ Source: config.h (with possible user overrides)");
  #else
    Serial.println("⚠️  Source: preferences + built-in defaults");
  #endif
  Serial.printf("  WiFi SSID: '%s'\n", wifi_ssid.c_str());
  Serial.printf("  WiFi Password: '%s' (length: %d)\n", maskPassword(wifi_password.c_str()).c_str(), wifi_password.length());
  Serial.printf("  Server IP: '%s'\n", gym_server_ip.c_str());
  Serial.printf("  Server Port: %d\n", gym_server_port);
  Serial.printf("  Device ID: '%s'\n", device_id.c_str());
  Serial.println("========================================");
  Serial.println("Proceeding to WiFi connection...");
}

void saveConfiguration() {
  Serial.println("Saving configuration to preferences...");
  
  // Save WiFi configuration
  preferences.putString("wifi_ssid", wifi_ssid);
  preferences.putString("wifi_password", wifi_password);
  
  // Save server configuration
  preferences.putString("server_ip", gym_server_ip);
  preferences.putInt("server_port", gym_server_port);
  preferences.putString("device_id", device_id);
  
  // Mark as user-configured to allow overriding config.h values
  preferences.putBool("user_configured", true);
  
  Serial.println("Configuration saved successfully!");
  Serial.println("Note: Saved preferences will override config.h values on next restart");
}

void resetConfiguration() {
  Serial.println("Resetting configuration to defaults...");
  
  // Clear all preferences to restore config.h priority
  preferences.clear();
  
  // Reset to default values
  wifi_ssid = DEFAULT_WIFI_SSID;
  wifi_password = DEFAULT_WIFI_PASSWORD;
  gym_server_ip = DEFAULT_GYM_SERVER_IP;
  gym_server_port = String(DEFAULT_GYM_SERVER_PORT).toInt();  // Convert string to int
  device_id = DEFAULT_DEVICE_ID;
  
  #ifdef CONFIG_H
    Serial.println("Configuration reset complete! config.h values will be used on next restart.");
  #else
    Serial.println("Configuration reset complete! Built-in defaults will be used.");
  #endif
}

// ==================== SETUP FUNCTION ====================
void setup() {
  // IMPORTANT: Set your Serial Monitor to 115200 baud rate
  // Garbled characters at startup are ESP32 boot messages (sent at 74880 baud)
  Serial.begin(115200);
  delay(1000);  // Wait for serial monitor to stabilize
  
  // Clear any boot messages and provide clear start indicator
  Serial.println();
  Serial.println("========================================");
  Serial.println("ESP32 Fingerprint Door Lock Starting...");
  Serial.println("Baud Rate: 115200");
  #ifdef CONFIG_H
    Serial.println("config.h: DETECTED and LOADED");
  #else
    Serial.println("config.h: NOT FOUND");
  #endif
  Serial.println("========================================");
  
  // Initialize preferences and load configuration FIRST
  preferences.begin("doorlock", false);
  loadConfiguration();
  
  // Initialize hardware
  initializePins();
  initializeFingerprint();
  
  // Connect to WiFi (now with loaded configuration)
  connectToWiFi();
  
  // Initialize time
  // Configure NTP with local timezone from config.h
  Serial.println("Configuring NTP time synchronization...");
  Serial.printf("Timezone offset: %d seconds (%s)\n", TIMEZONE_OFFSET, 
                TIMEZONE_OFFSET >= 0 ? "UTC+" : "UTC-");
  Serial.printf("DST offset: %d seconds\n", DST_OFFSET);
  
  // Wait for NTP time synchronization
  waitForNTPTime();
  
  // Initialize web server
  initializeWebServer();
  
  // System ready
  systemReady = true;
  setStatusLED("ready");
  playTone(1000, 100);
  
  Serial.println();
  Serial.println("========================================");
  Serial.println("SYSTEM READY - Waiting for fingerprints");
  Serial.printf("Device IP: %s\n", WiFi.localIP().toString().c_str());
  Serial.printf("Web Interface: http://%s\n", WiFi.localIP().toString().c_str());
  Serial.println("========================================");
  Serial.println();
}

// ==================== MAIN LOOP ====================
void loop() {
  // Handle web server requests
  webServer.handleClient();
  
  // Check system status
  if (!systemReady) {
    delay(1000);
    return;
  }
  
  // Check WiFi connection
  if (WiFi.status() != WL_CONNECTED) {
    reconnectWiFi();
  }
  
  // Send heartbeat to server
  if (millis() - lastHeartbeat > HEARTBEAT_INTERVAL) {
    sendHeartbeat();
    lastHeartbeat = millis();
  }
  
  // Periodic NTP resynchronization (every 30 minutes if time is invalid)
  if (millis() - lastNTPResync > 1800000) { // 30 minutes
    if (!getLocalTime(&timeinfo) || timeinfo.tm_year < 120 || timeinfo.tm_year > 138) {
      Serial.println("🔄 Periodic NTP resynchronization triggered due to invalid time");
      resyncNTPTime();
      lastNTPResync = millis();
    } else {
      lastNTPResync = millis(); // Update timestamp even if time is valid
    }
  }
  
  // Check buttons (with debouncing)
  if (millis() - lastButtonCheck > BUTTON_DEBOUNCE) {
    checkButtons();
    lastButtonCheck = millis();
  }
  
  // Main fingerprint checking logic
  if (!enrollmentMode) {
    checkFingerprint();
  } else {
    handleEnrollment();
  }
  
  delay(100);  // Small delay to prevent watchdog issues
}

// ==================== INITIALIZATION FUNCTIONS ====================
void initializePins() {
  // Output pins
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(GREEN_LED_PIN, OUTPUT);
  pinMode(RED_LED_PIN, OUTPUT);
  pinMode(BLUE_LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  
  // Input pins with internal pullup
  pinMode(ENROLL_BUTTON_PIN, INPUT_PULLUP);
  pinMode(OVERRIDE_BUTTON_PIN, INPUT_PULLUP);
  
  // Initialize all outputs to OFF
  digitalWrite(RELAY_PIN, HIGH);  // Start with door locked (relay closed)
  digitalWrite(GREEN_LED_PIN, LOW);
  digitalWrite(RED_LED_PIN, LOW);
  digitalWrite(BLUE_LED_PIN, LOW);
  digitalWrite(BUZZER_PIN, LOW);
  
  Serial.println("GPIO pins initialized");
}

void initializeFingerprint() {
  fingerprintSerial.begin(57600, SERIAL_8N1, FINGERPRINT_RX_PIN, FINGERPRINT_TX_PIN);
  
  finger.begin(57600);
  
  // Test if sensor is responding
  if (finger.verifyPassword()) {
    Serial.println("AS608 Fingerprint sensor connected");
    
    finger.getParameters();
    Serial.printf("Sensor info: Status=0x%X, Capacity=%d, Security=%d\n", 
                  finger.status_reg, finger.capacity, finger.security_level);
    Serial.printf("Enrolled fingerprints: %d\n", finger.templateCount);
  } else {
    Serial.println("AS608 Fingerprint sensor not found");
    setStatusLED("error");
    // Continue anyway - sensor might be connected later
  }
}

void connectToWiFi() {
  Serial.println("========================================");
  Serial.println("WiFi Connection Attempt");
  Serial.println("========================================");
  Serial.printf("SSID: %s\n", wifi_ssid.c_str());
  Serial.printf("Password: %s (length: %d)\n", maskPassword(wifi_password.c_str()).c_str(), wifi_password.length());
  Serial.printf("Timeout: %d seconds\n", WIFI_TIMEOUT / 1000);
  Serial.println("----------------------------------------");
  
  // Disconnect any previous connection
  WiFi.disconnect(true);
  delay(1000);
  
  Serial.printf("Starting connection to: %s", wifi_ssid.c_str());
  WiFi.begin(wifi_ssid.c_str(), wifi_password.c_str());
  
  unsigned long startTime = millis();
  int dotCount = 0;
  
  while (WiFi.status() != WL_CONNECTED && millis() - startTime < WIFI_TIMEOUT) {
    delay(500);
    Serial.print(".");
    dotCount++;
    
    // Show intermediate status every 10 dots (5 seconds)
    if (dotCount % 10 == 0) {
      Serial.printf(" [%s] ", getWiFiStatusText(WiFi.status()).c_str());
    }
  }
  
  Serial.println(); // New line after dots
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("========================================");
    Serial.println("WiFi CONNECTION SUCCESSFUL!");
    Serial.println("========================================");
    Serial.printf("SSID: %s\n", WiFi.SSID().c_str());
    Serial.printf("IP Address: %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("Gateway: %s\n", WiFi.gatewayIP().toString().c_str());
    Serial.printf("DNS: %s\n", WiFi.dnsIP().toString().c_str());
    Serial.printf("Signal Strength: %d dBm (%s)\n", WiFi.RSSI(), getSignalQuality(WiFi.RSSI()).c_str());
    Serial.printf("MAC Address: %s\n", WiFi.macAddress().c_str());
    Serial.printf("Connection Time: %d ms\n", millis() - startTime);
    Serial.println("========================================");
  } else {
    Serial.println("========================================");
    Serial.println("WiFi CONNECTION FAILED!");
    Serial.println("========================================");
    Serial.printf("Final Status: %s\n", getWiFiStatusText(WiFi.status()).c_str());
    Serial.printf("Attempted SSID: %s\n", wifi_ssid.c_str());
    Serial.printf("Time Elapsed: %d ms (timeout: %d ms)\n", millis() - startTime, WIFI_TIMEOUT);
    Serial.println();
    Serial.println("TROUBLESHOOTING TIPS:");
    Serial.println("1. Check SSID spelling and case sensitivity");
    Serial.println("2. Verify password is correct");
    Serial.println("3. Ensure network is 2.4GHz (ESP32 doesn't support 5GHz)");
    Serial.println("4. Check if network has MAC address filtering");
    Serial.println("5. Verify network is not hidden");
    Serial.println("6. Check router logs for connection attempts");
    Serial.println("========================================");
    Serial.println("Continuing in OFFLINE mode...");
  }
}

void reconnectWiFi() {
  Serial.println("========================================");
  Serial.println("WiFi RECONNECTION Attempt");
  Serial.println("========================================");
  Serial.printf("Previous Status: %s\n", getWiFiStatusText(WiFi.status()).c_str());
  Serial.printf("Target SSID: %s\n", wifi_ssid.c_str());
  Serial.println("----------------------------------------");
  
  WiFi.disconnect();
  delay(500);
  WiFi.reconnect();
  
  unsigned long startTime = millis();
  int dotCount = 0;
  
  while (WiFi.status() != WL_CONNECTED && millis() - startTime < 10000) {
    delay(500);
    Serial.print(".");
    dotCount++;
    
    // Show status every 4 dots (2 seconds)
    if (dotCount % 4 == 0) {
      Serial.printf(" [%s] ", getWiFiStatusText(WiFi.status()).c_str());
    }
  }
  
  Serial.println(); // New line after dots
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("WiFi RECONNECTION SUCCESSFUL!");
    Serial.printf("IP: %s | Signal: %d dBm (%s)\n", 
                  WiFi.localIP().toString().c_str(), 
                  WiFi.RSSI(), 
                  getSignalQuality(WiFi.RSSI()).c_str());
    Serial.printf("Reconnection time: %d ms\n", millis() - startTime);
  } else {
    Serial.println("WiFi RECONNECTION FAILED!");
    Serial.printf("Final Status: %s\n", getWiFiStatusText(WiFi.status()).c_str());
    Serial.println("Will retry on next heartbeat cycle...");
  }
  Serial.println("========================================");
}

// ==================== FINGERPRINT FUNCTIONS ====================
void checkFingerprint() {
  fingerprintID = getFingerprintID();
  
  if (fingerprintID > 0) {
    Serial.printf("Fingerprint matched: ID %d\n", fingerprintID);
    
    // Grant access
    unlockDoor();
    
    // Send data to gym management system
    sendBiometricData(fingerprintID, "authorized");
    
    // Wait a moment before checking again
    delay(2000);
  } else if (fingerprintID == -2) {
    // Fingerprint detected but not matched
    Serial.println("Fingerprint not recognized");
    
    accessDenied();
    sendBiometricData(-1, "unauthorized");
    
    delay(1000);
  }
  // fingerprintID == -1 means no finger detected, continue normally
}

int getFingerprintID() {
  uint8_t p = finger.getImage();
  
  if (p == FINGERPRINT_NOFINGER) {
    return -1;  // No finger detected
  }
  
  if (p != FINGERPRINT_OK) {
    return -1;  // Image capture failed
  }
  
  p = finger.image2Tz();
  if (p != FINGERPRINT_OK) {
    return -1;  // Feature extraction failed
  }
  
  p = finger.fingerSearch();
  if (p == FINGERPRINT_OK) {
    return finger.fingerID;  // Match found
  } else {
    return -2;  // Finger detected but no match
  }
}

// ==================== ACCESS CONTROL FUNCTIONS ====================
bool isDoorLocked() {
  // Returns true if door is locked (relay is HIGH/closed)
  return digitalRead(RELAY_PIN) == HIGH;
}

void unlockDoor() {
  Serial.println("Door unlocked!");
  
  // Visual and audio feedback
  setStatusLED("granted");
  playTone(1000, 200);
  delay(100);
  playTone(1200, 200);
  
  // Unlock door - OPEN relay to allow door to unlock
  Serial.println("🔓 Opening relay (door unlocked)");
  digitalWrite(RELAY_PIN, LOW);
  
  // Keep door unlocked for specified time
  Serial.printf("⏱️  Door will remain unlocked for %d seconds\n", DOOR_UNLOCK_TIME / 1000);
  delay(DOOR_UNLOCK_TIME);
  
  // Lock door - CLOSE relay to keep door locked
  Serial.println("🔒 Closing relay (door locked)");
  digitalWrite(RELAY_PIN, HIGH);
  setStatusLED("ready");
  
  Serial.println("Door locked");
}

void accessDenied() {
  Serial.println("Access denied!");
  
  // Visual and audio feedback
  setStatusLED("denied");
  playTone(500, 500);
  delay(100);
  playTone(300, 500);
  
  delay(2000);
  setStatusLED("ready");
}

void emergencyUnlock() {
  Serial.println("Emergency unlock activated!");
  
  unlockDoor();
  sendBiometricData(-999, "emergency_unlock");
}

// ==================== ENROLLMENT FUNCTIONS ====================
void startEnrollmentMode() {
  enrollmentMode = true;
  
  // Only set enrollmentID if it hasn't been set by remote command
  if (enrollmentID == 0) {
    enrollmentID = getNextAvailableID();
  }
  
  Serial.printf("Enrollment mode started for ID: %d\n", enrollmentID);
  Serial.println("Please place finger on sensor...");
  
  setStatusLED("enrollment");
}

void handleEnrollment() {
  int result = enrollFingerprint();
  
  if (result == 1) {
    // Enrollment successful
    Serial.printf("Fingerprint enrolled successfully! ID: %d\n", enrollmentID);
    
    enrollmentMode = false;
    setStatusLED("ready");
    
    // Success feedback
    playTone(1000, 200);
    delay(100);
    playTone(1200, 200);
    delay(100);
    playTone(1400, 200);
    
    // Send enrollment data to server
    sendEnrollmentData(enrollmentID, "enrollment_success");
    
    // Reset enrollmentID for next enrollment
    enrollmentID = 0;
    
  } else if (result == -1) {
    // Enrollment failed
    Serial.println("Fingerprint enrollment failed");
    
    enrollmentMode = false;
    setStatusLED("error");
    
    // Error feedback
    playTone(300, 1000);
    delay(2000);
    setStatusLED("ready");
    
    sendEnrollmentProgress("enrollment_failed");
    
    // Reset enrollmentID for next enrollment
    enrollmentID = 0;
  }
  // result == 0 means still in progress
}

int enrollFingerprint() {
  int p = -1;
  
  Serial.println("Place finger on sensor...");
  unsigned long startTime = millis();
  const unsigned long ENROLLMENT_TIMEOUT = 30000; // 30 seconds timeout
  
  // Send enrollment progress update
  sendEnrollmentProgress("scanning_first_finger");
  
  while (p != FINGERPRINT_OK) {
    // Check for timeout
    if (millis() - startTime > ENROLLMENT_TIMEOUT) {
      Serial.println("Enrollment timeout - no finger detected");
      sendEnrollmentProgress("timeout_first_finger");
      return -1;
    }
    
    p = finger.getImage();
    switch (p) {
      case FINGERPRINT_OK:
        Serial.println("Image taken");
        sendEnrollmentProgress("first_finger_captured");
        break;
      case FINGERPRINT_NOFINGER:
        delay(50); // Small delay to prevent overwhelming the sensor
        continue;
      case FINGERPRINT_PACKETRECIEVEERR:
        Serial.println("Communication error");
        sendEnrollmentProgress("communication_error");
        return -1;
      case FINGERPRINT_IMAGEFAIL:
        Serial.println("Imaging error");
        sendEnrollmentProgress("imaging_error");
        return -1;
      default:
        Serial.println("Unknown error");
        sendEnrollmentProgress("unknown_error");
        return -1;
    }
  }
  
  // Convert image to template
  p = finger.image2Tz(1);
  if (p != FINGERPRINT_OK) {
    Serial.println("Template creation failed");
    sendEnrollmentProgress("template_creation_failed");
    return -1;
  }
  
  Serial.println("Remove finger...");
  sendEnrollmentProgress("remove_finger");
  delay(2000);
  
  p = 0;
  startTime = millis(); // Reset timeout for finger removal
  while (p != FINGERPRINT_NOFINGER) {
    // Check for timeout on finger removal
    if (millis() - startTime > ENROLLMENT_TIMEOUT) {
      Serial.println("Enrollment timeout - finger not removed");
      sendEnrollmentProgress("timeout_finger_removal");
      return -1;
    }
    
    p = finger.getImage();
    delay(50); // Small delay to prevent overwhelming the sensor
  }
  
  Serial.println("Place same finger again...");
  sendEnrollmentProgress("scanning_second_finger");
  startTime = millis(); // Reset timeout for second finger placement
  
  while (p != FINGERPRINT_OK) {
    // Check for timeout on second finger placement
    if (millis() - startTime > ENROLLMENT_TIMEOUT) {
      Serial.println("Enrollment timeout - second finger placement failed");
      sendEnrollmentProgress("timeout_second_finger");
      return -1;
    }
    
    p = finger.getImage();
    switch (p) {
      case FINGERPRINT_OK:
        Serial.println("Image taken");
        sendEnrollmentProgress("second_finger_captured");
        break;
      case FINGERPRINT_NOFINGER:
        delay(50); // Small delay to prevent overwhelming the sensor
        continue;
      case FINGERPRINT_PACKETRECIEVEERR:
        Serial.println("Communication error");
        sendEnrollmentProgress("communication_error");
        return -1;
      case FINGERPRINT_IMAGEFAIL:
        Serial.println("Imaging error");
        sendEnrollmentProgress("imaging_error");
        return -1;
      default:
        Serial.println("Unknown error");
        sendEnrollmentProgress("unknown_error");
        return -1;
    }
  }
  
  // Convert second image
  p = finger.image2Tz(2);
  if (p != FINGERPRINT_OK) {
    Serial.println("Second template creation failed");
    sendEnrollmentProgress("second_template_failed");
    return -1;
  }
  
  // Create model
  sendEnrollmentProgress("creating_model");
  p = finger.createModel();
  if (p == FINGERPRINT_OK) {
    Serial.println("Prints matched!");
    sendEnrollmentProgress("prints_matched");
  } else {
    Serial.println("Prints did not match");
    sendEnrollmentProgress("prints_mismatch");
    return -1;
  }
  
  // Store model
  sendEnrollmentProgress("storing_model");
  p = finger.storeModel(enrollmentID);
  if (p == FINGERPRINT_OK) {
    Serial.println("Stored!");
    sendEnrollmentProgress("model_stored");
    return 1;  // Success
  } else {
    Serial.println("Storage failed");
    sendEnrollmentProgress("storage_failed");
    return -1;
  }
}

int getNextAvailableID() {
  // Find next available fingerprint ID
  for (int i = 1; i < finger.capacity; i++) {
    uint8_t p = finger.loadModel(i);
    if (p == FINGERPRINT_BADLOCATION) {
      return i;  // This slot is empty
    }
  }
  return 1;  // Fallback to ID 1
}

// ==================== COMMUNICATION FUNCTIONS ====================
void sendBiometricData(int memberID, String status) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi not connected - data not sent");
    return;
  }
  
  // Create JSON message compatible with gym management system
  StaticJsonDocument<300> doc;
  doc["userId"] = String(memberID);
  doc["memberId"] = String(memberID);
  doc["timestamp"] = getISO8601Time();
  doc["status"] = status;
  doc["deviceId"] = device_id;
  doc["event"] = "TimeLog";
  doc["verifMode"] = "FP";
  doc["deviceType"] = "esp32_door_lock";
  doc["location"] = "main_entrance";
  
  String jsonString;
  serializeJson(doc, jsonString);
  
  Serial.printf("📤 Sending enrollment data: status=%s, memberId=%d\n", status.c_str(), memberID);
  sendToServer(jsonString);
}

void sendEnrollmentData(int memberID, String status) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi not connected - enrollment data not sent");
    return;
  }
  
  StaticJsonDocument<300> doc;
  doc["userId"] = String(memberID);
  doc["memberId"] = String(memberID);
  doc["timestamp"] = getISO8601Time();
  doc["status"] = status;
  doc["deviceId"] = device_id;
  doc["event"] = "Enroll";
  doc["deviceType"] = "esp32_door_lock";
  doc["enrollmentStep"] = "complete";
  
  String jsonString;
  serializeJson(doc, jsonString);
  
  sendToServer(jsonString);
}

void sendEnrollmentProgress(String progressStep) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi not connected - enrollment progress not sent");
    return;
  }
  
  StaticJsonDocument<300> doc;
  doc["userId"] = String(enrollmentID);
  doc["memberId"] = String(enrollmentID);
  doc["timestamp"] = getISO8601Time();
  doc["status"] = "enrollment_progress";
  doc["deviceId"] = device_id;
  doc["event"] = "Enroll";
  doc["deviceType"] = "esp32_door_lock";
  doc["enrollmentStep"] = progressStep;
  
  String jsonString;
  serializeJson(doc, jsonString);
  
  Serial.printf("📤 Sending enrollment progress: %s\n", progressStep.c_str());
  sendToServer(jsonString);
}

void sendHeartbeat() {
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }
  
  // Get timestamp and validate it
  String timestamp = getISO8601Time();
  
  // Check if timestamp is valid (should not be just millis)
  if (timestamp.length() < 10 || timestamp.indexOf('T') == -1) {
    Serial.println("⚠️ Invalid timestamp for heartbeat, skipping...");
    return;
  }
  
  StaticJsonDocument<250> doc;
  doc["deviceId"] = device_id;
  doc["deviceType"] = "esp32_door_lock";
  doc["status"] = deviceStatus;
  doc["timestamp"] = timestamp;
  doc["event"] = "heartbeat";
  doc["door_locked"] = isDoorLocked();
  doc["relay_state"] = digitalRead(RELAY_PIN);
  doc["wifi_rssi"] = WiFi.RSSI();
  doc["free_heap"] = ESP.getFreeHeap();
  doc["enrolled_prints"] = finger.templateCount;
  doc["ip_address"] = WiFi.localIP().toString();
  
  String jsonString;
  serializeJson(doc, jsonString);
  
  Serial.printf("💓 Sending heartbeat with timestamp: %s\n", timestamp.c_str());
  sendToServer(jsonString);
}

void sendToServer(String jsonData) {
  // Send to the ESP32 webhook endpoint
  String url = String("http://") + gym_server_ip + ":" + gym_server_port + "/api/biometric/esp32-webhook";
  
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("User-Agent", "ESP32-DoorLock/1.0");
  
  // Set timeout to handle slower server responses
  http.setTimeout(HTTP_TIMEOUT);
  
  int httpResponseCode = http.POST(jsonData);
  
  if (httpResponseCode > 0) {
    String response = http.getString();
    Serial.printf("Data sent successfully (HTTP %d) to %s\n", httpResponseCode, url.c_str());
    
    if (httpResponseCode != 200) {
      Serial.printf("Server response: %s\n", response.c_str());
    }
  } else {
    Serial.printf("HTTP POST failed to %s: %s\n", url.c_str(), http.errorToString(httpResponseCode).c_str());
  }
  
  http.end();
}

// ==================== UTILITY FUNCTIONS ====================
void checkButtons() {
  // Check enrollment button
  if (digitalRead(ENROLL_BUTTON_PIN) == LOW) {
    Serial.println("Enrollment button pressed");
    startEnrollmentMode();
    delay(500);  // Prevent multiple triggers
  }
  
  // Check override button
  if (digitalRead(OVERRIDE_BUTTON_PIN) == LOW) {
    Serial.println("Override button pressed");
    emergencyUnlock();
    delay(500);  // Prevent multiple triggers
  }
}

void setStatusLED(String status) {
  // Turn off all LEDs first
  digitalWrite(GREEN_LED_PIN, LOW);
  digitalWrite(RED_LED_PIN, LOW);
  digitalWrite(BLUE_LED_PIN, LOW);
  
  if (status == "ready") {
    digitalWrite(BLUE_LED_PIN, HIGH);
  } else if (status == "granted") {
    digitalWrite(GREEN_LED_PIN, HIGH);
  } else if (status == "denied") {
    digitalWrite(RED_LED_PIN, HIGH);
  } else if (status == "enrollment") {
    // Blink blue for enrollment mode
    for (int i = 0; i < 3; i++) {
      digitalWrite(BLUE_LED_PIN, HIGH);
      delay(100);
      digitalWrite(BLUE_LED_PIN, LOW);
      delay(100);
    }
    digitalWrite(BLUE_LED_PIN, HIGH);
  } else if (status == "error") {
    // Blink red for error
    for (int i = 0; i < 5; i++) {
      digitalWrite(RED_LED_PIN, HIGH);
      delay(100);
      digitalWrite(RED_LED_PIN, LOW);
      delay(100);
    }
  }
}

void playTone(int frequency, int duration) {
  // Simple tone generation using PWM with newer ESP32 Arduino core API
  #if ESP_ARDUINO_VERSION >= ESP_ARDUINO_VERSION_VAL(3, 0, 0)
    // For ESP32 Arduino Core 3.x and newer
    ledcAttach(BUZZER_PIN, frequency, 8);
    ledcWriteTone(BUZZER_PIN, frequency);
    delay(duration);
    ledcWriteTone(BUZZER_PIN, 0);
    ledcDetach(BUZZER_PIN);
  #else
    // For ESP32 Arduino Core 2.x and older
    int channel = 0;
    ledcSetup(channel, frequency, 8);
    ledcAttachPin(BUZZER_PIN, channel);
    ledcWriteTone(channel, frequency);
    delay(duration);
    ledcWriteTone(channel, 0);
  #endif
}

String getISO8601Time() {
  if (!getLocalTime(&timeinfo)) {
    // If NTP time not available, try to get time again with a small delay
    delay(100);
    if (!getLocalTime(&timeinfo)) {
      // Still no NTP time, use a more reasonable fallback
      // Calculate approximate time based on millis() and a base timestamp
      unsigned long currentMillis = millis();
      unsigned long secondsSinceStart = currentMillis / 1000;
      
      // Use a reasonable base timestamp (e.g., device start time)
      // This is better than returning raw millis which creates invalid dates
      time_t baseTime = 1735689600; // 2025-01-01 00:00:00 UTC as fallback
      time_t currentTime = baseTime + secondsSinceStart;
      
      struct tm fallbackTime;
      gmtime_r(&currentTime, &fallbackTime);
      
      char timeString[30];
      strftime(timeString, sizeof(timeString), "%Y-%m-%dT%H:%M:%S", &fallbackTime);
      
      // Log the fallback for debugging
      Serial.printf("⚠️ NTP time not available, using fallback: %s\n", timeString);
      return String(timeString);
    }
  }
  
  // Validate that time is reasonable before using it
  if (timeinfo.tm_year < 120 || timeinfo.tm_year > 138) { // Before 2020 or after 2038
    Serial.printf("⚠️ Invalid year detected: %d, using fallback time\n", timeinfo.tm_year + 1900);
    
    // Use fallback time calculation
    unsigned long currentMillis = millis();
    unsigned long secondsSinceStart = currentMillis / 1000;
    time_t baseTime = 1735689600; // 2025-01-01 00:00:00 UTC as fallback
    time_t currentTime = baseTime + secondsSinceStart;
    
    struct tm fallbackTime;
    gmtime_r(&currentTime, &fallbackTime);
    
    char timeString[30];
    strftime(timeString, sizeof(timeString), "%Y-%m-%dT%H:%M:%S", &fallbackTime);
    return String(timeString);
  }
  
  char timeString[30];
  // Format as local time without 'Z' suffix since we now configure proper timezone
  // The server will handle the timestamp as local time from the ESP32
  strftime(timeString, sizeof(timeString), "%Y-%m-%dT%H:%M:%S", &timeinfo);
  return String(timeString);
}

String maskPassword(const char* password) {
  String masked = "";
  int len = strlen(password);
  
  if (len == 0) {
    return "[EMPTY]";
  } else if (len <= 2) {
    return "**";
  } else if (len <= 4) {
    return String(password[0]) + "**" + String(password[len-1]);
  } else {
    // Show first 2 and last 1 characters, mask the rest
    masked = String(password[0]) + String(password[1]);
    for (int i = 2; i < len - 1; i++) {
      masked += "*";
    }
    masked += String(password[len-1]);
  }
  
  return masked;
}

String getWiFiStatusText(wl_status_t status) {
  switch (status) {
    case WL_IDLE_STATUS:     return "IDLE";
    case WL_NO_SSID_AVAIL:   return "NO_SSID_AVAILABLE";
    case WL_SCAN_COMPLETED:  return "SCAN_COMPLETED";
    case WL_CONNECTED:       return "CONNECTED";
    case WL_CONNECT_FAILED:  return "CONNECT_FAILED";
    case WL_CONNECTION_LOST: return "CONNECTION_LOST";
    case WL_DISCONNECTED:    return "DISCONNECTED";
    default:                 return "UNKNOWN(" + String(status) + ")";
  }
}

String getSignalQuality(int rssi) {
  if (rssi > -30) return "Amazing";
  if (rssi > -50) return "Excellent";
  if (rssi > -60) return "Good";
  if (rssi > -70) return "Fair";
  if (rssi > -80) return "Weak";
  return "Very Weak";
}

// ==================== WEB SERVER FUNCTIONS ====================
void initializeWebServer() {
  // Root page
  webServer.on("/", handleRoot);
  
  // Status API
  webServer.on("/status", handleStatus);
  
  // Control API
  webServer.on("/unlock", HTTP_POST, handleUnlock);
  webServer.on("/lock", HTTP_POST, handleLock);
  webServer.on("/enroll", HTTP_POST, handleWebEnroll);
  webServer.on("/resync-time", HTTP_POST, handleResyncTime);
  
  // Remote command handling from gym management server
  webServer.on("/command", HTTP_POST, handleRemoteCommand);
  
  // Configuration
  webServer.on("/config", HTTP_GET, handleConfig);
  webServer.on("/config", HTTP_POST, handleConfigSave);
  
  // API endpoints for remote configuration
  webServer.on("/api/config", HTTP_GET, handleApiConfig);
  webServer.on("/api/config", HTTP_POST, handleApiConfigSave);
  
  webServer.begin();
  Serial.println("Web server started on port 80");
}

void handleRoot() {
  String html = "<!DOCTYPE html><html><head><title>ESP32 Door Lock</title>";
  html += "<style>body{font-family:Arial;margin:20px;} .status{display:inline-block;padding:5px 10px;border-radius:5px;color:white;} .locked{background-color:#d32f2f;} .unlocked{background-color:#388e3c;} button{padding:10px 15px;margin:5px;border:none;border-radius:5px;cursor:pointer;} .unlock{background-color:#388e3c;color:white;} .lock{background-color:#d32f2f;color:white;} .enroll{background-color:#1976d2;color:white;} .time{background-color:#f57c00;color:white;}</style>";
  html += "</head><body>";
  html += "<h1>ESP32 Door Lock System</h1>";
  html += "<p><strong>Device ID:</strong> " + device_id + "</p>";
  html += "<p><strong>Status:</strong> " + deviceStatus + "</p>";
  String doorStatus = isDoorLocked() ? "locked'>LOCKED" : "unlocked'>UNLOCKED";
  html += "<p><strong>Door State:</strong> <span class='status " + doorStatus + "</span></p>";
  html += "<p><strong>WiFi:</strong> " + wifi_ssid + " (" + String(WiFi.RSSI()) + " dBm)</p>";
  html += "<p><strong>Server:</strong> " + gym_server_ip + ":" + String(gym_server_port) + "</p>";
  html += "<p><strong>Enrolled Fingerprints:</strong> " + String(finger.templateCount) + "</p>";
  html += "<hr>";
  html += "<button class='unlock' onclick=\"fetch('/unlock', {method:'POST'})\">Emergency Unlock</button>";
  html += "<button class='lock' onclick=\"fetch('/lock', {method:'POST'})\">Manual Lock</button><br><br>";
  html += "<button class='enroll' onclick=\"fetch('/enroll', {method:'POST'})\">Start Enrollment</button><br><br>";
  html += "<button class='time' onclick=\"fetch('/resync-time', {method:'POST'})\">Resync Time</button><br><br>";
  html += "<a href='/status'>JSON Status</a> | <a href='/config'>Configuration</a>";
  html += "<script>setInterval(function(){location.reload();},5000);</script>";
  html += "</body></html>";
  
  webServer.send(200, "text/html", html);
}

void handleStatus() {
  StaticJsonDocument<400> doc;
  doc["device_id"] = device_id;
  doc["status"] = deviceStatus;
  doc["door_locked"] = isDoorLocked();
  doc["wifi_connected"] = (WiFi.status() == WL_CONNECTED);
  doc["wifi_ssid"] = wifi_ssid;
  doc["wifi_rssi"] = WiFi.RSSI();
  doc["ip_address"] = WiFi.localIP().toString();
  doc["server_ip"] = gym_server_ip;
  doc["server_port"] = gym_server_port;
  doc["enrolled_prints"] = finger.templateCount;
  doc["free_heap"] = ESP.getFreeHeap();
  doc["uptime"] = millis();
  doc["enrollment_mode"] = enrollmentMode;
  
  String jsonString;
  serializeJson(doc, jsonString);
  
  webServer.send(200, "application/json", jsonString);
}

void handleUnlock() {
  emergencyUnlock();
  webServer.send(200, "text/plain", "Door unlocked");
}

void handleLock() {
  Serial.println("Manual door lock requested via web interface");
  
  // Lock door - CLOSE relay to keep door locked
  digitalWrite(RELAY_PIN, HIGH);
  setStatusLED("ready");
  
  Serial.println("Door manually locked");
  webServer.send(200, "text/plain", "Door locked");
}

void handleWebEnroll() {
  startEnrollmentMode();
  webServer.send(200, "text/plain", "Enrollment mode started");
}

void handleResyncTime() {
  Serial.println("📱 Manual time resync requested via web interface");
  
  // Start resync in background (non-blocking)
  resyncNTPTime();
  
  // Return immediate response
  webServer.send(200, "application/json", "{\"success\":true,\"message\":\"Time resynchronization started\"}");
}

void handleRemoteCommand() {
  if (!webServer.hasArg("plain")) {
    webServer.send(400, "application/json", "{\"error\":\"No JSON body provided\"}");
    return;
  }
  
  String body = webServer.arg("plain");
  StaticJsonDocument<500> doc;
  
  if (deserializeJson(doc, body)) {
    webServer.send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
    return;
  }
  
  // Extract command details
  String command = doc["command"].as<String>();
  String deviceId = doc["deviceId"].as<String>();
  
  // Verify this command is for our device
  if (deviceId != device_id && !deviceId.isEmpty()) {
    webServer.send(400, "application/json", "{\"error\":\"Command not for this device\"}");
    return;
  }
  
  Serial.printf("📱 Received remote command: %s\n", command.c_str());
  
  // Handle different commands
  if (command == "start_enrollment") {
    // Extract member ID if provided
    if (doc["data"]["memberId"]) {
      int memberId = doc["data"]["memberId"].as<int>();
      Serial.printf("🎯 Starting enrollment for member ID: %d\n", memberId);
      // Store member ID for enrollment tracking
      enrollmentID = memberId;
      Serial.printf("📝 Stored enrollmentID: %d\n", enrollmentID);
    } else {
      Serial.println("⚠️ No member ID provided, will use next available ID");
    }
    
    startEnrollmentMode();
    Serial.printf("🚀 Enrollment mode started with ID: %d\n", enrollmentID);
    webServer.send(200, "application/json", "{\"success\":true,\"message\":\"Enrollment mode started\"}");
    
  } else if (command == "unlock_door") {
    emergencyUnlock();
    webServer.send(200, "application/json", "{\"success\":true,\"message\":\"Door unlocked\"}");
    
  } else if (command == "access_granted") {
    // This could be used for additional access logging
    unlockDoor();
    webServer.send(200, "application/json", "{\"success\":true,\"message\":\"Access granted\"}");
    
  } else if (command == "cancel_enrollment") {
    // Cancel ongoing enrollment
    if (enrollmentMode) {
      Serial.println("📛 Enrollment cancelled by remote command");
      enrollmentMode = false;
      setStatusLED("ready");
      
      // Extract member ID if provided for logging
      int memberId = -1;
      if (doc["data"]["memberId"]) {
        memberId = doc["data"]["memberId"].as<int>();
      }
      
      // Send cancellation notification to server
      sendEnrollmentData(memberId, "enrollment_cancelled");
      
      // Reset enrollmentID for next enrollment
      enrollmentID = 0;
      
      webServer.send(200, "application/json", "{\"success\":true,\"message\":\"Enrollment cancelled\"}");
    } else {
      webServer.send(200, "application/json", "{\"success\":true,\"message\":\"No enrollment to cancel\"}");
    }
    
  } else {
    Serial.printf("⚠️  Unknown command: %s\n", command.c_str());
    webServer.send(400, "application/json", "{\"error\":\"Unknown command\"}");
  }
}

void handleConfig() {
  String html = "<!DOCTYPE html><html><head><title>Configuration</title>";
  html += "<style>body{font-family:Arial;margin:20px;}input,select{width:300px;padding:8px;margin:5px 0;}button{padding:10px 20px;margin:10px 5px;}</style>";
  html += "</head><body>";
  html += "<h1>ESP32 Door Lock Configuration</h1>";
  
  html += "<form method='POST' action='/config'>";
  html += "<h3>WiFi Settings</h3>";
  html += "<p>SSID: <br><input type='text' name='wifi_ssid' value='" + wifi_ssid + "' required></p>";
  html += "<p>Password: <br><input type='password' name='wifi_password' value='" + wifi_password + "' required></p>";
  
  html += "<h3>Server Settings</h3>";
  html += "<p>Device ID: <br><input type='text' name='device_id' value='" + device_id + "' required></p>";
  html += "<p>Server IP: <br><input type='text' name='server_ip' value='" + gym_server_ip + "' required></p>";
  html += "<p>Server Port: <br><input type='number' name='server_port' value='" + String(gym_server_port) + "' min='1' max='65535' required></p>";
  
  html += "<p><button type='submit' name='action' value='save'>Save Configuration</button>";
  html += "<button type='submit' name='action' value='reset' onclick='return confirm(\"Reset to defaults?\")'>Reset to Defaults</button></p>";
  html += "</form>";
  
  html += "<hr><h3>Current Status</h3>";
  html += "<p><strong>WiFi Status:</strong> " + getWiFiStatusText(WiFi.status()) + "</p>";
  if (WiFi.status() == WL_CONNECTED) {
    html += "<p><strong>IP Address:</strong> " + WiFi.localIP().toString() + "</p>";
    html += "<p><strong>Signal Strength:</strong> " + String(WiFi.RSSI()) + " dBm</p>";
  }
  
  html += "<p><a href='/'>&lt; Back to Home</a></p>";
  html += "</body></html>";
  
  webServer.send(200, "text/html", html);
}

void handleConfigSave() {
  String action = webServer.arg("action");
  
  if (action == "reset") {
    resetConfiguration();
    webServer.send(200, "text/html", 
      "<html><body><h2>Configuration Reset</h2>"
      "<p>Configuration has been reset to defaults.</p>"
      "<p>Device will restart in 3 seconds...</p>"
      "<script>setTimeout(function(){window.location='/';},3000);</script>"
      "</body></html>");
    delay(3000);
    ESP.restart();
    return;
  }
  
  // Save new configuration
  bool needsRestart = false;
  
  // Check if WiFi settings changed
  String new_wifi_ssid = webServer.arg("wifi_ssid");
  String new_wifi_password = webServer.arg("wifi_password");
  
  if (new_wifi_ssid != wifi_ssid || new_wifi_password != wifi_password) {
    needsRestart = true;
    wifi_ssid = new_wifi_ssid;
    wifi_password = new_wifi_password;
  }
  
  // Update server settings
  String new_device_id = webServer.arg("device_id");
  String new_server_ip = webServer.arg("server_ip");
  int new_server_port = webServer.arg("server_port").toInt();
  
  if (new_server_ip != gym_server_ip || new_server_port != gym_server_port) {
    needsRestart = true;
  }
  
  device_id = new_device_id;
  gym_server_ip = new_server_ip;
  gym_server_port = new_server_port;
  
  // Save to preferences
  saveConfiguration();
  
  String message = "<html><body><h2>Configuration Saved</h2>";
  message += "<p>New configuration has been saved successfully!</p>";
  
  if (needsRestart) {
    message += "<p><strong>WiFi or server settings changed.</strong></p>";
    message += "<p>Device will restart in 5 seconds to apply changes...</p>";
    message += "<script>setTimeout(function(){window.location='/';},5000);</script>";
  } else {
    message += "<p><a href='/'>Return to Home</a></p>";
  }
  
  message += "</body></html>";
  webServer.send(200, "text/html", message);
  
  if (needsRestart) {
    delay(5000);
    ESP.restart();
  }
}

void handleApiConfig() {
  // Return current configuration as JSON
  StaticJsonDocument<500> doc;
  
  doc["wifi_ssid"] = wifi_ssid;
  doc["wifi_password_masked"] = maskPassword(wifi_password.c_str());
  doc["device_id"] = device_id;
  doc["gym_server_ip"] = gym_server_ip;
  doc["gym_server_port"] = gym_server_port;
  doc["wifi_status"] = getWiFiStatusText(WiFi.status());
  
  if (WiFi.status() == WL_CONNECTED) {
    doc["ip_address"] = WiFi.localIP().toString();
    doc["wifi_rssi"] = WiFi.RSSI();
  }
  
  String jsonString;
  serializeJson(doc, jsonString);
  
  webServer.send(200, "application/json", jsonString);
}

void handleApiConfigSave() {
  // Accept JSON configuration
  if (!webServer.hasArg("plain")) {
    webServer.send(400, "application/json", "{\"error\":\"No JSON body provided\"}");
    return;
  }
  
  String body = webServer.arg("plain");
  StaticJsonDocument<500> doc;
  
  if (deserializeJson(doc, body)) {
    webServer.send(400, "application/json", "{\"error\":\"Invalid JSON\"}");
    return;
  }
  
  bool needsRestart = false;
  bool configChanged = false;
  
  // Update WiFi settings if provided
  if (doc.containsKey("wifi_ssid")) {
    String new_ssid = doc["wifi_ssid"].as<String>();
    if (new_ssid != wifi_ssid) {
      wifi_ssid = new_ssid;
      needsRestart = true;
      configChanged = true;
    }
  }
  
  if (doc.containsKey("wifi_password")) {
    String new_password = doc["wifi_password"].as<String>();
    if (new_password != wifi_password) {
      wifi_password = new_password;
      needsRestart = true;
      configChanged = true;
    }
  }
  
  // Update server settings if provided
  if (doc.containsKey("device_id")) {
    device_id = doc["device_id"].as<String>();
    configChanged = true;
  }
  
  if (doc.containsKey("gym_server_ip")) {
    String new_ip = doc["gym_server_ip"].as<String>();
    if (new_ip != gym_server_ip) {
      gym_server_ip = new_ip;
      needsRestart = true;
      configChanged = true;
    }
  }
  
  if (doc.containsKey("gym_server_port")) {
    int new_port = doc["gym_server_port"].as<int>();
    if (new_port != gym_server_port) {
      gym_server_port = new_port;
      needsRestart = true;
      configChanged = true;
    }
  }
  
  if (configChanged) {
    saveConfiguration();
    
    StaticJsonDocument<200> response;
    response["success"] = true;
    response["message"] = "Configuration updated successfully";
    response["restart_required"] = needsRestart;
    
    String responseString;
    serializeJson(response, responseString);
    
    webServer.send(200, "application/json", responseString);
    
    if (needsRestart && doc.containsKey("auto_restart") && doc["auto_restart"].as<bool>()) {
      delay(1000);
      ESP.restart();
    }
  } else {
    webServer.send(200, "application/json", "{\"success\":true,\"message\":\"No changes detected\"}");
  }
}
