# Nebulon-GPT

Your Fully Private Ollama-based Web User Interface - A modern, elegant interface for interacting with your local Ollama models.

![Nebulon-GPT Screenshot](screenshot.png)

## Features

- Clean, modern interface with a sleek dark theme
- Support for all your local Ollama models
- Real-time streaming responses as the model generates text
- Beautiful table formatting for structured data
- Chat history and conversation management
- Suggested prompts to help you get started
- Enhanced markdown rendering for responses
- Fully dockerized for easy deployment

### 🎤 Vosk Speech Recognition

- **Offline speech recognition** powered by Vosk
- **Multiple language models** support
- **Real-time transcription** with interim results
- **Model management interface** for easy switching
- **WebSocket-based** communication via Nginx proxy at `/vosk`
- **Voice caching** - saves up to 2 seconds of voice data for connection recovery

## Prerequisites

- [Docker](https://www.docker.com/products/docker-desktop/) installed on your machine
- [Ollama](https://ollama.ai/) running locally with models installed

## Quick Start

1. Make sure Ollama is running on your machine:
   ```bash
   ollama serve
   ```

2. Clone this repository:
   ```bash
   git clone --branch New-Features-From-Main-Branch https://github.com/pitt-cpace/NebulonGPT.git
   cd NebulonGPT
   ```

3. Start the application using the provided script:
   ```bash
   ./start.sh
   ```
   
   This script will automatically detect if you have Docker Compose or just Docker and run the appropriate commands.

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

### Environment Variables

Nebulon-GPT supports runtime configuration through environment variables. These can be set when starting the container.

#### Ollama LLM Configuration (Runtime - Configurable without rebuild)

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OLLAMA_URL` | No | `http://host.docker.internal:11434` | URL of your Ollama LLM server (runtime configurable) |
| `OLLAMA_CUSTOM_HEADER_NAME` | No | _(none)_ | Name of custom HTTP header for Ollama requests (e.g., `X-API-Key`, `Authorization`) |
| `OLLAMA_CUSTOM_HEADER_VALUE` | No | _(none)_ | Value of custom HTTP header (e.g., API key or Bearer token) |

#### Backend Services Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `REST_API_PORT` | `3001` | Internal FastAPI backend REST API port |
| `HTTPS_PORT` | `3443` | HTTPS port for secure network access |
| `DATA_DIR` | `./data` | Directory for storing chat data |
| `VOSK_MODELS_DIR` | `./models/vosk` | Directory containing Vosk speech recognition models |

#### Machine Learning & AI Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `HF_HOME` | `/app/.cache/huggingface` | Hugging Face cache directory for model storage |
| `TRANSFORMERS_CACHE` | `/app/.cache/huggingface/transformers` | Transformers library cache directory |
| `HF_DATASETS_CACHE` | `/app/.cache/huggingface/datasets` | Hugging Face datasets cache directory |
| `HF_HUB_OFFLINE` | `1` | Run Hugging Face in offline mode (0=online, 1=offline) |
| `KOKORO_SERVER_HOST` | `0.0.0.0` | Kokoro TTS server host address |
| `KOKORO_SERVER_PORT` | `2701` | Kokoro TTS server port |

#### Frontend Build Variables (Build-time only - deprecated for Ollama config)

| Variable | Default | Description |
|----------|---------|-------------|
| `REACT_APP_OLLAMA_API_URL` | `http://localhost:11434` | ⚠️ **Deprecated**: Use `OLLAMA_URL` instead for runtime config |
| `REACT_APP_VOSK_SERVER_URL` | `ws://localhost:3000/vosk` | Vosk WebSocket URL (build-time) |
| `REACT_APP_TTS_SERVER_URL` | `ws://localhost:3000/tts` | TTS WebSocket URL (build-time) |
| `NODE_ENV` | `production` | Node environment mode |

#### System Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PYTHONUNBUFFERED` | `1` | Disable Python output buffering for real-time logs |
| `PYTHONPATH` | `/app:$PYTHONPATH` | Python module search path |

### Configuration Examples

**Default configuration (Ollama on host machine):**
```bash
docker run -p 3000:80 nebulon-gpt
```

**Custom Ollama URL:**
```bash
docker run -p 3000:80 \
  -e OLLAMA_URL=http://192.168.1.100:11434 \
  nebulon-gpt
```

**With API key authentication:**
```bash
docker run -p 3000:80 \
  -e OLLAMA_URL=http://api.example.com:11434 \
  -e OLLAMA_CUSTOM_HEADER_NAME=X-API-Key \
  -e OLLAMA_CUSTOM_HEADER_VALUE=your-secret-key \
  nebulon-gpt
```

**With Bearer token:**
```bash
docker run -p 3000:80 \
  -e OLLAMA_URL=https://secure-ollama.example.com \
  -e OLLAMA_CUSTOM_HEADER_NAME=Authorization \
  -e OLLAMA_CUSTOM_HEADER_VALUE="Bearer your-token-here" \
  nebulon-gpt
```

**Using docker-compose.yml:**
```yaml
environment:
  - OLLAMA_URL=http://192.168.1.100:11434
  - OLLAMA_CUSTOM_HEADER_NAME=X-API-Key
  - OLLAMA_CUSTOM_HEADER_VALUE=your-secret-key
  - HF_HUB_OFFLINE=0  # Enable online mode for model downloads
```

**Using environment file (.env):**
```bash
# Create .env file
cat > .env <<EOF
OLLAMA_URL=http://192.168.1.100:11434
OLLAMA_CUSTOM_HEADER_NAME=X-API-Key
OLLAMA_CUSTOM_HEADER_VALUE=your-secret-key
EOF

# Run with env file
docker run -p 3000:80 --env-file .env nebulon-gpt
```

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

### Docker Memory Requirements for Large Vosk Models

**Important**: When uploading large Vosk model files (>1GB), you may encounter memory-related errors during upload/extraction. This is due to Docker's default memory limitations.

**Symptoms:**
- Upload appears to work but shows error messages
- Large model files (like `vosk-model-en-us-0.22.zip` - 1.91GB) fail to upload
- Smaller models work fine

**Solution:**
1. **Increase Docker Memory Allocation**:
   - **Docker Desktop (Mac/Windows)**: 
     - Open Docker Desktop → Settings → Resources → Advanced
     - Increase "Memory Limit" to at least **16GB** (recommended: **24GB+**)
     - Click "Apply & Restart"
   
   - **Docker on Linux**:
     - Docker uses system memory directly, but you may need to increase container limits
     - Add memory limits to docker-compose.yml if needed:
       ```yaml
       services:
         nebulon-gpt:
           mem_limit: 16g
       ```

2. **Recommended Memory Settings**:
   - **Minimum**: 8GB for models up to 500MB
   - **Recommended**: 16GB for models up to 1.5GB  
   - **Large Models**: 24GB+ for models over 2GB

3. **Verify Settings**:
   - After increasing memory, restart Docker completely
   - Rebuild the container: `docker-compose down && docker-compose up --build -d`
   - Test with a large model file

**Note**: The Vosk model management interface supports files up to 5GB, but your Docker memory allocation must be sufficient to handle the decompression process.

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

## License

MIT

## Acknowledgements

- [Ollama](https://ollama.ai/) for making local LLMs accessible
- [React](https://reactjs.org/) and [Material-UI](https://mui.com/) for the frontend framework
