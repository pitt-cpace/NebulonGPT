#!/bin/bash

# Kokoro TTS Browser Server Startup Script

echo "🌐 Starting Kokoro TTS Browser Server..."
echo "=================================="

# Check if we're in the right directory
if [ ! -f "websocket/browser_tts_server.py" ]; then
    echo "❌ Error: browser_tts_server.py not found!"
    echo "Please run this script from the Kokoro-TTS-Server directory"
    exit 1
fi

# Check if Python 3 is available
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: Python 3 is not installed or not in PATH"
    exit 1
fi

# Check if required Python packages are installed
echo "🔍 Checking dependencies..."
python3 -c "import websockets, asyncio, json, base64, logging, re, time, pathlib" 2>/dev/null
if [ $? -ne 0 ]; then
    echo "❌ Error: Missing required Python packages"
    echo "Please install dependencies with: pip install -r requirements.txt"
    exit 1
fi

# Check if kokoro_api.py exists
if [ ! -f "kokoro_api.py" ]; then
    echo "❌ Error: kokoro_api.py not found!"
    echo "Please make sure Kokoro TTS is properly installed"
    exit 1
fi

# Set default port
PORT=${KOKORO_BROWSER_PORT:-2702}
HOST=${KOKORO_BROWSER_HOST:-localhost}

echo "✅ Dependencies check passed"
echo "🚀 Starting server on $HOST:$PORT"
echo ""
echo "📱 Browser Test Page: file://$(pwd)/websocket/browser_test.html"
echo "🌐 WebSocket URL: ws://$HOST:$PORT"
echo ""
echo "Press Ctrl+C to stop the server"
echo ""

# Start the browser server
KOKORO_BROWSER_PORT=$PORT KOKORO_BROWSER_HOST=$HOST python3 websocket/browser_tts_server.py --host $HOST --port $PORT
