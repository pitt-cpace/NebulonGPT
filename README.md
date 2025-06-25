=======
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
- **Advanced voice recognition** with Vosk integration
- **Multi-user session support** with per-session model tracking
- **Intelligent model selection** and persistence
- Fully dockerized for easy deployment

## Prerequisites

- [Docker](https://www.docker.com/products/docker-desktop/) installed on your machine
- [Ollama](https://ollama.ai/) running locally with models installed

## Download Vosk Models

Before using speech recognition, you must download the desired Vosk models from:

https://alphacephei.com/vosk/models

**Recommended models:**

- **English (Small)**: vosk-model-small-en-us-0.15 (~40MB) - Fast, good for real-time
- **English (Large)**: vosk-model-en-us-0.22 (~1.8GB) - High accuracy
- **Other Languages**: Choose models for your preferred languages

### Extract Models

After downloading, extract the models into the following directory:

```
Vosk-Server/websocket/models/
```

**Example structure:**
```
Vosk-Server/websocket/models/
├── vosk-model-small-en-us-0.15/
├── vosk-model-en-us-0.22/
└── vosk-model-fa-0.5/
```

## Quick Start

1. Make sure Ollama is running on your machine:
   ```bash
   ollama serve
   ```

2. Clone the repository:
   ```bash
   git clone --branch New-Features https://github.com/pitt-cpace/NebulonGPT.git
   ```

3. Enter the project directory:
   ```bash
   cd NebulonGPT
   ```

4. Start with Docker (you have multiple options):
   ```bash
   docker compose up -d
   # OR use the provided script
   ./start.sh
   ```
   
   The script will automatically detect if you have Docker Compose or just Docker and run the appropriate commands.

5. Open your browser and navigate to:
   ```
   http://localhost:3000
   ```

## Chat Persistence

Your chat history is automatically saved and will persist between browser sessions and container restarts. Chat data is stored in the `data/` directory in your project folder, so your conversations are preserved even when you:

- Close and reopen your browser
- Restart the Docker containers
- Update the application

The chat data is stored locally on your machine and never sent to external servers, maintaining your privacy.

## Voice Recognition Features

NebulonGPT includes advanced voice recognition capabilities powered by Vosk:

### Key Features:
- **Multi-language support** - Works with any Vosk model language
- **Per-session model tracking** - Each user maintains their own model preferences
- **Intelligent model selection** - Automatically uses the best available model
- **Model persistence** - Models stay loaded across page refreshes
- **Centralized error detection** - Consistent error messages across all components
- **Real-time transcription** - See your speech converted to text in real-time

### Voice Recognition Setup:
1. **Download models** from https://alphacephei.com/vosk/models
2. **Extract models** to `Vosk-Server/websocket/models/`
3. **Start the application** - Vosk server starts automatically with Docker
4. **Select your model** in Settings → Voice Recognition
5. **Click the microphone button** to start dictation

### Supported Languages:
The system supports any language for which you have downloaded Vosk models, including:
- English (multiple variants)
- Spanish, French, German, Russian
- Arabic, Persian, Chinese, Japanese
- And many more...

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

If you don't have Docker Compose, you'll need to build and run both containers manually:

```bash
# Build the Vosk Server image
docker build -t vosk-server ./Vosk-Server/websocket

# Build the main application image
docker build -t nebulon-gpt .

# Create a network
docker network create ollama-network

# Run Vosk Server
docker run -d --name vosk-server \
  --network ollama-network \
  -p 2700:2700 \
  -v "$(pwd)/Vosk-Server/websocket/models:/app/models" \
  vosk-server

# Run the main application
docker run -d --name nebulon-gpt \
  --network ollama-network \
  -p 3000:80 \
  --add-host=host.docker.internal:host-gateway \
  -v "$(pwd)/nginx.conf:/etc/nginx/http.d/default.conf" \
  -v "$(pwd)/data:/app/data" \
  -e NODE_ENV=production \
  -e REACT_APP_OLLAMA_API_URL=http://host.docker.internal:11434 \
  nebulon-gpt
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
- Check Docker logs: `docker logs nebulon-gpt` or `docker logs vosk-server`
- Verify that ports 3000 and 2700 are not already in use
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
   docker logs nebulon-gpt
   ```

5. **Firewall Settings**: Make sure your firewall allows connections to port 11434 (Ollama API)

6. **Ollama API Access**: Verify Ollama is configured to accept connections by checking its configuration

## License

MIT

## Architecture

NebulonGPT is built with a modern, containerized architecture:

- **Frontend**: React with Material-UI for a clean, responsive interface
- **Backend**: Node.js server for chat data persistence and API management
- **Voice Recognition**: Integrated Vosk server for speech-to-text capabilities
- **Containerization**: Docker Compose orchestrates all services automatically

**Note**: The Vosk-Server is now directly integrated into the project (no longer a submodule), making deployment simpler and more reliable.

## Acknowledgements

- [Ollama](https://ollama.ai/) for making local LLMs accessible
- [React](https://reactjs.org/) and [Material-UI](https://mui.com/) for the frontend framework
- [Vosk](https://alphacephei.com/vosk/) for open-source speech recognition
