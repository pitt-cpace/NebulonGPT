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

echo "📦 Exporting Docker image to export directory..."
docker save nebulongpt-nebulon-gpt-integrated:latest | gzip > nebulon-gpt-integrated.tar.gz

echo "📦 Exporting Docker volumes..."
mkdir -p nebulon-gpt-volumes

# Export each volume
echo "  📁 Exporting vosk-models volume..."
docker run --rm -v nebulongpt_vosk-models:/data -v $(pwd)/nebulon-gpt-volumes:/backup alpine tar czf /backup/vosk-models.tar.gz -C /data .

echo "  📁 Exporting chat-data volume..."
docker run --rm -v nebulongpt_chat-data:/data -v $(pwd)/nebulon-gpt-volumes:/backup alpine tar czf /backup/chat-data.tar.gz -C /data .

echo "  📁 Exporting huggingface-cache volume..."
docker run --rm -v nebulongpt_huggingface-cache:/data -v $(pwd)/nebulon-gpt-volumes:/backup alpine tar czf /backup/huggingface-cache.tar.gz -C /data .

echo "📦 Creating complete export package..."
tar czf nebulon-gpt-complete.tar.gz nebulon-gpt-integrated.tar.gz nebulon-gpt-volumes/

# Clean up temporary files
rm nebulon-gpt-integrated.tar.gz
rm -rf nebulon-gpt-volumes

echo "✅ Export completed successfully!"
echo "📁 Complete package saved to: ./nebulon-gpt-complete.tar.gz"
echo "📊 Package size: $(du -sh ./nebulon-gpt-complete.tar.gz | cut -f1)"
echo ""
echo "📋 To import on another machine:"
echo "   1. Extract: tar xzf nebulon-gpt-complete.tar.gz"
echo "   2. Load image: gunzip -c nebulon-gpt-integrated.tar.gz | docker load"
echo "   3. Create volumes:"
echo "      docker volume create nebulongpt_vosk-models"
echo "      docker volume create nebulongpt_chat-data"
echo "      docker volume create nebulongpt_huggingface-cache"
echo "   4. Restore volumes:"
echo "      docker run --rm -v nebulongpt_vosk-models:/data -v \$(pwd)/nebulon-gpt-volumes:/backup alpine tar xzf /backup/vosk-models.tar.gz -C /data"
echo "      docker run --rm -v nebulongpt_chat-data:/data -v \$(pwd)/nebulon-gpt-volumes:/backup alpine tar xzf /backup/chat-data.tar.gz -C /data"
echo "      docker run --rm -v nebulongpt_huggingface-cache:/data -v \$(pwd)/nebulon-gpt-volumes:/backup alpine tar xzf /backup/huggingface-cache.tar.gz -C /data"
echo "   5. Start: docker-compose up -d"
