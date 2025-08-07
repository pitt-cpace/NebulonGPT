#!/bin/bash

echo "🐳 Starting NebulonGPT with Vosk & Kokoro TTS Servers in Docker..."
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker and try again."
    exit 1
fi

# Check if docker-compose is available
if ! command -v docker-compose &> /dev/null; then
    echo "❌ docker-compose is not installed. Please install docker-compose and try again."
    exit 1
fi

echo "🔧 Building and starting services..."
echo ""

# Build and start all services
docker-compose up --build -d

echo ""
echo "✅ Services started successfully!"
echo ""
echo "📋 Service Status:"
echo "  🌐 NebulonGPT Web UI: http://localhost:3000"
echo "  🎤 Vosk Speech Server: ws://localhost:3000/vosk"
echo "  🎵 Kokoro TTS Server: ws://localhost:3000/tts"
echo ""
echo "📊 To view logs:"
echo "  docker-compose logs -f nebulon-gpt"
echo "  docker-compose logs -f vosk-server"
echo "  docker-compose logs -f kokoro-tts"
echo ""
echo "🛑 To stop services:"
echo "  docker-compose down"
echo ""
echo "🔄 To restart services:"
echo "  docker-compose restart"
echo ""

# Show running containers
echo "🐳 Running containers:"
docker-compose ps
