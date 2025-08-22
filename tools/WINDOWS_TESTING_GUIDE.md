# 🪟 Windows-Specific ESP32 Testing Guide

This guide covers Windows-specific testing procedures and troubleshooting for the ESP32 fingerprint door lock system.

## 🔧 Windows Prerequisites

### Required Software
- **Node.js 16+** (Download from nodejs.org)
- **Git for Windows** (includes Git Bash)
- **PowerShell 5.1+** (built into Windows 10/11)
- **SQLite Tools** (optional, auto-downloaded by setup script)
- **Visual Studio Code** (recommended IDE)

### Optional Tools
- **Windows Subsystem for Linux (WSL)** for Unix command compatibility
- **Windows Terminal** for better PowerShell experience
- **Postman** for API testing

## 🚀 Quick Windows Setup

### 1. Environment Setup
```powershell
# Clone the repository
git clone <your-repo-url>
cd gmgmt

# Install dependencies
npm install

# Setup environment file
Copy-Item env.sample .env

# Edit .env file for Windows
Add-Content .env "WIN_DATA_ROOT=C:/ProgramData/gmgmt"
Add-Content .env "ENABLE_BIOMETRIC=true"
Add-Content .env "BIOMETRIC_PORT=8080"
Add-Content .env "BIOMETRIC_HOST=0.0.0.0"

# Create data directory
New-Item -ItemType Directory -Force -Path "C:/ProgramData/gmgmt"
```

### 2. Windows Firewall Configuration
```powershell
# Run PowerShell as Administrator for firewall commands

# Allow Node.js through firewall
New-NetFirewallRule -DisplayName "Node.js App" -Direction Inbound -Program "C:\Program Files\nodejs\node.exe" -Action Allow

# Allow biometric port
New-NetFirewallRule -DisplayName "Gym Management Biometric" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow

# Verify firewall rules
Get-NetFirewallRule -DisplayName "*Gym Management*" | Format-Table
```

### 3. Database Setup
```powershell
# Setup ESP32 database tables (auto-detects Windows)
npm run esp32:setup

# If SQLite is not installed, the script will use better-sqlite3 fallback
# Manual setup if needed:
npm install better-sqlite3
```

## 🧪 Windows Testing Commands

### System Requirements Check
```powershell
# Check system compatibility
npm run esp32:test:system

# Expected output:
# 🖥️  Platform: win32
# 🏗️  Architecture: x64
# 🟢 Node.js version: v18.x.x
# 🪟 Windows detected - using Windows-compatible methods
# ⚡ PowerShell available for advanced testing
```

### Network Connectivity Testing
```powershell
# Test network connectivity with Windows tools
npm run esp32:test:network

# Manual network testing
Test-NetConnection -ComputerName localhost -Port 8080
ping localhost

# Check open ports
netstat -an | findstr 8080
```

### Windows-Specific Diagnostics
```powershell
# Run Windows-specific diagnostic information
npm run esp32:test:windows

# This will show:
# - Network adapter status
# - Firewall rules for port 8080
# - Windows version information
# - Available PowerShell features
```

## 🔍 Windows-Specific Test Scenarios

### 1. PowerShell TCP Testing
```powershell
# Test TCP connection manually
$client = New-Object System.Net.Sockets.TcpClient
try {
    $client.Connect("localhost", 8080)
    if ($client.Connected) {
        Write-Host "✅ TCP connection successful"
        
        # Send test message
        $stream = $client.GetStream()
        $message = '{"deviceId":"TEST_WIN","status":"test","timestamp":"' + (Get-Date -Format "yyyy-MM-ddTHH:mm:ssZ") + '"}'
        $data = [System.Text.Encoding]::UTF8.GetBytes($message + "`r`n")
        $stream.Write($data, 0, $data.Length)
        
        Write-Host "✅ Test message sent"
    }
} catch {
    Write-Host "❌ TCP connection failed: $($_.Exception.Message)"
} finally {
    $client.Close()
}
```

### 2. Windows Service Testing
```powershell
# Install and test as Windows service
npm install -g pm2
npm install -g pm2-windows-service

# Install service
pm2-service-install -n "GymManagement"

# Start application
pm2 start src/app.js --name "gym-management" --env production
pm2 start src/startBiometricListener.js --name "biometric-listener"

# Check service status
pm2 status
pm2 logs gym-management --lines 50
```

### 3. Windows Defender Testing
```powershell
# Check if Windows Defender is blocking the application
Get-MpThreat | Where-Object {$_.ProcessName -like "*node*"}

# Add exclusions if needed (run as Administrator)
Add-MpPreference -ExclusionProcess "node.exe"
Add-MpPreference -ExclusionPath (Get-Location).Path

# Verify exclusions
Get-MpPreference | Select-Object -ExpandProperty ExclusionProcess
Get-MpPreference | Select-Object -ExpandProperty ExclusionPath
```

## 🐛 Windows-Specific Troubleshooting

### Common Windows Issues

#### Issue 1: PowerShell Execution Policy
```powershell
# Symptom: Scripts cannot be executed
Get-ExecutionPolicy

# Solution: Set execution policy
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Verify
Get-ExecutionPolicy -List
```

#### Issue 2: Windows Firewall Blocking
```powershell
# Symptom: ESP32 cannot connect, connection timeouts
# Check Windows Firewall logs
Get-WinEvent -LogName "Microsoft-Windows-Windows Firewall With Advanced Security/Firewall" -MaxEvents 10

# Solution: Add firewall rules
New-NetFirewallRule -DisplayName "ESP32 Port" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow

# Test firewall rule
Test-NetConnection -ComputerName localhost -Port 8080
```

#### Issue 3: SQLite Installation Issues
```powershell
# Symptom: Database setup fails, SQLite not found
# Download and install SQLite tools
Invoke-WebRequest -Uri "https://sqlite.org/2023/sqlite-tools-win32-x86-3420000.zip" -OutFile "sqlite-tools.zip"
Expand-Archive -Path "sqlite-tools.zip" -DestinationPath "C:\sqlite"

# Add to PATH (run as Administrator)
$env:PATH += ";C:\sqlite"
[Environment]::SetEnvironmentVariable("PATH", $env:PATH, [EnvironmentVariableTarget]::Machine)

# Alternative: Use WSL
wsl --install Ubuntu
wsl sqlite3 --version
```

#### Issue 4: Port Already in Use
```powershell
# Symptom: EADDRINUSE error
# Find process using port 8080
netstat -ano | findstr 8080

# Kill process by PID (replace XXXX with actual PID)
taskkill /PID XXXX /F

# Or use PowerShell
Get-Process -Id XXXX | Stop-Process -Force
```

#### Issue 5: Network Adapter Issues
```powershell
# Check network adapters
Get-NetAdapter | Where-Object {$_.Status -eq "Up"}

# Reset network configuration
netsh winsock reset
netsh int ip reset
# Restart required

# Flush DNS
ipconfig /flushdns
```

## 📊 Windows Performance Testing

### Resource Monitoring
```powershell
# Monitor Node.js processes
Get-Process | Where-Object {$_.ProcessName -eq "node"} | Format-Table ProcessName, Id, CPU, WorkingSet

# Monitor network connections
Get-NetTCPConnection -LocalPort 8080

# Monitor file handles
Get-Process -Name "node" | Select-Object -ExpandProperty Handles
```

### Memory Usage
```powershell
# Check system memory
Get-WmiObject -Class Win32_OperatingSystem | Select-Object TotalVisibleMemorySize, FreePhysicalMemory

# Monitor application memory
Get-Counter "\Process(node)\Working Set"
```

## 🔐 Windows Security Testing

### User Account Control (UAC)
```powershell
# Check UAC status
Get-ItemProperty HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System -Name EnableLUA

# Test running without admin privileges
# The application should work without administrator rights
```

### Windows Defender SmartScreen
```powershell
# Check SmartScreen status
Get-MpComputerStatus | Select-Object SmartScreenEnabled

# If needed, add application to trusted list
```

## 📋 Windows Test Checklist

### Pre-deployment Testing
- [ ] Node.js and npm installed correctly
- [ ] PowerShell execution policy allows scripts
- [ ] Windows Firewall configured properly
- [ ] SQLite tools installed or better-sqlite3 working
- [ ] All npm scripts execute without errors
- [ ] TCP connections work from PowerShell
- [ ] Windows service installation successful
- [ ] Application starts without administrator privileges

### Network Testing
- [ ] ESP32 can connect from Windows network
- [ ] Port 8080 accessible from LAN
- [ ] Firewall rules working correctly
- [ ] Multiple devices can connect simultaneously
- [ ] Connection survives network adapter changes

### Security Testing
- [ ] Windows Defender doesn't block application
- [ ] UAC doesn't interfere with normal operation
- [ ] Application works in restricted user environment
- [ ] Network isolation works properly
- [ ] Logging captures security events

### Performance Testing
- [ ] Memory usage stable under load
- [ ] CPU usage reasonable during operation
- [ ] Network latency acceptable
- [ ] Database operations perform well
- [ ] No memory leaks during extended operation

## 📞 Windows Support Resources

### Microsoft Documentation
- [PowerShell Documentation](https://docs.microsoft.com/en-us/powershell/)
- [Windows Firewall](https://docs.microsoft.com/en-us/windows/security/threat-protection/windows-firewall/)
- [Windows Service Management](https://docs.microsoft.com/en-us/windows/win32/services/services)

### Useful Windows Commands
```powershell
# System information
systeminfo

# Network configuration
ipconfig /all

# Windows version
Get-ComputerInfo | Select-Object WindowsProductName, WindowsVersion

# Installed software
Get-WmiObject -Class Win32_Product | Where-Object {$_.Name -like "*Node*"}

# Event logs
Get-EventLog -LogName Application -Source "Node.js" -Newest 10
```

### Common PowerShell Aliases
```powershell
# Useful aliases for testing
Set-Alias -Name grep -Value Select-String
Set-Alias -Name curl -Value Invoke-WebRequest
Set-Alias -Name wget -Value Invoke-WebRequest
```

---

## 🎉 Windows Setup Complete!

Once all tests pass on Windows, your ESP32 fingerprint door lock system is ready for production deployment on Windows servers.

**Next Steps:**
1. Deploy to production Windows server
2. Configure Windows Task Scheduler or service for auto-start
3. Set up Windows Event Log monitoring
4. Configure automated backups
5. Implement Windows-specific monitoring and alerting
