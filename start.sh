#!/bin/bash

echo "🚀 Building NebulonGPT Container..."
echo "===================================="

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Check if docker-compose is available
if ! command -v docker-compose &> /dev/null; then
    echo "❌ docker-compose is not installed. Please install docker-compose first."
    exit 1
fi

echo "✅ Docker and docker-compose are available"

# Stop any existing containers
echo "🛑 Stopping existing containers..."
docker-compose down

# Remove old images (optional - uncomment if you want to force rebuild)
# echo "🗑️  Removing old images..."
# docker-compose down --rmi all

# Build and start the container
echo "🔨 Building container..."
docker-compose up --build -d

# Wait a moment for services to start
echo "⏳ Waiting for services to start..."
sleep 10

# Check container status
echo "📊 Container Status:"
docker-compose ps

# Check if container is running
echo "🔍 Checking container status..."
docker exec nebulon-gpt-integrated ps aux | grep -E "(node|python|nginx)" | grep -v grep || echo "Services starting..."

# Show recent logs
echo "📝 Recent logs:"
docker-compose logs --tail=20

echo ""
echo "🎉 Build complete!"
echo "================================================"
echo "🌐 Web Interface: http://localhost:3000"
echo "🎤 Vosk ASR Server: ws://localhost:3000/vosk"
echo "🔊 Kokoro TTS Server: ws://localhost:3000/tts"
echo ""
echo "📋 Useful commands:"
echo "  View logs: docker-compose logs -f"
echo "  Stop services: docker-compose down"
echo "  Restart services: docker-compose restart"
echo "  Check processes: docker exec nebulon-gpt-integrated ps aux"
echo ""
echo "📖 For more information, see INTEGRATED_SETUP.md"
