# Vosk Models Management in NebulonGPT

This guide explains how to use the Vosk speech recognition models management system in NebulonGPT.

## New Features

### 1. Model Management via User Interface
- Upload new models through web interface
- Delete unnecessary models
- Automatic ZIP file extraction
- View model information (size, modification date)

### 2. Persistent Storage in Docker
- Models are stored in Docker Volume
- Models persist after container restart
- Automatic model backup copying when needed

### 3. Model Management API
- `/api/vosk/models` - Get models list
- `/api/vosk/models/upload` - Upload new model
- `/api/vosk/models/:name` - Delete model
- `/api/vosk/models/:name/extract` - Extract ZIP file

## How to Use

### Accessing Model Management
1. Click on the Settings icon (⚙️)
2. In the "Speech Recognition Model" section, click on the management icon (💾)
3. The model management window opens

### Upload New Model
1. Click on "Select ZIP Files" button
2. Select one or more Vosk model ZIP files (multiple selection supported)
3. All models are automatically uploaded and extracted sequentially
4. **Force Overwrite**: If a model already exists, it will be automatically overwritten
5. Progress is shown for the entire batch upload
6. Click "Refresh" to update the models list

### Download Models
You can download Vosk models from:
https://alphacephei.com/vosk/models

### Recommended Models
- **vosk-model-small-en-us-0.15** - American English (small, fast)
- **vosk-model-en-us-0.22** - American English (large, more accurate)
- **vosk-model-small-fa-0.42** - Persian (small)
- **vosk-model-fa-0.42** - Persian (large)

## Docker Configuration

### docker-compose.yml
```yaml
services:
  vosk-server:
    volumes:
      - vosk-models:/app/models
      - ./Vosk-Server/websocket/models:/app/models-backup

volumes:
  vosk-models:
    driver: local
```

### Benefits of This Approach
1. **Persistence**: Models are preserved after container deletion
2. **Backup**: Initial models are copied from host system
3. **Flexibility**: Ability to add new models without rebuild

## Troubleshooting

### Issue: Models not visible after restart
**Solution**: 
1. Make sure Docker Volume is configured correctly
2. Check container logs: `docker-compose logs vosk-server`

### Issue: Model upload error
**Solution**:
1. Make sure the ZIP file is valid
2. File size should be less than 5GB
3. Stable internet connection required

### Issue: Uploaded model doesn't work
**Solution**:
1. Make sure the model is suitable for Vosk
2. Files `am/final.mdl` or `conf/model.conf` should exist
3. Re-extract the model

### Issue: ZIP extraction fails on Windows
**Solution**:
This has been fixed! The system now uses a cross-platform Node.js library (`node-stream-zip`) instead of system commands, so it works on Windows, macOS, and Linux without requiring additional software.

### Issue: Upload fails with "Error uploading model" or "Network Error"
**Solution**:
The Node.js server (port 3001) needs to be running for upload functionality. 

**To start the server:**
1. **Development mode**: Run `npm start` (starts both React and Node.js server)
2. **Production mode**: Run `npm run server` (starts only Node.js server)
3. **Docker mode**: Make sure the `nebulon-gpt` service is running in docker-compose

**Note**: Model viewing works without the Node.js server (gets models from Vosk server), but upload requires the Node.js server.

## File Structure

```
NebulonGPT/
├── Vosk-Server/websocket/models/     # Backup models on host
│   ├── vosk-model-en-us-0.22/
│   ├── vosk-model-small-en-us-0.15/
│   └── ...
├── src/components/
│   ├── VoskModelManager.tsx          # Model management component
│   ├── VoskModelSelector.tsx         # Model selector
│   └── SettingsDialog.tsx           # Settings
└── server.js                        # Model management API
```

## API Reference

### GET /api/vosk/models
Get list of available models

**Response:**
```json
{
  "models": [
    {
      "name": "vosk-model-en-us-0.22",
      "type": "directory",
      "size": 1073741824,
      "modified": "2023-01-01T00:00:00.000Z",
      "status": "ready"
    }
  ]
}
```

### POST /api/vosk/models/upload
Upload new model

**Request:** FormData with `model` field (ZIP file)

**Response:**
```json
{
  "success": true,
  "message": "Model uploaded and extracted successfully",
  "filename": "vosk-model-en-us-0.22.zip",
  "extracted": true
}
```

### DELETE /api/vosk/models/:modelName
Delete model

**Response:**
```json
{
  "success": true,
  "message": "Model deleted successfully"
}
```

### POST /api/vosk/models/:modelName/extract
Extract ZIP file

**Response:**
```json
{
  "success": true,
  "message": "Model extracted successfully"
}
```

## Security Notes

1. Only ZIP files are accepted
2. Maximum file size is 5GB
3. Files are stored in restricted directory
4. File type validation is performed

## Future Updates

- [ ] Support for more formats
- [ ] Automatic model compression
- [ ] Direct download from online sources
- [ ] Management of different model versions
- [ ] Model usage statistics
