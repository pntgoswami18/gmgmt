# PowerShell script to download Node.js runtimes for Windows standalone build

# Node 22.x LTS - the app requires Node >= 20 (better-sqlite3 ABI), and
# Node 18 is end-of-life. When bumping the version, update the SHA-256
# hashes below from https://nodejs.org/dist/v<version>/SHASUMS256.txt
# (and the matching pins in download-node-runtimes.js / .bat).
$NodeVersion = "22.23.2"
$BaseUrl = "https://nodejs.org/dist/v$NodeVersion"

$ErrorActionPreference = "Stop"

Write-Host "🚀 Downloading Node.js $NodeVersion runtimes for Windows standalone build..." -ForegroundColor Green

# Create vendor directories
$Directories = @(
    "vendor\node-win-x64",
    "vendor\node-win-ia32",
    "temp"
)

foreach ($dir in $Directories) {
    if (!(Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
        Write-Host "📁 Created directory: $dir" -ForegroundColor Yellow
    }
}

# Download configurations (SHA-256 values from nodejs.org's SHASUMS256.txt)
$Downloads = @(
    @{
        Arch = "x64"
        Filename = "node-v$NodeVersion-win-x64.zip"
        Sha256 = "1177b4137ba5adaa56354ae40f1080c7450e8ae09cecb47da459d1c52ac99f97"
        TargetDir = "vendor\node-win-x64"
    },
    @{
        Arch = "x86"
        Filename = "node-v$NodeVersion-win-x86.zip"
        Sha256 = "725c9e2bdd1c2016b41c995a81f4fa36ce4e2ee565b7455d8f889182727df647"
        TargetDir = "vendor\node-win-ia32"
    }
)

foreach ($download in $Downloads) {
    $url = "$BaseUrl/$($download.Filename)"
    $zipFile = "temp\$($download.Filename)"

    Write-Host "📥 Downloading $($download.Filename)..." -ForegroundColor Cyan

    try {
        Invoke-WebRequest -Uri $url -OutFile $zipFile -UseBasicParsing
        Write-Host "✅ Downloaded $($download.Filename)" -ForegroundColor Green

        # The bundled node.exe runs as a Windows Service under LocalSystem -
        # verify the download against the pinned official hash first.
        $actualHash = (Get-FileHash -Path $zipFile -Algorithm SHA256).Hash.ToLower()
        if ($actualHash -ne $download.Sha256) {
            Write-Host "❌ SHA-256 mismatch for $($download.Filename):" -ForegroundColor Red
            Write-Host "   expected $($download.Sha256)" -ForegroundColor Red
            Write-Host "   actual   $actualHash" -ForegroundColor Red
            exit 1
        }
        Write-Host "🔒 Verified SHA-256 of $($download.Filename)" -ForegroundColor Green

        Write-Host "📦 Extracting $($download.Filename)..." -ForegroundColor Cyan
        Expand-Archive -Path $zipFile -DestinationPath "temp" -Force

        # Move node.exe to target directory
        $extractedDir = "temp\$($download.Filename.Replace('.zip', ''))"
        $nodeExe = "$extractedDir\node.exe"
        $targetExe = "$($download.TargetDir)\node.exe"

        if (!(Test-Path $nodeExe)) {
            Write-Host "❌ node.exe not found at $nodeExe after extraction" -ForegroundColor Red
            exit 1
        }

        Copy-Item $nodeExe $targetExe -Force
        Write-Host "✅ Extracted node.exe to $($download.TargetDir)" -ForegroundColor Green

        # Clean up extracted directory
        Remove-Item $extractedDir -Recurse -Force

        # Clean up zip file
        Remove-Item $zipFile -Force

    } catch {
        Write-Host "❌ Error downloading $($download.Filename): $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}

# Clean up temp directory
Remove-Item "temp" -Recurse -Force

Write-Host "`n🎉 Successfully downloaded and extracted Node.js runtimes!" -ForegroundColor Green

# Test the runtimes
Write-Host "`n🧪 Testing runtimes..." -ForegroundColor Yellow
Write-Host "x64 version:" -ForegroundColor Cyan
& "vendor\node-win-x64\node.exe" --version

Write-Host "`nx86 version:" -ForegroundColor Cyan
& "vendor\node-win-ia32\node.exe" --version

Write-Host "`n📋 Next steps:" -ForegroundColor Yellow
Write-Host "1. Verify the runtimes are in place:" -ForegroundColor White
Write-Host "   - vendor\node-win-x64\node.exe" -ForegroundColor Gray
Write-Host "   - vendor\node-win-ia32\node.exe" -ForegroundColor Gray
Write-Host "2. Use these runtimes in your Windows installer" -ForegroundColor White
Write-Host "3. Test your application with both runtimes" -ForegroundColor White

# Only prompt when a human is at the console - ReadKey hangs or throws in
# non-interactive hosts (CI, powershell -NonInteractive, build wrappers).
if ([Environment]::UserInteractive -and -not $env:CI) {
    Write-Host "`nPress any key to continue..." -ForegroundColor Gray
    try {
        $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    } catch {
        # Host doesn't support ReadKey (e.g. ISE) - nothing to wait for.
    }
}
