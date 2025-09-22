@echo off
echo Downloading Node.js 18.19.0 runtimes for Windows standalone build...

REM Create vendor directories
if not exist "vendor\node-win-x64" mkdir "vendor\node-win-x64"
if not exist "vendor\node-win-ia32" mkdir "vendor\node-win-ia32"
if not exist "temp" mkdir "temp"

echo.
echo Downloading Node.js 18.19.0 x64...
powershell -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v18.19.0/node-v18.19.0-win-x64.zip' -OutFile 'temp\node-v18.19.0-win-x64.zip'"

echo Downloading Node.js 18.19.0 x86...
powershell -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v18.19.0/node-v18.19.0-win-x86.zip' -OutFile 'temp\node-v18.19.0-win-x86.zip'"

echo.
echo Extracting x64 runtime...
powershell -Command "Expand-Archive -Path 'temp\node-v18.19.0-win-x64.zip' -DestinationPath 'temp' -Force"
copy "temp\node-v18.19.0-win-x64\node.exe" "vendor\node-win-x64\node.exe"

echo Extracting x86 runtime...
powershell -Command "Expand-Archive -Path 'temp\node-v18.19.0-win-x86.zip' -DestinationPath 'temp' -Force"
copy "temp\node-v18.19.0-win-x86\node.exe" "vendor\node-win-ia32\node.exe"

echo.
echo Cleaning up...
rmdir /s /q "temp"

echo.
echo Testing runtimes...
echo x64 version:
vendor\node-win-x64\node.exe --version
echo.
echo x86 version:
vendor\node-win-ia32\node.exe --version

echo.
echo ✅ Node.js runtimes downloaded successfully!
echo.
echo Next steps:
echo 1. Verify runtimes are in place:
echo    - vendor\node-win-x64\node.exe
echo    - vendor\node-win-ia32\node.exe
echo 2. Use these runtimes in your Windows installer
echo.
pause
