#!/bin/bash

echo "🚀 Starting Python services for Electron development"

# Function to cleanup background processes
cleanup() {
    echo ""
    echo "🛑 Stopping Python services..."
    if [ ! -z "$VOSK_PID" ]; then
        kill $VOSK_PID 2>/dev/null
        echo "🎤 Stopped Vosk server (PID: $VOSK_PID)"
    fi
    if [ ! -z "$TTS_PID" ]; then
        kill $TTS_PID 2>/dev/null
        echo "🔊 Stopped TTS server (PID: $TTS_PID)"
    fi
    exit 0
}

# Set trap to cleanup on script exit
trap cleanup SIGINT SIGTERM EXIT

# Use bundled Python
PYTHON_EXE="$(pwd)/python-bundle/python-env/python-dist/bin/python3.9"

if [ ! -f "$PYTHON_EXE" ]; then
    echo "❌ Bundled Python not found at: $PYTHON_EXE"
    echo "Please run 'npm run bundle-python' first"
    exit 1
fi

echo "🐍 Using bundled Python: $PYTHON_EXE"

# Start Vosk Server (Speech Recognition) on port 2700
echo "🎤 Starting Vosk server on port 2700..."
cd python-bundle/python-env/vosk-server
# Set VOSK_MODELS_DIR to point to Electron's extracted models location
export VOSK_MODELS_DIR="$HOME/.nebulon-gpt/vosk-models"
$PYTHON_EXE asr_server_with_models.py &
VOSK_PID=$!
echo "🎤 Vosk server started with PID: $VOSK_PID"
cd ../../..

# Wait a moment for Vosk to start
sleep 2

# Start TTS Server (Text-to-Speech) on port 2701
echo "🔊 Starting TTS server on port 2701..."
cd python-bundle/python-env/kokoro-tts
$PYTHON_EXE browser_tts_server.py --host 0.0.0.0 --port 2701 &
TTS_PID=$!
echo "🔊 TTS server started with PID: $TTS_PID"
cd ../../..

echo ""
echo "✅ Python services started successfully!"
echo "📊 Vosk Speech Recognition: ws://0.0.0.0:2700 (PID: $VOSK_PID)"
echo "📊 Kokoro TTS: ws://0.0.0.0:2701 (PID: $TTS_PID)"
echo ""

# Keep script running and wait for services
wait
