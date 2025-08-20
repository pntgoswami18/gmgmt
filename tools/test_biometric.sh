#!/bin/bash

# Test script for biometric TCP communication
# This script provides various ways to test your biometric listener

set -e

# Load environment variables from .env file if it exists
if [ -f ".env" ]; then
    echo "Loading environment from .env file..."
    export $(grep -v '^#' .env | xargs)
elif [ -f "src/.env" ]; then
    echo "Loading environment from src/.env file..."
    export $(grep -v '^#' src/.env | xargs)
fi

# Configuration
HOST=${BIOMETRIC_HOST:-"localhost"}
PORT=${BIOMETRIC_PORT:-"8080"}

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔐 Biometric Communication Test Tool${NC}"
echo -e "${BLUE}====================================${NC}"
echo "Target: $HOST:$PORT"
echo ""

# Function to check if port is listening
check_port() {
    echo -e "${YELLOW}📡 Checking if port $PORT is listening...${NC}"
    if command -v nc >/dev/null 2>&1; then
        if nc -z "$HOST" "$PORT" 2>/dev/null; then
            echo -e "${GREEN}✅ Port $PORT is open and listening${NC}"
            return 0
        else
            echo -e "${RED}❌ Port $PORT is not accessible${NC}"
            return 1
        fi
    else
        echo -e "${YELLOW}⚠️  netcat (nc) not available, skipping port check${NC}"
        return 0
    fi
}

# Function to send test message
send_message() {
    local message="$1"
    local description="$2"
    
    echo -e "${YELLOW}📤 Sending: $description${NC}"
    echo -e "${BLUE}Message: $message${NC}"
    
    if command -v nc >/dev/null 2>&1; then
        echo "$message" | nc "$HOST" "$PORT" -w 3
        echo -e "${GREEN}✅ Message sent${NC}"
    else
        echo -e "${RED}❌ netcat (nc) not available${NC}"
    fi
    echo ""
}

# Function to start interactive mode
interactive_mode() {
    echo -e "${YELLOW}🔄 Starting interactive mode...${NC}"
    echo -e "${BLUE}Type messages to send (Ctrl+C to exit):${NC}"
    
    if command -v nc >/dev/null 2>&1; then
        nc "$HOST" "$PORT"
    else
        echo -e "${RED}❌ netcat (nc) not available for interactive mode${NC}"
    fi
}

# Function to monitor port
monitor_port() {
    echo -e "${YELLOW}👀 Monitoring connections to port $PORT...${NC}"
    echo -e "${BLUE}Press Ctrl+C to stop${NC}"
    
    if command -v netstat >/dev/null 2>&1; then
        watch -n 1 "netstat -an | grep :$PORT"
    elif command -v ss >/dev/null 2>&1; then
        watch -n 1 "ss -tlnp | grep :$PORT"
    else
        echo -e "${RED}❌ netstat or ss not available${NC}"
    fi
}

# Function to send various test messages
send_test_messages() {
    echo -e "${YELLOW}🧪 Sending various test message formats...${NC}"
    echo ""
    
    # JSON format
    send_message '{"userId":"12345","status":"authorized","deviceId":"TEST001","timestamp":"2024-01-15T10:30:00Z"}' "JSON Format - Authorized"
    
    # CSV format
    send_message "12345,2024-01-15T10:30:00Z,authorized,TEST001" "CSV Format - Authorized"
    
    # Colon-separated format
    send_message "USER:12345:AUTHORIZED:TEST001" "Colon Format - Authorized"
    
    # Denied access
    send_message "USER:99999:DENIED:TEST001" "Colon Format - Denied"
    
    # JSON denied
    send_message '{"userId":"99999","status":"unauthorized","deviceId":"TEST001"}' "JSON Format - Denied"
    
    # Invalid user
    send_message "USER:INVALID:AUTHORIZED:TEST001" "Invalid User Test"
    
    # Malformed message
    send_message "INVALID_MESSAGE_FORMAT" "Malformed Message Test"
}

# Function to stress test
stress_test() {
    local count=${1:-10}
    echo -e "${YELLOW}💪 Running stress test with $count messages...${NC}"
    
    for i in $(seq 1 "$count"); do
        local user_id=$((12345 + i))
        local status=$( [ $((i % 2)) -eq 0 ] && echo "authorized" || echo "unauthorized" )
        
        send_message "USER:$user_id:$status:TEST001" "Stress Test Message $i/$count"
        sleep 0.1
    done
    
    echo -e "${GREEN}✅ Stress test completed${NC}"
}

# Function to listen on port (simple server)
listen_mode() {
    echo -e "${YELLOW}👂 Starting simple listener on port $PORT...${NC}"
    echo -e "${BLUE}Waiting for connections... (Ctrl+C to stop)${NC}"
    
    if command -v nc >/dev/null 2>&1; then
        nc -l "$PORT"
    else
        echo -e "${RED}❌ netcat (nc) not available for listen mode${NC}"
    fi
}

# Function to show usage
show_usage() {
    echo "Usage: $0 [OPTIONS] [COMMAND]"
    echo ""
    echo "Commands:"
    echo "  check      - Check if biometric port is listening"
    echo "  test       - Send various test messages"
    echo "  stress N   - Send N test messages rapidly"
    echo "  interactive- Start interactive message sending"
    echo "  monitor    - Monitor port connections"
    echo "  listen     - Start simple listener (for testing)"
    echo ""
    echo "Environment Variables:"
    echo "  BIOMETRIC_HOST - Target host (default: localhost)"
    echo "  BIOMETRIC_PORT - Target port (default: 8080)"
    echo ""
    echo "Examples:"
    echo "  $0 check"
    echo "  $0 test"
    echo "  $0 stress 50"
    echo "  BIOMETRIC_PORT=9090 $0 check"
}

# Main script logic
case "${1:-check}" in
    "check")
        check_port
        ;;
    "test")
        if check_port; then
            send_test_messages
        fi
        ;;
    "stress")
        if check_port; then
            stress_test "${2:-10}"
        fi
        ;;
    "interactive")
        interactive_mode
        ;;
    "monitor")
        monitor_port
        ;;
    "listen")
        listen_mode
        ;;
    "help"|"-h"|"--help")
        show_usage
        ;;
    *)
        echo -e "${RED}❌ Unknown command: $1${NC}"
        echo ""
        show_usage
        exit 1
        ;;
esac
