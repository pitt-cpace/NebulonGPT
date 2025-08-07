#!/bin/bash

# NebulonGPT Docker Image Export Script
# Simple export of the integrated Docker image

set -e

echo "🚀 NebulonGPT Docker Image Export"
echo "=================================="

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker and try again."
    exit 1
fi

# Check if the image exists
if ! docker images nebulongpt-nebulon-gpt-integrated:latest | grep -q nebulongpt-nebulon-gpt-integrated; then
    echo "❌ Image 'nebulongpt-nebulon-gpt-integrated:latest' not found."
    echo "Please build the image first by running: ./start.sh"
    exit 1
fi

echo "📦 Creating temporary export directory in export folder..."
mkdir -p export/nebulon-gpt-export-temp

echo "📦 Exporting Docker image..."
docker save nebulongpt-nebulon-gpt-integrated:latest | gzip > export/nebulon-gpt-export-temp/nebulon-gpt-integrated.tar.gz

echo "📦 Exporting Docker volumes..."
mkdir -p export/nebulon-gpt-export-temp/nebulon-gpt-volumes

# Export volumes (vosk models are now embedded in the image, no need to export them)
echo "  📁 Exporting chat-data volume..."
docker run --rm -v nebulongpt_chat-data:/app/data -v $(pwd)/export/nebulon-gpt-export-temp/nebulon-gpt-volumes:/backup nebulongpt-nebulon-gpt-integrated:latest tar czf /backup/chat-data.tar.gz -C /app/data .

echo "  📁 Copying huggingface-cache directory..."
if [ -d "Kokoro-TTS-Server/huggingface-cache" ]; then
    tar czf export/nebulon-gpt-export-temp/nebulon-gpt-volumes/huggingface-cache.tar.gz -C Kokoro-TTS-Server/huggingface-cache .
else
    echo "  ⚠️  Kokoro-TTS-Server/huggingface-cache directory not found, skipping..."
fi

echo "📦 Preparing import script and configuration..."
# Copy the import script to the export directory
cp export/import-docker-image.sh export/nebulon-gpt-export-temp/import-docker-image.sh
chmod +x export/nebulon-gpt-export-temp/import-docker-image.sh

# Create a modified docker-compose.yml for import (without build context)
if [ -f "docker-compose.yml" ]; then
    echo "  📝 Creating import-ready docker-compose.yml..."
    cat > export/nebulon-gpt-export-temp/docker-compose.yml << 'EOF'
version: '3.8'

services:
  nebulon-gpt-integrated:
    image: nebulongpt-nebulon-gpt-integrated:latest
    container_name: nebulon-gpt-integrated
    ports:
      - "3000:80"
    restart: unless-stopped
    networks:
      - ollama-network
    volumes:
      - chat-data:/app/data
      - ./Kokoro-TTS-Server/huggingface-cache:/app/.cache/huggingface
    environment:
      - NODE_ENV=production
      # Frontend build-time environment variables
      - REACT_APP_OLLAMA_API_URL=http://host.docker.internal:11434
      - REACT_APP_VOSK_SERVER_URL=ws://localhost:3000/vosk
      - REACT_APP_TTS_SERVER_URL=ws://localhost:3000/tts
      # Python services environment variables
      - PYTHONUNBUFFERED=1
      - HF_HOME=/app/.cache/huggingface
      - TRANSFORMERS_CACHE=/app/.cache/huggingface/transformers
      - HF_DATASETS_CACHE=/app/.cache/huggingface/datasets
      - HF_HUB_OFFLINE=0
      - KOKORO_SERVER_HOST=0.0.0.0
      - KOKORO_SERVER_PORT=2701

networks:
  ollama-network:
    driver: bridge

volumes:
  chat-data:
    driver: local
EOF
    echo "  ✅ Import-ready docker-compose.yml created"
else
    echo "  ⚠️  docker-compose.yml not found, skipping..."
fi

echo "📦 Creating complete export ZIP package..."
cd export/nebulon-gpt-export-temp
if [ -f "docker-compose.yml" ]; then
    zip -r ../nebulon-gpt-complete.zip nebulon-gpt-integrated.tar.gz nebulon-gpt-volumes/ import-docker-image.sh docker-compose.yml
else
    zip -r ../nebulon-gpt-complete.zip nebulon-gpt-integrated.tar.gz nebulon-gpt-volumes/ import-docker-image.sh
fi
cd ../..

# Clean up temporary directory
rm -rf export/nebulon-gpt-export-temp

echo "✅ Export completed successfully!"
echo "📁 Complete package saved to: ./export/nebulon-gpt-complete.zip"
echo "📊 Package size: $(du -sh ./export/nebulon-gpt-complete.zip | cut -f1)"
echo ""
echo "📋 To import on another machine:"
echo "   1. Extract the ZIP package: unzip nebulon-gpt-complete.zip"
echo "   2. Run the import script: ./import-docker-image.sh"
echo "   3. The script will automatically:"
echo "      • Load the Docker image"
echo "      • Create and restore all volumes"
echo "      • Check for docker-compose.yml"
echo "      • Optionally start NebulonGPT"
echo ""
echo "🎉 That's it! The import script handles everything automatically."
