# Vosk Speech Recognition Integration

This project has been successfully integrated with Vosk WebSocket server for real-time speech recognition, replacing the browser's built-in speech recognition API.

## Features

- **Real-time speech recognition** using Vosk WebSocket server
- **Multiple model support** - select from available Vosk models for different languages
- **Model hot-swapping** - switch between models without restarting the server
- **Shared model caching** - efficient memory usage when multiple clients use the same model
- **Offline processing** - no data sent to external services
- **High accuracy** speech-to-text conversion
- **Continuous recognition** with partial and final results
- **Automatic fallback** - graceful handling when Vosk server is unavailable
- **User-friendly model selector** - intuitive interface for choosing speech recognition models

## Prerequisites

1. **Vosk Server Running**: You need to have the Vosk WebSocket server running on `localhost:2700`
2. **Vosk Model**: A compatible Vosk model (e.g., `vosk-model-small-en-us-0.15`)

## Setup Instructions

### 1. Start the Enhanced Vosk Server (with Model Selection)

For the new model selection feature, use the enhanced server:

```bash
cd E:\Program\Web\vosk-server\websocket
python asr_server_with_models.py /path/to/models/directory
```

Or set the models directory via environment variable:

```bash
export VOSK_MODELS_DIR=/path/to/models/directory
python asr_server_with_models.py
```

You should see output similar to:
```
INFO:root:Available models: vosk-model-small-en-us-0.15, vosk-model-ru-0.42, vosk-model-de-0.21
INFO:root:Starting Vosk WebSocket server on 0.0.0.0:2700
INFO:root:Models directory: /path/to/models/directory
INFO:websockets.server:server listening on 0.0.0.0:2700
```

### 1.1. Legacy Server (Single Model)

For backward compatibility, you can still use the original server:

```bash
cd E:\Program\Web\vosk-server\websocket
python asr_server.py vosk-model-small-en-us-0.15
```

### 2. Organize Your Vosk Models

Create a models directory and place your Vosk models there:

```
models/
├── vosk-model-small-en-us-0.15/
│   ├── am/
│   ├── conf/
│   └── ...
├── vosk-model-ru-0.42/
│   ├── am/
│   ├── conf/
│   └── ...
└── vosk-model-de-0.21/
    ├── am/
    ├── conf/
    └── ...
```

### 3. Start the React Application

```bash
npm start
```

## How It Works

### Architecture

1. **VoskSpeechRecognition Service** (`src/services/vosk.ts`):
   - Manages WebSocket connection to Vosk server
   - Handles audio capture and processing
   - Converts audio to 16-bit PCM format required by Vosk
   - Provides event-driven interface similar to Web Speech API

2. **ChatArea Integration** (`src/components/ChatArea.tsx`):
   - Automatically detects Vosk server availability
   - Initializes Vosk recognition on component mount
   - Handles speech recognition events (partial/final results)
   - Displays real-time transcription feedback

### Audio Processing

- **Sample Rate**: 16kHz (required by Vosk)
- **Format**: 16-bit PCM mono
- **Buffer Size**: 4096 samples
- **Audio Enhancements**: Echo cancellation, noise suppression, auto gain control

### User Interface

- **Microphone Button**: Click to start/stop speech recognition
- **Visual Feedback**: 
  - Normal state: Default microphone icon
  - Listening: Active microphone icon with different styling
  - Error: Error state with warning color
- **Real-time Display**: Interim results shown as you speak
- **Tooltip**: Shows "Start dictation (Vosk)" or "Stop dictation (Vosk)"

## Model Selection Feature

### Overview

The enhanced Vosk integration now supports multiple speech recognition models, allowing users to select the most appropriate model for their language and use case.

### Using the Model Selector

1. **Access the Model Selector**: On the welcome screen, you'll see a "Speech Recognition Model" section if the Vosk server is available
2. **View Available Models**: The dropdown shows all models found in the server's models directory
3. **Select a Model**: Choose from the list - models are displayed with user-friendly names (e.g., "English (Small)" instead of "vosk-model-small-en-us-0.15")
4. **Model Loading**: When you select a model, it will be loaded on the server (this may take a few seconds for large models)
5. **Active Model Display**: The currently active model is shown with a green chip indicator

### Model Name Formatting

The interface automatically formats model names for better readability:

- **Language Detection**: Recognizes language codes (en, es, fr, de, ru, etc.) and displays full language names
- **Size Information**: Detects size indicators (small, large, medium, tiny) and includes them in the display
- **Regional Variants**: Handles regional codes like "en-us" → "English (US)"

### Supported Languages

The system supports models for many languages including:
- English (US/UK), Spanish, French, German, Russian
- Chinese, Japanese, Korean, Arabic, Hindi
- And many more (depends on available Vosk models)

### Model Caching and Memory Management

- **Shared Models**: Multiple clients can use the same model without duplicating memory usage
- **Reference Counting**: Models are automatically unloaded when no clients are using them
- **Hot Swapping**: Switch between models without restarting the server or losing connections

## Usage

### Basic Speech Recognition

1. **Select a Model**: Choose your preferred speech recognition model from the dropdown (if available)
2. **Start Speaking**: Click the microphone button in the chat input area
3. **Real-time Feedback**: See partial transcription as you speak
4. **Final Results**: Complete sentences are added to the input field
5. **Stop Recording**: Click the microphone button again or wait for automatic stop

### Model Management

1. **Refresh Models**: Click the refresh button next to the model selector to reload the available models list
2. **Switch Models**: Select a different model at any time - the change takes effect immediately
3. **Model Status**: The active model is displayed with a green indicator chip

## Error Handling

The integration includes comprehensive error handling:

- **Server Unavailable**: Shows error message if Vosk server is not running
- **Connection Issues**: Automatic reconnection attempts
- **Audio Errors**: Graceful fallback with user feedback
- **Permission Denied**: Clear error messages for microphone access

## Troubleshooting

### Common Issues

1. **"Vosk server not available"**:
   - Ensure Vosk server is running on `localhost:2700`
   - Check firewall settings
   - Verify the server is accessible

2. **"Failed to access microphone"**:
   - Grant microphone permissions in browser
   - Check if another application is using the microphone
   - Try refreshing the page

3. **Poor Recognition Quality**:
   - Ensure good microphone quality
   - Speak clearly and at moderate pace
   - Check for background noise

### Server Status Check

The application automatically checks server availability on startup. You can verify manually by opening browser developer tools and checking the console for:

```
✅ WebSocket connected to Vosk server
```

## Configuration

### Changing Server URL

To use a different Vosk server URL, modify the default in `src/services/vosk.ts`:

```typescript
constructor(private serverUrl: string = 'ws://your-server:port') {}
```

### Audio Settings

Audio capture settings can be modified in the `initializeAudio()` method:

```typescript
this.mediaStream = await navigator.mediaDevices.getUserMedia({ 
  audio: {
    sampleRate: 16000,        // Required by Vosk
    channelCount: 1,          // Mono audio
    echoCancellation: true,   // Reduce echo
    noiseSuppression: true,   // Reduce background noise
    autoGainControl: true     // Automatic volume adjustment
  } 
});
```

## Benefits Over Browser Speech Recognition

1. **Privacy**: All processing happens locally
2. **Reliability**: No internet connection required
3. **Consistency**: Same recognition engine across all browsers
4. **Customization**: Can use different Vosk models for different languages
5. **Performance**: Lower latency for real-time applications

## Technical Details

### WebSocket Protocol

The integration uses WebSocket for real-time communication with an enhanced protocol for model management:

#### Message Types (Client → Server)

| Message Type | Format | Purpose |
|--------------|--------|---------|
| `get_models` | `{"type": "get_models"}` | Request list of available models |
| `select_model` | `{"type": "select_model", "model": "model-name"}` | Select/load a specific model |
| Audio Data | Binary ArrayBuffer (Int16Array) | Raw PCM audio frames |
| End of Stream | `{"eof": 1}` | Signal end of audio stream |

#### Message Types (Server → Client)

| Message Type | Format | Purpose |
|--------------|--------|---------|
| `models` | `{"type": "models", "models": ["model1", "model2"]}` | List of available models |
| `model_loaded` | `{"type": "model_loaded", "model": "model-name"}` | Confirmation that model is loaded |
| `result` | `{"type": "result", "text": "transcribed text"}` | Final transcription result |
| `error` | `{"type": "error", "message": "error description"}` | Error notification |

#### Legacy Support

The enhanced server maintains backward compatibility with the original protocol:
- Binary audio data is processed the same way
- Legacy JSON messages are still supported
- Original result format is preserved for compatibility

### Memory Management

- Automatic cleanup of audio resources
- WebSocket connection management
- Proper disposal of audio contexts and streams

## Future Enhancements

Potential improvements for the integration:

1. **Multiple Language Support**: Switch between different Vosk models
2. **Voice Commands**: Implement specific voice commands for UI actions
3. **Speaker Recognition**: Identify different speakers in conversations
4. **Custom Vocabulary**: Add domain-specific terms for better recognition
5. **Audio Visualization**: Real-time audio level indicators

## Support

For issues related to:
- **Vosk Integration**: Check this documentation and console logs
- **Vosk Server**: Refer to [Vosk documentation](https://alphacephei.com/vosk/)
- **General Application**: Check the main project README
