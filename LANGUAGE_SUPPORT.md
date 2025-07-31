# Language Support for NebulonGPT TTS

This document explains the automatic language detection and TTS language switching system based on Vosk speech recognition models.

## 🎯 How It Works

When you select a Vosk model for speech recognition, the system automatically detects the language and switches the TTS (Text-to-Speech) to match. This ensures seamless multilingual conversations.

## ✅ Fully Supported Languages (No Additional Setup Required)

These languages work out of the box with Kokoro TTS:

| Language | Vosk Model Examples | TTS Voice | Notes |
|----------|-------------------|-----------|-------|
| **English (US)** | `vosk-model-en-us-0.22`, `vosk-model-small-en-us-0.15` | `af_heart` (American) | Default language |
| **English (UK)** | `vosk-model-en-gb-*` | `bf_emma` (British) | British accent |
| **English (India)** | `vosk-model-en-in-*` | `af_heart` (American) | Uses American voice |
| **Spanish** | `vosk-model-es-0.42`, `vosk-model-small-es-0.42` | `ef_dora` | Full Spanish support |
| **French** | `vosk-model-fr-0.22`, `vosk-model-small-fr-0.22` | `ff_siwis` | Full French support |
| **Italian** | `vosk-model-it-0.22`, `vosk-model-small-it-0.22` | `if_sara` | Full Italian support |
| **Portuguese** | `vosk-model-pt-*`, `vosk-model-small-pt-0.3` | `pf_dora` | Brazilian Portuguese |
| **Hindi** | `vosk-model-hi-0.22`, `vosk-model-small-hi-0.22` | `hf_alpha` | Full Hindi support |

## ✅ Additional Supported Languages

These languages are now fully supported (dependencies included in requirements.txt):

### Chinese (Mandarin)
- **Vosk Models**: `vosk-model-cn-0.22`, `vosk-model-small-cn-0.22`
- **TTS Voice**: `zf_xiaobei`
- **Status**: ✅ Fully supported

### Japanese
- **Vosk Models**: `vosk-model-ja-0.22`, `vosk-model-small-ja-0.22`
- **TTS Voice**: `jf_alpha`
- **Status**: ✅ Fully supported

## 🚫 Unsupported Languages (English Fallback)

These languages are available in Vosk but not supported by Kokoro TTS. They will automatically fall back to English:

| Language | Vosk Models Available | Fallback |
|----------|---------------------|----------|
| **Russian** | `vosk-model-ru-0.42`, `vosk-model-small-ru-0.22` | English (American) |
| **German** | `vosk-model-de-0.21`, `vosk-model-small-de-0.15` | English (American) |
| **Turkish** | `vosk-model-small-tr-0.3` | English (American) |
| **Vietnamese** | `vosk-model-vn-0.4`, `vosk-model-small-vn-0.4` | English (American) |
| **Dutch** | `vosk-model-small-nl-0.22` | English (American) |
| **Korean** | `vosk-model-small-ko-0.22` | English (American) |
| **Arabic** | `vosk-model-ar-*` | English (American) |
| **Persian/Farsi** | `vosk-model-fa-*` | English (American) |
| **Ukrainian** | `vosk-model-uk-*` | English (American) |
| **Polish** | `vosk-model-small-pl-0.22` | English (American) |
| **Czech** | `vosk-model-small-cs-*` | English (American) |
| **And others...** | Various models available | English (American) |

## 🛠️ Installation

All language dependencies are now automatically managed through the `requirements.txt` file:

```
misaki[en,zh,ja]
```

This includes:
- **English** (`misaki[en]`) - Default language support
- **Chinese** (`misaki[zh]`) - Mandarin Chinese support  
- **Japanese** (`misaki[ja]`) - Japanese language support

### Setup Process

1. **Install Dependencies**: Run `pip install -r Kokoro-TTS-Server/requirements.txt`
2. **Start TTS Server**: The server will automatically have all language support enabled
3. **Test Languages**: Select Chinese or Japanese Vosk models to test automatic switching

## 🎯 Usage Examples

### Automatic Language Switching

1. **Select Spanish Model**: Choose "vosk-model-es-0.42" in Vosk settings
   - System automatically switches to Spanish TTS (`ef_dora` voice)
   - Console shows: `🌐 TTS language automatically switched to Spanish`

2. **Select Chinese Model**: Choose "vosk-model-cn-0.22" in Vosk settings
   - If dependencies installed: Switches to Chinese TTS (`zf_xiaobei` voice)
   - If not installed: Shows warning with installation instructions

3. **Select Unsupported Model**: Choose "vosk-model-de-0.21" (German)
   - System falls back to English TTS
   - Console shows: `⚠️ German language is not supported by Kokoro TTS. Using English voice instead.`

### Console Output Examples

**Supported Language (Spanish)**:
```
🌐 Detected language "es" from model: vosk-model-es-0.42
🌐 TTS language automatically switched to Spanish based on Vosk model: vosk-model-es-0.42
```

**Supported Language (Chinese)**:
```
🌐 Detected language "cn" from model: vosk-model-cn-0.22
🌐 TTS language automatically switched to Mandarin Chinese based on Vosk model: vosk-model-cn-0.22
```

**Supported Language (Japanese)**:
```
🌐 Detected language "ja" from model: vosk-model-ja-0.22
🌐 TTS language automatically switched to Japanese based on Vosk model: vosk-model-ja-0.22
```

**Unsupported Language (German)**:
```
🌐 Detected language "de" from model: vosk-model-de-0.21
⚠️ German language is not supported by Kokoro TTS. Using English voice instead.
```

## 🔧 Technical Details

### Language Detection Process

1. **Model Selection**: User selects a Vosk model (e.g., "vosk-model-cn-0.22")
2. **Pattern Matching**: System extracts language code using regex patterns:
   - `vosk-model-([a-z]{2}(?:-[a-z]{2})?)-` → extracts "cn"
3. **Mapping Lookup**: Finds corresponding Kokoro TTS settings:
   - `cn` → Language: `z`, Voice: `zf_xiaobei`
4. **Support Check**: Verifies if language dependencies are installed
5. **TTS Update**: Switches TTS settings or shows warning message

### Configuration Files

- **Language Mappings**: `src/services/languageMapping.ts`
- **TTS Service**: `src/services/ttsService.ts`
- **Vosk Integration**: `src/services/vosk.ts`

### Supported Model Patterns

The system recognizes these Vosk model naming patterns:
- `vosk-model-{lang}-{version}` (e.g., `vosk-model-cn-0.22`)
- `vosk-model-small-{lang}-{version}` (e.g., `vosk-model-small-es-0.42`)
- `{lang}-{version}` (e.g., `cn-0.22`)
- Special cases: `vosk-model-el-gr`, `vosk-model-tl-ph`, `vosk-model-ar-tn`

## 🎛️ Settings

### Auto Language Detection

- **Location**: TTS Settings → Auto Language Detection
- **Default**: Enabled
- **Function**: Automatically switches TTS language based on selected Vosk model
- **Disable**: If you prefer to manually control TTS language

### Full Voice Mode

- **Requirement**: Must be enabled for TTS to work
- **Function**: Enables real-time text-to-speech during conversations
- **Integration**: Works seamlessly with automatic language switching

## 🐛 Troubleshooting

### Chinese/Japanese Not Working

1. **Check Dependencies**: Dependencies are now included in `requirements.txt`
2. **Restart Server**: TTS server must be restarted after installing dependencies
3. **Check Console**: Look for language detection messages in browser console
4. **Reinstall**: Run `pip install -r Kokoro-TTS-Server/requirements.txt` to ensure all dependencies

### Language Not Switching

1. **Check Auto Detection**: Ensure "Auto Language Detection" is enabled in TTS settings
2. **Check Model Name**: Verify the Vosk model name follows supported patterns
3. **Check Console**: Look for language detection messages in browser console
4. **Manual Override**: Manually select language in TTS settings if needed

### Text Not Being Sent to TTS (Fixed)

**Issue**: Some languages (Chinese, Japanese, etc.) use different punctuation marks, causing text chunking to fail.

**Solution**: The TTS server now includes language-aware text processing that:
- Recognizes Western punctuation: `. ! ?`
- Recognizes Chinese/Japanese punctuation: `。！？｡`
- Handles languages without clear sentence boundaries
- Processes text in chunks when no punctuation is found

### Fallback to English

This is expected behavior for unsupported languages. The system will:
1. Show a warning message explaining the language is not supported
2. Automatically use English TTS as fallback
3. Continue working normally with English voice

## 📚 References

- **Kokoro TTS**: https://github.com/hexgrad/kokoro
- **Vosk Models**: https://alphacephei.com/vosk/models
- **Misaki G2P**: https://github.com/hexgrad/misaki
