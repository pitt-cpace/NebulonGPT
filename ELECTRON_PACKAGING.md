# NebulonGPT Electron Packaging Guide

## Overview

This guide explains how to build distributable packages (.app for macOS, .exe for Windows, AppImage/deb for Linux) that contain embedded ZIP files for Vosk and Kokoro models. When the app runs, it automatically checks for and extracts these models on first launch.

## Architecture

The packaging system works as follows:

1. **Build Process**: `electron-builder` copies ZIP files from the project into the app bundle using `extraResources`
2. **Runtime Extraction**: On first launch, the app checks for embedded models and extracts them to user data directory
3. **Version Management**: Uses version checking to avoid re-extraction on subsequent launches
4. **Cross-Platform**: Works on macOS (.dmg), Windows (.exe), and Linux (AppImage/deb)

## File Structure

```
NebulonGPT/
├── Kokoro-TTS-Server/
│   ├── huggingface-cache.zip.001    # Split cache files (embedded in app)
│   ├── huggingface-cache.zip.002
│   ├── huggingface-cache.zip.003
│   ├── huggingface-cache.zip.004
│   └── websocket/                   # Python TTS server (embedded in app)
├── Vosk-Server/
│   ├── websocket/
│   │   ├── models/                  # Vosk model ZIP files (embedded in app)
│   │   └── asr_server_with_models.py # Python ASR server (embedded in app)
├── electron.js                     # Main Electron process with extraction logic
├── preload.js                      # IPC bridge
└── package.json                    # Build configuration
```

## Build Configuration

The `package.json` contains the electron-builder configuration:

```json
{
  "build": {
    "extraResources": [
      {
        "from": "Vosk-Server/websocket/models",
        "to": "models/vosk",
        "filter": ["**/*.zip*"]
      },
      {
        "from": "Kokoro-TTS-Server",
        "to": "models/kokoro",
        "filter": ["huggingface-cache.zip.*"]
      },
      {
        "from": "Vosk-Server/websocket",
        "to": "vosk-server"
      },
      {
        "from": "Kokoro-TTS-Server/websocket",
        "to": "kokoro-tts"
      }
    ]
  }
}
```

## Runtime Extraction Process

### 1. Version Checking
- App checks `~/.nebulon-gpt/VERSION.json` for existing extraction
- Compares app version and model version to determine if re-extraction is needed

### 2. Model Extraction Locations
- **Kokoro Cache**: `~/.nebulon-gpt/huggingface-cache/`
- **Vosk Models**: `~/.nebulon-gpt/vosk-models/`
- **Chat Data**: `~/.nebulon-gpt/chats.json`

### 3. Extraction Process
1. **Kokoro TTS**: Concatenates split ZIP files → extracts to cache directory
2. **Vosk Models**: Copies and extracts ZIP files to models directory
3. **Version Marker**: Creates VERSION.json to skip future extractions

## Build Commands

### Development
```bash
npm run electron-dev          # Run in development mode
```

### Production Builds
```bash
npm run dist:mac              # Build macOS .dmg
npm run dist:win              # Build Windows .exe (NSIS installer)
npm run dist:linux            # Build Linux AppImage and .deb
npm run dist                  # Build for current platform
```

### Build Outputs
- **macOS**: `dist-electron/NebulonGPT-0.1.0.dmg`
- **Windows**: `dist-electron/NebulonGPT Setup 0.1.0.exe`
- **Linux**: `dist-electron/NebulonGPT-0.1.0.AppImage` and `dist-electron/nebulon-gpt_0.1.0_amd64.deb`

## Platform-Specific Features

### macOS (.dmg)
- Universal binary (x64 + arm64)
- Drag-and-drop installer
- Proper app signing (when certificates available)

### Windows (.exe)
- NSIS installer with user choice of install directory
- Desktop and Start Menu shortcuts
- Uninstaller included

### Linux (AppImage + .deb)
- **AppImage**: Single portable executable
- **DEB**: Traditional Debian package for apt installation

## First Run Experience

1. **App Launch**: User double-clicks the app
2. **Model Check**: App checks if models are already extracted
3. **Extraction**: If first run, shows "Extracting models..." (silent background process)
4. **Service Startup**: Starts Python services (Vosk ASR, Kokoro TTS)
5. **UI Ready**: Main window appears when all services are running

## Troubleshooting

### Build Issues
- **Canvas errors**: Canvas package has been removed to avoid native compilation issues
- **Python dependencies**: Ensure Python 3.x is available on target system
- **Missing models**: Check that ZIP files exist in source directories before building

### Runtime Issues
- **Extraction fails**: Check disk space and permissions in user data directory
- **Services won't start**: Verify Python installation and dependencies
- **Models not found**: Delete `~/.nebulon-gpt/VERSION.json` to force re-extraction

## Development Notes

### Adding New Models
1. Place ZIP files in appropriate source directories
2. Update `extraResources` configuration in package.json
3. Modify extraction logic in `electron.js` if needed
4. Increment version in `extractBundledResources()` function

### Updating Extraction Logic
- Modify `extractKokoroCache()` and `extractVoskModels()` functions
- Update version string to force re-extraction for existing users
- Test extraction on clean systems

## Security Considerations

- Models are extracted to user data directory (not system-wide)
- No elevated permissions required
- ZIP files are validated during extraction
- Temporary files are cleaned up after extraction

## Performance Notes

- First launch takes longer due to model extraction (1-3 minutes depending on model size)
- Subsequent launches are fast (models already extracted)
- Extraction happens in background with minimal UI blocking
- Large models (>1GB) may require progress indicators in future versions

## File Size Considerations

- **Kokoro Cache**: ~500MB (split into 4 parts for GitHub compatibility)
- **Vosk Models**: Varies by language (50MB-1GB per model)
- **Total App Size**: 1-2GB depending on included models
- **Compressed Installer**: ~30-50% smaller due to compression

This packaging approach ensures users get a single-file installer that contains everything needed to run NebulonGPT offline, including all AI models and dependencies.
