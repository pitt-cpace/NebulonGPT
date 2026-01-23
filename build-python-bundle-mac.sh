#!/bin/bash

# NebulonGPT Python Bundle Builder for macOS using python-build-standalone
# This script creates a completely isolated Python environment with all dependencies
# Uses python-build-standalone for true standalone Python (no system Python required)

set -e  # Exit on any error

# Accept architecture as parameter, or detect from system
if [ -n "$1" ]; then
    TARGET_ARCH="$1"
    echo "Building Python bundle for specified architecture: $TARGET_ARCH"
else
    TARGET_ARCH=$(uname -m)
    echo "Building Python bundle for detected architecture: $TARGET_ARCH"
    echo "You can specify architecture: ./build-python-bundle-mac.sh [x64|arm64]"
fi

# Python version to use
PYTHON_VERSION="3.9.19"

# python-build-standalone release tag
PBS_VERSION="20240726"

# Function to calculate directory size (more reliable using du)
calculate_dir_size() {
    if [ -d "$1" ]; then
        # Use du for more reliable size calculation on macOS
        # -sk gives size in KB, multiply by 1024 for bytes
        local size_kb=$(du -sk "$1" | cut -f1)
        echo $((size_kb * 1024))
    else
        echo "0"
    fi
}

# Function to check if bundle needs rebuilding
needs_rebuild() {
    local bundle_dir="python-bundle"
    local checksum_file="python-bundle/bundle-checksum-${TARGET_ARCH}.txt"
    
    echo "   Checking if bundle needs rebuilding..."
    echo "   Bundle directory: $bundle_dir"
    echo "   Checksum file: $checksum_file"
    
    # Check 1: Does python-env directory exist?
    if [ ! -d "$bundle_dir" ]; then
        echo "Check 1 FAILED: Bundle directory not found"
        return 0  # true - needs rebuild
    fi
    echo "Check 1 PASSED: Bundle directory exists"
    
    # Check 2: Does checksum file exist?
    if [ ! -f "$checksum_file" ]; then
        echo "Check 2 FAILED: Checksum file not found"
        return 0  # true - needs rebuild
    fi
    echo "Check 2 PASSED: Checksum file exists"
    
    # Check 3: Is current size >= saved size?
    local saved_size=$(cat "$checksum_file" 2>/dev/null || echo "0")
    local current_size=$(calculate_dir_size "$bundle_dir")
    
    echo "   Saved size: $saved_size bytes"
    echo "   Current size: $current_size bytes"
    
    if [ "$current_size" -lt "$saved_size" ]; then
        echo "Check 3 FAILED: Bundle size is smaller than expected"
        echo "   This indicates missing or corrupted files"
        return 0  # true - needs rebuild
    fi
    echo "Check 3 PASSED: Bundle size is adequate"
    
    echo "All checks passed - bundle is valid!"
    return 1  # false - no rebuild needed
}

echo "Checking Python bundle for macOS $TARGET_ARCH..."
echo ""

# Check if rebuild is needed
if ! needs_rebuild; then
    echo ""
    echo "Python bundle already exists and is valid - skipping rebuild"
    echo "To force rebuild, delete: python-bundle/python-env or python-bundle/bundle-checksum-${TARGET_ARCH}.txt"
    exit 0
fi

echo ""
echo "🔨 Creating standalone Python bundle for macOS $TARGET_ARCH..."

# Clean up any existing bundle
echo "Cleaning up existing bundle..."
rm -rf python-bundle

# Create directory structure
echo "Creating directory structure..."
mkdir -p python-bundle

# Determine the correct python-build-standalone URL based on architecture
if [ "$TARGET_ARCH" = "arm64" ]; then
    PBS_ARCH="aarch64-apple-darwin"
    echo "Downloading python-build-standalone for ARM64..."
elif [ "$TARGET_ARCH" = "x64" ]; then
    PBS_ARCH="x86_64-apple-darwin"
    echo "Downloading python-build-standalone for x64..."
else
    echo "Unsupported architecture: $TARGET_ARCH"
    exit 1
fi

# Download URL for python-build-standalone
PBS_URL="https://github.com/indygreg/python-build-standalone/releases/download/${PBS_VERSION}/cpython-${PYTHON_VERSION}+${PBS_VERSION}-${PBS_ARCH}-install_only.tar.gz"

echo "Downloading from: $PBS_URL"

# Download python-build-standalone
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"

if ! curl -L -o python.tar.gz "$PBS_URL"; then
    echo "Failed to download python-build-standalone"
    cd -
    rm -rf "$TEMP_DIR"
    exit 1
fi

echo "Extracting standalone Python..."
tar -xzf python.tar.gz

# Move extracted Python to our bundle directory
cd -
mv "$TEMP_DIR/python" python-bundle/python-dist

# Cleanup temp directory
rm -rf "$TEMP_DIR"

# Install Python packages into the standalone Python
echo "Installing Python packages for $TARGET_ARCH..."

# Use the bundled Python's pip to install packages
BUNDLED_PYTHON="python-bundle/python-dist/bin/python3"

if [ ! -f "$BUNDLED_PYTHON" ]; then
    echo "Bundled Python not found at: $BUNDLED_PYTHON"
    exit 1
fi

echo "Using bundled Python: $BUNDLED_PYTHON"

# Install packages using bundled pip
$BUNDLED_PYTHON -m pip install --upgrade pip

# # Install PyTorch with platform-specific handling
# echo "Installing PyTorch for $TARGET_ARCH..."
# if [ "$TARGET_ARCH" = "x64" ]; then
#     # For Intel Macs (x64), explicitly install CPU-only PyTorch to ensure compatibility
#     echo "Installing Intel Mac (x64) compatible PyTorch..."
#     $BUNDLED_PYTHON -m pip install \
#         --upgrade --force-reinstall \
#         torch==2.2.2 torchvision==0.17.2 --index-url https://download.pytorch.org/whl/cpu
# else
#     # For ARM64 Macs, install from standard PyPI
#     echo "Installing ARM64 Mac compatible PyTorch..."
#     $BUNDLED_PYTHON -m pip install \
#         --upgrade --force-reinstall \
#         torch==2.2.2 torchvision==0.17.2
# fi

# Install backend requirements
echo "Installing backend requirements for $TARGET_ARCH..."
$BUNDLED_PYTHON -m pip install \
    --upgrade \
    -r backend/requirements.txt

# Copy FastAPI backend
echo "Copying FastAPI backend..."
if [ -d 'backend' ]; then
    mkdir -p python-bundle/backend
    
    # Copy Python files and config (exclude models directory, we'll handle that separately)
    echo "Copying backend Python files..."
    rsync -av --exclude='models' --exclude='__pycache__' --exclude='*.pyc' backend/ python-bundle/backend/
else
    echo "ERROR: backend directory not found!"
    exit 1
fi

# Calculate bundle size and create architecture-specific checksum
echo "Calculating bundle checksum for $TARGET_ARCH..."
BUNDLE_SIZE=$(calculate_dir_size "python-bundle")
echo $BUNDLE_SIZE > "python-bundle/bundle-checksum-${TARGET_ARCH}.txt"

echo "Python bundle creation completed successfully for $TARGET_ARCH!"
echo "Bundle size: $BUNDLE_SIZE bytes"
echo "Bundle location: python-bundle/"
echo ""

# Sign all binaries before zipping
echo "Signing all binaries in the bundle..."
IDENTITY="University of Pittsburgh (BB467SPB6A)"
ENTITLEMENTS="entitlements.mac.plist"

if [ ! -f "$ENTITLEMENTS" ]; then
    echo "Warning: Entitlements file not found: $ENTITLEMENTS"
    echo "Skipping code signing. App may fail notarization."
else
    SIGNED_COUNT=0
    FAILED_COUNT=0
    
    # Find and sign all Mach-O binaries
    while IFS= read -r -d '' file; do
        # Check if file is a Mach-O binary
        if file "$file" | grep -q "Mach-O"; then
            echo "   • Signing: ${file#python-bundle/}"
            if codesign --force --sign "$IDENTITY" \
                --timestamp \
                --options runtime \
                --entitlements "$ENTITLEMENTS" \
                "$file" 2>/dev/null; then
                ((SIGNED_COUNT++))
            else
                echo " Warning: Failed to sign this file"
                ((FAILED_COUNT++))
            fi
        fi
    done < <(find python-bundle -type f \( -name "*.so" -o -name "*.dylib" -o -perm +111 \) -print0)
    
    echo "Signed $SIGNED_COUNT binaries"
    if [ $FAILED_COUNT -gt 0 ]; then
        echo "Failed to sign $FAILED_COUNT binaries"
    fi
fi

echo ""
echo "Creating python-bundle.zip for distribution..."

# Create zip file from the python-bundle directory
cd python-bundle && zip -r ../python-bundle.zip . && cd ..

echo "Python bundle created and zipped successfully for $TARGET_ARCH!"
echo ""
echo "Bundle contents:"
echo "   • Standalone Python $PYTHON_VERSION from python-build-standalone"
echo "   • All required packages (FastAPI, vosk, torch, spacy, kokoro, etc.)"
echo "   • FastAPI unified backend (REST API + WebSocket endpoints)"
echo "   • Checksum file: bundle-checksum-${TARGET_ARCH}.txt"
echo ""
echo "Ready for distribution!"
