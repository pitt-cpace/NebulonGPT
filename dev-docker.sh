#!/bin/bash

# NebulonGPT Development Docker Script
# Usage: ./dev-docker.sh [1|2]
# 1 = Quick restart with changes
# 2 = Full clean rebuild (removes everything)

set -e  # Exit on any error

echo "🚀 NebulonGPT Development Docker Script"
echo "======================================"

# Function to check if Docker is running
check_docker() {
    if ! docker info > /dev/null 2>&1; then
        echo "❌ Docker is not running. Please start Docker and try again."
        exit 1
    fi
}

# Function to check if docker-compose is available
check_docker_compose() {
    if ! command -v docker-compose &> /dev/null; then
        echo "❌ docker-compose is not installed. Please install docker-compose and try again."
        exit 1
    fi
}

# Function for quick restart (Option 1)
quick_restart() {
    echo "🔄 Quick Restart - Applying Changes"
    echo "=================================="
    
    echo "📋 Stopping existing containers..."
    docker-compose down
    
    echo "🔨 Rebuilding with changes..."
    docker-compose up --build -d
    
    echo ""
    echo "✅ Quick restart completed!"
    show_status
}

# Function for full clean rebuild (Option 2)
full_clean_rebuild() {
    echo "🧹 Full Clean Rebuild - Nuclear Option"
    echo "====================================="
    echo "⚠️  This will remove ALL Docker data for this project!"
    echo ""
    
    # Ask for confirmation
    read -p "Are you sure you want to proceed? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "❌ Operation cancelled."
        exit 1
    fi
    
    echo ""
    echo "🛑 Stopping all containers..."
    docker-compose down --remove-orphans
    
    echo "🗑️  Removing project containers..."
    docker-compose rm -f
    
    echo "🗑️  Removing project images..."
    docker-compose down --rmi all --volumes --remove-orphans 2>/dev/null || true
    
    echo "🗑️  Removing project volumes..."
    docker volume ls -q | grep "$(basename $(pwd))" | xargs -r docker volume rm 2>/dev/null || true
    
    echo "🗑️  Removing unused Docker resources..."
    docker system prune -f
    
    echo "🗑️  Removing build cache..."
    docker builder prune -f
    
    echo ""
    echo "🔨 Building everything from scratch..."
    docker-compose build --no-cache --pull
    
    echo "🚀 Starting fresh containers..."
    docker-compose up -d
    
    echo ""
    echo "✅ Full clean rebuild completed!"
    show_status
}

# Function to show service status
show_status() {
    echo ""
    echo "📋 Service Status:"
    echo "  🌐 NebulonGPT Web UI: http://localhost:3000"
    echo "  🎤 Vosk Speech Server: ws://localhost:2700"
    echo "  🎵 Kokoro TTS Server: ws://localhost:2701"
    echo ""
    echo "🐳 Running containers:"
    docker-compose ps
    echo ""
    echo "📊 To view logs:"
    echo "  docker-compose logs -f nebulon-gpt"
    echo "  docker-compose logs -f vosk-server"
    echo "  docker-compose logs -f kokoro-tts"
    echo ""
    echo "🛑 To stop services:"
    echo "  docker-compose down"
}

# Function to show usage
show_usage() {
    echo ""
    echo "Usage: ./dev-docker.sh [option]"
    echo ""
    echo "Options:"
    echo "  1    Quick restart - Apply code changes (recommended for development)"
    echo "  2    Full clean rebuild - Remove everything and rebuild from scratch"
    echo ""
    echo "Examples:"
    echo "  ./dev-docker.sh 1    # Quick restart with your changes"
    echo "  ./dev-docker.sh 2    # Nuclear option - clean everything and rebuild"
    echo ""
    echo "💡 Use option 1 for regular development"
    echo "💡 Use option 2 when you have Docker issues or want a fresh start"
}

# Main script logic
main() {
    check_docker
    check_docker_compose
    
    case "${1:-}" in
        "1")
            quick_restart
            ;;
        "2")
            full_clean_rebuild
            ;;
        *)
            echo "❌ Invalid or missing option!"
            show_usage
            exit 1
            ;;
    esac
}

# Run main function with all arguments
main "$@"
