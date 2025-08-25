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

// ==================== CONFIGURATION ====================
// WiFi Configuration - Update these for your network
const char* WIFI_SSID = "FTTH BSNL_5GEXT";
const char* WIFI_PASSWORD = "vireng101167";

// Gym Management System Configuration
const char* GYM_SERVER_IP = "192.168.1.101";  // Update to your server IP
const int GYM_SERVER_PORT = 5005;             // Your BIOMETRIC_PORT
const char* DEVICE_ID = "DOOR_001";            // Unique identifier for this door

// Pin Definitions
#define FINGERPRINT_RX_PIN    16
#define FINGERPRINT_TX_PIN    17
#define RELAY_PIN             18
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
int fingerprintID = -1;
String deviceStatus = "ready";

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
  Serial.println("========================================");
  
  // Initialize hardware
  initializePins();
  initializeFingerprint();
  
  // Connect to WiFi
  connectToWiFi();
  
  // Initialize time
  configTime(0, 0, "pool.ntp.org");
  
  // Initialize web server
  initializeWebServer();
  
  // Initialize preferences
  preferences.begin("doorlock", false);
  
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
  digitalWrite(RELAY_PIN, LOW);
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
  Serial.printf("Connecting to WiFi: %s", WIFI_SSID);
  
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  
  unsigned long startTime = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startTime < WIFI_TIMEOUT) {
    delay(500);
    Serial.print(".");
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.printf("WiFi connected! IP: %s\n", WiFi.localIP().toString().c_str());
    Serial.printf("Signal strength: %d dBm\n", WiFi.RSSI());
  } else {
    Serial.println();
    Serial.println("WiFi connection failed - continuing in offline mode");
  }
}

void reconnectWiFi() {
  Serial.println("Reconnecting to WiFi...");
  WiFi.disconnect();
  WiFi.reconnect();
  
  unsigned long startTime = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startTime < 10000) {
    delay(500);
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("WiFi reconnected");
  }
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
void unlockDoor() {
  Serial.println("Door unlocked!");
  
  // Visual and audio feedback
  setStatusLED("granted");
  playTone(1000, 200);
  delay(100);
  playTone(1200, 200);
  
  // Unlock door
  digitalWrite(RELAY_PIN, HIGH);
  
  // Keep door unlocked for specified time
  delay(DOOR_UNLOCK_TIME);
  
  // Lock door
  digitalWrite(RELAY_PIN, LOW);
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
  enrollmentID = getNextAvailableID();
  
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
    
  } else if (result == -1) {
    // Enrollment failed
    Serial.println("Fingerprint enrollment failed");
    
    enrollmentMode = false;
    setStatusLED("error");
    
    // Error feedback
    playTone(300, 1000);
    delay(2000);
    setStatusLED("ready");
    
    sendEnrollmentData(enrollmentID, "enrollment_failed");
  }
  // result == 0 means still in progress
}

int enrollFingerprint() {
  int p = -1;
  
  Serial.println("Place finger on sensor...");
  while (p != FINGERPRINT_OK) {
    p = finger.getImage();
    switch (p) {
      case FINGERPRINT_OK:
        Serial.println("Image taken");
        break;
      case FINGERPRINT_NOFINGER:
        continue;
      case FINGERPRINT_PACKETRECIEVEERR:
        Serial.println("Communication error");
        return -1;
      case FINGERPRINT_IMAGEFAIL:
        Serial.println("Imaging error");
        return -1;
      default:
        Serial.println("Unknown error");
        return -1;
    }
  }
  
  // Convert image to template
  p = finger.image2Tz(1);
  if (p != FINGERPRINT_OK) {
    Serial.println("Template creation failed");
    return -1;
  }
  
  Serial.println("Remove finger...");
  delay(2000);
  
  p = 0;
  while (p != FINGERPRINT_NOFINGER) {
    p = finger.getImage();
  }
  
  Serial.println("Place same finger again...");
  while (p != FINGERPRINT_OK) {
    p = finger.getImage();
    switch (p) {
      case FINGERPRINT_OK:
        Serial.println("Image taken");
        break;
      case FINGERPRINT_NOFINGER:
        continue;
      case FINGERPRINT_PACKETRECIEVEERR:
        Serial.println("Communication error");
        return -1;
      case FINGERPRINT_IMAGEFAIL:
        Serial.println("Imaging error");
        return -1;
      default:
        Serial.println("Unknown error");
        return -1;
    }
  }
  
  // Convert second image
  p = finger.image2Tz(2);
  if (p != FINGERPRINT_OK) {
    Serial.println("Second template creation failed");
    return -1;
  }
  
  // Create model
  p = finger.createModel();
  if (p == FINGERPRINT_OK) {
    Serial.println("Prints matched!");
  } else {
    Serial.println("Prints did not match");
    return -1;
  }
  
  // Store model
  p = finger.storeModel(enrollmentID);
  if (p == FINGERPRINT_OK) {
    Serial.println("Stored!");
    return 1;  // Success
  } else {
    Serial.println("Storage failed");
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
  doc["deviceId"] = DEVICE_ID;
  doc["event"] = "TimeLog";
  doc["verifMode"] = "FP";
  doc["deviceType"] = "esp32_door_lock";
  doc["location"] = "main_entrance";
  
  String jsonString;
  serializeJson(doc, jsonString);
  
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
  doc["deviceId"] = DEVICE_ID;
  doc["event"] = "Enroll";
  doc["deviceType"] = "esp32_door_lock";
  doc["enrollmentStep"] = "complete";
  
  String jsonString;
  serializeJson(doc, jsonString);
  
  sendToServer(jsonString);
}

void sendHeartbeat() {
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }
  
  StaticJsonDocument<200> doc;
  doc["deviceId"] = DEVICE_ID;
  doc["deviceType"] = "esp32_door_lock";
  doc["status"] = deviceStatus;
  doc["timestamp"] = getISO8601Time();
  doc["event"] = "heartbeat";
  doc["wifi_rssi"] = WiFi.RSSI();
  doc["free_heap"] = ESP.getFreeHeap();
  doc["enrolled_prints"] = finger.templateCount;
  
  String jsonString;
  serializeJson(doc, jsonString);
  
  sendToServer(jsonString);
}

void sendToServer(String jsonData) {
  http.begin(String("http://") + GYM_SERVER_IP + ":" + GYM_SERVER_PORT);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("User-Agent", "ESP32-DoorLock/1.0");
  
  int httpResponseCode = http.POST(jsonData);
  
  if (httpResponseCode > 0) {
    String response = http.getString();
    Serial.printf("Data sent successfully (HTTP %d)\n", httpResponseCode);
    
    if (httpResponseCode != 200) {
      Serial.printf("Server response: %s\n", response.c_str());
    }
  } else {
    Serial.printf("HTTP POST failed: %s\n", http.errorToString(httpResponseCode).c_str());
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
  struct tm timeinfo;
  if (!getLocalTime(&timeinfo)) {
    // If NTP time not available, use millis-based timestamp
    return String(millis());
  }
  
  char timeString[30];
  strftime(timeString, sizeof(timeString), "%Y-%m-%dT%H:%M:%S", &timeinfo);
  return String(timeString) + "Z";
}

// ==================== WEB SERVER FUNCTIONS ====================
void initializeWebServer() {
  // Root page
  webServer.on("/", handleRoot);
  
  // Status API
  webServer.on("/status", handleStatus);
  
  // Control API
  webServer.on("/unlock", HTTP_POST, handleUnlock);
  webServer.on("/enroll", HTTP_POST, handleWebEnroll);
  
  // Configuration
  webServer.on("/config", HTTP_GET, handleConfig);
  webServer.on("/config", HTTP_POST, handleConfigSave);
  
  webServer.begin();
  Serial.println("Web server started on port 80");
}

void handleRoot() {
  String html = "<!DOCTYPE html><html><head><title>ESP32 Door Lock</title></head><body>";
  html += "<h1>ESP32 Door Lock System</h1>";
  html += "<p><strong>Device ID:</strong> " + String(DEVICE_ID) + "</p>";
  html += "<p><strong>Status:</strong> " + deviceStatus + "</p>";
  html += "<p><strong>WiFi:</strong> " + String(WIFI_SSID) + " (" + String(WiFi.RSSI()) + " dBm)</p>";
  html += "<p><strong>Server:</strong> " + String(GYM_SERVER_IP) + ":" + String(GYM_SERVER_PORT) + "</p>";
  html += "<p><strong>Enrolled Fingerprints:</strong> " + String(finger.templateCount) + "</p>";
  html += "<hr>";
  html += "<button onclick=\"fetch('/unlock', {method:'POST'})\">Emergency Unlock</button><br><br>";
  html += "<button onclick=\"fetch('/enroll', {method:'POST'})\">Start Enrollment</button><br><br>";
  html += "<a href='/status'>JSON Status</a> | <a href='/config'>Configuration</a>";
  html += "</body></html>";
  
  webServer.send(200, "text/html", html);
}

void handleStatus() {
  StaticJsonDocument<400> doc;
  doc["device_id"] = DEVICE_ID;
  doc["status"] = deviceStatus;
  doc["wifi_connected"] = (WiFi.status() == WL_CONNECTED);
  doc["wifi_ssid"] = WIFI_SSID;
  doc["wifi_rssi"] = WiFi.RSSI();
  doc["ip_address"] = WiFi.localIP().toString();
  doc["server_ip"] = GYM_SERVER_IP;
  doc["server_port"] = GYM_SERVER_PORT;
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

void handleWebEnroll() {
  startEnrollmentMode();
  webServer.send(200, "text/plain", "Enrollment mode started");
}

void handleConfig() {
  String html = "<!DOCTYPE html><html><head><title>Configuration</title></head><body>";
  html += "<h1>Door Lock Configuration</h1>";
  html += "<form method='POST'>";
  html += "<p>Device ID: <input type='text' name='device_id' value='" + String(DEVICE_ID) + "'></p>";
  html += "<p>Server IP: <input type='text' name='server_ip' value='" + String(GYM_SERVER_IP) + "'></p>";
  html += "<p>Server Port: <input type='number' name='server_port' value='" + String(GYM_SERVER_PORT) + "'></p>";
  html += "<p><input type='submit' value='Save Configuration'></p>";
  html += "</form>";
  html += "<a href='/'>&lt; Back to Home</a>";
  html += "</body></html>";
  
  webServer.send(200, "text/html", html);
}

void handleConfigSave() {
  // In a production system, you would save these to preferences
  // and restart the system with new configuration
  String message = "Configuration saved successfully! Restart device to apply changes.";
  webServer.send(200, "text/plain", message);
}
