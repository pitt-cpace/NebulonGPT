#!/bin/bash

# Kokoro TTS Server Startup Script
# Similar to the Vosk server startup scripts

set -e

# Default values
LANGUAGE="a"
PORT="2701"
DEVICE="cpu"
INTERFACE="0.0.0.0"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -l|--language)
            LANGUAGE="$2"
            shift 2
            ;;
        -p|--port)
            PORT="$2"
            shift 2
            ;;
        -d|--device)
            DEVICE="$2"
            shift 2
            ;;
        -i|--interface)
            INTERFACE="$2"
            shift 2
            ;;
        -h|--help)
            echo "Kokoro TTS Server Startup Script"
            echo ""
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  -l, --language LANG    Language code (default: a)"
            echo "                         a=American English, b=British English"
            echo "                         e=Spanish, f=French, h=Hindi, i=Italian"
            echo "                         j=Japanese, p=Portuguese, z=Chinese"
            echo "  -p, --port PORT        Server port (default: 2701)"
            echo "  -d, --device DEVICE    Processing device (default: cpu)"
            echo "                         Options: cpu, cuda, mps"
            echo "  -i, --interface ADDR   Server interface (default: 0.0.0.0)"
            echo "  -h, --help             Show this help message"
            echo ""
            echo "Examples:"
            echo "  $0                     # Start with defaults"
            echo "  $0 -l e -p 3000        # Spanish on port 3000"
            echo "  $0 -d cuda             # Use GPU acceleration"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use -h or --help for usage information"
            exit 1
            ;;
    esac
done

# Set environment variables
export KOKORO_SERVER_INTERFACE="$INTERFACE"
export KOKORO_SERVER_PORT="$PORT"
export KOKORO_DEVICE="$DEVICE"
export KOKORO_DEFAULT_LANGUAGE="$LANGUAGE"

# Language descriptions
case $LANGUAGE in
    a) LANG_DESC="American English" ;;
    b) LANG_DESC="British English" ;;
    e) LANG_DESC="Spanish" ;;
    f) LANG_DESC="French" ;;
    h) LANG_DESC="Hindi" ;;
    i) LANG_DESC="Italian" ;;
    j) LANG_DESC="Japanese" ;;
    p) LANG_DESC="Portuguese" ;;
    z) LANG_DESC="Chinese" ;;
    *) LANG_DESC="Unknown ($LANGUAGE)" ;;
esac

echo "🎤 Starting Kokoro TTS Server..."
echo "📍 Interface: $INTERFACE"
echo "🔌 Port: $PORT"
echo "🌍 Language: $LANG_DESC ($LANGUAGE)"
echo "💻 Device: $DEVICE"
echo ""

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: python3 is not installed or not in PATH"
    exit 1
fi

# Check if required packages are installed
echo "🔍 Checking dependencies..."
python3 -c "import kokoro, websockets, torch, soundfile" 2>/dev/null || {
    echo "❌ Error: Missing required packages. Please run:"
    echo "   pip install -r requirements.txt"
    exit 1
}

# Additional language-specific checks
if [[ "$LANGUAGE" == "j" ]]; then
    python3 -c "import misaki" 2>/dev/null || {
        echo "⚠️  Warning: For Japanese support, install: pip install misaki[ja]"
    }
elif [[ "$LANGUAGE" == "z" ]]; then
    python3 -c "import misaki" 2>/dev/null || {
        echo "⚠️  Warning: For Chinese support, install: pip install misaki[zh]"
    }
fi

echo "✅ Dependencies check passed"
echo ""

# Change to the script directory
cd "$(dirname "$0")"

# Start the server
echo "🚀 Starting server..."
echo "   WebSocket URL: ws://$INTERFACE:$PORT"
echo "   Press Ctrl+C to stop"
echo ""

# Run the server with the specified language
python3 websocket/tts_server.py "$LANGUAGE"
