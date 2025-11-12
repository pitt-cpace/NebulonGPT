import React, { useState, useEffect } from 'react';
import {
  Box,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Typography,
  CircularProgress,
  Alert,
  Chip,
  Tooltip,
  IconButton,
} from '@mui/material';
import {
  Refresh as RefreshIcon,
  Mic as MicIcon,
  Language as LanguageIcon,
  Storage as StorageIcon,
} from '@mui/icons-material';
import { VoskRecognitionService } from '../services/vosk';
import axios from 'axios';
import { isElectron, electronApi } from '../services/electronApi';

interface VoskModelSelectorProps {
  voskRecognition: VoskRecognitionService | null;
  disabled?: boolean;
  onModelSelected?: (modelName: string) => void;
  onError?: (error: string) => void;
  onMicStopped?: () => void;
  onMicStart?: React.MutableRefObject<(() => Promise<void>) | null>;
  onMicStop?: React.MutableRefObject<(() => Promise<void>) | null>;
  onManageModels?: () => void;
  onRefreshReady?: (refreshFn: () => void) => void;
}

const VoskModelSelector: React.FC<VoskModelSelectorProps> = ({
  voskRecognition,
  disabled = false,
  onModelSelected,
  onError,
  onMicStopped,
  onMicStart,
  onMicStop,
  onManageModels,
  onRefreshReady,
}) => {
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [loadingModel, setLoadingModel] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelDetails, setModelDetails] = useState<{ [key: string]: any }>({});

  // Use dynamic API base URL that works with any port (same logic as WebSocket detection)
  const API_BASE = `${window.location.protocol}//${window.location.host}`;

  // Helper function to format file sizes (same as VoskModelManager)
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Enhanced static language mapping with native scripts
  const getLanguageInfo = (modelName: string) => {
    const parts = modelName.toLowerCase().split('-');
    
    // Comprehensive language mappings with native scripts
    const languageMap: { [key: string]: { name: string; native: string; region?: string } } = {
      'en': { name: 'English', native: 'English' },
      'es': { name: 'Spanish', native: 'Español' },
      'fr': { name: 'French', native: 'Français' },
      'de': { name: 'German', native: 'Deutsch' },
      'ru': { name: 'Russian', native: 'Русский' },
      'zh': { name: 'Chinese', native: '中文' },
      'cn': { name: 'Chinese', native: '中文' },
      'ja': { name: 'Japanese', native: '日本語' },
      'ko': { name: 'Korean', native: '한국어' },
      'it': { name: 'Italian', native: 'Italiano' },
      'pt': { name: 'Portuguese', native: 'Português' },
      'ar': { name: 'Arabic', native: 'العربية' },
      'hi': { name: 'Hindi', native: 'हिन्दी' },
      'fa': { name: 'Persian', native: 'فارسی' },
      'tr': { name: 'Turkish', native: 'Türkçe' },
      'nl': { name: 'Dutch', native: 'Nederlands' },
      'sv': { name: 'Swedish', native: 'Svenska' },
      'da': { name: 'Danish', native: 'Dansk' },
      'no': { name: 'Norwegian', native: 'Norsk' },
      'fi': { name: 'Finnish', native: 'Suomi' },
      'pl': { name: 'Polish', native: 'Polski' },
      'cs': { name: 'Czech', native: 'Čeština' },
      'hu': { name: 'Hungarian', native: 'Magyar' },
      'ro': { name: 'Romanian', native: 'Română' },
      'bg': { name: 'Bulgarian', native: 'Български' },
      'hr': { name: 'Croatian', native: 'Hrvatski' },
      'sk': { name: 'Slovak', native: 'Slovenčina' },
      'sl': { name: 'Slovenian', native: 'Slovenščina' },
      'et': { name: 'Estonian', native: 'Eesti' },
      'lv': { name: 'Latvian', native: 'Latviešu' },
      'lt': { name: 'Lithuanian', native: 'Lietuvių' },
      'uk': { name: 'Ukrainian', native: 'Українська' },
      'be': { name: 'Belarusian', native: 'Беларуская' },
      'ka': { name: 'Georgian', native: 'ქართული' },
      'hy': { name: 'Armenian', native: 'Հայերեն' },
      'az': { name: 'Azerbaijani', native: 'Azərbaycan' },
      'kk': { name: 'Kazakh', native: 'Қазақша' },
      'ky': { name: 'Kyrgyz', native: 'Кыргызча' },
      'uz': { name: 'Uzbek', native: 'Oʻzbekcha' },
      'tg': { name: 'Tajik', native: 'Тоҷикӣ' },
      'mn': { name: 'Mongolian', native: 'Монгол' },
      'vi': { name: 'Vietnamese', native: 'Tiếng Việt' },
      'vn': { name: 'Vietnamese', native: 'Tiếng Việt' },
      'th': { name: 'Thai', native: 'ไทย' },
      'id': { name: 'Indonesian', native: 'Bahasa Indonesia' },
      'ms': { name: 'Malay', native: 'Bahasa Melayu' },
      'tl': { name: 'Filipino', native: 'Tagalog' },
      'sw': { name: 'Swahili', native: 'Kiswahili' },
      'am': { name: 'Amharic', native: 'አማርኛ' },
      'he': { name: 'Hebrew', native: 'עברית' },
      'ur': { name: 'Urdu', native: 'اردو' },
      'bn': { name: 'Bengali', native: 'বাংলা' },
      'ta': { name: 'Tamil', native: 'தமிழ்' },
      'te': { name: 'Telugu', native: 'తెలుగు' },
      'ml': { name: 'Malayalam', native: 'മലയാളം' },
      'kn': { name: 'Kannada', native: 'ಕನ್ನಡ' },
      'gu': { name: 'Gujarati', native: 'ગુજરાતી' },
      'pa': { name: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
      'or': { name: 'Odia', native: 'ଓଡ଼ିଆ' },
      'as': { name: 'Assamese', native: 'অসমীয়া' },
      'ne': { name: 'Nepali', native: 'नेपाली' },
      'si': { name: 'Sinhala', native: 'සිංහල' },
      'my': { name: 'Burmese', native: 'မြန်မာ' },
      'km': { name: 'Khmer', native: 'ខ្មែរ' },
      'lo': { name: 'Lao', native: 'ລາວ' },
      'ca': { name: 'Catalan', native: 'Català' },
      'el': { name: 'Greek', native: 'Ελληνικά' },
      'eo': { name: 'Esperanto', native: 'Esperanto' },
      'br': { name: 'Breton', native: 'Brezhoneg' },
      'is': { name: 'Icelandic', native: 'Íslenska' },
      'mt': { name: 'Maltese', native: 'Malti' },
      'cy': { name: 'Welsh', native: 'Cymraeg' },
      'ga': { name: 'Irish', native: 'Gaeilge' },
      'gd': { name: 'Scottish Gaelic', native: 'Gàidhlig' },
      'eu': { name: 'Basque', native: 'Euskera' },
      'fo': { name: 'Faroese', native: 'Føroyskt' },
      'lb': { name: 'Luxembourgish', native: 'Lëtzebuergesch' },
      'rm': { name: 'Romansh', native: 'Rumantsch' },
      'sq': { name: 'Albanian', native: 'Shqip' },
      'mk': { name: 'Macedonian', native: 'Македонски' },
      'sr': { name: 'Serbian', native: 'Српски' },
      'bs': { name: 'Bosnian', native: 'Bosanski' },
      'me': { name: 'Montenegrin', native: 'Crnogorski' },
    };

    let language = { name: '', native: '', region: undefined as string | undefined };
    let size = '';

    // Extract language from model name parts
    for (const part of parts) {
      if (languageMap[part]) {
        language = { ...languageMap[part], region: undefined };
        break;
      }
    }

    // Handle compound language codes and special cases
    if (parts.includes('en') && parts.includes('us')) {
      language = { ...language, name: 'English', native: 'English', region: 'US' };
    } else if (parts.includes('en') && parts.includes('gb')) {
      language = { ...language, name: 'English', native: 'English', region: 'UK' };
    } else if (parts.includes('en') && parts.includes('in')) {
      language = { ...language, name: 'English', native: 'English', region: 'India' };
    } else if (parts.includes('pt') && parts.includes('br')) {
      language = { ...language, name: 'Portuguese', native: 'Português', region: 'Brazil' };
    } else if (parts.includes('ar') && parts.includes('tn')) {
      language = { ...language, name: 'Arabic', native: 'العربية', region: 'Tunisia' };
    }

    // Extract size information
    if (parts.includes('small')) size = 'Small';
    else if (parts.includes('large')) size = 'Large';
    else if (parts.includes('medium')) size = 'Medium';
    else if (parts.includes('tiny')) size = 'Tiny';

    return { language, size };
  };

  // Helper function to format model names for display
  const formatModelName = (modelName: string): string => {
    const { language, size } = getLanguageInfo(modelName);
    
    if (language.name && size) {
      const regionSuffix = language.region ? ` (${language.region})` : '';
      return `${language.name}${regionSuffix} (${size})`;
    } else if (language.name) {
      const regionSuffix = language.region ? ` (${language.region})` : '';
      return `${language.name}${regionSuffix}`;
    } else {
      // Fallback: capitalize and clean up the original name
      return modelName
        .replace(/vosk-model-/gi, '')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase());
    }
  };

  // Helper function to get model details for second line
  const getModelDetails = (modelName: string): string => {
    const { language } = getLanguageInfo(modelName);
    
    // Extract version information
    const versionMatch = modelName.match(/(\d+\.\d+(?:\.\d+)?)/);
    const version = versionMatch ? `v${versionMatch[1]}` : '';
    
    // Create details string
    const languageDetails = language.native && language.native !== language.name 
      ? `${language.name}/${language.native}` 
      : language.name;
    
    const details = [languageDetails, version].filter(Boolean).join(' • ');
    return details || 'Speech recognition model';
  };




  // Load available models
  const loadModels = async () => {
    if (!voskRecognition) {
      setError('Vosk recognition not initialized');
      return;
    }

    setLoading(true);
    setError(null);

    // Use centralized method to check model availability
    const modelCheck = await voskRecognition.checkModelAvailability();
    
    if (!modelCheck.hasModels) {
      // Server not available or no models found
      setError(modelCheck.errorMessage || 'No speech recognition models available');
      setAvailableModels([]);
      setSelectedModel('');
      if (onError) {
        onError(modelCheck.errorMessage || 'No speech recognition models available');
      }
      setLoading(false);
      return;
    }

    // If we get here, server is available and has models
    try {
      const models = await voskRecognition.getAvailableModels();
      setAvailableModels(models);
      
      // Load model details including sizes from the same API that VoskModelManager uses
      try {
        if (isElectron()) {
          // Use Electron API
          const response = await electronApi.getVoskModels();
          if (response.models) {
            const detailsMap: { [key: string]: any } = {};
            response.models.forEach((model: any) => {
              detailsMap[model.name] = {
                size: formatFileSize(model.size),
                type: model.type,
                status: model.status
              };
            });
            setModelDetails(detailsMap);
          }
        } else {
          // Use HTTP API for web/Docker version
          const response = await axios.get(`${API_BASE}/api/vosk/models/all`);
          if (response.data.models) {
            const detailsMap: { [key: string]: any } = {};
            response.data.models.forEach((model: any) => {
              detailsMap[model.name] = {
                size: formatFileSize(model.size),
                type: model.type,
                status: model.status
              };
            });
            setModelDetails(detailsMap);
          }
        }
      } catch (error) {
        console.log('⚠️ Could not load model details:', error);
      }
      
      // Check what model is currently running on the server first
      let serverCurrentModel: string | null = null;
      try {
        serverCurrentModel = await voskRecognition.getServerCurrentModel();
      } catch (error) {
      }
      
      // Set current model based on priority:
      // 1. Saved model from localStorage (highest priority - user's last choice)
      // 2. Server's currently loaded model (fallback if no saved model)
      // 3. Local current model
      // 4. Auto-select default model
      
      // Check for saved model first (highest priority)
      const savedModel = localStorage.getItem('nebulongpt_vosk_selected_model');
      if (savedModel && models.includes(savedModel)) {
        
        // If saved model is different from server's current model, load it
        if (serverCurrentModel !== savedModel) {
          try {
            setLoadingModel(true);
            await voskRecognition.selectModel(savedModel);
            setSelectedModel(savedModel);
            
            if (onModelSelected) {
              onModelSelected(savedModel);
            }
          } catch (error) {
            console.error(`❌ VoskModelSelector: Failed to load saved model ${savedModel}:`, error);
            // Fall back to server model if saved model fails to load
            if (serverCurrentModel && serverCurrentModel !== 'none' && models.includes(serverCurrentModel)) {
              setSelectedModel(serverCurrentModel);
            }
          } finally {
            setLoadingModel(false);
          }
        } else {
          // Saved model is already loaded on server
          setSelectedModel(savedModel);
          if (onModelSelected) {
            onModelSelected(savedModel);
          }
        }
      } else if (serverCurrentModel && serverCurrentModel !== 'none' && models.includes(serverCurrentModel)) {
        setSelectedModel(serverCurrentModel);
      } else {
        const localCurrentModel = voskRecognition.getCurrentModel();
        if (localCurrentModel && models.includes(localCurrentModel)) {
          console.log(`✅ Using local current model: ${localCurrentModel}`);
          setSelectedModel(localCurrentModel);
        } else if (models.length > 0) {
          // Auto-select default model if no model is currently selected
          let defaultModel = '';
          
          // Priority order for default model selection
          const preferredModels = [
            'vosk-model-small-en-us-0.15',
            'vosk-model-en-us-0.22',
            'vosk-model-small-en-us',
            'vosk-model-en-us'
          ];
          
          // Try to find a preferred model
          for (const preferred of preferredModels) {
            if (models.includes(preferred)) {
              defaultModel = preferred;
              break;
            }
          }
          
          // If no preferred model found, use the first available model
          if (!defaultModel) {
            defaultModel = models[0];
          }
          
          // Show default model in UI without loading it
          console.log(`🔧 Setting UI to show default model without loading: ${defaultModel}`);
          setSelectedModel(defaultModel);
        }
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load models';
      setError(errorMessage);
      if (onError) {
        onError(errorMessage);
      }
    } finally {
      setLoading(false);
    }
  };

  // Handle model selection
  const handleModelChange = async (modelName: string) => {
    if (!voskRecognition || !modelName) return;

    setLoadingModel(true);
    setError(null);

    try {
      // Check if the selected model is already loaded on the server
      let serverCurrentModel: string | null = null;
      try {
        serverCurrentModel = await voskRecognition.getServerCurrentModel();
      } catch (error) {
        console.log('⚠️ VoskModelSelector: Could not get server current model:', error);
      }

      // If the selected model is already loaded on the server, just update the UI
      if (serverCurrentModel === modelName) {
        setSelectedModel(modelName);
        
        // The VoskRecognitionService will automatically update its internal state
        // when it detects the server already has this model loaded
        
        if (onModelSelected) {
          onModelSelected(modelName);
        }
        setLoadingModel(false);
        return;
      }

      // If no model is loaded on server (or different model), load the selected model

      // Check if mic is currently listening and stop it first using the exposed function
      if (voskRecognition.isCurrentlyRecording()) {
        console.log('🛑 Stopping mic recording before changing voice model...');
        
        // Use the exposed stop function from ChatArea if available
        if (onMicStop?.current) {
          console.log('✅ Using ChatArea stopMicListening function');
          await onMicStop.current();
        } else {
          // Fallback to direct voskRecognition call
          console.log('⚠️ Fallback to direct voskRecognition.stop()');
          await voskRecognition.stop();
          
          // Notify parent component that mic was stopped so UI can be updated
          if (onMicStopped) {
            onMicStopped();
          }
        }
        
        console.log('✅ Mic recording stopped, proceeding with model change');
      }

      await voskRecognition.selectModel(modelName);
      setSelectedModel(modelName);
      
      // Save selected model to localStorage for persistence across page refreshes
      localStorage.setItem('nebulongpt_vosk_selected_model', modelName);
      
      // Trigger automatic language detection for TTS when model changes
      const { ttsService } = await import('../services/ttsService');
      const languageResult = ttsService.autoDetectLanguageFromVoskModel(modelName);
      if (languageResult.message) {
        console.log(`🌐 ${languageResult.message}`);
      }
      
      if (onModelSelected) {
        onModelSelected(modelName);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to select model';
      setError(errorMessage);
      if (onError) {
        onError(errorMessage);
      }
    } finally {
      setLoadingModel(false);
    }
  };

  // Load models on component mount and when voskRecognition changes
  useEffect(() => {
    if (voskRecognition) {
      // Add a small delay to ensure the component is fully mounted
      const timer = setTimeout(() => {
        loadModels();
      }, 100);
      
      return () => clearTimeout(timer);
    }
  }, [voskRecognition]);

  // Provide the loadModels function to the parent component
  useEffect(() => {
    if (onRefreshReady) {
      onRefreshReady(loadModels);
    }
  }, [onRefreshReady]);

  // Note: VoskRecognitionService handles model events internally

  if (!voskRecognition) {
    return (
      <Alert severity="warning" sx={{ mb: 2 }}>
        Vosk speech recognition not available
      </Alert>
    );
  }

  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <LanguageIcon sx={{ fontSize: 20, color: 'text.secondary' }} />
        <Typography variant="subtitle2" color="text.secondary">
          Speech Recognition Model
        </Typography>
        <Tooltip title="Manage models">
          <IconButton
            size="small"
            onClick={onManageModels}
            disabled={disabled}
          >
            <StorageIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Refresh models list">
          <IconButton
            size="small"
            onClick={loadModels}
            disabled={loading || disabled}
          >
            <RefreshIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 1 }}>
          {error.includes('https://alphacephei.com/vosk/models') ? (
            <Box>
              No speech recognition models found. Please download models from{' '}
              <a 
                href="https://alphacephei.com/vosk/models" 
                target="_blank" 
                rel="noopener noreferrer"
                style={{ color: 'inherit', textDecoration: 'underline' }}
              >
                https://alphacephei.com/vosk/models
              </a>
              {' '}and upload them using the "Manage Models" button above.
            </Box>
          ) : (
            error
          )}
        </Alert>
      )}

      <FormControl fullWidth size="small" disabled={disabled || loading}>
        <InputLabel id="vosk-model-select-label">
          {loading ? 'Loading models...' : 'Select Model'}
        </InputLabel>
        <Select
          labelId="vosk-model-select-label"
          value={selectedModel}
          label={loading ? 'Loading models...' : 'Select Model'}
          onChange={(e) => handleModelChange(e.target.value)}
          disabled={disabled || loading || loadingModel}
          startAdornment={
            loadingModel ? (
              <CircularProgress size={16} sx={{ mr: 1 }} />
            ) : selectedModel ? (
              <MicIcon sx={{ fontSize: 16, mr: 1, color: 'success.main' }} />
            ) : null
          }
        >
          {availableModels.length === 0 ? (
            <MenuItem disabled>
              {loading ? 'Loading...' : 'No models available'}
            </MenuItem>
          ) : (
            availableModels.map((model) => (
              <MenuItem key={model} value={model}>
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '100%', py: 0.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>
                      {formatModelName(model)}
                    </Typography>
                    <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <Chip
                        label={model}
                        size="small"
                        variant="outlined"
                        sx={{ 
                          fontSize: '0.7rem',
                          height: '18px',
                          '& .MuiChip-label': {
                            px: 0.8
                          }
                        }}
                      />
                    </Box>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', mt: 0.2 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                      {getModelDetails(model)}
                    </Typography>
                    {modelDetails[model]?.size && (
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                        {modelDetails[model].size}
                      </Typography>
                    )}
                  </Box>
                </Box>
              </MenuItem>
            ))
          )}
        </Select>
      </FormControl>

      {selectedModel && (
        <Box sx={{ mt: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Active:
          </Typography>
          <Chip
            label={formatModelName(selectedModel)}
            size="small"
            color="success"
            variant="outlined"
            icon={<MicIcon sx={{ fontSize: 14 }} />}
          />
        </Box>
      )}
    </Box>
  );
};

export default VoskModelSelector;
