#!/bin/bash

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "Docker is not installed. Please install Docker first."
    echo "Visit: https://www.docker.com/products/docker-desktop/"
    exit 1
fi

# Check if Ollama is running
if ! curl -s http://localhost:11434/api/tags &> /dev/null; then
    echo "Ollama doesn't seem to be running on port 11434."
    echo "Please start Ollama with 'ollama serve' before running this application."
    exit 1
fi

# Auto-extract Vosk model if it exists and hasn't been extracted yet
VOSK_ZIP_FILE="Vosk-Server/websocket/models/vosk-model-small-en-us-0.15.zip"
VOSK_MODELS_DIR="Vosk-Server/websocket/models"
VOSK_EXTRACTED_DIR="$VOSK_MODELS_DIR/vosk-model-small-en-us-0.15"

if [ -f "$VOSK_ZIP_FILE" ] && [ ! -d "$VOSK_EXTRACTED_DIR" ]; then
    echo "Found Vosk model zip file. Extracting to docker volume path..."
    
    # Extract the zip file
    if command -v unzip &> /dev/null; then
        echo "Extracting $VOSK_ZIP_FILE to $VOSK_MODELS_DIR..."
        unzip -q "$VOSK_ZIP_FILE" -d "$VOSK_MODELS_DIR"
        if [ $? -eq 0 ]; then
            echo "✓ Vosk model extracted successfully to $VOSK_EXTRACTED_DIR"
        else
            echo "✗ Failed to extract Vosk model"
        fi
    else
        echo "Warning: 'unzip' command not found. Please install unzip or extract the model manually."
        echo "You can extract $VOSK_ZIP_FILE to $VOSK_MODELS_DIR manually."
    fi
elif [ -d "$VOSK_EXTRACTED_DIR" ]; then
    echo "✓ Vosk model already extracted at $VOSK_EXTRACTED_DIR"
elif [ ! -f "$VOSK_ZIP_FILE" ]; then
    echo "ℹ Vosk model zip file not found at $VOSK_ZIP_FILE"
    echo "  You can download models from: https://alphacephei.com/vosk/models"
fi

# Try to use docker compose (newer Docker versions)
if docker compose version &> /dev/null; then
    echo "Starting Nebulon-GPT with docker compose..."
    docker compose up --build -d
# Fall back to docker-compose if available
elif command -v docker-compose &> /dev/null; then
    echo "Starting Nebulon-GPT with docker-compose..."
    docker-compose up -d
# If neither is available, use plain docker commands
else
    echo "Docker Compose not found. Using plain Docker commands..."
    
    # Build the image
    echo "Building Docker image..."
    docker build -t nebulon-gpt .
    
    # Run the container
    echo "Starting container..."
    docker run -d --name nebulon-gpt \
        -p 3000:80 \
        --add-host=host.docker.internal:host-gateway \
        -v "$(pwd)/nginx.conf:/etc/nginx/http.d/default.conf" \
        -e NODE_ENV=production \
        -e REACT_APP_OLLAMA_API_URL=http://host.docker.internal:11434 \
        nebulon-gpt
fi

# Wait for the container to start
sleep 3

# Check if the container is running
if docker ps | grep -q nebulon-gpt; then
    echo "Nebulon-GPT is now running!"
    echo "Open your browser and navigate to: http://localhost:3000"
else
    echo "Failed to start Nebulon-GPT. Please check the logs with 'docker logs nebulon-gpt'."
    exit 1
fi
