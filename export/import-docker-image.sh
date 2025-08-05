#!/bin/bash

# NebulonGPT Docker Image Import Script
# Import complete Docker image and volumes from export package

set -e

echo "🚀 NebulonGPT Docker Image Import"
echo "================================="

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker and try again."
    exit 1
fi

# Check if we're in an extracted directory or need to extract the ZIP
if [ -f "nebulon-gpt-integrated.tar.gz" ]; then
    echo "📦 Found extracted files in current directory, proceeding with import..."
elif [ -f "nebulon-gpt-complete.zip" ]; then
    echo "📦 Found ZIP package, extracting..."
    unzip -o nebulon-gpt-complete.zip
else
    echo "❌ Neither extracted files nor ZIP package found in current directory."
    echo "Please make sure you have either:"
    echo "  • nebulon-gpt-complete.zip (to extract and import)"
    echo "  • or run this script from the extracted directory"
    exit 1
fi

echo "📦 Loading Docker image..."
if [ -f "nebulon-gpt-integrated.tar.gz" ]; then
    gunzip -c nebulon-gpt-integrated.tar.gz | docker load
    echo "✅ Docker image loaded successfully!"
else
    echo "❌ Docker image file not found. Please make sure you're in the correct directory."
    exit 1
fi

echo "📦 Creating Docker volumes..."
docker volume create nebulongpt_vosk-models
docker volume create nebulongpt_chat-data  
docker volume create nebulongpt_huggingface-cache
echo "✅ Docker volumes created successfully!"

echo "📦 Restoring volume data..."

if [ -f "nebulon-gpt-volumes/vosk-models.tar.gz" ]; then
    echo "  📁 Restoring vosk-models volume..."
    docker run --rm -v nebulongpt_vosk-models:/data -v $(pwd)/nebulon-gpt-volumes:/backup nebulongpt-nebulon-gpt-integrated:latest tar xzf /backup/vosk-models.tar.gz -C /data
    echo "  ✅ Vosk models restored!"
else
    echo "  ⚠️  Vosk models backup not found, skipping..."
fi

if [ -f "nebulon-gpt-volumes/chat-data.tar.gz" ]; then
    echo "  📁 Restoring chat-data volume..."
    docker run --rm -v nebulongpt_chat-data:/data -v $(pwd)/nebulon-gpt-volumes:/backup nebulongpt-nebulon-gpt-integrated:latest tar xzf /backup/chat-data.tar.gz -C /data
    echo "  ✅ Chat data restored!"
else
    echo "  ⚠️  Chat data backup not found, skipping..."
fi

if [ -f "nebulon-gpt-volumes/huggingface-cache.tar.gz" ]; then
    echo "  📁 Restoring huggingface-cache volume..."
    docker run --rm -v nebulongpt_huggingface-cache:/data -v $(pwd)/nebulon-gpt-volumes:/backup nebulongpt-nebulon-gpt-integrated:latest tar xzf /backup/huggingface-cache.tar.gz -C /data
    echo "  ✅ Hugging Face cache restored!"
else
    echo "  ⚠️  Hugging Face cache backup not found, skipping..."
fi

echo "🧹 Cleaning up temporary files..."
rm -f nebulon-gpt-integrated.tar.gz
rm -rf nebulon-gpt-volumes

echo ""
echo "✅ Import completed successfully!"
echo "🎉 NebulonGPT is ready to run!"
echo ""

# Check if docker-compose.yml exists and start automatically
echo "🔍 Checking for docker-compose.yml..."
if [ -f "docker-compose.yml" ]; then
    echo "✅ docker-compose.yml found in current directory"
    
    echo ""
    echo "🔨 Starting NebulonGPT application automatically..."
    docker-compose up -d
    
    echo ""
    echo "⏳ Waiting for services to start..."
    sleep 5
    
    echo "📊 Container Status:"
    docker-compose ps
    
    echo ""
    echo "🎉 NebulonGPT is now running!"
    echo "🌐 Access the application at: http://localhost:3000"
else
    echo "⚠️  docker-compose.yml not found in current directory"
    echo "📋 Please make sure docker-compose.yml is in this directory, then run:"
    echo "   docker-compose up -d"
    echo ""
    echo "🌐 Then access NebulonGPT at: http://localhost:3000"
fi

echo ""
echo "📊 Imported volumes:"
echo "   • Vosk Models: $(docker volume inspect nebulongpt_vosk-models --format '{{.Mountpoint}}' 2>/dev/null || echo 'Volume created')"
echo "   • Chat Data: $(docker volume inspect nebulongpt_chat-data --format '{{.Mountpoint}}' 2>/dev/null || echo 'Volume created')"
echo "   • HuggingFace Cache: $(docker volume inspect nebulongpt_huggingface-cache --format '{{.Mountpoint}}' 2>/dev/null || echo 'Volume created')"
