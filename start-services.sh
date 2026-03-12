#!/bin/sh

echo "Starting NebulonGPT"
echo "Timestamp: $(date)"

# ============================================================================
# RUNTIME CONFIGURATION - Process Nginx Config from Template
# ============================================================================

# Set default Ollama URL if not provided
export OLLAMA_URL="${OLLAMA_URL:-http://host.docker.internal:11434}"

echo "Configuring Ollama URL: $OLLAMA_URL"

# Render nginx config from template (replaces all environment variables)
TEMPLATE="/etc/nginx/templates/nginx.conf.template"
OUT="/etc/nginx/conf.d/default.conf"

if [ -f "$TEMPLATE" ]; then
    echo "Rendering nginx config from template..."
    
    # Get all the vars with ${VAR} formatting
    VARS="$(grep -oE '\$\{[A-Za-z_][A-Za-z0-9_]*\}' "$TEMPLATE" | sort -u | tr '\n' ' ')"
    envsubst "$VARS" < "$TEMPLATE" > "$OUT"
    
    # Conditionally add custom header if environment variables are provided
    if [ -n "$OLLAMA_CUSTOM_HEADER_NAME" ] && [ -n "$OLLAMA_CUSTOM_HEADER_VALUE" ]; then
        echo "Custom header configured: $OLLAMA_CUSTOM_HEADER_NAME"
        # Use sed to replace the placeholder with the actual header directive
        sed -i "s|# __CUSTOM_HEADER_PLACEHOLDER__|proxy_set_header $OLLAMA_CUSTOM_HEADER_NAME \"$OLLAMA_CUSTOM_HEADER_VALUE\";|g" "$OUT"
    else
        echo "No custom header configured (optional)"
        # Remove the placeholder line
        sed -i "s|        # __CUSTOM_HEADER_PLACEHOLDER__||g" "$OUT"
    fi
    
    echo "Nginx configuration rendered successfully"
else
    echo "ERROR: Nginx template not found at $TEMPLATE"
    exit 1
fi

# Start NGINX with the updated config
echo "Starting Nginx..."
nginx &
NGINX_PID=$!
echo "Nginx started with PID: $NGINX_PID"

# Set environment variables for unified backend
export PYTHONPATH="/app:$PYTHONPATH"
export HF_HOME=/app/.cache/huggingface
export TRANSFORMERS_CACHE=/app/.cache/huggingface/transformers
export HF_DATASETS_CACHE=/app/.cache/huggingface/datasets
export HF_HUB_OFFLINE=1
export VOSK_MODELS_DIR=/app/backend/models/vosk
export DATA_DIR=./data
export REST_API_PORT=3001
export HTTPS_PORT=3443

# Hugging Face Cache Extraction (one-time setup)
if [ -f "/app/kokoro-cache/huggingface-cache.zip.001" ] && [ ! -f "/app/.cache/huggingface/.extracted" ]; then
    echo "Extracting Hugging Face cache..."
    mkdir -p /tmp/hf-extract
    cd /app/kokoro-cache
    cat huggingface-cache.zip.001 huggingface-cache.zip.002 huggingface-cache.zip.003 huggingface-cache.zip.004 > /tmp/huggingface-cache.zip
    cd /tmp/hf-extract
    unzip -o -q /tmp/huggingface-cache.zip
    if [ -d "huggingface-cache" ]; then
        mv huggingface-cache/* /app/.cache/huggingface/
        rmdir huggingface-cache
        touch /app/.cache/huggingface/.extracted
        echo "Cache extraction completed"
    fi
    rm -rf /tmp/hf-extract /tmp/huggingface-cache.zip
    chown -R root:root /app/.cache/huggingface
    chmod -R 755 /app/.cache/huggingface
fi

# Vosk Models Extraction (one-time setup)
if [ -d "/app/vosk-models-source" ] && [ ! -f "/app/backend/models/vosk/.extracted" ]; then
    echo "Extracting Vosk models..."
    cd /app/vosk-models-source
    
    # Step 1: Concatenate all split zip files into single zip files
    base_names=$(ls *.zip.* 2>/dev/null | sed 's/\.zip\..*$//' | sort -u)
    for base_name in $base_names; do
        if [ -n "$base_name" ]; then
            echo "Concatenating split archive: $base_name"
            parts=$(ls "${base_name}.zip."* 2>/dev/null | sort -V)
            if [ -n "$parts" ]; then
                cat $parts > "${base_name}.zip"
                echo "Created: ${base_name}.zip"
            fi
        fi
    done
    
    # Step 2: Extract all zip files (both original and newly concatenated)
    for zipfile in *.zip; do
        if [ -f "$zipfile" ]; then
            case "$zipfile" in
                *.zip.*)
                    # Skip split file parts
                    ;;
                *)
                    echo "Extracting: $zipfile"
                    unzip -o -q "$zipfile" -d /app/backend/models/vosk
                    ;;
            esac
        fi
    done
    
    # Step 3: Mark extraction as complete
    touch /app/backend/models/vosk/.extracted
    
    echo "Vosk models extraction completed"
fi

# Start Unified FastAPI Backend (REST API + Vosk WebSocket + TTS WebSocket)
echo "Starting Unified FastAPI Backend..."
echo "Port: 3001"
echo "Endpoints: REST API + /vosk WebSocket + /tts WebSocket"
cd /app
python -m uvicorn backend.main:app --host 0.0.0.0 --port 3001 --log-level info 2>&1 | sed 's/^/[BACKEND] /' &
BACKEND_PID=$!
echo "Backend started with PID: $BACKEND_PID"

# Wait for backend to initialize
sleep 5

# Final Status
echo ""
echo "============================================"
echo "SERVICE STATUS"
echo "============================================"
echo "Nginx (PID: $NGINX_PID)"
echo "  - Frontend serving: /"
echo "  - Reverse proxy: /api/*, /vosk, /tts"
echo "Unified FastAPI Backend (PID: $BACKEND_PID)"
echo "  - REST API: /api/chats, /api/vosk/*, /api/network-info"
echo "  - Vosk WebSocket: /vosk"
echo "  - TTS WebSocket: /tts"
echo "============================================"
echo ""
echo "All services started successfully!"
echo "Application ready at http://localhost"
echo ""

# Keep container running and monitor processes
wait
