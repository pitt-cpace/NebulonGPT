#!/bin/bash

# Start Queue TTS Server Script
# This script starts the Kokoro TTS server with queue management capabilities

echo "🎵 Starting Kokoro Queue TTS Server..."
echo "📋 Features: Pause, Resume, Skip, Queue Management"

# Check if Python is available
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: Python 3 is not installed or not in PATH"
    exit 1
fi

# Check if we're in the right directory
if [ ! -f "websocket/queue_tts_server.py" ]; then
    echo "❌ Error: queue_tts_server.py not found. Please run this script from the Kokoro-TTS-Server directory."
    exit 1
fi

# Default values
HOST="localhost"
PORT=2702
DEVICE="cpu"
LANGUAGE="a"

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --host)
            HOST="$2"
            shift 2
            ;;
        --port)
            PORT="$2"
            shift 2
            ;;
        --device)
            DEVICE="$2"
            shift 2
            ;;
        --language)
            LANGUAGE="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --host HOST        Host to bind to (default: localhost)"
            echo "  --port PORT        Port to bind to (default: 2702)"
            echo "  --device DEVICE    Device to use: cpu or cuda (default: cpu)"
            echo "  --language LANG    Language code (default: a)"
            echo "  --help, -h         Show this help message"
            echo ""
            echo "Queue Commands (via client):"
            echo "  add <text>         Add text to queue"
            echo "  play               Start/resume playback"
            echo "  pause              Pause playback"
            echo "  stop               Stop and clear queue"
            echo "  skip               Skip current item"
            echo "  skip_to <id>       Skip to specific item"
            echo "  remove <id>        Remove item from queue"
            echo "  status             Show queue status"
            echo "  clear              Clear completed items"
            exit 0
            ;;
        *)
            echo "❌ Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

echo "🔧 Configuration:"
echo "   Host: $HOST"
echo "   Port: $PORT"
echo "   Device: $DEVICE"
echo "   Language: $LANGUAGE"
echo ""

# Check if port is already in use
if command -v lsof &> /dev/null; then
    if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null ; then
        echo "⚠️  Warning: Port $PORT is already in use"
        echo "   You may need to stop the existing service first"
        echo ""
    fi
fi

echo "🚀 Starting Queue TTS Server..."
echo "📡 Server will be available at: ws://$HOST:$PORT"
echo "🎮 Use queue_test_client.py to interact with the server"
echo "⏹️  Press Ctrl+C to stop the server"
echo ""

# Start the server
python3 websocket/queue_tts_server.py \
    --host "$HOST" \
    --port "$PORT" \
    --device "$DEVICE" \
    --language "$LANGUAGE"

echo ""
echo "🛑 Queue TTS Server stopped"
