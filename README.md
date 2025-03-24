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
- Fully dockerized for easy deployment

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
   git clone https://github.com/yourusername/ollama-ui.git
   cd ollama-ui
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

## License

MIT

## Acknowledgements

- [Ollama](https://ollama.ai/) for making local LLMs accessible
- [React](https://reactjs.org/) and [Material-UI](https://mui.com/) for the frontend framework
