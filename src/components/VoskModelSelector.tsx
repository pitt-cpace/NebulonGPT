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

  // Helper function to format model names for display
  const formatModelName = (modelName: string): string => {
    // Extract language and size information from model name
    const parts = modelName.toLowerCase().split('-');
    let displayName = modelName;
    let language = '';
    let size = '';

    // Common language mappings
    const languageMap: { [key: string]: string } = {
      'en': 'English',
      'es': 'Spanish',
      'fr': 'French',
      'de': 'German',
      'ru': 'Russian',
      'zh': 'Chinese',
      'ja': 'Japanese',
      'ko': 'Korean',
      'it': 'Italian',
      'pt': 'Portuguese',
      'ar': 'Arabic',
      'hi': 'Hindi',
      'fa': 'Persian',
      'tr': 'Turkish',
      'nl': 'Dutch',
      'sv': 'Swedish',
      'da': 'Danish',
      'no': 'Norwegian',
      'fi': 'Finnish',
      'pl': 'Polish',
      'cs': 'Czech',
      'hu': 'Hungarian',
      'ro': 'Romanian',
      'bg': 'Bulgarian',
      'hr': 'Croatian',
      'sk': 'Slovak',
      'sl': 'Slovenian',
      'et': 'Estonian',
      'lv': 'Latvian',
      'lt': 'Lithuanian',
      'uk': 'Ukrainian',
      'be': 'Belarusian',
      'ka': 'Georgian',
      'hy': 'Armenian',
      'az': 'Azerbaijani',
      'kk': 'Kazakh',
      'ky': 'Kyrgyz',
      'uz': 'Uzbek',
      'tg': 'Tajik',
      'mn': 'Mongolian',
      'vi': 'Vietnamese',
      'th': 'Thai',
      'id': 'Indonesian',
      'ms': 'Malay',
      'tl': 'Filipino',
      'sw': 'Swahili',
      'am': 'Amharic',
      'he': 'Hebrew',
      'ur': 'Urdu',
      'bn': 'Bengali',
      'ta': 'Tamil',
      'te': 'Telugu',
      'ml': 'Malayalam',
      'kn': 'Kannada',
      'gu': 'Gujarati',
      'pa': 'Punjabi',
      'or': 'Odia',
      'as': 'Assamese',
      'ne': 'Nepali',
      'si': 'Sinhala',
      'my': 'Burmese',
      'km': 'Khmer',
      'lo': 'Lao',
    };

    // Extract language
    for (const part of parts) {
      if (languageMap[part]) {
        language = languageMap[part];
        break;
      }
      // Handle compound language codes like 'en-us', 'en-gb'
      if (part.includes('us') && parts.includes('en')) {
        language = 'English (US)';
        break;
      }
      if (part.includes('gb') && parts.includes('en')) {
        language = 'English (UK)';
        break;
      }
    }

    // Extract size information
    if (parts.includes('small')) size = 'Small';
    else if (parts.includes('large')) size = 'Large';
    else if (parts.includes('medium')) size = 'Medium';
    else if (parts.includes('tiny')) size = 'Tiny';

    // Create display name
    if (language && size) {
      displayName = `${language} (${size})`;
    } else if (language) {
      displayName = language;
    } else {
      // Fallback: capitalize and clean up the original name
      displayName = modelName
        .replace(/vosk-model-/gi, '')
        .replace(/-/g, ' ')
        .replace(/\b\w/g, l => l.toUpperCase());
    }

    return displayName;
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
      
      // Check what model is currently running on the server first
      let serverCurrentModel: string | null = null;
      try {
        serverCurrentModel = await voskRecognition.getServerCurrentModel();
        console.log(`🔍 VoskModelSelector: Server currently has model loaded: ${serverCurrentModel}`);
      } catch (error) {
        console.log('⚠️ VoskModelSelector: Could not get server current model:', error);
      }
      
      // Set current model based on priority:
      // 1. Saved model from localStorage (highest priority - user's last choice)
      // 2. Server's currently loaded model (fallback if no saved model)
      // 3. Local current model
      // 4. Auto-select default model
      
      // Check for saved model first (highest priority)
      const savedModel = localStorage.getItem('nebulongpt_vosk_selected_model');
      if (savedModel && models.includes(savedModel)) {
        console.log(`✅ VoskModelSelector: Found saved model in localStorage: ${savedModel}`);
        
        // If saved model is different from server's current model, load it
        if (serverCurrentModel !== savedModel) {
          console.log(`🔄 VoskModelSelector: Loading saved model ${savedModel} (server has: ${serverCurrentModel || 'none'})`);
          try {
            setLoadingModel(true);
            await voskRecognition.selectModel(savedModel);
            setSelectedModel(savedModel);
            console.log(`✅ VoskModelSelector: Successfully loaded saved model: ${savedModel}`);
            
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
          console.log(`✅ VoskModelSelector: Saved model ${savedModel} is already loaded on server`);
          setSelectedModel(savedModel);
          if (onModelSelected) {
            onModelSelected(savedModel);
          }
        }
      } else if (serverCurrentModel && serverCurrentModel !== 'none' && models.includes(serverCurrentModel)) {
        console.log(`✅ VoskModelSelector: No saved model, using server's current model: ${serverCurrentModel}`);
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
        console.log(`🔍 VoskModelSelector: Checking server current model: ${serverCurrentModel}`);
      } catch (error) {
        console.log('⚠️ VoskModelSelector: Could not get server current model:', error);
      }

      // If the selected model is already loaded on the server, just update the UI
      if (serverCurrentModel === modelName) {
        console.log(`✅ VoskModelSelector: Model ${modelName} is already loaded on server, skipping load`);
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
      console.log(`🔄 VoskModelSelector: Loading new model ${modelName} (current: ${serverCurrentModel || 'none'})`);

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
      console.log(`💾 VoskModelSelector: Saved model to localStorage: ${modelName}`);
      
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
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%' }}>
                  <Typography variant="body2">
                    {formatModelName(model)}
                  </Typography>
                  <Chip
                    label={model}
                    size="small"
                    variant="outlined"
                    sx={{ 
                      ml: 'auto', 
                      fontSize: '0.7rem',
                      height: '20px',
                      '& .MuiChip-label': {
                        px: 1
                      }
                    }}
                  />
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
