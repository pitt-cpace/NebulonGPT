# 🎵 Text-to-Speech Integration with Kokoro TTS

This document describes the complete TTS integration setup for NebulonGPT using Kokoro TTS server.

## 🚀 Quick Start

### Using Docker (Recommended)

1. **Start the complete system with TTS:**
   ```bash
   ./docker-start.sh
   ```
   *Works on Mac, Linux, and Windows (PowerShell/Docker Desktop)*

2. **Access the application:**
   - **NebulonGPT UI**: http://localhost:3000
   - **Vosk Speech Server**: ws://localhost:2700
   - **Kokoro TTS Server**: ws://localhost:2701

### Manual Setup

1. **Install TTS dependencies:**
   ```bash
   cd Kokoro-TTS-Server
   pip3 install -r requirements.txt
   ```

2. **Start TTS server:**
   ```bash
   cd Kokoro-TTS-Server
   python3 websocket/tts_server.py
   ```

3. **Start NebulonGPT:**
   ```bash
   npm start
   ```

## 🎛️ TTS Settings in UI

### Accessing TTS Settings

1. Click the **Settings** ⚙️ button in the UI
2. Navigate to the **Text-to-Speech Settings** section (🎤 icon)

### Available Settings

#### **Full Voice Mode**
- ✅ **Checkbox**: Enable/disable TTS for LLM responses
- **Description**: "Enable text-to-speech for LLM responses"

#### **Voice Gender** *(appears only when Full Voice Mode is enabled)*
- 🔘 **Female** (default)
- ⚪ **Male**

#### **TTS Status Indicator** *(appears only when Full Voice Mode is enabled)*
- 🟢 **Connected**: TTS server is ready
- 🟠 **Connecting/Reconnecting**: Attempting to connect
- 🔴 **Disconnected**: TTS server unavailable

## 🐳 Docker Configuration

### Services

#### **NebulonGPT Main App**
- **Port**: 3000
- **Environment**: 
  - `TTS_SERVER_URL=ws://kokoro-tts:2701`

#### **Kokoro TTS Server**
- **Port**: 2701
- **Environment**:
  - `KOKORO_SERVER_HOST=0.0.0.0`
  - `KOKORO_SERVER_PORT=2701`
- **Volumes**: `tts-models:/app/models`

### Docker Commands

```bash
# Start services
docker-compose up --build

# Stop services
docker-compose down

# View logs
docker-compose logs -f kokoro-tts

# Rebuild specific service
docker-compose build kokoro-tts
```

## 🔧 Technical Implementation

### TTS Service (`src/services/ttsService.ts`)

#### **Key Features**
- **WebSocket connection** to TTS server
- **Automatic reconnection** with exponential backoff
- **Status monitoring** and callbacks
- **Audio playback** from base64 data
- **Settings persistence**

#### **API Methods**
```typescript
// Connect to TTS server
await ttsService.connect();

// Update settings
ttsService.updateSettings({
  fullVoiceMode: true,
  voiceGender: 'female'
});

// Speak text
await ttsService.speak("Hello, world!");

// Stop current speech
ttsService.stop();

// Get current status
const status = ttsService.getStatus();
```

### Settings Dialog Integration

The TTS settings are integrated into the existing Model Settings dialog:

- **Real-time status updates** via WebSocket callbacks
- **Persistent settings** stored in TTS service
- **Automatic connection** on component mount
- **Visual status indicators** with colored dots

## 🎯 Available TTS Servers

### 1. **Basic TTS Server** (`tts_server.py`)
- **Port**: 2701
- **Features**: Simple text-to-speech conversion
- **Usage**: Basic TTS functionality

### 2. **Queue TTS Server** (`queue_tts_server.py`)
- **Port**: 2701
- **Features**: Queue management, pause/resume/skip
- **Usage**: Advanced TTS with playback controls

### 3. **Browser TTS Server** (`browser_tts_server.py`)
- **Port**: 2701
- **Features**: Browser-optimized TTS
- **Usage**: Web-based TTS interface

## 🔌 WebSocket Protocol

### Message Format

#### **Client to Server**
```json
{
  "action": "speak",
  "text": "Hello, world!",
  "voice": "female"
}
```

#### **Server to Client**
```json
{
  "type": "audio",
  "data": "base64_encoded_audio_data"
}
```

### Supported Actions
- `speak`: Convert text to speech
- `stop`: Stop current playback
- `status`: Get server status

## 🛠️ Development

### Adding New TTS Features

1. **Update TTS Service** (`src/services/ttsService.ts`)
2. **Modify Settings Dialog** (`src/components/SettingsDialog.tsx`)
3. **Test with Docker** using `./docker-start.sh`

### Debugging

#### **Check TTS Server Logs**
```bash
docker-compose logs -f kokoro-tts
```

#### **Test TTS Connection**
```bash
# Test WebSocket connection
wscat -c ws://localhost:2701
```

#### **Browser Console**
- Check for TTS connection errors
- Monitor WebSocket messages
- Verify audio playback

## 🚨 Troubleshooting

### Common Issues

#### **TTS Status: Reconnecting...**
- **Cause**: TTS server not running or unreachable
- **Solution**: Start TTS server or check Docker containers

#### **No Audio Playback**
- **Cause**: Browser audio permissions or codec issues
- **Solution**: Check browser audio settings and permissions

#### **Connection Failed**
- **Cause**: Port conflicts or firewall issues
- **Solution**: Check port availability and firewall settings

### Port Configuration

| Service | Default Port | Environment Variable |
|---------|-------------|---------------------|
| NebulonGPT | 3000 | - |
| Basic TTS | 2701 | `KOKORO_SERVER_PORT` |
| Queue TTS | 2701 | `KOKORO_SERVER_PORT` |
| Browser TTS | 2701 | `KOKORO_SERVER_PORT` |

## 📝 Notes

- **Female voice** is selected by default
- **Full Voice Mode** must be enabled for TTS to work
- **Settings persistence** - TTS preferences are saved when clicking "Save" button
- **Cancel behavior** - TTS settings revert to saved values when clicking "Cancel"
- **Docker setup** handles all dependencies automatically
- **Status indicator** shows real-time connection state
- **Automatic reconnection** handles temporary disconnections

## 🎉 Success Indicators

When everything is working correctly, you should see:

1. ✅ **TTS Status: Connected** (green dot)
2. 🎵 **Audio playback** when Full Voice Mode is enabled
3. 🔄 **Real-time status updates** in the settings dialog
4. 📱 **Responsive UI** with immediate setting changes

---

**Ready to use TTS with NebulonGPT!** 🚀🎵
