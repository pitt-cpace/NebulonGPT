#!/bin/bash

echo "Starting FastAPI Backend for Electron development"

# Function to cleanup background processes
cleanup() {
    echo ""
    echo "Stopping FastAPI backend..."
    if [ ! -z "$BACKEND_PID" ]; then
        kill $BACKEND_PID 2>/dev/null
        echo "Stopped backend server (PID: $BACKEND_PID)"
    fi
    exit 0
}

# Set trap to cleanup on script exit
trap cleanup SIGINT SIGTERM EXIT

# Use bundled Python
PYTHON_EXE="$(pwd)/python-bundle/python-env/python-dist/bin/python3"

if [ ! -f "$PYTHON_EXE" ]; then
    echo "Bundled Python not found at: $PYTHON_EXE"
    echo "Please run 'npm run bundle-python' first"
    exit 1
fi

echo "🐍 Using bundled Python: $PYTHON_EXE"

# Set environment variables for the backend
export VOSK_MODELS_DIR="$(pwd)/python-bundle/python-env/backend/models/vosk"
export HF_HOME="$(pwd)/python-bundle/python-env/backend/models/kokoro/huggingface-cache"
export DATA_DIR="$(pwd)/data"
export REST_API_PORT=3001

echo "VOSK_MODELS_DIR: $VOSK_MODELS_DIR"
echo "HF_HOME: $HF_HOME"
echo "DATA_DIR: $DATA_DIR"

# Start FastAPI backend (unified REST API + WebSocket endpoints)
echo "Starting FastAPI backend on port $REST_API_PORT..."
cd python-bundle/python-env/backend
$PYTHON_EXE -m uvicorn main:app --host 0.0.0.0 --port $REST_API_PORT &
BACKEND_PID=$!
echo "Backend started with PID: $BACKEND_PID"
cd ../../..

echo ""
echo "FastAPI backend started successfully!"
echo "REST API: http://0.0.0.0:$REST_API_PORT"
echo "Vosk WebSocket: ws://0.0.0.0:$REST_API_PORT/vosk"
echo "TTS WebSocket: ws://0.0.0.0:$REST_API_PORT/tts"
echo ""

# Keep script running and wait for backend
wait
