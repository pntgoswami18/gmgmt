@echo off
echo ========================================
echo    GMGMT - Stopping Services
echo ========================================
echo.

echo Stopping Node.js processes...

REM Stop all Node.js processes (more gentle than taskkill)
for /f "tokens=2" %%i in ('tasklist /fi "imagename eq node.exe" /fo csv ^| find /v "Image Name"') do (
    echo Stopping Node.js process %%i
    taskkill /pid %%i /f >nul 2>&1
)

REM Also stop any npm processes
for /f "tokens=2" %%i in ('tasklist /fi "imagename eq npm.exe" /fo csv ^| find /v "Image Name"') do (
    echo Stopping npm process %%i
    taskkill /pid %%i /f >nul 2>&1
)

echo.
echo All GMGMT services have been stopped.
echo.
pause
