@echo off
echo ========================================
echo    GMGMT - Gym Management System
echo ========================================
echo.
echo Starting backend and client in single window...
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

REM Check if .env file exists, if not copy from sample
if not exist ".env" (
    if exist "env.sample" (
        echo Copying env.sample to .env...
        copy "env.sample" ".env" >nul
    )
)

REM Install dependencies if needed
if not exist "node_modules" (
    echo Installing backend dependencies...
    npm install
)

if not exist "client\node_modules" (
    echo Installing client dependencies...
    cd client
    npm install
    cd ..
)

echo.
echo Starting backend with biometric integration...
echo Backend: http://localhost:3001
echo Client: http://localhost:3000
echo.
echo Press Ctrl+C to stop both services
echo.

REM Start backend in background
start /b npm run start:with-biometric

REM Wait for backend to start
timeout /t 5 /nobreak >nul

REM Start client (this will block until stopped)
cd client
npm start
