# NebulonGPT Python Bundle Builder for Windows
# This script creates a completely isolated Python environment with all dependencies

param(
    [switch]$Verbose
)

$ErrorActionPreference = 'Stop'

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

function Write-Info {
    param([string]$Message)
    Write-Host "INFO: $Message" -ForegroundColor Blue
}

function Calculate-DirectorySize {
    param([string]$Path)
    if (Test-Path $Path) {
        return (Get-ChildItem -Path $Path -Recurse | Measure-Object -Property Length -Sum).Sum
    }
    return 0
}

function Test-NeedsRebuild {
    $bundleDir = 'python-bundle/python-env'
    $checksumFile = 'python-bundle/bundle-checksum.txt'
    
    if (-not (Test-Path $bundleDir)) {
        Write-Info "Bundle directory not found, creating bundle..."
        return $true
    }
    
    if (-not (Test-Path $checksumFile)) {
        Write-Info "Checksum file not found, creating bundle..."
        return $true
    }
    
    try {
        $savedSizeText = Get-Content $checksumFile -Raw -ErrorAction Stop
        $savedSize = [long]($savedSizeText.Trim())
        $currentSize = Calculate-DirectorySize $bundleDir
        
        Write-Info "Saved size: $savedSize bytes"
        Write-Info "Current size: $currentSize bytes"
        
        if ($currentSize -lt $savedSize) {
            Write-Warning "Bundle size is smaller than expected (saved: $savedSize, current: $currentSize), recreating bundle..."
            return $true
        }
        
        Write-Success "Bundle is up to date (size: $currentSize bytes)"
        return $false
    } catch {
        Write-Warning "Error reading checksum file: $($_.Exception.Message), recreating bundle..."
        return $true
    }
}

Write-Step "Checking Python bundle for Windows..."

# Check if rebuild is needed
if (-not (Test-NeedsRebuild)) {
    Write-Success "Python bundle already exists and is valid - skipping rebuild"
    exit 0
}

Write-Step "Creating Python bundle for Windows..."

# Clean up any existing bundle
Write-Step "Cleaning up existing bundle..."
if (Test-Path 'python-bundle') {
    Remove-Item -Recurse -Force 'python-bundle'
}

# Create directory structure
Write-Step "Creating directory structure..."
New-Item -ItemType Directory -Path 'python-bundle/python-env/lib/python3.10/site-packages' -Force | Out-Null

# Download and extract embedded Python
Write-Step "Downloading Python 3.10 embedded..."
$zipUrl = 'https://www.python.org/ftp/python/3.10.8/python-3.10.8-embed-amd64.zip'
$zipPath = 'python-embed.zip'

try {
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
    Write-Success "Python downloaded successfully"
} catch {
    Write-Warning "Retrying download..."
    Start-Sleep -Seconds 2
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath -UseBasicParsing
}

Write-Step "Extracting Python..."
Expand-Archive -Path $zipPath -DestinationPath 'python-bundle/python-env/' -Force
Remove-Item $zipPath

# Configure Python path
Write-Step "Configuring Python path..."
$pathConfig = @(
    'python310.zip',
    'lib/python3.10/site-packages',
    '',
    '# Uncomment to run site.main() automatically',
    'import site'
)
$pathConfig | Set-Content 'python-bundle/python-env/python310._pth'

# Download and install pip
Write-Step "Setting up pip..."
$getPipPath = 'python-bundle/python-env/get-pip.py'
if (-not (Test-Path $getPipPath)) {
    Write-Info "Downloading get-pip.py..."
    try {
        Invoke-WebRequest -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile $getPipPath -UseBasicParsing
    } catch {
        Start-Sleep -Seconds 2
        Invoke-WebRequest -Uri 'https://bootstrap.pypa.io/get-pip.py' -OutFile $getPipPath -UseBasicParsing
    }
} else {
    Write-Info "Using existing get-pip.py"
}

$pythonExe = '.\python-bundle\python-env\python.exe'
Write-Step "Bootstrapping pip..."
& $pythonExe -s -E $getPipPath pip==24.2 --no-warn-script-location

# Set pip environment variables
$env:PIP_DISABLE_PIP_VERSION_CHECK = '1'
$env:PIP_NO_INPUT = '1'
$env:PIP_CONFIG_FILE = $null
$targetDir = 'python-bundle/python-env/lib/python3.10/site-packages'

# Install packages from requirements
Write-Step "Installing Python packages from requirements-bundle.txt..."
if (Test-Path 'requirements-bundle.txt') {
    & $pythonExe -s -E -m pip install --no-cache-dir --upgrade --ignore-installed --isolated --no-warn-script-location --target $targetDir -r requirements-bundle.txt
    Write-Success "Requirements installed successfully"
} else {
    Write-Warning "requirements-bundle.txt not found, installing core packages manually..."
    
    Write-Info "Installing core packages..."
    & $pythonExe -s -E -m pip install --no-cache-dir --upgrade --ignore-installed --isolated --no-warn-script-location --target $targetDir pip==24.2 vosk==0.3.45 websockets==11.0.3 torch==2.2.2 soundfile==0.12.1 kokoro==0.7.16 numpy==1.26.4 huggingface_hub==0.24.6
    
    Write-Info "Installing TTS dependencies..."
    & $pythonExe -s -E -m pip install --no-cache-dir --upgrade --ignore-installed --isolated --no-warn-script-location --target $targetDir spacy==3.7.5 phonemizer-fork==3.3.0 spacy-curated-transformers==0.3.1 num2words==0.5.13 espeakng-loader==0.2.4
    
    Write-Info "Installing Misaki and spaCy model..."
    & $pythonExe -s -E -m pip install --no-cache-dir --upgrade --ignore-installed --isolated --no-warn-script-location --target $targetDir 'misaki[en]==0.7.16' https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl
    
    Write-Info "Installing additional utilities..."
    & $pythonExe -s -E -m pip install --no-cache-dir --upgrade --ignore-installed --isolated --no-warn-script-location --target $targetDir colorama==0.4.6 tqdm==4.66.4 regex==2024.5.15 filelock==3.15.4 attrs==24.2.0 urllib3==2.2.2 typing_extensions==4.12.2 charset-normalizer==3.3.2 idna==3.7 certifi==2024.7.4 cffi==1.16.0 pycparser==2.22
}

# Install spaCy English model
Write-Step "Installing spaCy English model..."
& $pythonExe -s -E -m pip install --no-cache-dir --upgrade --ignore-installed --isolated --no-warn-script-location --target $targetDir https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl

# Copy websocket servers (excluding models directory)
Write-Step "Copying websocket servers..."
if (Test-Path 'Vosk-Server/websocket') {
    if (-not (Test-Path 'python-bundle/python-env/vosk-server')) {
        New-Item -ItemType Directory -Path 'python-bundle/python-env/vosk-server' -Force | Out-Null
    }
    
    # Copy Python files and requirements, but exclude models directory
    Get-ChildItem -Path 'Vosk-Server/websocket' -Exclude 'models' | ForEach-Object {
        Copy-Item -Recurse -Force $_.FullName 'python-bundle/python-env/vosk-server/'
    }
    Write-Success "Vosk server copied (excluding models directory)"
} else {
    Write-Warning "Skip: Vosk-Server/websocket not found"
}

if (Test-Path 'Kokoro-TTS-Server/websocket') {
    if (-not (Test-Path 'python-bundle/python-env/kokoro-tts')) {
        New-Item -ItemType Directory -Path 'python-bundle/python-env/kokoro-tts' -Force | Out-Null
    }
    Copy-Item -Recurse -Force 'Kokoro-TTS-Server/websocket/*' 'python-bundle/python-env/kokoro-tts/'
    Write-Success "Kokoro TTS server copied"
} else {
    Write-Warning "Skip: Kokoro-TTS-Server/websocket not found"
}

# Create the fixed Python wrapper script
Write-Step "Creating Python wrapper with proper file execution..."
$pythonWrapper = @'
#!/usr/bin/env python3
import sys
import os

# Get the directory containing this script
script_dir = os.path.dirname(os.path.abspath(__file__))
bundle_site_packages = os.path.join(script_dir, "lib", "python3.10", "site-packages")
bundle_stdlib = os.path.join(script_dir, "lib", "python3.10")

# Completely replace sys.path with only bundled paths
sys.path = [
    bundle_site_packages,
    bundle_stdlib,
    os.path.join(bundle_stdlib, "lib-dynload"),
]

# Set environment variables for complete isolation
os.environ["PYTHONDONTWRITEBYTECODE"] = "1"
os.environ["PYTHONNOUSERSITE"] = "1"
os.environ["PYTHONIOENCODING"] = "utf-8"

# Remove system Python paths from environment
if "PYTHONPATH" in os.environ:
    del os.environ["PYTHONPATH"]
if "PYTHONSTARTUP" in os.environ:
    del os.environ["PYTHONSTARTUP"]
if "PYTHONOPTIMIZE" in os.environ:
    del os.environ["PYTHONOPTIMIZE"]

# Execute the provided arguments
if len(sys.argv) > 1:
    if sys.argv[1] == "-c" and len(sys.argv) > 2:
        exec(sys.argv[2])
    else:
        # Execute a Python file
        script_path = sys.argv[1]
        if os.path.isfile(script_path):
            # Set sys.argv to match what the script expects
            sys.argv = sys.argv[1:]  # Remove the wrapper script from argv
            with open(script_path, 'r') as f:
                code = compile(f.read(), script_path, 'exec')
                exec(code, {'__file__': script_path, '__name__': '__main__'})
        else:
            print(f"Error: File '{script_path}' not found", file=sys.stderr)
            sys.exit(1)
else:
    # Interactive mode
    import code
    code.interact()
'@

$pythonWrapper | Set-Content 'python-bundle/python-env/python3.py' -Encoding UTF8

# Create a batch file wrapper for easier execution
Write-Step "Creating batch file wrapper..."
$batchWrapper = @'
@echo off
"%~dp0python.exe" "%~dp0python3.py" %*
'@
$batchWrapper | Set-Content 'python-bundle/python-env/python3.bat' -Encoding ASCII

# Calculate bundle size and create checksum
Write-Step "Calculating bundle checksum..."
$bundleSize = (Get-ChildItem -Path 'python-bundle/python-env' -Recurse | Measure-Object -Property Length -Sum).Sum
$bundleSize | Out-File -FilePath 'python-bundle/bundle-checksum.txt' -Encoding utf8

Write-Success "Python bundle creation completed successfully!"
Write-Info "Bundle size: $bundleSize bytes"
Write-Info "Bundle location: python-bundle/"
Write-Host ""
Write-Host "Bundle contents:" -ForegroundColor Magenta
Write-Host "   - Isolated Python 3.10 environment" -ForegroundColor White
Write-Host "   - All required packages (vosk, torch, spacy, kokoro, etc.)" -ForegroundColor White
Write-Host "   - Vosk ASR server" -ForegroundColor White
Write-Host "   - Kokoro TTS server" -ForegroundColor White
Write-Host "   - Fixed Python wrapper for proper script execution" -ForegroundColor White
Write-Host ""
Write-Host "Ready for distribution!" -ForegroundColor Green
