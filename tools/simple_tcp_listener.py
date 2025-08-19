#!/usr/bin/env python3
"""
Simple TCP listener for SecureEye biometric devices
Alternative implementation for testing or different deployment scenarios
"""

import socket
import threading
import json
from datetime import datetime

class SimpleBiometricListener:
    def __init__(self, host='0.0.0.0', port=8080):
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
            
            # Determine action based on status
            if biometric_data.get('status') in ['authorized', '1', 'AUTHORIZED']:
                self.handle_access_granted(biometric_data)
                self.send_response(client_socket, "ACK:GRANTED")
            elif biometric_data.get('status') in ['unauthorized', '0', 'DENIED']:
                self.handle_access_denied(biometric_data)
                self.send_response(client_socket, "ACK:DENIED")
            else:
                self.handle_unknown_message(biometric_data)
                self.send_response(client_socket, "ACK:UNKNOWN")
                
        except Exception as e:
            print(f"❌ Error processing biometric data: {e}")
            self.send_response(client_socket, "ACK:ERROR")
    
    def parse_message(self, message):
        """Parse different message formats"""
        # Try JSON first
        try:
            return json.loads(message)
        except json.JSONDecodeError:
            pass
        
        # Try comma-separated values
        if ',' in message:
            parts = message.split(',')
            return {
                'userId': parts[0] if len(parts) > 0 else None,
                'timestamp': parts[1] if len(parts) > 1 else None,
                'status': parts[2] if len(parts) > 2 else None,
                'deviceId': parts[3] if len(parts) > 3 else None,
            }
        
        # Try colon-separated format (USER:12345:AUTHORIZED:DEVICE001)
        if ':' in message:
            parts = message.split(':')
            return {
                'messageType': parts[0] if len(parts) > 0 else None,
                'userId': parts[1] if len(parts) > 1 else None,
                'status': parts[2] if len(parts) > 2 else None,
                'deviceId': parts[3] if len(parts) > 3 else None,
            }
        
        # Default: treat as raw message
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
        
        # Log to file (you could also log to database)
        with open('/tmp/biometric_access.log', 'a') as f:
            f.write(f"{json.dumps(log_entry)}\n")
    
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
    PORT = 8080       # Default port
    
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
