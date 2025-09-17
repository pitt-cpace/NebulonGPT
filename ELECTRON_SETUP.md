# NebulonGPT Electron Setup Guide

This guide explains how to set up and build NebulonGPT as both a Docker application and an Electron desktop application from the same codebase.

## Architecture Overview

NebulonGPT now supports dual deployment modes:

### Docker Mode (Original)
- **Frontend**: React app served by Nginx
- **Backend**: Node.js Express server
- **Services**: Python Vosk (speech recognition) + Kokoro TTS
- **Data**: Stored in Docker volumes
- **Access**: Web browser at `http://localhost:3000`

### Electron Mode (New)
- **Frontend**: React app served by Electron's built-in Chromium
- **Backend**: Electron main process (replaces Node.js server)
- **Services**: Python Vosk + Kokoro TTS (same as Docker)
- **Data**: Stored in user's home directory (`~/.nebulon-gpt/`)
- **Access**: Native desktop application

## Prerequisites

### For Both Modes
- [Node.js](https://nodejs.org/) (v18 or higher)
- [Python](https://python.org/) (v3.9 or higher)
- [Ollama](https://ollama.ai/) running locally

### For Docker Mode
- [Docker](https://www.docker.com/products/docker-desktop/)
- [Docker Compose](https://docs.docker.com/compose/)

### For Electron Mode
- All Python dependencies for Vosk and Kokoro TTS
- System tools: `unzip`, `cp` (usually pre-installed on macOS/Linux)

## Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/pitt-cpace/NebulonGPT.git
   cd NebulonGPT
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

## Building and Running

### Docker Mode (Web Application)

1. **Development:**
   ```bash
   # Start React dev server + Node.js server
   npm run start:both
   ```

2. **Production (Docker):**
   ```bash
   # Build and run with Docker Compose
   npm run build:docker
   # or
   docker-compose up -d
   ```

3. **Access:** Open `http://localhost:3000` in your browser

### Electron Mode (Desktop Application)

1. **Development:**
   ```bash
   # Start React dev server + Electron
   npm run electron-dev
   ```

2. **Production Build:**
   ```bash
   # Build for current platform
   npm run dist
   
   # Or build for specific platforms:
   npm run dist:mac    # macOS (DMG)
   npm run dist:win    # Windows (NSIS installer)
   npm run dist:linux  # Linux (AppImage + DEB)
   ```

3. **Output:** Built applications will be in the `dist-electron/` directory

## Environment Detection

The application automatically detects its environment and adapts:

### API Calls
- **Electron**: Uses IPC communication via `window.electronAPI`
- **Docker/Web**: Uses HTTP fetch to `/api/chats` endpoints

### WebSocket Connections
- **Electron**: Direct connection to `ws://localhost:2700` (Vosk) and `ws://localhost:2701` (TTS)
- **Docker/Web**: Proxied through Nginx at `/vosk` and `/tts`

### Data Storage
- **Electron**: `~/.nebulon-gpt/chats.json` and related files
- **Docker/Web**: Docker volumes and server-side storage

## File Structure

```
NebulonGPT/
├── electron.js                 # Electron main process
├── preload.js                  # Electron preload script
├── src/
│   ├── services/
│   │   └── electronApi.ts      # Dual-environment API adapter
│   └── ...
├── vosk-server/                # Python Vosk service
├── kokoro-tts/                 # Python TTS service
├── package.json                # Updated with Electron scripts
└── dist-electron/              # Electron build output
```

## Configuration

### Electron Builder Configuration

The `package.json` includes Electron Builder configuration:

```json
{
  "build": {
    "appId": "com.nebulon.gpt",
    "productName": "NebulonGPT",
    "files": [
      "build/**/*",
      "electron.js",
      "preload.js",
      "vosk-server/**/*",
      "kokoro-tts/**/*"
    ],
    "extraResources": [
      {
        "from": "vosk-server",
        "to": "app/vosk-server"
      },
      {
        "from": "kokoro-tts",
        "to": "app/kokoro-tts"
      }
    ]
  }
}
```

### Environment Variables

#### Docker Mode
- `REACT_APP_OLLAMA_API_URL`: Ollama API endpoint
- `REACT_APP_VOSK_SERVER_URL`: Vosk WebSocket URL
- `REACT_APP_TTS_SERVER_URL`: TTS WebSocket URL

#### Electron Mode
- Environment variables are handled automatically by the Electron main process
- Python services use local directories and ports

## Troubleshooting

### Electron Mode Issues

1. **Python services not starting:**
   - Ensure Python 3.9+ is installed and in PATH
   - Check that required Python packages are installed:
     ```bash
     pip install -r vosk-server/websocket/requirements.txt
     pip install -r kokoro-tts/requirements.txt
     ```

2. **Models not found:**
   - Vosk models will be extracted to `~/.nebulon-gpt/vosk-models/`
   - TTS cache will be extracted to `~/.nebulon-gpt/huggingface-cache/`
   - First run may take longer due to extraction

3. **Build errors:**
   - Ensure all dependencies are installed: `npm install`
   - Clear build cache: `rm -rf dist-electron/ build/`
   - Rebuild: `npm run dist`

### Docker Mode Issues

1. **Connection issues:**
   - Run the connection test: `./test-ollama-connection.sh`
   - Check Docker networking: `docker logs nebulon-gpt-integrated`

2. **Service startup:**
   - Check service logs: `docker-compose logs`
   - Ensure all required files are present

## Development

### Adding Features

When adding new features, ensure they work in both environments:

1. **API calls**: Use `electronApi` from `src/services/electronApi.ts`
2. **WebSocket connections**: Use `getWebSocketUrls()` helper
3. **File operations**: Handle both Electron IPC and HTTP endpoints
4. **Environment detection**: Use `isElectron()` function

### Testing

1. **Test Docker mode:**
   ```bash
   npm run build:docker
   # Test at http://localhost:3000
   ```

2. **Test Electron mode:**
   ```bash
   npm run electron-dev
   # Test the desktop application
   ```

## Distribution

### Docker Distribution
- Use existing Docker Hub or container registry
- Share `docker-compose.yml` for easy deployment

### Electron Distribution
- Built applications are platform-specific
- Distribute `.dmg` for macOS, `.exe` for Windows, `.AppImage`/`.deb` for Linux
- Consider code signing for production releases

## Security Considerations

### Electron Security
- Context isolation is enabled (`contextIsolation: true`)
- Node integration is disabled (`nodeIntegration: false`)
- Preload script provides secure IPC communication
- External links open in system browser, not in app

### Docker Security
- Uses existing security model
- No additional security concerns introduced

## Performance

### Electron Benefits
- Native desktop experience
- No browser overhead
- Direct file system access
- Better resource management

### Docker Benefits
- Consistent environment
- Easy deployment
- Scalable architecture
- Web accessibility

Both modes offer excellent performance for their respective use cases.
