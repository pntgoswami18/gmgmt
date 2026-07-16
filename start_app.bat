@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
echo ========================================
echo    GMGMT - Gym Management System
echo ========================================
echo.
echo Starting backend server with biometric integration...
echo Starting React client...
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

REM Check if npm is installed
npm --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: npm is not installed or not in PATH
    pause
    exit /b 1
)

echo Checking for a previous running instance...
set "LAUNCH_APP_DIR=%~dp0"
REM NOTE: matches by command-line substring only, so it may also close an
REM unrelated git.exe/node.exe that happens to reference this folder (e.g.
REM an IDE's background tooling). Acceptable for a single-user dev launcher.
for /f "usebackq tokens=1,2,* delims=|" %%A in (`powershell -NoProfile -Command "$dir = $env:LAUNCH_APP_DIR; Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'git.exe' -or $_.Name -eq 'node.exe') -and $_.CommandLine -like ('*' + $dir + '*') } | ForEach-Object { '{0}|{1}|{2}' -f $_.ProcessId, $_.Name, $_.CommandLine }"`) do (
    echo Closing leftover process %%A ^(%%B: %%C^) from a previous run...
    REM /T kills the whole process tree: a matched process (e.g. cross-env's
    REM node.exe, found via its own directory-scoped command line) can itself
    REM spawn the real backend "node src/app.js" as a child whose command line
    REM has no path to match on, so killing without /T would leave it running
    REM and still holding the port.
    taskkill /PID %%A /T /F >nul 2>nul
)

echo.
echo Checking for updates...
where git >nul 2>nul
if %errorlevel% neq 0 (
    echo WARNING: git is not installed or not in PATH - skipping update check
) else (
    git fetch
    if !errorlevel! neq 0 (
        echo WARNING: git fetch failed - continuing with current version
    ) else (
        git pull --ff-only
        if !errorlevel! neq 0 (
            echo WARNING: git pull failed or had conflicts - continuing with current version
        )
    )
)

REM Check if .env file exists, if not copy from sample
if not exist ".env" (
    if exist "env.sample" (
        echo Copying env.sample to .env...
        copy "env.sample" ".env" >nul
        echo .env file created from env.sample
    ) else (
        echo WARNING: No .env file found and no env.sample to copy from
    )
)

REM Install dependencies if node_modules doesn't exist
if not exist "node_modules" (
    echo Installing backend dependencies...
    npm install
    if !errorlevel! neq 0 (
        echo ERROR: Failed to install backend dependencies
        pause
        exit /b 1
    )
)

if not exist "client\node_modules" (
    echo Installing client dependencies...
    cd client
    npm install
    if !errorlevel! neq 0 (
        echo ERROR: Failed to install client dependencies
        pause
        exit /b 1
    )
    cd ..
)

echo.
echo ========================================
echo Starting services...
echo ========================================
echo.
echo Backend will run on: http://localhost:3001
echo Client will run on: http://localhost:3000
echo.
echo Press Ctrl+C in this window to stop both services
echo.

REM Start backend with biometric integration in a new window
start "GMGMT Backend" cmd /k "npm run start:with-biometric"

REM Wait a moment for backend to start
timeout /t 3 /nobreak >nul

REM Start client in a new window
start "GMGMT Client" cmd /k "cd client && npm start"

echo.
echo ========================================
echo Services started successfully!
echo ========================================
echo.
echo Backend: http://localhost:3001 (with biometric integration)
echo Client: http://localhost:3000
echo.
echo Both services are running in separate windows.
echo Close those windows to stop the services.
echo.
echo Press any key to exit this launcher...
pause >nul
