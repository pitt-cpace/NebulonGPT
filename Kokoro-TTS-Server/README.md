# Kokoro TTS Server

A WebSocket-based Text-to-Speech server using the Kokoro TTS model, similar to the Vosk ASR server structure.

## Features

- **Multiple Languages**: Support for English (American/British), Spanish, French, Hindi, Italian, Japanese, Portuguese, and Chinese
- **Voice Selection**: Choose between male and female voices
- **Speed Control**: Adjust speech speed from 0.5x to 2.0x
- **Real-time Processing**: WebSocket-based for low-latency communication
- **Base64 Audio**: Returns audio as base64-encoded WAV files

## Installation

1. Install Python dependencies:
```bash
pip install -r requirements.txt
```

2. For additional language support:
```bash
# For Japanese
pip install misaki[ja]

# For Chinese
pip install misaki[zh]
```

## Usage

### Starting the Server

```bash
python websocket/tts_server.py [language_code]
```

**Language Codes:**
- `a` - American English (default)
- `b` - British English  
- `e` - Spanish
- `f` - French
- `h` - Hindi
- `i` - Italian
- `j` - Japanese
- `p` - Brazilian Portuguese
- `z` - Mandarin Chinese

### Environment Variables

- `KOKORO_SERVER_INTERFACE` - Server interface (default: 0.0.0.0)
- `KOKORO_SERVER_PORT` - Server port (default: 2701)
- `KOKORO_DEVICE` - Processing device (default: cpu, options: cpu, cuda, mps)
- `KOKORO_DEFAULT_LANGUAGE` - Default language code (default: a)

### Example Usage

```bash
# Start server on default port with American English
python websocket/tts_server.py

# Start server with Spanish
python websocket/tts_server.py e

# Start server with custom port
KOKORO_SERVER_PORT=3000 python websocket/tts_server.py

# Start server with GPU acceleration (if available)
KOKORO_DEVICE=cuda python websocket/tts_server.py
```

## WebSocket API

### Connection
Connect to: `ws://localhost:2701`

### Message Format

#### Regular TTS Request
```json
{
  "text": "Hello, this is a test message",
  "voice": "af_heart",
  "speed": 1.0,
  "language": "a"
}
```

#### Streaming TTS Session

**Start Streaming:**
```json
{
  "start_stream": true,
  "voice": "af_heart",
  "speed": 1.0,
  "language": "a"
}
```

**Send Text Chunks (for LLM streaming):**
```json
{
  "text_chunk": "Hello, this is a "
}
```

**End Streaming:**
```json
{
  "end_stream": true
}
```

#### Configuration Update
```json
{
  "config": {
    "language": "e"
  }
}
```

### Response Format

#### Regular TTS Response
```json
{
  "type": "complete_audio",
  "audio": "base64_encoded_wav_data",
  "sample_rate": 24000,
  "format": "wav",
  "text": "Hello, this is a test message",
  "voice": "af_heart",
  "speed": 1.0,
  "language": "a"
}
```

#### Streaming Session Started
```json
{
  "status": "streaming_started",
  "session_id": 12345,
  "voice": "af_heart",
  "speed": 1.0,
  "language": "a"
}
```

#### Audio Chunk (Streaming)
```json
{
  "type": "audio_chunk",
  "audio_chunk": "base64_encoded_wav_data",
  "sample_rate": 24000,
  "format": "wav",
  "text_chunk": "Hello, this is a ",
  "voice": "af_heart",
  "speed": 1.0,
  "language": "a",
  "session_id": 12345
}
```

#### Chunk Acknowledgment
```json
{
  "type": "chunk_received",
  "session_id": 12345,
  "buffer_size": 25,
  "processed_sentences": 1
}
```

#### Streaming Session Ended
```json
{
  "type": "streaming_ended",
  "session_id": 12345
}
```

#### Error Response
```json
{
  "error": "Error message description"
}
```

## Available Voices

### Female Voices
- `af_heart` - American Female (warm, expressive)
- `af_sky` - American Female (clear, professional)
- `af_bella` - American Female (friendly, conversational)

### Male Voices  
- `am_adam` - American Male (deep, authoritative)
- `am_michael` - American Male (clear, professional)

### Language-Specific Voices
- `bf_emma` - British Female
- `bm_george` - British Male
- `ef_isabella` - Spanish Female
- `em_carlos` - Spanish Male
- `ff_marie` - French Female
- `fm_pierre` - French Male

## Client Example

### JavaScript Client
```javascript
const ws = new WebSocket('ws://localhost:2701');

ws.onopen = function() {
    // Send TTS request
    ws.send(JSON.stringify({
        text: "Hello, how are you today?",
        voice: "af_heart",
        speed: 1.0,
        language: "a"
    }));
};

ws.onmessage = function(event) {
    const response = JSON.parse(event.data);
    
    if (response.error) {
        console.error('TTS Error:', response.error);
        return;
    }
    
    // Convert base64 to audio and play
    const audioData = atob(response.audio);
    const audioArray = new Uint8Array(audioData.length);
    for (let i = 0; i < audioData.length; i++) {
        audioArray[i] = audioData.charCodeAt(i);
    }
    
    const audioBlob = new Blob([audioArray], { type: 'audio/wav' });
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    audio.play();
};
```

### Python Client
```python
import asyncio
import websockets
import json
import base64
import wave

async def tts_client():
    uri = "ws://localhost:2701"
    
    async with websockets.connect(uri) as websocket:
        # Send TTS request
        request = {
            "text": "Hello, this is a test message",
            "voice": "af_heart", 
            "speed": 1.0,
            "language": "a"
        }
        
        await websocket.send(json.dumps(request))
        response = await websocket.recv()
        
        data = json.loads(response)
        
        if 'error' in data:
            print(f"Error: {data['error']}")
            return
            
        # Save audio to file
        audio_data = base64.b64decode(data['audio'])
        with open('output.wav', 'wb') as f:
            f.write(audio_data)
            
        print(f"Audio saved to output.wav")
        print(f"Text: {data['text']}")
        print(f"Voice: {data['voice']}")
        print(f"Speed: {data['speed']}")

# Run the client
asyncio.run(tts_client())
```

## Performance Notes

- **CPU Mode**: Suitable for development and light usage
- **GPU Mode**: Recommended for production with high throughput
- **Memory Usage**: ~1-2GB RAM depending on language models loaded
- **Latency**: Typically 100-500ms for short texts on modern hardware

## Troubleshooting

### Common Issues

1. **Import Error for kokoro**: Install with `pip install kokoro>=0.9.4`
2. **Missing espeak**: Install espeak-ng for phoneme processing
3. **CUDA Errors**: Ensure PyTorch CUDA version matches your CUDA installation
4. **Memory Issues**: Use CPU mode or reduce concurrent connections

### Logs
Server logs include connection info, processing times, and error details. Set log level with:
```bash
export PYTHONPATH=. && python -c "import logging; logging.basicConfig(level=logging.DEBUG)" websocket/tts_server.py
