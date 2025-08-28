@echo off
setlocal enabledelayedexpansion

REM Test script for biometric TCP communication (Windows version)
REM This script provides various ways to test your biometric listener

REM Load environment variables from .env file if it exists
if exist ".env" (
    echo Loading environment from .env file...
    for /f "usebackq tokens=1,2 delims==" %%a in (".env") do (
        if not "%%a"=="" if not "%%a:~0,1%"=="#" (
            set "%%a=%%b"
        )
    )
) else if exist "src\.env" (
    echo Loading environment from src\.env file...
    for /f "usebackq tokens=1,2 delims==" %%a in ("src\.env") do (
        if not "%%a"=="" if not "%%a:~0,1%"=="#" (
            set "%%a=%%b"
        )
    )
)

REM Configuration
if not defined BIOMETRIC_HOST set BIOMETRIC_HOST=localhost
if not defined BIOMETRIC_PORT set BIOMETRIC_PORT=5005

echo.
echo 🔐 Biometric Communication Test Tool
echo ====================================
echo Target: %BIOMETRIC_HOST%:%BIOMETRIC_PORT%
echo.

REM Function to check if port is listening using PowerShell
:check_port
echo 📡 Checking if port %BIOMETRIC_PORT% is listening...
powershell -Command "try { $client = New-Object System.Net.Sockets.TcpClient; $client.Connect('%BIOMETRIC_HOST%', %BIOMETRIC_PORT%); $client.Close(); Write-Host '✅ Port %BIOMETRIC_PORT% is open and listening' -ForegroundColor Green; exit 0 } catch { Write-Host '❌ Port %BIOMETRIC_PORT% is not accessible' -ForegroundColor Red; exit 1 }"
if %errorlevel% neq 0 goto :eof
goto :send_test_messages

REM Function to send test message using PowerShell
:send_message
set "message=%~1"
set "description=%~2"

echo 📤 Sending: %description%
echo Message: %message%

powershell -Command "try { $client = New-Object System.Net.Sockets.TcpClient; $client.Connect('%BIOMETRIC_HOST%', %BIOMETRIC_PORT%); $stream = $client.GetStream(); $data = [System.Text.Encoding]::ASCII.GetBytes('%message%' + \"`r`n\"); $stream.Write($data, 0, $data.Length); Start-Sleep -Milliseconds 100; $buffer = New-Object byte[] 1024; $bytes = $stream.Read($buffer, 0, 1024); if ($bytes -gt 0) { $response = [System.Text.Encoding]::ASCII.GetString($buffer, 0, $bytes); Write-Host $response -NoNewline }; $client.Close(); Write-Host '✅ Message sent' -ForegroundColor Green } catch { Write-Host '❌ Failed to send message: $_' -ForegroundColor Red }"
echo.
goto :eof

REM Function to send various test messages
:send_test_messages
echo 🧪 Sending various test message formats...
echo.

call :send_message "{\"userId\":\"12345\",\"status\":\"authorized\",\"deviceId\":\"TEST001\",\"timestamp\":\"2024-01-15T10:30:00Z\"}" "JSON Format - Authorized"

call :send_message "12345,2024-01-15T10:30:00Z,authorized,TEST001" "CSV Format - Authorized"

call :send_message "USER:12345:AUTHORIZED:TEST001" "Colon Format - Authorized"

call :send_message "USER:99999:DENIED:TEST001" "Colon Format - Denied"

call :send_message "{\"userId\":\"99999\",\"status\":\"unauthorized\",\"deviceId\":\"TEST001\"}" "JSON Format - Denied"

call :send_message "USER:INVALID:AUTHORIZED:TEST001" "Invalid User Test"

call :send_message "INVALID_MESSAGE_FORMAT" "Malformed Message Test"

goto :eof

REM Show usage
:show_usage
echo Usage: %0 [COMMAND]
echo.
echo Commands:
echo   check      - Check if biometric port is listening
echo   test       - Send various test messages
echo   help       - Show this help message
echo.
echo Environment Variables:
echo   BIOMETRIC_HOST - Target host (default: localhost)
echo   BIOMETRIC_PORT - Target port (default: 8080)
echo.
echo Examples:
echo   %0 check
echo   %0 test
echo   set BIOMETRIC_PORT=5005 && %0 check
goto :eof

REM Main script logic
set "command=%~1"
if "%command%"=="" set "command=check"

if "%command%"=="check" (
    call :check_port
) else if "%command%"=="test" (
    call :check_port
    if %errorlevel% equ 0 call :send_test_messages
) else if "%command%"=="help" (
    call :show_usage
) else (
    echo ❌ Unknown command: %command%
    echo.
    call :show_usage
    exit /b 1
)
