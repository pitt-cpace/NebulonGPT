#!/bin/bash

# NebulonGPT Python Bundle Builder for macOS
# This script creates a completely isolated Python environment with all dependencies

set -e  # Exit on any error

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
    local checksum_file="python-bundle/bundle-checksum.txt"
    
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

echo "🔨 Creating Python bundle for macOS..."

# Clean up any existing bundle
echo "🧹 Cleaning up existing bundle..."
rm -rf python-bundle

# Create directory structure
echo "📁 Creating directory structure..."
mkdir -p python-bundle/python-env/lib/python3.9/site-packages

# Install Python packages with pinned versions
echo "📦 Installing Python packages..."
pip3 install \
    --target python-bundle/python-env/lib/python3.9/site-packages \
    --upgrade --force-reinstall \
    -r requirements-bundle.txt

# Install spaCy English model
echo "🔤 Installing spaCy English model..."
pip3 install \
    --target python-bundle/python-env/lib/python3.9/site-packages \
    --upgrade \
    https://github.com/explosion/spacy-models/releases/download/en_core_web_sm-3.8.0/en_core_web_sm-3.8.0-py3-none-any.whl

# Copy Python standard library
echo "📚 Copying Python standard library..."
cp -r /Library/Developer/CommandLineTools/Library/Frameworks/Python3.framework/Versions/3.9/lib/python3.9 \
    python-bundle/python-env/lib/

# Copy websocket servers
echo "🌐 Copying websocket servers..."
if [ -d 'Vosk-Server/websocket' ]; then
    mkdir -p python-bundle/python-env/vosk-server
    cp -r Vosk-Server/websocket/* python-bundle/python-env/vosk-server/
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

# Create the fixed Python wrapper script
echo "🔧 Creating Python wrapper with proper file execution..."
cat > python-bundle/python-env/python3 << 'PYTHON_WRAPPER_EOF'
#!/usr/bin/python3
import sys
import os

# Get the directory containing this script
script_dir = os.path.dirname(os.path.abspath(__file__))
bundle_site_packages = os.path.join(script_dir, "lib", "python3.9", "site-packages")
bundle_stdlib = os.path.join(script_dir, "lib", "python3.9")

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
PYTHON_WRAPPER_EOF

# Make the Python wrapper executable
chmod +x python-bundle/python-env/python3

# Calculate bundle size and create checksum
echo "📊 Calculating bundle checksum..."
BUNDLE_SIZE=$(find python-bundle/python-env -type f -exec wc -c {} + | tail -1 | awk '{print $1}')
echo $BUNDLE_SIZE > python-bundle/bundle-checksum.txt

echo "✅ Python bundle creation completed successfully!"
echo "📦 Bundle size: $BUNDLE_SIZE bytes"
echo "🎯 Bundle location: python-bundle/"
echo ""
echo "🔍 Bundle contents:"
echo "   • Isolated Python 3.9 environment"
echo "   • All required packages (vosk, torch, spacy, kokoro, etc.)"
echo "   • Vosk ASR server"
echo "   • Kokoro TTS server"
echo "   • Fixed Python wrapper for proper script execution"
echo ""
echo "🚀 Ready for distribution!"
