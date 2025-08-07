# Kokoro TTS Server

A multi-language Text-to-Speech server using Kokoro TTS with support for male and female voices in English, Chinese, Japanese, and Korean.

## Features

- **Multi-language support**: English, Chinese, Japanese, Korean
- **Male and female voices** for each supported language
- **WebSocket-based API** for real-time TTS
- **Streaming TTS** for long texts
- **Voice model caching** to avoid runtime downloads
- **Docker support** for easy deployment

## Quick Start

### Docker Setup (Recommended)

The Kokoro TTS Server is designed to run in Docker with all dependencies and models automatically installed during the build process.

```bash
# Build and start the container (from the main project directory)
docker compose up -d kokoro-tts

# Or build manually
docker build -t kokoro-tts .
docker run -p 2701:2701 kokoro-tts
```

### Manual Setup (Development)

```bash
# Install dependencies
pip install -r requirements.txt

# Start the server
python3 websocket/browser_tts_server.py
```

**Note**: When running manually, some models may be downloaded on first use. The Docker setup pre-downloads all models during build time.

## Server Configuration

The server can be started with custom parameters:

```bash
python3 websocket/browser_tts_server.py \
  --host 0.0.0.0 \
  --port 2701 \
  --device cpu \
  --language a
```

### Parameters

- `--host`: Host to bind to (default: localhost)
- `--port`: Port to bind to (default: 2701)
- `--device`: Device to use - `cpu` or `cuda` (default: cpu)
- `--language`: Default language code (default: a for American English)

## Language Support

### English (Language code: `a` or `en`)
- **Male voices**: `am_adam`, `am_michael`, `bm_george`, `bm_lewis`
- **Female voices**: `af_heart`, `af_bella`, `af_sarah`, `bf_emma`, `bf_isabella`

### Chinese (Language code: `zh`)
- **Male/Female voices**: Available through Kokoro TTS

### Japanese (Language code: `ja`)
- **Male/Female voices**: Available through Kokoro TTS

### Korean (Language code: `ko`)
- **Male/Female voices**: Available through Kokoro TTS

## API Usage

### WebSocket Connection

Connect to: `ws://localhost:3000/tts` (via Nginx proxy) or `ws://localhost:2701` (direct)

### Message Formats

#### Regular TTS Request
```json
{
  "text": "Hello, world!",
  "voice": "af_heart",
  "speed": 1.0,
  "language": "a"
}
```

#### Streaming TTS (Start)
```json
{
  "start_stream": true,
  "voice": "af_heart",
  "speed": 1.0,
  "language": "a"
}
```

#### Streaming TTS (Text Chunk)
```json
{
  "text_chunk": "This is a chunk of text to be spoken.",
  "session_id": 1234567890
}
```

#### Streaming TTS (End)
```json
{
  "end_stream": true
}
```

#### Queue Control
```json
{
  "action": "stop"    // or "clear", "pause", "resume"
}
```

### Response Formats

#### Complete Audio Response
```json
{
  "type": "complete_audio",
  "text": "Hello, world!",
  "voice": "af_heart",
  "audio": "base64_encoded_wav_data",
  "audio_format": "wav",
  "sample_rate": 24000
}
```

#### Streaming Audio Chunk
```json
{
  "type": "audio_chunk",
  "session_id": 1234567890,
  "text_chunk": "This is a chunk",
  "audio_chunk": "base64_encoded_wav_data",
  "audio_format": "wav",
  "sample_rate": 24000
}
```

## Voice Models

The server automatically downloads voice models from Hugging Face Hub:
- **Main model**: `hexgrad/Kokoro-82M`
- **Language models**: Downloaded as needed for each language

Models are cached locally to avoid repeated downloads.

## Dependencies

### Core Dependencies
- `kokoro>=0.7.16` - Main TTS engine
- `websockets>=10.0` - WebSocket server
- `torch>=1.9.0` - PyTorch for neural networks
- `soundfile>=0.12.1` - Audio file handling
- `numpy` - Numerical operations

### Language-Specific Dependencies

Language-specific dependencies and models are pre-cached in the `huggingface-cache/` directory and loaded at runtime. No additional language packages need to be installed.

## Troubleshooting

### Common Issues

1. **Models not downloading**: Ensure internet connection during Docker build. Models are pre-downloaded during container build
2. **Language errors**: All language-specific dependencies are included in the Docker image
3. **CUDA errors**: Use `--device cpu` if CUDA is not available
4. **Port conflicts**: Change port with `--port` parameter or modify Docker port mapping

### Logs

The server provides detailed logging for debugging:
- Model loading progress
- WebSocket connections
- TTS generation status
- Error messages

### Performance Tips

1. **Use Docker for production**: All models are pre-cached in the container
2. **Use CPU for development**: `--device cpu`
3. **Models are pre-cached**: No runtime downloads when using Docker
4. **Streaming for long texts**: Use streaming API for better responsiveness

## Docker Integration

This TTS server is designed to work with the NebulonGPT Docker setup. It's automatically configured in the main `docker-compose.yml` file.

## License

This project uses the Kokoro TTS engine. Please refer to the Kokoro TTS license for usage terms.
