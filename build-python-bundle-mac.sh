#!/bin/bash

# NebulonGPT Python Bundle Builder for macOS using python-build-standalone
# This script creates a completely isolated Python environment with all dependencies
# Uses python-build-standalone for true standalone Python (no system Python required)

set -e  # Exit on any error

# Accept architecture as parameter, or detect from system
if [ -n "$1" ]; then
    TARGET_ARCH="$1"
    echo "🏗️  Building Python bundle for specified architecture: $TARGET_ARCH"
else
    TARGET_ARCH=$(uname -m)
    echo "🏗️  Building Python bundle for detected architecture: $TARGET_ARCH"
    echo "💡 You can specify architecture: ./build-python-bundle-mac.sh [x64|arm64]"
fi

# Python version to use
PYTHON_VERSION="3.9.19"

# python-build-standalone release tag
PBS_VERSION="20240726"

# Function to calculate directory size
calculate_dir_size() {
    if [ -d "$1" ]; then
        find "$1" -type f -exec wc -c {} + | tail -1 | awk '{print $1}'
    else
        echo "0"
    fi
}

# Function to check if bundle needs rebuilding
needs_rebuild() {
    local bundle_dir="python-bundle/python-env"
    local checksum_file="python-bundle/bundle-checksum-${TARGET_ARCH}.txt"
    
    if [ ! -d "$bundle_dir" ]; then
        echo "📁 Bundle directory not found, creating bundle..."
        return 0  # true - needs rebuild
    fi
    
    if [ ! -f "$checksum_file" ]; then
        echo "📊 Checksum file not found, creating bundle..."
        return 0  # true - needs rebuild
    fi
    
    local saved_size=$(cat "$checksum_file" 2>/dev/null || echo "0")
    local current_size=$(calculate_dir_size "$bundle_dir")
    
    if [ "$current_size" -lt "$saved_size" ]; then
        echo "⚠️  Bundle size is smaller than expected (saved: $saved_size, current: $current_size), recreating bundle..."
        return 0  # true - needs rebuild
    fi
    
    echo "✅ Bundle is up to date (size: $current_size bytes)"
    return 1  # false - no rebuild needed
}

echo "🐍 Checking Python bundle for macOS..."

# Check if rebuild is needed
if ! needs_rebuild; then
    echo "🎯 Python bundle already exists and is valid - skipping rebuild"
    exit 0
fi

echo "🔨 Creating standalone Python bundle for macOS $TARGET_ARCH..."

# Clean up any existing bundle
echo "🧹 Cleaning up existing bundle..."
rm -rf python-bundle

# Create directory structure
echo "📁 Creating directory structure..."
mkdir -p python-bundle/python-env

# Determine the correct python-build-standalone URL based on architecture
if [ "$TARGET_ARCH" = "arm64" ]; then
    PBS_ARCH="aarch64-apple-darwin"
    echo "📥 Downloading python-build-standalone for ARM64..."
elif [ "$TARGET_ARCH" = "x64" ]; then
    PBS_ARCH="x86_64-apple-darwin"
    echo "📥 Downloading python-build-standalone for x64..."
else
    echo "❌ Unsupported architecture: $TARGET_ARCH"
    exit 1
fi

# Download URL for python-build-standalone
PBS_URL="https://github.com/indygreg/python-build-standalone/releases/download/${PBS_VERSION}/cpython-${PYTHON_VERSION}+${PBS_VERSION}-${PBS_ARCH}-install_only.tar.gz"

echo "🌐 Downloading from: $PBS_URL"

# Download python-build-standalone
TEMP_DIR=$(mktemp -d)
cd "$TEMP_DIR"

if ! curl -L -o python.tar.gz "$PBS_URL"; then
    echo "❌ Failed to download python-build-standalone"
    cd -
    rm -rf "$TEMP_DIR"
    exit 1
fi

echo "📦 Extracting standalone Python..."
tar -xzf python.tar.gz

# Move extracted Python to our bundle directory
cd -
mv "$TEMP_DIR/python" python-bundle/python-env/python-dist

# Cleanup temp directory
rm -rf "$TEMP_DIR"

# Install Python packages into the standalone Python
echo "📦 Installing Python packages for $TARGET_ARCH..."

# Use the bundled Python's pip to install packages
BUNDLED_PYTHON="python-bundle/python-env/python-dist/bin/python3"

if [ ! -f "$BUNDLED_PYTHON" ]; then
    echo "❌ Bundled Python not found at: $BUNDLED_PYTHON"
    exit 1
fi

echo "🐍 Using bundled Python: $BUNDLED_PYTHON"

# Install packages using bundled pip
$BUNDLED_PYTHON -m pip install --upgrade pip

# Install PyTorch with platform-specific handling
echo "🔥 Installing PyTorch for $TARGET_ARCH..."
if [ "$TARGET_ARCH" = "x64" ]; then
    # For Intel Macs (x64), explicitly install CPU-only PyTorch to ensure compatibility
    echo "📦 Installing Intel Mac (x64) compatible PyTorch..."
    $BUNDLED_PYTHON -m pip install \
        --upgrade --force-reinstall \
        torch==2.2.2 torchvision==0.17.2 --index-url https://download.pytorch.org/whl/cpu
else
    # For ARM64 Macs, install from standard PyPI
    echo "📦 Installing ARM64 Mac compatible PyTorch..."
    $BUNDLED_PYTHON -m pip install \
        --upgrade --force-reinstall \
        torch==2.2.2 torchvision==0.17.2
fi

# Install remaining packages from requirements (excluding torch and torchvision)
echo "📦 Installing remaining Python packages for $TARGET_ARCH..."
$BUNDLED_PYTHON -m pip install \
    --upgrade --force-reinstall \
    -r requirements-bundle.txt --no-deps

# Now install dependencies of the packages we just installed
echo "📦 Installing package dependencies..."
$BUNDLED_PYTHON -m pip install \
    -r requirements-bundle.txt

# Install spaCy English model
echo "🔤 Installing spaCy English model for $TARGET_ARCH..."
$BUNDLED_PYTHON -m pip install \
    --upgrade \
    https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl

# Copy websocket servers
echo "🌐 Copying websocket servers..."
if [ -d 'Vosk-Server/websocket' ]; then
    mkdir -p python-bundle/python-env/vosk-server
    # Copy all files except the models directory
    find Vosk-Server/websocket -maxdepth 1 -type f -exec cp {} python-bundle/python-env/vosk-server/ \;
    # Copy other directories except models
    for dir in Vosk-Server/websocket/*/; do
        if [ -d "$dir" ] && [ "$(basename "$dir")" != "models" ]; then
            cp -r "$dir" python-bundle/python-env/vosk-server/
        fi
    done
    echo "✅ Vosk server copied"
else
    echo "⚠️  Skip: Vosk-Server/websocket not found"
fi

if [ -d 'Kokoro-TTS-Server/websocket' ]; then
    mkdir -p python-bundle/python-env/kokoro-tts
    cp -r Kokoro-TTS-Server/websocket/* python-bundle/python-env/kokoro-tts/
    echo "✅ Kokoro TTS server copied"
else
    echo "⚠️  Skip: Kokoro-TTS-Server/websocket not found"
fi

# Calculate bundle size and create architecture-specific checksum
echo "📊 Calculating bundle checksum for $TARGET_ARCH..."
BUNDLE_SIZE=$(find python-bundle/python-env -type f -exec wc -c {} + | tail -1 | awk '{print $1}')
echo $BUNDLE_SIZE > "python-bundle/bundle-checksum-${TARGET_ARCH}.txt"

echo "✅ Python bundle creation completed successfully for $TARGET_ARCH!"
echo "📦 Bundle size: $BUNDLE_SIZE bytes"
echo "🎯 Bundle location: python-bundle/"
echo ""
echo "📦 Creating python-bundle.zip for distribution..."

# Create zip file from the python-bundle directory
cd python-bundle && zip -r ../python-bundle.zip . && cd ..

echo "✅ Python bundle created and zipped successfully for $TARGET_ARCH!"
echo ""
echo "🔍 Bundle contents:"
echo "   • Standalone Python $PYTHON_VERSION from python-build-standalone"
echo "   • All required packages (vosk, torch, spacy, kokoro, etc.)"
echo "   • Vosk ASR server"
echo "   • Kokoro TTS server"
echo ""
echo "🚀 Ready for distribution!"
