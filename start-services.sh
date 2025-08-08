#!/bin/sh

echo "🚀 =============================================="
echo "🚀 STARTING NebulonGPT INTEGRATED SERVICES"
echo "🚀 =============================================="
echo "🚀 Timestamp: $(date)"
echo "🚀 Container ID: $(hostname)"
echo "🚀 Working Directory: $(pwd)"
echo "🚀 User: $(whoami)"
echo "🚀 =============================================="

# System Information
echo ""
echo "📊 SYSTEM INFORMATION:"
echo "📊 OS: $(uname -a)"
echo "📊 Memory: $(free -h | grep Mem)"
echo "📊 Disk Space: $(df -h /)"
echo "📊 Python Version: $(python --version 2>&1 || echo 'Python not found')"
echo "📊 Node Version: $(node --version 2>&1 || echo 'Node not found')"
echo "📊 Nginx Version: $(nginx -v 2>&1 || echo 'Nginx not found')"

# Directory Structure Check
echo ""
echo "📁 DIRECTORY STRUCTURE CHECK:"
echo "📁 /app exists: $([ -d /app ] && echo 'YES' || echo 'NO')"
echo "📁 /app/vosk-server exists: $([ -d /app/vosk-server ] && echo 'YES' || echo 'NO')"
echo "📁 /app/kokoro-tts exists: $([ -d /app/kokoro-tts ] && echo 'YES' || echo 'NO')"
echo "📁 /app/vosk-server/websocket exists: $([ -d /app/vosk-server/websocket ] && echo 'YES' || echo 'NO')"
echo "📁 /app/kokoro-tts/websocket exists: $([ -d /app/kokoro-tts/websocket ] && echo 'YES' || echo 'NO')"

# File Existence Check
echo ""
echo "📄 CRITICAL FILES CHECK:"
echo "📄 Vosk server script: $([ -f /app/vosk-server/websocket/asr_server_with_models.py ] && echo 'EXISTS' || echo 'MISSING')"
echo "📄 TTS server script: $([ -f /app/kokoro-tts/websocket/browser_tts_server.py ] && echo 'EXISTS' || echo 'MISSING')"
echo "📄 Node.js server: $([ -f /app/server.js ] && echo 'EXISTS' || echo 'MISSING')"
echo "📄 Nginx config: $([ -f /etc/nginx/sites-available/default ] && echo 'EXISTS' || echo 'MISSING')"

# Models Check
echo ""
echo "🤖 MODELS CHECK:"
echo "🤖 Vosk models directory: $([ -d /app/vosk-server/models ] && echo 'EXISTS' || echo 'MISSING')"
if [ -d /app/vosk-server/models ]; then
    echo "🤖 Vosk models found: $(ls -la /app/vosk-server/models/ | wc -l) items"
    echo "🤖 Vosk models list:"
    ls -la /app/vosk-server/models/ | sed 's/^/🤖   /'
fi

echo "🤖 Kokoro cache directory: $([ -d /app/.cache/huggingface ] && echo 'EXISTS' || echo 'MISSING')"
if [ -d /app/.cache/huggingface ]; then
    echo "🤖 Kokoro cache size: $(du -sh /app/.cache/huggingface 2>/dev/null || echo 'Cannot calculate')"
    echo "🤖 Kokoro cache contents:"
    ls -la /app/.cache/huggingface/ 2>/dev/null | sed 's/^/🤖   /' || echo "🤖   Cannot list contents"
fi

# Environment Variables Setup
echo ""
echo "🔧 SETTING UP ENVIRONMENT VARIABLES:"
export PYTHONPATH="/app/vosk-server:/app/kokoro-tts:$PYTHONPATH"
echo "🔧 PYTHONPATH set to: $PYTHONPATH"

export HF_HOME=/app/.cache/huggingface
echo "🔧 HF_HOME set to: $HF_HOME"

export TRANSFORMERS_CACHE=/app/.cache/huggingface/transformers
echo "🔧 TRANSFORMERS_CACHE set to: $TRANSFORMERS_CACHE"

export HF_DATASETS_CACHE=/app/.cache/huggingface/datasets
echo "🔧 HF_DATASETS_CACHE set to: $HF_DATASETS_CACHE"

export HF_HUB_OFFLINE=0
echo "🔧 HF_HUB_OFFLINE set to: $HF_HUB_OFFLINE"

export KOKORO_SERVER_HOST=0.0.0.0
echo "🔧 KOKORO_SERVER_HOST set to: $KOKORO_SERVER_HOST"

export KOKORO_SERVER_PORT=2701
echo "🔧 KOKORO_SERVER_PORT set to: $KOKORO_SERVER_PORT"

export VOSK_MODELS_DIR=/app/vosk-server/models
echo "🔧 VOSK_MODELS_DIR set to: $VOSK_MODELS_DIR"

# Python Dependencies Check
echo ""
echo "🐍 PYTHON DEPENDENCIES CHECK:"
echo "🐍 Checking Vosk dependencies..."
cd /app/vosk-server/websocket
python -c "import vosk; print('✅ Vosk imported successfully')" 2>/dev/null || echo "❌ Vosk import failed"
python -c "import websockets; print('✅ WebSockets imported successfully')" 2>/dev/null || echo "❌ WebSockets import failed"
python -c "import json; print('✅ JSON imported successfully')" 2>/dev/null || echo "❌ JSON import failed"

echo "🐍 Checking TTS dependencies..."
cd /app/kokoro-tts
python -c "import torch; print('✅ PyTorch imported successfully')" 2>/dev/null || echo "❌ PyTorch import failed"
python -c "import soundfile; print('✅ SoundFile imported successfully')" 2>/dev/null || echo "❌ SoundFile import failed"
python -c "import asyncio; print('✅ AsyncIO imported successfully')" 2>/dev/null || echo "❌ AsyncIO import failed"

# Try importing Kokoro TTS specifically
echo "🐍 Checking Kokoro TTS import..."
python -c "
try:
    from kokoro import KPipeline, KModel
    print('✅ Kokoro TTS imported successfully')
except ImportError as e:
    print('❌ Kokoro TTS import failed:', str(e))
except Exception as e:
    print('❌ Kokoro TTS import error:', str(e))
" 2>&1

# Port Availability Check
echo ""
echo "🔌 PORT AVAILABILITY CHECK:"
echo "🔌 Checking if port 2700 (Vosk) is available..."
netstat -ln | grep :2700 && echo "⚠️ Port 2700 already in use" || echo "✅ Port 2700 available"

echo "🔌 Checking if port 2701 (TTS) is available..."
netstat -ln | grep :2701 && echo "⚠️ Port 2701 already in use" || echo "✅ Port 2701 available"

echo "🔌 Checking if port 3001 (Node) is available..."
netstat -ln | grep :3001 && echo "⚠️ Port 3001 already in use" || echo "✅ Port 3001 available"

echo "🔌 Checking if port 80 (Nginx) is available..."
netstat -ln | grep :80 && echo "⚠️ Port 80 already in use" || echo "✅ Port 80 available"

# Start Services
echo ""
echo "🚀 =============================================="
echo "🚀 STARTING SERVICES"
echo "🚀 =============================================="

# Start Vosk server in the background
echo ""
echo "🎤 STARTING VOSK SERVER:"
echo "🎤 Changing to directory: /app/vosk-server/websocket"
cd /app/vosk-server/websocket
echo "🎤 Current directory: $(pwd)"
echo "🎤 Directory contents:"
ls -la | sed 's/^/🎤   /'
echo "🎤 Starting Vosk server with command: python asr_server_with_models.py"
echo "🎤 Vosk server starting at $(date)..."

python asr_server_with_models.py 2>&1 | sed 's/^/[VOSK] /' &
VOSK_PID=$!
echo "🎤 Vosk server started with PID: $VOSK_PID"

# Wait a moment and check if Vosk is still running
sleep 2
if kill -0 $VOSK_PID 2>/dev/null; then
    echo "✅ Vosk server is running (PID: $VOSK_PID)"
else
    echo "❌ Vosk server failed to start or crashed immediately"
fi

# Start Kokoro TTS server in the background
echo ""
echo "🔊 STARTING KOKORO TTS SERVER:"
echo "🔊 Changing to directory: /app/kokoro-tts"
cd /app/kokoro-tts
echo "🔊 Current directory: $(pwd)"
echo "🔊 Directory contents:"
ls -la | sed 's/^/🔊   /'
echo "🔊 WebSocket directory contents:"
ls -la websocket/ | sed 's/^/🔊   /'
echo "🔊 Starting TTS server with command: python websocket/browser_tts_server.py --host $KOKORO_SERVER_HOST --port $KOKORO_SERVER_PORT"
echo "🔊 TTS server starting at $(date)..."
echo "🔊 Host: $KOKORO_SERVER_HOST, Port: $KOKORO_SERVER_PORT"

python websocket/browser_tts_server.py --host $KOKORO_SERVER_HOST --port $KOKORO_SERVER_PORT 2>&1 | sed 's/^/[TTS] /' &
TTS_PID=$!
echo "🔊 TTS server started with PID: $TTS_PID"

# Wait a moment and check if TTS is still running
sleep 3
if kill -0 $TTS_PID 2>/dev/null; then
    echo "✅ TTS server is running (PID: $TTS_PID)"
else
    echo "❌ TTS server failed to start or crashed immediately"
    echo "❌ Checking for TTS server errors..."
    # Try to run TTS server once more to see immediate errors
    echo "❌ Attempting to run TTS server in foreground for error diagnosis..."
    timeout 10s python websocket/browser_tts_server.py --host $KOKORO_SERVER_HOST --port $KOKORO_SERVER_PORT 2>&1 | sed 's/^/[TTS-DEBUG] /' || echo "❌ TTS server debug run failed or timed out"
fi

# Start Node.js server in the background
echo ""
echo "🟢 STARTING NODE.JS SERVER:"
echo "🟢 Changing to directory: /app"
cd /app
echo "🟢 Current directory: $(pwd)"
echo "🟢 Directory contents:"
ls -la | sed 's/^/🟢   /'
echo "🟢 Starting Node.js server with command: node server.js"
echo "🟢 Node.js server starting at $(date)..."

node server.js 2>&1 | sed 's/^/[NODE] /' &
NODE_PID=$!
echo "🟢 Node.js server started with PID: $NODE_PID"

# Wait a moment and check if Node is still running
sleep 2
if kill -0 $NODE_PID 2>/dev/null; then
    echo "✅ Node.js server is running (PID: $NODE_PID)"
else
    echo "❌ Node.js server failed to start or crashed immediately"
fi

# Final Service Status Check
echo ""
echo "📊 FINAL SERVICE STATUS CHECK:"
echo "📊 Timestamp: $(date)"
echo "📊 Vosk Server (PID $VOSK_PID): $(kill -0 $VOSK_PID 2>/dev/null && echo 'RUNNING' || echo 'STOPPED')"
echo "📊 TTS Server (PID $TTS_PID): $(kill -0 $TTS_PID 2>/dev/null && echo 'RUNNING' || echo 'STOPPED')"
echo "📊 Node Server (PID $NODE_PID): $(kill -0 $NODE_PID 2>/dev/null && echo 'RUNNING' || echo 'STOPPED')"

# Port Status Check
echo ""
echo "🔌 FINAL PORT STATUS CHECK:"
sleep 5  # Wait for services to bind to ports
echo "🔌 Port 2700 (Vosk): $(netstat -ln | grep :2700 && echo 'LISTENING' || echo 'NOT LISTENING')"
echo "🔌 Port 2701 (TTS): $(netstat -ln | grep :2701 && echo 'LISTENING' || echo 'NOT LISTENING')"
echo "🔌 Port 3001 (Node): $(netstat -ln | grep :3001 && echo 'LISTENING' || echo 'NOT LISTENING')"

# Start Nginx in the foreground to keep the container running
echo ""
echo "🌐 STARTING NGINX (FOREGROUND):"
echo "🌐 Nginx will start in foreground to keep container alive"
echo "🌐 Nginx config file: /etc/nginx/sites-available/default"
echo "🌐 Nginx config preview:"
head -20 /etc/nginx/sites-available/default | sed 's/^/🌐   /'
echo "🌐 Starting Nginx at $(date)..."
echo "🌐 =============================================="
echo "🌐 ALL SERVICES STARTED - NGINX TAKING OVER"
echo "🌐 =============================================="

nginx -g 'daemon off;'
