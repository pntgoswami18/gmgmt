# PowerShell script to download Node.js runtimes for Windows standalone build

$NodeVersion = "18.19.0"
$BaseUrl = "https://nodejs.org/dist/v$NodeVersion"

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

# Download configurations
$Downloads = @(
    @{
        Arch = "x64"
        Filename = "node-v$NodeVersion-win-x64.zip"
        TargetDir = "vendor\node-win-x64"
    },
    @{
        Arch = "x86"
        Filename = "node-v$NodeVersion-win-x86.zip"
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
        
        Write-Host "📦 Extracting $($download.Filename)..." -ForegroundColor Cyan
        Expand-Archive -Path $zipFile -DestinationPath "temp" -Force
        
        # Move node.exe to target directory
        $extractedDir = "temp\$($download.Filename.Replace('.zip', ''))"
        $nodeExe = "$extractedDir\node.exe"
        $targetExe = "$($download.TargetDir)\node.exe"
        
        if (Test-Path $nodeExe) {
            Copy-Item $nodeExe $targetExe -Force
            Write-Host "✅ Extracted node.exe to $($download.TargetDir)" -ForegroundColor Green
            
            # Clean up extracted directory
            Remove-Item $extractedDir -Recurse -Force
        }
        
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

Write-Host "`nPress any key to continue..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
