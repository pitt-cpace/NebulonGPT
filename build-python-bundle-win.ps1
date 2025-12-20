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
    Write-Host "STEP: $Message" -ForegroundColor Cyan
}

function Write-Success {
    param([string]$Message)
    Write-Host "SUCCESS: $Message" -ForegroundColor Green
}

function Write-Warning {
    param([string]$Message)
    Write-Host "WARNING: $Message" -ForegroundColor Yellow
}

function Write-Error-Message {
    param([string]$Message)
    Write-Host "ERROR: $Message" -ForegroundColor Red
}

function Write-Info {
    param([string]$Message)
    Write-Host "INFO: $Message" -ForegroundColor Blue
}

function Calculate-DirectorySize {
    param([string]$Path)
    if (Test-Path $Path) {
        return (Get-ChildItem -Path $Path -Recurse -File | Measure-Object -Property Length -Sum).Sum
    }
    return 0
}

function Test-NeedsRebuild {
    $bundleDir = "python-bundle"
    $checksumFile = "python-bundle\bundle-checksum-$Architecture.txt"
    
    Write-Info "   Checking if bundle needs rebuilding..."
    Write-Info "   Bundle directory: $bundleDir"
    Write-Info "   Checksum file: $checksumFile"
    Write-Host ""
    
    # Check 1: Does bundle directory exist?
    if (-not (Test-Path $bundleDir)) {
        Write-Warning "Check 1 FAILED: Bundle directory not found"
        return $true
    }
    Write-Success "Check 1 PASSED: Bundle directory exists"
    
    # Check 2: Does checksum file exist?
    if (-not (Test-Path $checksumFile)) {
        Write-Warning "Check 2 FAILED: Checksum file not found"
        return $true
    }
    Write-Success "Check 2 PASSED: Checksum file exists"
    
    # Check 3: Is current size >= saved size?
    try {
        $savedSize = [long](Get-Content $checksumFile -Raw).Trim()
        $currentSize = Calculate-DirectorySize $bundleDir
        
        Write-Info "   Saved size: $savedSize bytes"
        Write-Info "   Current size: $currentSize bytes"
        Write-Host ""
        
        if ($currentSize -lt $savedSize) {
            Write-Warning "Check 3 FAILED: Bundle size is smaller than expected"
            Write-Warning "   This indicates missing or corrupted files"
            return $true
        }
        Write-Success "Check 3 PASSED: Bundle size is adequate"
        Write-Host ""
        
        Write-Success "All checks passed - bundle is valid!"
        return $false
    }
    catch {
        Write-Warning "Could not read checksum file, creating bundle..."
        return $true
    }
}

Write-Step "Checking Python bundle for Windows $Architecture..."
Write-Info "You can specify architecture: .\build-python-bundle-win.ps1 -Architecture [x64]"
Write-Host ""

# Check if rebuild is needed
if (-not (Test-NeedsRebuild)) {
    Write-Host ""
    Write-Success "Python bundle already exists and is valid - skipping rebuild"
    Write-Info "To force rebuild, delete: python-bundle or python-bundle\bundle-checksum-$Architecture.txt"
    exit 0
}

Write-Host ""
Write-Step "Creating standalone Python bundle for Windows $Architecture..."

# Clean up any existing bundle
Write-Step "Cleaning up existing bundle..."
if (Test-Path "python-bundle") {
    Remove-Item -Recurse -Force "python-bundle"
}

# Create directory structure
Write-Info "Creating directory structure..."
New-Item -ItemType Directory -Path "python-bundle" -Force | Out-Null

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
    Move-Item -Path $pythonDir.FullName -Destination "python-bundle\python-dist"
    
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
$bundledPython = "python-bundle\python-dist\python.exe"

if (-not (Test-Path $bundledPython)) {
    Write-Error-Message "Bundled Python not found at: $bundledPython"
    exit 1
}

Write-Info "Using bundled Python: $bundledPython"

# Install packages using bundled pip
& $bundledPython -m pip install --upgrade pip

# Install backend requirements
Write-Info "Installing backend requirements for $Architecture..."
& $bundledPython -m pip install --upgrade -r backend\requirements.txt

# Copy FastAPI backend
Write-Info "Copying FastAPI backend..."
if (Test-Path "backend") {
    New-Item -ItemType Directory -Path "python-bundle\backend" -Force | Out-Null
    
    # Copy Python files and config (exclude models directory, we'll handle that separately)
    Write-Info "Copying backend Python files..."
    Get-ChildItem -Path "backend" -Exclude "models","__pycache__","*.pyc" | Copy-Item -Destination "python-bundle\backend" -Recurse -Force
    
    # Create empty models directory structure
    # Models are NOT copied into the Python bundle to avoid duplication
    # They are extracted separately at runtime to ~/.nebulon-gpt/vosk-models/ and ~/.nebulon-gpt/huggingface/
    New-Item -ItemType Directory -Path "python-bundle\backend\models\vosk" -Force | Out-Null
    New-Item -ItemType Directory -Path "python-bundle\backend\models\kokoro" -Force | Out-Null
    
    Write-Info "Empty models directories created (models extracted separately at runtime)"
    
    Write-Success "Backend copied successfully"
}
else {
    Write-Error-Message "ERROR: backend directory not found!"
    exit 1
}

# Calculate bundle size and create architecture-specific checksum
Write-Info "Calculating bundle checksum for $Architecture..."
$bundleSize = Calculate-DirectorySize "python-bundle"
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
Write-Host "Bundle contents:" -ForegroundColor Magenta
Write-Host "   - Standalone Python $PYTHON_VERSION from python-build-standalone" -ForegroundColor White
Write-Host "   - All required packages (FastAPI, vosk, torch, spacy, kokoro, etc.)" -ForegroundColor White
Write-Host "   - FastAPI unified backend (REST API + WebSocket endpoints)" -ForegroundColor White
Write-Host "   - Checksum file: bundle-checksum-$Architecture.txt" -ForegroundColor White
Write-Host ""
Write-Host "Note: Models are packaged separately and extracted at runtime to avoid duplication" -ForegroundColor Yellow
Write-Host ""
Write-Host "Ready for distribution!" -ForegroundColor Green
