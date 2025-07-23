# 🐳 Docker Setup for NebulonGPT with Vosk Integration

This guide explains how to run NebulonGPT with Vosk speech recognition using Docker.

## 📋 Prerequisites

1. **Docker Desktop** installed and running
   - Windows: [Download Docker Desktop](https://www.docker.com/products/docker-desktop)
   - macOS: [Download Docker Desktop](https://www.docker.com/products/docker-desktop)
   - Linux: [Install Docker Engine](https://docs.docker.com/engine/install/)

2. **Docker Compose** (included with Docker Desktop)

3. **Vosk Models** (optional - can be downloaded through the UI)
   - Place Vosk model directories in `Vosk-Server/websocket/models/`
   - Example: `Vosk-Server/websocket/models/vosk-model-small-en-us-0.15/`

## 🚀 Quick Start

### Option 1: Using Startup Scripts (Recommended)

**Windows:**
```bash
docker-start.bat
```

**Linux/macOS:**
```bash
chmod +x docker-start.sh
./docker-start.sh
```

### Option 2: Manual Docker Compose

```bash
# Build and start all services
docker-compose up --build -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

## 🏗️ Architecture

The Docker setup includes two main services:

### 1. **nebulon-gpt** (Main Application)
- **Port:** 3000 (Web UI)
- **Technology:** React + Node.js + Nginx
- **Features:** 
  - Chat interface
  - Model settings
  - File processing (PDF, Word, images)
  - Speech recognition integration

### 2. **vosk-server** (Speech Recognition)
- **Port:** 2700 (WebSocket)
- **Technology:** Python + Vosk
- **Features:**
  - Real-time speech recognition
  - Multiple language models
  - Model management API

## 🌐 Service URLs

After starting the services:

- **Web Application:** http://localhost:3000
- **Vosk WebSocket:** ws://localhost:2700
- **API Backend:** http://localhost:3001 (internal)

## 📁 Directory Structure

```
NebulonGPT/
├── docker-compose.yml          # Main Docker configuration
├── Dockerfile                  # Main app container
├── docker-start.bat           # Windows startup script
├── docker-start.sh            # Linux/macOS startup script
├── Vosk-Server/
│   ├── Dockerfile.vosk        # Vosk server container
│   └── websocket/
│       ├── models/            # Place Vosk models here
│       │   └── vosk-model-small-en-us-0.15/
│       ├── asr_server_with_models.py
│       └── requirements.txt
└── src/                       # Application source code
```

## 🔧 Configuration

### Environment Variables

The following environment variables are automatically configured:

- `REACT_APP_VOSK_SERVER_URL=ws://vosk-server:2700` (Docker internal)
- `REACT_APP_OLLAMA_API_URL=http://host.docker.internal:11434`
- `NODE_ENV=production`
- `PYTHONUNBUFFERED=1`

### Volume Mounts

- `chat-data:/app/data` - Persistent chat storage
- `vosk-models:/app/models` - Vosk models storage
- `./Vosk-Server/websocket/models:/app/websocket/models` - Local models directory

## 📊 Monitoring and Logs

### View Logs
```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f nebulon-gpt
docker-compose logs -f vosk-server
```

### Check Service Status
```bash
docker-compose ps
```

### Resource Usage
```bash
docker stats
```

## 🛠️ Management Commands

### Start Services
```bash
docker-compose up -d
```

### Stop Services
```bash
docker-compose down
```

### Restart Services
```bash
docker-compose restart
```

### Rebuild Services
```bash
docker-compose up --build -d
```

### Update Services
```bash
# Pull latest images and rebuild
docker-compose pull
docker-compose up --build -d
```

## 🎤 Vosk Model Management

### Adding Models

1. **Download models** from [Vosk Models](https://alphacephei.com/vosk/models)
2. **Extract** the model to `Vosk-Server/websocket/models/`
3. **Restart** the Vosk service:
   ```bash
   docker-compose restart vosk-server
   ```

### Model Directory Structure
```
Vosk-Server/websocket/models/
├── vosk-model-small-en-us-0.15/
│   ├── am/
│   ├── conf/
│   ├── graph/
│   ├── ivector/
│   └── README
└── vosk-model-en-us-0.22/
    ├── am/
    ├── conf/
    └── ...
```

### Using the Model Manager

1. Open the web application at http://localhost:3000
2. Click the **Settings** (gear) icon
3. In the **Speech Recognition Model** section:
   - Click **Manage Models** to upload ZIP files
   - Select models from the dropdown
   - Models are automatically detected and loaded

## 🔍 Troubleshooting

### Common Issues

#### 1. **Port Already in Use**
```bash
# Check what's using the port
netstat -tulpn | grep :3000
netstat -tulpn | grep :2700

# Stop conflicting services
docker-compose down
```

#### 2. **Vosk Server Not Starting**
```bash
# Check Vosk server logs
docker-compose logs vosk-server

# Common causes:
# - No models in the models directory
# - Python dependencies missing
# - Port 2700 already in use
```

#### 3. **Models Not Loading**
```bash
# Check model directory permissions
ls -la Vosk-Server/websocket/models/

# Restart Vosk service
docker-compose restart vosk-server
```

#### 4. **WebSocket Connection Failed**
- Ensure both services are running: `docker-compose ps`
- Check if Vosk server is accessible: `curl http://localhost:2700`
- Verify firewall settings

### Debug Mode

Run services in foreground to see real-time logs:
```bash
docker-compose up --build
```

### Clean Installation

Remove all containers and volumes:
```bash
docker-compose down -v
docker system prune -a
```

## 🔒 Security Considerations

### Production Deployment

1. **Change default ports** in `docker-compose.yml`
2. **Add SSL/TLS** termination
3. **Configure firewall** rules
4. **Use environment files** for sensitive configuration
5. **Enable Docker security** features

### Network Security

- Services communicate through internal Docker network
- Only necessary ports are exposed to host
- WebSocket connections are isolated within Docker network

## 📈 Performance Optimization

### Resource Limits

Add resource limits to `docker-compose.yml`:
```yaml
services:
  nebulon-gpt:
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: '0.5'
  
  vosk-server:
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: '1.0'
```

### Storage Optimization

- Use Docker volumes for persistent data
- Regular cleanup of unused images: `docker system prune`
- Monitor disk usage: `docker system df`

## 🆘 Support

If you encounter issues:

1. **Check logs** first: `docker-compose logs -f`
2. **Verify prerequisites** are installed
3. **Check port availability**
4. **Review this documentation**
5. **Create an issue** with logs and system information

## 📚 Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Vosk Documentation](https://alphacephei.com/vosk/)
- [NebulonGPT Repository](https://github.com/pitt-cpace/NebulonGPT)
