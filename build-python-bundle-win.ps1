# NebulonGPT Python Bundle Builder for Windows using python-build-standalone
# This script creates a completely isolated Python environment with all dependencies
# Uses python-build-standalone for true standalone Python (no system Python required)

param(
    [string]$Architecture = "x64"
)

$ErrorActionPreference = 'Stop'

# Python version to use
# Bumped from 3.9.19 → 3.10.14 for parity with macOS. spaCy 3.8.13 +
# thinc 8.3.12 now require Python ≥ 3.10. The 20240726 python-build-standalone
# release ships 3.10.14 for x86_64-pc-windows-msvc.
$PYTHON_VERSION = "3.10.14"

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
# Create temp directory using GUID (avoids PowerShell temp-file weirdness)
$tempDir = Join-Path $env:TEMP ([System.Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

try {
    $tarGzPath = Join-Path $tempDir "python.tar.gz"
    Write-Info "Downloading Python (this may take a few minutes)..."
    
    # Use more reliable download with progress preference disabled for speed
    $ProgressPreference = 'SilentlyContinue'
    Invoke-WebRequest -Uri $PBS_URL -OutFile $tarGzPath -UseBasicParsing
    $ProgressPreference = 'Continue'
    
    Write-Info "Download complete. File size: $((Get-Item $tarGzPath).Length) bytes"
    Write-Info "Extracting standalone Python..."
    
    # Extract tar.gz using tar command (available in Windows 10+)
    $extractPath = Join-Path $tempDir "extracted"
    
    # Ensure clean extraction directory
    if (Test-Path $extractPath) {
        Remove-Item -Recurse -Force $extractPath
    }
    New-Item -ItemType Directory -Path $extractPath -Force | Out-Null
    
    Write-Info "Extract path: $extractPath"
    
    # Method 1: Try using PowerShell to decompress gzip, then tar to extract
    # This avoids issues with Windows tar's gzip handling
    try {
        Write-Info "Attempting two-step extraction (gzip decompress + tar extract)..."
        
        $tarPath = Join-Path $tempDir "python.tar"
        
        # Decompress gzip using .NET
        $gzipStream = [System.IO.Compression.GZipStream]::new(
            [System.IO.File]::OpenRead($tarGzPath),
            [System.IO.Compression.CompressionMode]::Decompress
        )
        $tarStream = [System.IO.File]::Create($tarPath)
        $gzipStream.CopyTo($tarStream)
        $tarStream.Close()
        $gzipStream.Close()
        
        Write-Info "Gzip decompression complete. Tar file size: $((Get-Item $tarPath).Length) bytes"
        
        # Now extract the tar file
        Push-Location $extractPath
        $tarResult = & tar.exe -xf $tarPath 2>&1
        $tarExitCode = $LASTEXITCODE
        Pop-Location
        
        if ($tarExitCode -ne 0) {
            Write-Warning "tar.exe returned exit code $tarExitCode"
            Write-Warning "tar output: $tarResult"
            throw "tar extraction failed with exit code $tarExitCode"
        }
        
        Write-Info "Tar extraction complete"
    }
    catch {
        Write-Warning "Two-step extraction failed: $($_.Exception.Message)"
        Write-Info "Falling back to direct tar.exe extraction..."
        
        # Fallback: Try direct extraction with tar.exe
        Push-Location $extractPath
        $tarResult = & tar.exe -xzf $tarGzPath 2>&1
        $tarExitCode = $LASTEXITCODE
        Pop-Location
        
        if ($tarExitCode -ne 0) {
            throw "tar extraction failed: $tarResult"
        }
    }
    
    # Move extracted Python to our bundle directory
    $pythonDir = Get-ChildItem -Path $extractPath -Directory | Select-Object -First 1
    
    if (-not $pythonDir) {
        throw "No Python directory found after extraction"
    }
    
    Write-Info "Found extracted Python directory: $($pythonDir.Name)"
    
    # Ensure destination doesn't exist (clean up from previous partial runs)
    $destPath = "python-bundle\python-dist"
    if (Test-Path $destPath) {
        Write-Info "Removing existing python-dist directory..."
        Remove-Item -Recurse -Force $destPath -ErrorAction SilentlyContinue
        Start-Sleep -Milliseconds 500  # Give filesystem time to release handles
    }
    
    # Use Copy-Item + Remove-Item instead of Move-Item (more reliable across volumes)
    Write-Info "Copying Python to bundle directory..."
    Copy-Item -Path $pythonDir.FullName -Destination $destPath -Recurse -Force
    
    # Verify copy was successful
    if (-not (Test-Path "$destPath\python.exe")) {
        throw "Python copy failed - python.exe not found in destination"
    }
    
    Write-Success "Python extracted successfully"
}
catch {
    Write-Error-Message "Failed to download or extract python-build-standalone: $($_.Exception.Message)"
    if (Test-Path $tempDir) {
        Remove-Item -Recurse -Force $tempDir
    }
    exit 1
}
finally {
    if (Test-Path $tempDir) {
        Remove-Item -Recurse -Force $tempDir
    }
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

# Prevent bundled Python from using the system's user site-packages
# This ensures only the bundled Python's own site-packages are used
$env:PYTHONNOUSERSITE = "1"

# Common pip flags to suppress warnings about scripts not on PATH
$pipFlags = @("--no-warn-script-location", "--disable-pip-version-check")

# Bootstrap pip into the bundled Python (avoids using broken system pip)
Write-Info "Bootstrapping pip into bundled Python..."
& $bundledPython -m ensurepip --upgrade
& $bundledPython -m pip install --upgrade pip @pipFlags

# Install backend requirements from requirements.txt (same as Mac build)
Write-Info "Installing backend requirements for $Architecture..."
& $bundledPython -m pip install --upgrade @pipFlags -r "backend\requirements.txt"

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
