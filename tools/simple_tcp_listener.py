#!/usr/bin/env python3
"""
Simple TCP listener for SecureEye biometric devices
Alternative implementation for testing or different deployment scenarios
"""

import socket
import threading
import json
import xml.etree.ElementTree as ET
import os
import tempfile
import platform
from datetime import datetime

class SimpleBiometricListener:
    def __init__(self, host='0.0.0.0', port=5005):
        self.host = host
        self.port = port
        self.socket = None
        self.running = False
        
    def start(self):
        """Start the TCP listener"""
        self.socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        
        try:
            self.socket.bind((self.host, self.port))
            self.socket.listen(5)
            self.running = True
            
            print(f"🔐 Biometric listener started on {self.host}:{self.port}")
            print("📡 Waiting for SecureEye device connections...")
            
            while self.running:
                try:
                    client_socket, address = self.socket.accept()
                    print(f"📱 Device connected from {address}")
                    
                    # Handle client in a separate thread
                    client_thread = threading.Thread(
                        target=self.handle_client,
                        args=(client_socket, address)
                    )
                    client_thread.daemon = True
                    client_thread.start()
                    
                except socket.error as e:
                    if self.running:
                        print(f"❌ Socket error: {e}")
                        
        except Exception as e:
            print(f"❌ Failed to start listener: {e}")
        finally:
            if self.socket:
                self.socket.close()
    
    def handle_client(self, client_socket, address):
        """Handle individual client connections"""
        try:
            while self.running:
                data = client_socket.recv(1024)
                if not data:
                    break
                    
                message = data.decode('utf-8').strip()
                print(f"📨 Received from {address}: {message}")
                
                # Process the biometric data
                self.process_biometric_data(message, client_socket)
                
        except Exception as e:
            print(f"❌ Error handling client {address}: {e}")
        finally:
            client_socket.close()
            print(f"📱 Device {address} disconnected")
    
    def process_biometric_data(self, message, client_socket):
        """Process incoming biometric data"""
        try:
            timestamp = datetime.now().isoformat()
            
            # Parse different message formats
            biometric_data = self.parse_message(message)
            biometric_data['timestamp'] = timestamp
            biometric_data['raw_message'] = message
            
            print(f"🔍 Parsed data: {json.dumps(biometric_data, indent=2)}")
            
            # Determine action based on status and message type
            status = biometric_data.get('status', '').lower()
            message_type = biometric_data.get('messageType', '').lower()
            
            # Handle time logging events (common in biometric systems)
            if message_type in ['timelog', 'time_log', 'attendance']:
                self.handle_time_log(biometric_data)
                self.send_response(client_socket, "ACK:TIMELOG")
            # Handle access control events (authorized status or valid userId with no status)
            elif (status in ['authorized', '1', 'granted', 'allowed', 'access granted'] or 
                  (biometric_data.get('userId') and not status)):
                self.handle_access_granted(biometric_data)
                self.send_response(client_socket, "ACK:GRANTED")
            elif status in ['unauthorized', '0', 'denied', 'rejected', 'access denied']:
                self.handle_access_denied(biometric_data)
                self.send_response(client_socket, "ACK:DENIED")
            # Handle attendance status events (clock in/out, overtime, etc.)
            elif any(keyword in status for keyword in ['overtime', 'clock', 'checkin', 'checkout', 'break', 'lunch']):
                self.handle_attendance_event(biometric_data)
                self.send_response(client_socket, "ACK:ATTENDANCE")
            else:
                self.handle_unknown_message(biometric_data)
                self.send_response(client_socket, "ACK:UNKNOWN")
                
        except Exception as e:
            print(f"❌ Error processing biometric data: {e}")
            self.send_response(client_socket, "ACK:ERROR")
    
    def parse_message(self, message):
        """Parse different message formats"""
        cleaned_message = message.strip().rstrip('\x00').strip()
        
        print(f"🔍 Parsing message (length: {len(message)} -> {len(cleaned_message)} after cleaning)")
        print(f"📄 Message preview: {cleaned_message[:100]}..." if len(cleaned_message) > 100 else f"📄 Full message: {cleaned_message}")
        
        # Try different parsing methods in order
        return (self._try_json_parse(cleaned_message) or
                self._try_xml_parse(cleaned_message) or
                self._try_csv_parse(message) or
                self._try_colon_parse(message) or
                self._default_parse())
    
    def _try_json_parse(self, message):
        """Try to parse as JSON"""
        try:
            return json.loads(message)
        except json.JSONDecodeError:
            return None
    
    def _try_xml_parse(self, message):
        """Try to parse as XML"""
        try:
            root = ET.fromstring(message)
            xml_data = {}
            
            # Parse child elements and attributes
            self._extract_xml_elements(root, xml_data)
            self._extract_xml_attributes(root, xml_data)
            self._extract_nested_xml(root, xml_data)
            
            # Handle simple text content
            if not list(root) and root.text:
                xml_data['messageType'] = root.tag
                xml_data['content'] = root.text
            
            self._debug_xml_results(xml_data)
            return xml_data
            
        except ET.ParseError as e:
            print(f"⚠️  XML parsing failed: {e}")
            return None
    
    def _extract_xml_elements(self, root, xml_data):
        """Extract data from XML child elements"""
        for child in root:
            tag_name = child.tag.lower()
            if tag_name in ['userid', 'user_id', 'user', 'id', 'memberid', 'member_id']:
                xml_data['userId'] = child.text
            elif tag_name in ['status', 'access', 'result', 'auth_status', 'attendstat', 'attend_stat']:
                xml_data['status'] = child.text
            elif tag_name in ['deviceid', 'device_id', 'device', 'terminal', 'reader', 'terminalid', 'terminal_id']:
                xml_data['deviceId'] = child.text
            elif tag_name in ['timestamp', 'time', 'datetime', 'event_time']:
                xml_data['timestamp'] = child.text
            elif tag_name in ['messagetype', 'message_type', 'type', 'event_type', 'event']:
                xml_data['messageType'] = child.text
            else:
                xml_data[tag_name] = child.text
    
    def _extract_xml_attributes(self, root, xml_data):
        """Extract data from XML attributes"""
        for attr_name, attr_value in root.attrib.items():
            attr_name_lower = attr_name.lower()
            if attr_name_lower in ['userid', 'user_id', 'user', 'id']:
                xml_data['userId'] = attr_value
            elif attr_name_lower in ['status', 'access', 'result']:
                xml_data['status'] = attr_value
            elif attr_name_lower in ['deviceid', 'device_id', 'device']:
                xml_data['deviceId'] = attr_value
    
    def _extract_nested_xml(self, root, xml_data):
        """Extract data from nested XML elements"""
        if not xml_data.get('userId'):
            user_elem = root.find('.//user') or root.find('.//User') or root.find('.//USER')
            if user_elem is not None:
                xml_data['userId'] = user_elem.text or user_elem.get('id')
        
        if not xml_data.get('status'):
            status_elem = root.find('.//status') or root.find('.//Status') or root.find('.//access')
            if status_elem is not None:
                xml_data['status'] = status_elem.text
    
    def _debug_xml_results(self, xml_data):
        """Print XML parsing debug information"""
        print(f"🔍 XML parsed successfully. Extracted fields: {list(xml_data.keys())}")
        if xml_data.get('userId'):
            print(f"👤 User ID: {xml_data['userId']}")
        if xml_data.get('status'):
            print(f"📊 Status: {xml_data['status']}")
        if xml_data.get('deviceId'):
            print(f"🖥️  Device ID: {xml_data['deviceId']}")
    
    def _try_csv_parse(self, message):
        """Try to parse as comma-separated values"""
        if ',' not in message:
            return None
        parts = message.split(',')
        return {
            'userId': parts[0] if len(parts) > 0 else None,
            'timestamp': parts[1] if len(parts) > 1 else None,
            'status': parts[2] if len(parts) > 2 else None,
            'deviceId': parts[3] if len(parts) > 3 else None,
        }
    
    def _try_colon_parse(self, message):
        """Try to parse as colon-separated format"""
        if ':' not in message:
            return None
        parts = message.split(':')
        return {
            'messageType': parts[0] if len(parts) > 0 else None,
            'userId': parts[1] if len(parts) > 1 else None,
            'status': parts[2] if len(parts) > 2 else None,
            'deviceId': parts[3] if len(parts) > 3 else None,
        }
    
    def _default_parse(self):
        """Default fallback parsing"""
        return {
            'userId': None,
            'status': 'unknown',
            'deviceId': None,
        }
    
    def handle_access_granted(self, data):
        """Handle authorized access"""
        user_id = data.get('userId', 'Unknown')
        print(f"✅ ACCESS GRANTED for user: {user_id}")
        
        # Here you would:
        # 1. Look up member in database
        # 2. Check active membership
        # 3. Log attendance
        # 4. Trigger door unlock
        # 5. Send welcome message
        
        self.log_event('ACCESS_GRANTED', data)
    
    def handle_access_denied(self, data):
        """Handle unauthorized access"""
        user_id = data.get('userId', 'Unknown')
        print(f"❌ ACCESS DENIED for user: {user_id}")
        
        # Here you would:
        # 1. Log security event
        # 2. Increment failed attempts
        # 3. Take photo if camera available
        # 4. Alert security if needed
        
        self.log_event('ACCESS_DENIED', data)
    
    def handle_time_log(self, data):
        """Handle time logging events"""
        user_id = data.get('userId', 'Unknown')
        status = data.get('status', 'Unknown')
        device_id = data.get('deviceId', 'Unknown')
        
        print(f"⏰ TIME LOG - User: {user_id}, Status: {status}, Device: {device_id}")
        
        # Here you would:
        # 1. Look up member in database
        # 2. Log attendance/time entry
        # 3. Calculate work hours
        # 4. Update attendance records
        # 5. Check for overtime rules
        
        self.log_event('TIME_LOG', data)
    
    def handle_attendance_event(self, data):
        """Handle attendance-related events (clock in/out, breaks, etc.)"""
        user_id = data.get('userId', 'Unknown')
        status = data.get('status', 'Unknown')
        device_id = data.get('deviceId', 'Unknown')
        
        print(f"📋 ATTENDANCE EVENT - User: {user_id}, Status: {status}, Device: {device_id}")
        
        # Here you would:
        # 1. Parse attendance action (clock in, clock out, break start, etc.)
        # 2. Update member's current status
        # 3. Calculate time intervals
        # 4. Apply business rules (break limits, overtime, etc.)
        # 5. Update payroll systems if needed
        
        self.log_event('ATTENDANCE_EVENT', data)
    
    def handle_unknown_message(self, data):
        """Handle unknown message format"""
        print(f"❓ UNKNOWN MESSAGE: {data.get('raw_message', '')}")
        self.log_event('UNKNOWN_MESSAGE', data)
    
    def log_event(self, event_type, data):
        """Log events to file or database"""
        timestamp = datetime.now().isoformat()
        log_entry = {
            'timestamp': timestamp,
            'event_type': event_type,
            'data': data
        }
        
        # Determine log file path - try multiple cross-platform locations
        log_filename = 'biometric_access.log'
        
        # Build platform-specific log paths
        log_paths = []
        
        # 1. System temporary directory (works on all platforms)
        temp_dir = tempfile.gettempdir()
        log_paths.append(os.path.join(temp_dir, log_filename))
        
        # 2. Platform-specific user data directory
        if platform.system() == 'Windows':
            # Windows: Use AppData/Local
            appdata = os.environ.get('LOCALAPPDATA')
            if appdata:
                log_paths.append(os.path.join(appdata, 'BiometricListener', log_filename))
        elif platform.system() == 'Darwin':  # macOS
            # macOS: Use ~/Library/Logs
            log_paths.append(os.path.expanduser('~/Library/Logs/' + log_filename))
        else:  # Linux and other Unix-like systems
            # Linux: Use ~/.local/share or ~/.cache
            log_paths.append(os.path.expanduser('~/.local/share/' + log_filename))
        
        # 3. User home directory (fallback for all platforms)
        log_paths.append(os.path.expanduser('~/' + log_filename))
        
        # 4. Current directory (last resort)
        log_paths.append(os.path.join('.', log_filename))
        
        # Try each log path until one works
        for log_path in log_paths:
            try:
                # Ensure directory exists
                log_dir = os.path.dirname(os.path.abspath(log_path))
                if log_dir and not os.path.exists(log_dir):
                    os.makedirs(log_dir, exist_ok=True)
                
                # Test write access by attempting to create/append to the file
                with open(log_path, 'a', encoding='utf-8') as f:
                    f.write(f"{json.dumps(log_entry, ensure_ascii=False)}\n")
                
                # If successful, log the path being used (only on first successful write)
                if not hasattr(self, '_log_path_announced'):
                    print(f"📁 Logging to: {log_path}")
                    self._log_path_announced = True
                
                # Break out of the loop on success
                break
                
            except (OSError, IOError, UnicodeError) as e:
                # If this is the last path, print the error
                if log_path == log_paths[-1]:
                    print("⚠️  Warning: Could not write to any log file location")
                    print(f"❌ Last error: {e}")
                    print(f"📝 Log entry: {json.dumps(log_entry, ensure_ascii=False)}")
                else:
                    # Try next path silently
                    continue
    
    def send_response(self, client_socket, response):
        """Send response back to device"""
        try:
            client_socket.send(f"{response}\r\n".encode('utf-8'))
        except Exception as e:
            print(f"❌ Error sending response: {e}")
    
    def stop(self):
        """Stop the listener"""
        print("🛑 Stopping biometric listener...")
        self.running = False
        if self.socket:
            self.socket.close()

def main():
    import signal
    import sys
    
    # Configuration
    HOST = '0.0.0.0'  # Listen on all interfaces
    PORT = 5005       # Default port
    
    # Allow command line arguments
    if len(sys.argv) > 1:
        PORT = int(sys.argv[1])
    if len(sys.argv) > 2:
        HOST = sys.argv[2]
    
    listener = SimpleBiometricListener(HOST, PORT)
    
    # Handle Ctrl+C gracefully
    def signal_handler(sig, frame):
        print("\n🛑 Interrupt received, shutting down...")
        listener.stop()
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # Start listening
    try:
        listener.start()
    except KeyboardInterrupt:
        print("\n🛑 Keyboard interrupt received")
    finally:
        listener.stop()

if __name__ == "__main__":
    main()
