# NebulonGPT Python Bundle Builder for Windows using python-build-standalone
# This script creates a completely isolated Python environment with all dependencies
# Uses python-build-standalone for true standalone Python (no system Python required)

param(
    [string]$Architecture = "x64"
)

$ErrorActionPreference = 'Stop'

# Python version to use
$PYTHON_VERSION = "3.9.19"

# python-build-standalone release tag
$PBS_VERSION = "20240726"

function Write-Step {
    param([string]$Message)
    Write-Host "🏗️  $Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "✅ $Message" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "⚠️  $Message" -ForegroundColor Yellow
}

function Write-Error-Message {
    param([string]$Message)
    Write-Host "❌ $Message" -ForegroundColor Red
}

function Write-Info {
    param([string]$Message)
    Write-Host "📦 $Message" -ForegroundColor Blue
}

function Calculate-DirectorySize {
    param([string]$Path)
    if (Test-Path $Path) {
        return (Get-ChildItem -Path $Path -Recurse -File | Measure-Object -Property Length -Sum).Sum
    }
    return 0
}

function Test-NeedsRebuild {
    $bundleDir = "python-bundle\python-env"
    $checksumFile = "python-bundle\bundle-checksum-$Architecture.txt"
    
    if (-not (Test-Path $bundleDir)) {
        Write-Info "Bundle directory not found, creating bundle..."
        return $true
    }
    
    if (-not (Test-Path $checksumFile)) {
        Write-Info "Checksum file not found, creating bundle..."
        return $true
    }
    
    try {
        $savedSize = [long](Get-Content $checksumFile -Raw).Trim()
        $currentSize = Calculate-DirectorySize $bundleDir
        
        if ($currentSize -lt $savedSize) {
            Write-Warning "Bundle size is smaller than expected (saved: $savedSize, current: $currentSize), recreating bundle..."
            return $true
        }
        
        Write-Success "Bundle is up to date (size: $currentSize bytes)"
        return $false
    }
    catch {
        Write-Info "Could not read checksum file, creating bundle..."
        return $true
    }
}

Write-Step "Building Python bundle for architecture: $Architecture"

# Check if rebuild is needed
if (-not (Test-NeedsRebuild)) {
    Write-Success "Python bundle already exists and is valid - skipping rebuild"
    exit 0
}

Write-Step "Creating standalone Python bundle for Windows $Architecture..."

# Clean up any existing bundle
Write-Step "Cleaning up existing bundle..."
if (Test-Path "python-bundle") {
    Remove-Item -Recurse -Force "python-bundle"
}

# Create directory structure
Write-Info "Creating directory structure..."
New-Item -ItemType Directory -Path "python-bundle\python-env" -Force | Out-Null

# Determine the correct python-build-standalone URL based on architecture
if ($Architecture -eq "x64") {
    $PBS_ARCH = "x86_64-pc-windows-msvc"
    Write-Info "Downloading python-build-standalone for x64..."
}
else {
    Write-Error-Message "Unsupported architecture: $Architecture"
    exit 1
}

# Download URL for python-build-standalone
$PBS_URL = "https://github.com/indygreg/python-build-standalone/releases/download/$PBS_VERSION/cpython-$PYTHON_VERSION+$PBS_VERSION-$PBS_ARCH-install_only.tar.gz"

Write-Info "Downloading from: $PBS_URL"

# Download python-build-standalone
$tempDir = New-TemporaryFile | ForEach-Object { Remove-Item $_; New-Item -ItemType Directory -Path $_ }

try {
    $tarGzPath = Join-Path $tempDir.FullName "python.tar.gz"
    Invoke-WebRequest -Uri $PBS_URL -OutFile $tarGzPath -UseBasicParsing
    
    Write-Info "Extracting standalone Python..."
    
    # Extract tar.gz using tar command (available in Windows 10+)
    $extractPath = Join-Path $tempDir.FullName "extracted"
    New-Item -ItemType Directory -Path $extractPath -Force | Out-Null
    
    # Use tar to extract (Windows 10+ has built-in tar)
    tar -xzf $tarGzPath -C $extractPath
    
    # Move extracted Python to our bundle directory
    $pythonDir = Get-ChildItem -Path $extractPath -Directory | Select-Object -First 1
    Move-Item -Path $pythonDir.FullName -Destination "python-bundle\python-env\python-dist"
    
    Write-Success "Python extracted successfully"
}
catch {
    Write-Error-Message "Failed to download or extract python-build-standalone: $($_.Exception.Message)"
    Remove-Item -Recurse -Force $tempDir
    exit 1
}
finally {
    Remove-Item -Recurse -Force $tempDir
}

# Install Python packages into the standalone Python
Write-Info "Installing Python packages for $Architecture..."

# Use the bundled Python's pip to install packages
$bundledPython = "python-bundle\python-env\python-dist\python.exe"

if (-not (Test-Path $bundledPython)) {
    Write-Error-Message "Bundled Python not found at: $bundledPython"
    exit 1
}

Write-Info "Using bundled Python: $bundledPython"

# Install packages using bundled pip
& $bundledPython -m pip install --upgrade pip

& $bundledPython -m pip install --upgrade --force-reinstall -r requirements-bundle.txt

# Install spaCy English model
Write-Info "Installing spaCy English model for $Architecture..."
& $bundledPython -m pip install --upgrade https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl

# Copy websocket servers
Write-Info "Copying websocket servers..."
if (Test-Path "Vosk-Server\websocket") {
    New-Item -ItemType Directory -Path "python-bundle\python-env\vosk-server" -Force | Out-Null
    
    # Copy all files except the models directory
    Get-ChildItem -Path "Vosk-Server\websocket" -Exclude "models" | Copy-Item -Destination "python-bundle\python-env\vosk-server" -Recurse -Force
    
    Write-Success "Vosk server copied"
}
else {
    Write-Warning "Skip: Vosk-Server\websocket not found"
}

if (Test-Path "Kokoro-TTS-Server\websocket") {
    New-Item -ItemType Directory -Path "python-bundle\python-env\kokoro-tts" -Force | Out-Null
    Copy-Item -Path "Kokoro-TTS-Server\websocket\*" -Destination "python-bundle\python-env\kokoro-tts" -Recurse -Force
    Write-Success "Kokoro TTS server copied"
}
else {
    Write-Warning "Skip: Kokoro-TTS-Server\websocket not found"
}

# Calculate bundle size and create architecture-specific checksum
Write-Info "Calculating bundle checksum for $Architecture..."
$bundleSize = Calculate-DirectorySize "python-bundle\python-env"
$bundleSize | Out-File -FilePath "python-bundle\bundle-checksum-$Architecture.txt" -Encoding utf8

Write-Success "Python bundle creation completed successfully for $Architecture!"
Write-Info "Bundle size: $bundleSize bytes"
Write-Info "Bundle location: python-bundle\"
Write-Host ""
Write-Info "Creating python-bundle.zip for distribution..."

# Create zip file from the python-bundle directory
Compress-Archive -Path "python-bundle\*" -DestinationPath "python-bundle.zip" -Force

Write-Success "Python bundle created and zipped successfully for $Architecture!"
Write-Host ""
Write-Host "🔍 Bundle contents:" -ForegroundColor Magenta
Write-Host "   • Standalone Python $PYTHON_VERSION from python-build-standalone" -ForegroundColor White
Write-Host "   • All required packages (vosk, torch, spacy, kokoro, etc.)" -ForegroundColor White
Write-Host "   • Vosk ASR server" -ForegroundColor White
Write-Host "   • Kokoro TTS server" -ForegroundColor White
Write-Host ""
Write-Host "🚀 Ready for distribution!" -ForegroundColor Green
