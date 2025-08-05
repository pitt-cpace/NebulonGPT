#!/bin/sh

echo "Starting NebulonGPT with Vosk and Kokoro TTS services..."

# Ensure Python path is set correctly
export PYTHONPATH="/app/vosk-server:/app/kokoro-tts:$PYTHONPATH"

# Set Kokoro environment variables
export HF_HOME=/app/.cache/huggingface
export TRANSFORMERS_CACHE=/app/.cache/huggingface/transformers
export HF_DATASETS_CACHE=/app/.cache/huggingface/datasets
export HF_HUB_OFFLINE=0
export KOKORO_SERVER_HOST=0.0.0.0
export KOKORO_SERVER_PORT=2701

# Start Vosk server in the background
cd /app/vosk-server/websocket
python asr_server_with_models.py /app/vosk-server/models &

# Start Kokoro TTS server in the background
cd /app/kokoro-tts
python websocket/browser_tts_server.py --host 0.0.0.0 --port 2701 &

# Start Node.js server in the background
cd /app
node server.js &

# Start Nginx in the foreground to keep the container running
nginx -g 'daemon off;'
