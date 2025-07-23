=======
# Nebulon-GPT

Your Fully Private Ollama-based Web User Interface with Advanced Speech Recognition - A modern, elegant interface for interacting with your local Ollama models featuring integrated Vosk speech-to-text capabilities.

![Nebulon-GPT Screenshot](screenshot.png)

## ✨ Features

### 🎯 Core Features
- Clean, modern interface with a sleek dark theme
- Support for all your local Ollama models
- Real-time streaming responses as the model generates text
- Beautiful table formatting for structured data (Llama3-3, Phi4, Markdown)
- Chat history and conversation management
- Suggested prompts to help you get started
- Enhanced markdown rendering for responses

### 🎤 Speech Recognition (NEW!)
- **Vosk-powered speech recognition** with offline capabilities
- **Multiple language models** support
- **Real-time transcription** with interim results
- **Model management interface** for easy model switching
- **Automatic fallback** to browser speech recognition
- **Voice data caching** for offline scenarios

### 📄 File Processing
- **PDF processing** with text and image extraction
- **Word document support** (.docx files)
- **Image attachments** with preview
- **Drag-and-drop** file uploads

### 🐳 Deployment
- **Fully dockerized** for easy deployment
- **Multi-service architecture** with Vosk integration
- **Production-ready** with Nginx reverse proxy

## Prerequisites

- [Docker](https://www.docker.com/products/docker-desktop/) installed on your machine
- [Ollama](https://ollama.ai/) running locally with models installed

## 🚀 Quick Start

### Option 1: Docker with Vosk Integration (Recommended)

1. **Start Ollama** on your machine:
   ```bash
   ollama serve
   ```

2. **Clone this repository**:
   ```bash
   git clone https://github.com/pitt-cpace/NebulonGPT.git
   cd NebulonGPT
   ```

3. **Start with Docker** (includes Vosk speech recognition):
   
   **Windows:**
   ```bash
   docker-start.bat
   ```
   
   **Linux/macOS:**
   ```bash
   chmod +x docker-start.sh
   ./docker-start.sh
   ```

4. **Open your browser** and navigate to:
   ```
   http://localhost:3000
   ```

5. **Configure Speech Recognition**:
   - Click the Settings (gear) icon
   - In the "Speech Recognition Model" section, click "Manage Models"
   - Upload Vosk model ZIP files or download from [Vosk Models](https://alphacephei.com/vosk/models)

### Option 2: Legacy Setup (No Speech Recognition)

1. Make sure Ollama is running on your machine:
   ```bash
   ollama serve
   ```

2. Clone this repository:
   ```bash
   git clone https://github.com/pitt-cpace/NebulonGPT.git
   cd NebulonGPT
   ```

3. Start the application using the provided script:
   ```bash
   ./start.sh
   ```

4. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

## Manual Installation

### Using Docker Compose (Recommended)

If you have Docker Compose installed:

```bash
# Using the newer Docker Compose plugin
docker compose up -d

# Or using the older docker-compose command
docker-compose up -d
```

### Using Plain Docker

If you don't have Docker Compose:

```bash
# Build the image
docker build -t ollama-ui .

# Run the container
docker run -d --name ollama-ui \
  -p 3000:80 \
  --add-host=host.docker.internal:host-gateway \
  -v "$(pwd)/nginx.conf:/etc/nginx/conf.d/default.conf" \
  -e NODE_ENV=production \
  -e REACT_APP_OLLAMA_API_URL=http://host.docker.internal:11434 \
  ollama-ui
```

## Configuration

The UI connects to your local Ollama instance running on port 11434 by default. If your Ollama instance is running on a different port or host, you can modify the `REACT_APP_OLLAMA_API_URL` environment variable in the `docker-compose.yml` file or pass it directly to the `docker run` command.

## Development

If you want to run the application in development mode:

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the development server:
   ```bash
   npm start
   ```

3. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

## Troubleshooting

If you encounter issues:

- Make sure Ollama is running (`ollama serve`)
- Check Docker logs: `docker logs ollama-ui`
- Verify that port 3000 is not already in use
- Ensure your Docker installation has permissions to create containers

### Connection Issues

If the UI is running but can't connect to Ollama:

1. **Run the Connection Test Script**: We've included a test script to help diagnose connection issues:
   ```bash
   ./test-ollama-connection.sh
   ```
   This script will test both direct connection to Ollama and connection from Docker to the host machine.

2. **Docker Networking**: The application uses `host.docker.internal` to connect to the Ollama API running on your host machine. This works on Docker Desktop for Mac and Windows, but on Linux you might need to:
   - Use your host machine's actual IP address instead of `host.docker.internal`
   - Modify the `nginx.conf` file and change the `proxy_pass` URL
   - Update the `REACT_APP_OLLAMA_API_URL` in docker-compose.yml

3. **Automatic Connection Fix**: We've included a script to automatically fix connection issues:
   ```bash
   ./fix-connection.sh
   ```
   This script will:
   - Detect your host IP address
   - Replace `host.docker.internal` with your actual IP in all configuration files
   - Create backups of the original files
   - Provide instructions for applying the changes

4. **Check Logs**: View the Nginx logs from the container:
   ```bash
   docker logs ollama-ui
   ```

5. **Firewall Settings**: Make sure your firewall allows connections to port 11434 (Ollama API)

6. **Ollama API Access**: Verify Ollama is configured to accept connections by checking its configuration

## 🐳 Docker Setup

For detailed Docker setup instructions, troubleshooting, and advanced configuration, see:

**📖 [DOCKER_SETUP.md](DOCKER_SETUP.md)**

### Quick Docker Commands

```bash
# Start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down

# Restart services
docker-compose restart
```

### Service URLs

- **Web Application:** http://localhost:3000
- **Vosk Speech Server:** ws://localhost:2700

## 🎤 Speech Recognition Setup

### Vosk Models

1. **Download models** from [Vosk Models](https://alphacephei.com/vosk/models)
2. **Recommended models:**
   - `vosk-model-small-en-us-0.15` (39MB) - Fast, good for real-time
   - `vosk-model-en-us-0.22` (1.8GB) - High accuracy
3. **Upload via UI:** Use the Model Manager in Settings
4. **Manual installation:** Extract to `Vosk-Server/websocket/models/`

### Supported Languages

Vosk supports 20+ languages including:
- English (US/UK)
- Spanish, French, German
- Russian, Chinese, Japanese
- And many more...

## 📚 Documentation

- **🐳 [Docker Setup Guide](DOCKER_SETUP.md)** - Complete Docker installation and configuration
- **🎤 [Vosk Integration Guide](VOSK_INTEGRATION.md)** - Speech recognition setup and usage
- **🔧 [Development Guide](#development)** - Local development setup

## License

MIT

## Acknowledgements

- [Ollama](https://ollama.ai/) for making local LLMs accessible
- [Vosk](https://alphacephei.com/vosk/) for offline speech recognition
- [React](https://reactjs.org/) and [Material-UI](https://mui.com/) for the frontend framework
