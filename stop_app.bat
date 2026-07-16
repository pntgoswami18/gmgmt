@echo off
cd /d "%~dp0"
echo ========================================
echo    GMGMT - Stopping Services
echo ========================================
echo.

echo Stopping GMGMT Node.js/npm processes...
set "LAUNCH_APP_DIR=%~dp0"
REM Scoped to this project's directory in the process command line, so it
REM won't kill unrelated node.exe/npm.exe processes elsewhere on the machine
REM (other projects, IDE tooling, etc). NOTE: matching is by command-line
REM substring only, so it may also close an unrelated process that happens
REM to reference this folder. Acceptable for a single-user dev launcher.
for /f "usebackq tokens=1,2,* delims=|" %%A in (`powershell -NoProfile -Command "$dir = $env:LAUNCH_APP_DIR; Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'node.exe' -or $_.Name -eq 'npm.exe') -and $_.CommandLine -like ('*' + $dir + '*') } | ForEach-Object { '{0}|{1}|{2}' -f $_.ProcessId, $_.Name, $_.CommandLine }"`) do (
    echo Stopping %%B process %%A ^(%%C^)...
    REM /T kills the whole process tree: a matched process (e.g. cross-env's
    REM node.exe, found via its own directory-scoped command line) can itself
    REM spawn the real backend "node src/app.js" as a child whose command line
    REM has no path to match on, so killing without /T would leave it running
    REM and still holding the port.
    taskkill /PID %%A /T /F >nul 2>nul
)

echo.
echo All GMGMT services have been stopped.
echo.
pause
