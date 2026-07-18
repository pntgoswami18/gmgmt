@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"
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

REM Check if npm is installed
REM `call` matters here: npm.cmd is itself a batch script, and invoking one
REM batch file from another without `call` transfers control into it and
REM never returns - the parent script (this one) would silently stop dead
REM the moment npm.cmd exits, with no error, no matter what comes after.
call npm --version >nul 2>&1
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
    )
)

REM Install dependencies if needed
if not exist "node_modules" (
    echo Installing backend dependencies...
    call npm install
    if !errorlevel! neq 0 (
        echo ERROR: Failed to install backend dependencies
        pause
        exit /b 1
    )
)

if not exist "client\node_modules" (
    echo Installing client dependencies...
    cd client
    call npm install
    if !errorlevel! neq 0 (
        echo ERROR: Failed to install client dependencies
        pause
        exit /b 1
    )
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
REM (errorlevel isn't checked here: `start /b` returns immediately with its
REM own success code, not the launched process's, so it can't detect a
REM backend crash. Watch the console output above for backend errors.)
start /b npm run start:with-biometric

REM Wait for backend to start. `timeout` needs a real console input handle and
REM errors out immediately when one isn't available (e.g. run over SSH); ping
REM as a sleep has no such dependency and works the same everywhere.
ping -n 6 127.0.0.1 >nul

REM Start client (this will block until stopped)
cd client
call npm start
if %errorlevel% neq 0 (
    echo ERROR: Client exited with an error
    cd ..
    pause
    exit /b 1
)
cd ..
