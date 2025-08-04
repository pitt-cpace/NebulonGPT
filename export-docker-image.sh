#!/bin/bash

# NebulonGPT Docker Image Export Script
# This script exports all containers, images, and volumes into a single distributable file

set -e

echo "🚀 NebulonGPT Docker Image Export"
echo "=================================="

# Configuration
EXPORT_DIR="nebulongpt-export"
EXPORT_FILE="nebulongpt-complete.tar.gz"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
EXPORT_FILE_TIMESTAMPED="nebulongpt-complete-${TIMESTAMP}.tar.gz"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    print_error "Docker is not running. Please start Docker and try again."
    exit 1
fi

# Check if services are running
print_status "Checking if NebulonGPT services are running..."
if ! docker compose ps | grep -q "Up"; then
    print_warning "Services are not running. Starting them first..."
    ./start.sh
    sleep 10
fi

# Create export directory
print_status "Creating export directory..."
rm -rf "$EXPORT_DIR"
mkdir -p "$EXPORT_DIR"

# Export Docker images
print_status "Exporting Docker images..."
docker save \
    nebulongpt-nebulon-gpt:latest \
    nebulongpt-vosk-server:latest \
    nebulongpt-kokoro-tts:latest \
    -o "$EXPORT_DIR/nebulongpt-images.tar"

print_success "Docker images exported to $EXPORT_DIR/nebulongpt-images.tar"

# Export volumes
print_status "Exporting Docker volumes..."

# Create temporary containers to export volume data
print_status "Exporting chat-data volume..."
docker run --rm -v nebulongpt_chat-data:/data -v "$(pwd)/$EXPORT_DIR":/backup alpine tar czf /backup/chat-data.tar.gz -C /data .

print_status "Exporting vosk-models volume..."
docker run --rm -v nebulongpt_vosk-models:/data -v "$(pwd)/$EXPORT_DIR":/backup alpine tar czf /backup/vosk-models.tar.gz -C /data .

print_success "Volumes exported successfully"

# Copy configuration files
print_status "Copying configuration files..."
cp docker-compose.yml "$EXPORT_DIR/"
cp start.sh "$EXPORT_DIR/"
cp nginx.conf "$EXPORT_DIR/"

# Copy source code and build files
print_status "Copying source code..."
cp -r src "$EXPORT_DIR/"
cp -r public "$EXPORT_DIR/"
cp package.json "$EXPORT_DIR/"
cp package-lock.json "$EXPORT_DIR/"
cp tsconfig.json "$EXPORT_DIR/"
cp Dockerfile "$EXPORT_DIR/"
cp server.js "$EXPORT_DIR/"
cp start-services.sh "$EXPORT_DIR/"

# Copy Vosk server files
print_status "Copying Vosk server files..."
cp -r Vosk-Server "$EXPORT_DIR/"

# Copy Kokoro TTS server files
print_status "Copying Kokoro TTS server files..."
cp -r Kokoro-TTS-Server "$EXPORT_DIR/"

# Create import script
print_status "Creating import script..."
cat > "$EXPORT_DIR/import-and-run.sh" << 'EOF'
#!/bin/bash

# NebulonGPT Docker Image Import and Run Script
# This script imports and runs the complete NebulonGPT system

set -e

echo "🚀 NebulonGPT Docker Image Import and Run"
echo "========================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
    print_error "Docker is not running. Please start Docker and try again."
    exit 1
fi

# Check if Docker Compose is available
if ! command -v docker compose >/dev/null 2>&1; then
    print_error "Docker Compose is not available. Please install Docker Compose."
    exit 1
fi

print_status "Importing Docker images..."
if [ -f "nebulongpt-images.tar" ]; then
    docker load -i nebulongpt-images.tar
    print_success "Docker images imported successfully"
else
    print_error "nebulongpt-images.tar not found!"
    exit 1
fi

print_status "Creating Docker volumes..."
docker volume create nebulongpt_chat-data 2>/dev/null || true
docker volume create nebulongpt_vosk-models 2>/dev/null || true

print_status "Importing volume data..."

# Cross-platform path handling for Docker volume mounting
get_docker_path() {
    local current_path="$(pwd)"
    local docker_path=""
    
    # Detect operating system
    if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]; then
        # Windows (Git Bash, MSYS2, Cygwin)
        if [[ "$current_path" =~ ^/[a-zA-Z]/ ]]; then
            # Already in Unix-style format (/c/Users/...)
            docker_path="$current_path"
        elif [[ "$current_path" =~ ^[A-Za-z]: ]]; then
            # Windows format (C:\Users\...), convert to Unix format
            drive_letter="${current_path:0:1}"
            path_without_drive="${current_path:2}"
            docker_path="/${drive_letter,,}${path_without_drive//\\//}"
        else
            docker_path="$current_path"
        fi
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        # macOS
        docker_path="$current_path"
    elif [[ "$OSTYPE" == "linux-gnu"* ]] || [[ "$OSTYPE" == "linux"* ]]; then
        # Linux
        docker_path="$current_path"
    else
        # Other Unix-like systems (FreeBSD, etc.)
        docker_path="$current_path"
    fi
    
    # Additional Windows detection for cases where OSTYPE isn't set correctly
    if [[ -z "$docker_path" ]] || [[ "$docker_path" == "$current_path" ]]; then
        if command -v cmd.exe >/dev/null 2>&1; then
            if [[ "$current_path" =~ ^[A-Za-z]: ]]; then
                drive_letter="${current_path:0:1}"
                path_without_drive="${current_path:2}"
                docker_path="/${drive_letter,,}${path_without_drive//\\//}"
            elif [[ ! "$current_path" =~ ^/ ]]; then
                # Relative path on Windows, make it absolute
                docker_path="$(pwd)"
            fi
        fi
    fi
    
    # Fallback: use current path as-is
    if [[ -z "$docker_path" ]]; then
        docker_path="$current_path"
    fi
    
    echo "$docker_path"
}

# Detect and display environment info
if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "cygwin" ]] || [[ "$OSTYPE" == "win32" ]]; then
    print_status "Detected Windows environment: $OSTYPE"
elif [[ "$OSTYPE" == "darwin"* ]]; then
    print_status "Detected macOS environment"
elif [[ "$OSTYPE" == "linux-gnu"* ]] || [[ "$OSTYPE" == "linux"* ]]; then
    print_status "Detected Linux environment"
elif command -v cmd.exe >/dev/null 2>&1; then
    print_status "Detected Windows via cmd.exe presence"
else
    print_status "Detected Unix-like environment: $OSTYPE"
fi

# Get the correct Docker-compatible path
BACKUP_PATH="$(get_docker_path)"
print_status "Current directory: $(pwd)"
print_status "Docker mount path: $BACKUP_PATH"

# Verify files exist before attempting to import
print_status "Verifying data files..."
if [[ -f "chat-data.tar.gz" ]]; then
    print_status "✓ Found chat-data.tar.gz ($(du -h chat-data.tar.gz 2>/dev/null | cut -f1 || echo 'unknown size'))"
else
    print_warning "✗ chat-data.tar.gz not found"
fi

if [[ -f "vosk-models.tar.gz" ]]; then
    print_status "✓ Found vosk-models.tar.gz ($(du -h vosk-models.tar.gz 2>/dev/null | cut -f1 || echo 'unknown size'))"
else
    print_warning "✗ vosk-models.tar.gz not found"
fi

# Import chat-data volume
if [ -f "chat-data.tar.gz" ]; then
    print_status "Importing chat-data volume..."
    docker run --rm -v nebulongpt_chat-data:/data -v "$BACKUP_PATH":/backup alpine sh -c "cd /data && tar xzf /backup/chat-data.tar.gz"
    print_success "Chat data imported successfully"
else
    print_warning "chat-data.tar.gz not found, starting with empty chat data"
fi

# Import vosk-models volume
if [ -f "vosk-models.tar.gz" ]; then
    print_status "Importing vosk-models volume..."
    docker run --rm -v nebulongpt_vosk-models:/data -v "$BACKUP_PATH":/backup alpine sh -c "cd /data && tar xzf /backup/vosk-models.tar.gz"
    print_success "Vosk models imported successfully"
else
    print_warning "vosk-models.tar.gz not found, Vosk models may need to be downloaded"
fi

print_status "Making scripts executable..."
chmod +x start.sh
chmod +x start-services.sh

print_status "Starting NebulonGPT services (using pre-built images)..."
# Use docker compose up instead of start.sh to avoid rebuilding
docker compose up -d

print_status "Cleaning up temporary Alpine image..."
# Remove Alpine image since it's no longer needed
docker rmi alpine:latest 2>/dev/null || true
print_success "Alpine image removed successfully"

print_success "🎉 NebulonGPT has been imported and started successfully!"
print_status "Access the application at: http://localhost:3000"
print_status "Vosk Speech Server: ws://localhost:2700"
print_status "Kokoro TTS Server: ws://localhost:2701"

echo ""
echo "📋 Available commands:"
echo "  docker compose logs -f          # View all logs"
echo "  docker compose down             # Stop services"
echo "  docker compose restart          # Restart services"
echo ""
EOF

chmod +x "$EXPORT_DIR/import-and-run.sh"

# Create README file
print_status "Creating README file..."
cat > "$EXPORT_DIR/README.md" << 'EOF'
# NebulonGPT - Complete Docker Distribution

This package contains a complete, portable installation of NebulonGPT that can be run on any Docker-enabled system.

## What's Included

- **Docker Images**: Pre-built images for all services
- **Volume Data**: Chat history and Vosk models
- **Configuration**: All necessary configuration files
- **Source Code**: Complete application source code

## System Requirements

- Docker Engine 20.10+
- Docker Compose 2.0+
- 4GB+ RAM
- 10GB+ free disk space

## Quick Start

1. **Extract the package**:
   ```bash
   tar -xzf nebulongpt-complete.tar.gz
   cd nebulongpt-export
   ```

2. **Import and run**:
   ```bash
   ./import-and-run.sh
   ```

3. **Access the application**:
   - Web UI: http://localhost:3000
   - Vosk Server: ws://localhost:2700
   - TTS Server: ws://localhost:2701

## Manual Import (Alternative)

If the automatic import script doesn't work:

```bash
# Import Docker images
docker load -i nebulongpt-images.tar

# Create volumes
docker volume create nebulongpt_chat-data
docker volume create nebulongpt_vosk-models

# Import volume data
docker run --rm -v nebulongpt_chat-data:/data -v $(pwd):/backup alpine sh -c "cd /data && tar xzf /backup/chat-data.tar.gz"
docker run --rm -v nebulongpt_vosk-models:/data -v $(pwd):/backup alpine sh -c "cd /data && tar xzf /backup/vosk-models.tar.gz"

# Start services
chmod +x start.sh
docker compose up -d
```

## Services

- **nebulon-gpt**: Main web application (Port 3000)
- **vosk-server**: Speech recognition server (Port 2700)
- **kokoro-tts**: Text-to-speech server (Port 2701)

## Troubleshooting

### Services won't start
```bash
docker compose down
docker system prune -f
./import-and-run.sh
```

### Port conflicts
Edit `docker-compose.yml` and change the port mappings:
```yaml
ports:
  - "3001:80"  # Change 3000 to 3001
```

### Volume issues
```bash
docker volume rm nebulongpt_chat-data nebulongpt_vosk-models
# Re-run import script
```

## Support

For issues and support, check the logs:
```bash
docker compose logs -f
```

## Version Information

This package was created on: $(date)
Docker version: $(docker --version)
Docker Compose version: $(docker compose version)
EOF

# Create version info file
print_status "Creating version info..."
cat > "$EXPORT_DIR/VERSION.txt" << EOF
NebulonGPT Docker Export
========================

Export Date: $(date)
Export Host: $(hostname)
Docker Version: $(docker --version)
Docker Compose Version: $(docker compose version)

Included Images:
$(docker images --format "table {{.Repository}}:{{.Tag}}\t{{.Size}}\t{{.CreatedAt}}" | grep nebulongpt)

Volume Sizes:
Chat Data: $(du -sh "$EXPORT_DIR/chat-data.tar.gz" 2>/dev/null | cut -f1 || echo "N/A")
Vosk Models: $(du -sh "$EXPORT_DIR/vosk-models.tar.gz" 2>/dev/null | cut -f1 || echo "N/A")
EOF

# Create the final compressed package
print_status "Creating final compressed package..."
tar -czf "$EXPORT_FILE_TIMESTAMPED" -C . "$EXPORT_DIR"

# Create symlink to latest
ln -sf "$EXPORT_FILE_TIMESTAMPED" "$EXPORT_FILE"

# Calculate file size
EXPORT_SIZE=$(du -sh "$EXPORT_FILE_TIMESTAMPED" | cut -f1)

print_success "🎉 Export completed successfully!"
echo ""
echo "📦 Package Details:"
echo "   File: $EXPORT_FILE_TIMESTAMPED"
echo "   Size: $EXPORT_SIZE"
echo "   Latest: $EXPORT_FILE (symlink)"
echo ""
echo "📋 To use on another system:"
echo "   1. Copy $EXPORT_FILE_TIMESTAMPED to target system"
echo "   2. Extract: tar -xzf $EXPORT_FILE_TIMESTAMPED"
echo "   3. Run: cd nebulongpt-export && ./import-and-run.sh"
echo ""
echo "✅ The package includes:"
echo "   • All Docker images"
echo "   • Volume data (chat history, models)"
echo "   • Complete source code"
echo "   • Configuration files"
echo "   • Automatic import script"

# Cleanup
print_status "Cleaning up temporary files..."
rm -rf "$EXPORT_DIR"

print_status "Cleaning up temporary Alpine image..."
# Remove Alpine image since it's no longer needed after export
docker rmi alpine:latest 2>/dev/null || true
print_success "Alpine image removed successfully"

print_success "Export process completed! 🚀"
