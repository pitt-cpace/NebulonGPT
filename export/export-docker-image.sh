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

# Export each volume using the NebulonGPT container (no internet download needed)
echo "  📁 Exporting vosk-models volume..."
docker run --rm -v nebulongpt_vosk-models:/data -v $(pwd)/export/nebulon-gpt-export-temp/nebulon-gpt-volumes:/backup nebulongpt-nebulon-gpt-integrated:latest tar czf /backup/vosk-models.tar.gz -C /data .

echo "  📁 Exporting chat-data volume..."
docker run --rm -v nebulongpt_chat-data:/data -v $(pwd)/export/nebulon-gpt-export-temp/nebulon-gpt-volumes:/backup nebulongpt-nebulon-gpt-integrated:latest tar czf /backup/chat-data.tar.gz -C /data .

echo "  📁 Exporting huggingface-cache volume..."
docker run --rm -v nebulongpt_huggingface-cache:/data -v $(pwd)/export/nebulon-gpt-export-temp/nebulon-gpt-volumes:/backup nebulongpt-nebulon-gpt-integrated:latest tar czf /backup/huggingface-cache.tar.gz -C /data .

echo "📦 Preparing import script and configuration..."
# Copy the import script to the export directory
cp export/import-docker-image.sh export/nebulon-gpt-export-temp/import-docker-image.sh
chmod +x export/nebulon-gpt-export-temp/import-docker-image.sh

# Copy docker-compose.yml if it exists
if [ -f "docker-compose.yml" ]; then
    cp docker-compose.yml export/nebulon-gpt-export-temp/docker-compose.yml
    echo "  ✅ docker-compose.yml included in export package"
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
