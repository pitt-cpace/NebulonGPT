#!/bin/sh

echo "🚀 Starting NebulonGPT Services"
echo "🚀 Timestamp: $(date)"

# NGINX FIRST
echo "🌐 Starting Nginx..."
nginx &
NGINX_PID=$!
echo "🌐 Nginx started with PID: $NGINX_PID"

# NODE.JS SECOND
echo "🟢 Starting Node.js..."
cd /app
node server.js 2>&1 | sed 's/^/[NODE] /' &
NODE_PID=$!
echo "🟢 Node.js started with PID: $NODE_PID"

# Wait for nginx and node.js
sleep 5

# Environment Variables
export PYTHONPATH="/app/vosk-server:/app/kokoro-tts:$PYTHONPATH"
export HF_HOME=/app/.cache/huggingface
export TRANSFORMERS_CACHE=/app/.cache/huggingface/transformers
export HF_DATASETS_CACHE=/app/.cache/huggingface/datasets
export HF_HUB_OFFLINE=1
export KOKORO_SERVER_HOST=0.0.0.0
export KOKORO_SERVER_PORT=2701
export VOSK_MODELS_DIR=/app/vosk-server/models

# Hugging Face Cache Extraction
echo "📦 Checking Hugging Face cache..."
if [ -d "/app/.cache/huggingface/hub" ] && [ "$(ls -A /app/.cache/huggingface/hub 2>/dev/null)" ]; then
    echo "✅ Hugging Face cache already exists"
else
    echo "📦 Extracting Hugging Face cache..."
    if [ -f "/app/kokoro-tts/huggingface-cache.zip.001" ]; then
        mkdir -p /tmp/hf-extract
        cd /app/kokoro-tts
        cat huggingface-cache.zip.001 huggingface-cache.zip.002 huggingface-cache.zip.003 huggingface-cache.zip.004 > /tmp/huggingface-cache.zip
        cd /tmp/hf-extract
        unzip -o -q /tmp/huggingface-cache.zip
        if [ -d "huggingface-cache" ]; then
            mv huggingface-cache/* /app/.cache/huggingface/
            rmdir huggingface-cache
            echo "✅ Cache extraction completed"
        fi
        rm -rf /tmp/hf-extract /tmp/huggingface-cache.zip
        chown -R root:root /app/.cache/huggingface
        chmod -R 755 /app/.cache/huggingface
    fi
fi

# Start Vosk Server
echo "🎤 Starting Vosk server..."
cd /app/vosk-server/websocket
python asr_server_with_models.py 2>&1 | sed 's/^/[VOSK] /' &
VOSK_PID=$!
echo "🎤 Vosk server started with PID: $VOSK_PID"

# Start TTS Server
echo "🔊 Starting TTS server..."
cd /app/kokoro-tts
python websocket/browser_tts_server.py --host $KOKORO_SERVER_HOST --port $KOKORO_SERVER_PORT 2>&1 | sed 's/^/[TTS] /' &
TTS_PID=$!
echo "🔊 TTS server started with PID: $TTS_PID"

# Final Status
echo ""
echo "📊 Service Status:"
echo "📊 Nginx (PID: $NGINX_PID)"
echo "📊 Node.js (PID: $NODE_PID)"
echo "📊 Vosk (PID: $VOSK_PID)"
echo "📊 TTS (PID: $TTS_PID)"

# Keep container running
echo "🚀 All services started - keeping container alive"
echo ""
echo ""
echo ""
echo ""
wait
