# NebulonGPT Python Backend

Single FastAPI application that replaces the Node.js server and consolidates all backend services.

## Overview

This backend provides:
- **REST API** - Chat management, model management, network info
- **WebSocket `/vosk`** - Vosk ASR (Automatic Speech Recognition)
- **WebSocket `/tts`** - Kokoro TTS (Text-to-Speech)

## Requirements

- Python 3.9+
- See `requirements.txt` for all dependencies

## Installation

```bash
cd backend
pip install -r requirements.txt
```

## Running the Backend

### Production
```bash
uvicorn backend.main:app --host 0.0.0.0 --port 3001
```

### Development (with auto-reload)
```bash
uvicorn backend.main:app --host 0.0.0.0 --port 3001 --reload
```

### With Environment Variables
```bash
export DATA_DIR=/app/data
export VOSK_MODELS_DIR=/app/vosk-server/models
export HF_HOME=/app/.cache/huggingface
uvicorn backend.main:app --host 0.0.0.0 --port 3001
```

## API Documentation

Once running, visit:
- **Swagger UI**: http://localhost:3001/docs
- **ReDoc**: http://localhost:3001/redoc

## Endpoints

### REST API

#### Chat Management
- `GET /api/chats` - Get all chats
- `POST /api/chats/{chat_id}` - Save/update specific chat
- `POST /api/chats` - Save all chats (legacy)

#### Vosk Model Management
- `GET /api/vosk/models/all` - List all models
- `POST /api/vosk/models/upload` - Upload model ZIP
- `POST /api/vosk/models/{name}/extract` - Extract model
- `DELETE /api/vosk/models/{name}` - Delete model

#### System Info
- `GET /api/network-info` - Get network addresses
- `GET /health` - Health check

### WebSocket Endpoints

#### `/vosk` - Speech Recognition
Accepts:
- Binary audio data (16kHz, mono, 16-bit PCM)
- JSON commands: `get_models`, `select_model`, `get_current_model`

Returns:
- `{"type": "result", "text": "..."}`  - Final transcription
- `{"type": "partial", "partial": "..."}` - Partial transcription

#### `/tts` - Text-to-Speech
Accepts JSON:
```json
{
  "text": "Hello world",
  "voice": "af_heart",
  "speed": 1.0,
  "assistantMessageId": "msg_123"
}
```

Actions:
```json
{"action": "stop"}  // Clear queue
{"action": "pause"}  // Pause generation
{"action": "resume"}  // Resume generation
```

Returns:
```json
{
  "type": "complete_audio",
  "audio": "base64_encoded_wav",
  "audio_format": "wav",
  "sample_rate": 24000
}
```

## Architecture

```
backend/main.py
├── FastAPI Application
│   ├── REST API Endpoints (HTTP)
│   ├── /vosk WebSocket (ASR)
│   └── /tts WebSocket (TTS)
├── Vosk Model Cache
├── Kokoro TTS Pipeline
└── Session Management
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `REST_API_PORT` | 3001 | Server port |
| `DATA_DIR` | /app/data | Chat data directory |
| `VOSK_MODELS_DIR` | /app/vosk-server/models | Vosk models directory |
| `HF_HOME` | /app/.cache/huggingface | Hugging Face cache |
| `HTTPS_PORT` | 3443 | HTTPS port for network info |

## Nginx Configuration

Your existing `nginx.conf` works without changes:

```nginx
# REST API
location /api/ {
    proxy_pass http://localhost:3001/api/;
}

# WebSockets
location /vosk {
    proxy_pass http://localhost:3001/vosk;
    # WebSocket upgrade headers
}

location /tts {
    proxy_pass http://localhost:3001/tts;
    # WebSocket upgrade headers
}
```

## Migration from Node.js

### What Changed
- **Removed**: Node.js `server.js`
- **Replaced with**: Single Python `backend/main.py`
- **Unchanged**: Frontend, Nginx config, port numbers

### Benefits
1. ✅ Single language (Python) for entire backend
2. ✅ Single process to manage
3. ✅ Native async/await throughout
4. ✅ Automatic API documentation
5. ✅ Better type safety with Pydantic
6. ✅ Simpler deployment

## Development

### File Structure
```
backend/
├── main.py          # Unified FastAPI application
├── requirements.txt # Python dependencies
└── README.md        # This file
```

### Adding New Endpoints

```python
@app.get("/api/your-endpoint")
async def your_endpoint():
    return {"status": "ok"}
```

### Adding New WebSocket Handler

```python
@app.websocket("/ws/your-service")
async def your_websocket(websocket: WebSocket):
    await websocket.accept()
    # Your logic here
```

## Troubleshooting

### Models not loading
- Check `VOSK_MODELS_DIR` path
- Ensure models are extracted (not ZIP files)
- Check logs for model loading errors

### TTS not working
- Verify Kokoro dependencies installed
- Check HuggingFace cache directory exists
- Review TTS initialization logs

### WebSocket connection issues
- Verify Nginx WebSocket proxy configuration
- Check firewall/security group settings
- Review WebSocket upgrade headers

## License

Same as main NebulonGPT project.
