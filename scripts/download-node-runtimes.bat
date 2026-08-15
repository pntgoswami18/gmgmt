@echo off
REM Node 22.x LTS - the app requires Node >= 20 (better-sqlite3 ABI), and
REM Node 18 is end-of-life. When bumping the version, update the SHA-256
REM hashes below from https://nodejs.org/dist/v<version>/SHASUMS256.txt
REM (and the matching pins in download-node-runtimes.js / .ps1).
set NODE_VERSION=22.23.2
set SHA256_X64=1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97
set SHA256_X86=725c9e2bdd1c2016b41c995a81f4fa36ce4e2ee565b7455d8f889182727df647

echo Downloading Node.js %NODE_VERSION% runtimes for Windows standalone build...

REM Create vendor directories
if not exist "vendor\node-win-x64" mkdir "vendor\node-win-x64"
if not exist "vendor\node-win-ia32" mkdir "vendor\node-win-ia32"
if not exist "temp" mkdir "temp"

echo.
echo Downloading Node.js %NODE_VERSION% x64...
powershell -Command "$ErrorActionPreference='Stop'; Invoke-WebRequest -Uri 'https://nodejs.org/dist/v%NODE_VERSION%/node-v%NODE_VERSION%-win-x64.zip' -OutFile 'temp\node-v%NODE_VERSION%-win-x64.zip'" || goto :fail

echo Downloading Node.js %NODE_VERSION% x86...
powershell -Command "$ErrorActionPreference='Stop'; Invoke-WebRequest -Uri 'https://nodejs.org/dist/v%NODE_VERSION%/node-v%NODE_VERSION%-win-x86.zip' -OutFile 'temp\node-v%NODE_VERSION%-win-x86.zip'" || goto :fail

echo.
echo Verifying checksums...
powershell -Command "$ErrorActionPreference='Stop'; if ((Get-FileHash 'temp\node-v%NODE_VERSION%-win-x64.zip' -Algorithm SHA256).Hash.ToLower() -ne '%SHA256_X64%') { Write-Error 'SHA-256 mismatch for x64 zip'; exit 1 }" || goto :fail
powershell -Command "$ErrorActionPreference='Stop'; if ((Get-FileHash 'temp\node-v%NODE_VERSION%-win-x86.zip' -Algorithm SHA256).Hash.ToLower() -ne '%SHA256_X86%') { Write-Error 'SHA-256 mismatch for x86 zip'; exit 1 }" || goto :fail
echo Checksums verified.

echo.
echo Extracting x64 runtime...
powershell -Command "$ErrorActionPreference='Stop'; Expand-Archive -Path 'temp\node-v%NODE_VERSION%-win-x64.zip' -DestinationPath 'temp' -Force" || goto :fail
copy "temp\node-v%NODE_VERSION%-win-x64\node.exe" "vendor\node-win-x64\node.exe" || goto :fail

echo Extracting x86 runtime...
powershell -Command "$ErrorActionPreference='Stop'; Expand-Archive -Path 'temp\node-v%NODE_VERSION%-win-x86.zip' -DestinationPath 'temp' -Force" || goto :fail
copy "temp\node-v%NODE_VERSION%-win-x86\node.exe" "vendor\node-win-ia32\node.exe" || goto :fail

echo.
echo Cleaning up...
rmdir /s /q "temp"

if not exist "vendor\node-win-x64\node.exe" goto :fail
if not exist "vendor\node-win-ia32\node.exe" goto :fail

echo.
echo Testing runtimes...
echo x64 version:
vendor\node-win-x64\node.exe --version
echo.
echo x86 version:
vendor\node-win-ia32\node.exe --version

echo.
echo Node.js runtimes downloaded successfully!
echo.
echo Next steps:
echo 1. Verify runtimes are in place:
echo    - vendor\node-win-x64\node.exe
echo    - vendor\node-win-ia32\node.exe
echo 2. Use these runtimes in your Windows installer
echo.
if "%CI%"=="" pause
exit /b 0

:fail
echo.
echo ERROR: download or extraction failed - see output above.
exit /b 1
