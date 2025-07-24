#!/bin/bash

# Cross-platform startup script for NebulonGPT
# Works on Mac, Windows (PowerShell/Git Bash), and Linux

echo "🚀 Starting NebulonGPT with Vosk Server..."
echo "=========================================="
echo ""

# Check if Docker is installed and running
echo "🔍 Checking Docker..."
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running or not installed."
    echo ""
    echo "Please ensure Docker is installed and running:"
    echo "  • macOS: Open Docker Desktop from Applications"
    echo "  • Windows: Open Docker Desktop from Start Menu"
    echo "  • Linux: Run 'sudo systemctl start docker'"
    echo ""
    echo "Download Docker: https://www.docker.com/products/docker-desktop/"
    exit 1
fi
echo "✅ Docker is running"

# Check Docker Compose availability
echo "🔍 Checking Docker Compose..."
if docker compose version > /dev/null 2>&1; then
    COMPOSE_CMD="docker compose"
    echo "✅ Using 'docker compose' (newer version)"
elif command -v docker-compose > /dev/null 2>&1; then
    COMPOSE_CMD="docker-compose"
    echo "✅ Using 'docker-compose' (legacy version)"
else
    echo "❌ Docker Compose not found. Please install Docker Compose."
    echo "Visit: https://docs.docker.com/compose/install/"
    exit 1
fi

echo ""
echo "🔧 Building and starting services..."
echo "This may take a few minutes on first run..."
echo ""

# Build and start all services
$COMPOSE_CMD up --build -d

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Services started successfully!"
    echo ""
    echo "📋 Service Status:"
    echo "  🌐 NebulonGPT Web UI: http://localhost:3000"
    echo "  🎤 Vosk Speech Server: ws://localhost:2700"
    echo ""
    echo "📊 To view logs:"
    echo "  $COMPOSE_CMD logs -f nebulon-gpt"
    echo "  $COMPOSE_CMD logs -f vosk-server"
    echo ""
    echo "🛑 To stop services:"
    echo "  $COMPOSE_CMD down"
    echo ""
    echo "🔄 To restart services:"
    echo "  $COMPOSE_CMD restart"
    echo ""
    
    # Show running containers
    echo "🐳 Running containers:"
    $COMPOSE_CMD ps
    
    echo ""
    echo "🎉 Setup complete! Open http://localhost:3000 in your browser"
else
    echo ""
    echo "❌ Failed to start services. Check the logs above for errors."
    echo "🔍 For troubleshooting, run: $COMPOSE_CMD logs"
    exit 1
fi
