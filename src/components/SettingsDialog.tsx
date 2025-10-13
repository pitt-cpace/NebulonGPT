import React, { useState, useEffect, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Typography,
  Slider,
  Box,
  IconButton,
  Divider,
  FormControlLabel,
  Checkbox,
  RadioGroup,
  Radio,
  FormControl,
  FormLabel,
  InputAdornment,
  CircularProgress,
  Tooltip,
} from '@mui/material';
import { 
  Settings as SettingsIcon, 
  Close as CloseIcon, 
  Storage as StorageIcon, 
  RecordVoiceOver as VoiceIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
  Refresh as RefreshIcon,
  Cable as CableIcon,
  Visibility as VisibilityIcon,
  VisibilityOff as VisibilityOffIcon,
  LightMode as LightModeIcon,
  DarkMode as DarkModeIcon,
} from '@mui/icons-material';
import { ModelType } from '../types';
import { VoskRecognitionService } from '../services/vosk';
import { ttsService, TTSStatus } from '../services/ttsService';
import VoskModelSelector from './VoskModelSelector';
import VoskModelManager from './VoskModelManager';
import * as styles from '../styles/components/SettingsDialog.styles';

interface SettingsDialogProps {
  model: ModelType | null;
  contextLength: number;
  temperature: number;
  maxContextLength?: number; // Maximum context length supported by the model
  onSaveSettings: (contextLength: number, temperature: number) => void;
  voskRecognition?: VoskRecognitionService | null;
  onMicStopped?: () => void;
  onMicStart?: React.MutableRefObject<(() => Promise<void>) | null>;
  onMicStop?: React.MutableRefObject<(() => Promise<void>) | null>;
}

const SettingsDialog: React.FC<SettingsDialogProps> = ({
  model,
  contextLength,
  temperature,
  maxContextLength = 48000, // Default to 48000 if not provided
  onSaveSettings,
  voskRecognition,
  onMicStopped,
  onMicStart,
  onMicStop,
}) => {
  const [open, setOpen] = useState(false);
  const [localContextLength, setLocalContextLength] = useState(contextLength);
  const [localTemperature, setLocalTemperature] = useState(temperature);
  const [contextLengthError, setContextLengthError] = useState('');
  const [temperatureError, setTemperatureError] = useState('');
  const [modelManagerOpen, setModelManagerOpen] = useState(false);
  const [refreshModels, setRefreshModels] = useState<(() => void) | null>(null);
  
  // TTS Settings state
  const [fullVoiceMode, setFullVoiceMode] = useState(false);
  const [voiceGender, setVoiceGender] = useState<'female' | 'male'>('female');
  const [ttsStatus, setTtsStatus] = useState<TTSStatus>('disconnected');
  
  // Store original TTS settings for cancel functionality
  const [originalTtsSettings, setOriginalTtsSettings] = useState({ fullVoiceMode: false, voiceGender: 'female' as 'female' | 'male' });
  
  // Theme mode state
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>('dark');
  const [originalThemeMode, setOriginalThemeMode] = useState<'light' | 'dark'>('dark');
  
  // Ollama API URL state
  const [ollamaApiUrl, setOllamaApiUrl] = useState('');
  const [originalOllamaApiUrl, setOriginalOllamaApiUrl] = useState('');
  const [ollamaApiKey, setOllamaApiKey] = useState('');
  const [originalOllamaApiKey, setOriginalOllamaApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [urlValidationStatus, setUrlValidationStatus] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle');
  const validationTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Update local state when props change
  useEffect(() => {
    setLocalContextLength(contextLength);
    setLocalTemperature(temperature);
  }, [contextLength, temperature]);

  // Initialize TTS service and load settings
  useEffect(() => {
    // Load TTS settings from service
    const settings = ttsService.getSettings();
    setFullVoiceMode(settings.fullVoiceMode);
    setVoiceGender(settings.voiceGender);
    setOriginalTtsSettings(settings);
    
    // Load theme mode from localStorage
    const savedThemeMode = localStorage.getItem('themeMode') as 'light' | 'dark' | null;
    const currentTheme = savedThemeMode || 'dark';
    setThemeMode(currentTheme);
    setOriginalThemeMode(currentTheme);
    
    // Load Ollama API URL from localStorage and denormalize for display
    const savedUrl = localStorage.getItem('ollamaApiUrl') || '';
    const displayUrl = denormalizeOllamaUrl(savedUrl);
    setOllamaApiUrl(displayUrl);
    setOriginalOllamaApiUrl(displayUrl);
    
    // Load Ollama API Key from localStorage
    const savedKey = localStorage.getItem('ollamaApiKey') || '';
    setOllamaApiKey(savedKey);
    setOriginalOllamaApiKey(savedKey);
    
    // Set up status callback
    ttsService.setStatusCallback(setTtsStatus);
    
    // Get initial status
    setTtsStatus(ttsService.getStatus());
    
    // Try to connect to TTS server
    ttsService.connect().catch((error) => {
      console.error('Failed to connect to TTS server:', error);
    });

    return () => {
      // Clean up on unmount
      ttsService.setStatusCallback(() => {});
    };
  }, []);

  // Handle TTS settings changes (local only, not saved until Save button)
  const handleFullVoiceModeChange = async (checked: boolean) => {
    setFullVoiceMode(checked);
    // Update service temporarily for immediate UI feedback
    ttsService.updateSettings({ fullVoiceMode: checked });
    
    // If enabling Full Voice Mode and TTS is disconnected, try to connect
    if (checked && ttsStatus === 'disconnected') {
      // console.log('🔌 Full Voice Mode enabled but TTS is disconnected - attempting to connect...');
      
      // Set status to "connecting" during the connection attempts
      setTtsStatus('connecting');
      
      // Try to connect up to 10 times
      let attempts = 0;
      const maxAttempts = 60;
      
      while (attempts < maxAttempts && ttsService.getStatus() === 'disconnected') {
        attempts++;
        // console.log(`🔌 TTS connection attempt ${attempts}/${maxAttempts}...`);
        
        try {
          await ttsService.connect();
          // console.log(`✅ TTS connected successfully on attempt ${attempts}`);
          break; // Exit loop if connection successful
        } catch (error) {
          console.error(`❌ TTS connection attempt ${attempts} failed:`, error);
          
          // Wait 1 second before next attempt (except for the last attempt)
          if (attempts < maxAttempts) {
            // console.log(`⏳ Waiting 1 second before attempt ${attempts + 1}...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
      
      // Update status based on final result
      const finalStatus = ttsService.getStatus();
      setTtsStatus(finalStatus);
      
      if (finalStatus === 'connected') {
        // console.log(`🎉 TTS connection successful after ${attempts} attempts`);
      } else {
        console.warn(`⚠️ TTS connection failed after ${maxAttempts} attempts. Final status: ${finalStatus}`);
      }
    }
  };

  const handleVoiceGenderChange = (gender: 'female' | 'male') => {
    setVoiceGender(gender);
    // Update service temporarily for immediate UI feedback
    ttsService.updateSettings({ voiceGender: gender });
  };

  const handleOpen = async () => {
    // Refresh TTS settings from service when opening dialog
    const currentSettings = ttsService.getSettings();
    setFullVoiceMode(currentSettings.fullVoiceMode);
    setVoiceGender(currentSettings.voiceGender);
    setOriginalTtsSettings(currentSettings);
    
    // Refresh theme mode
    const savedThemeMode = localStorage.getItem('themeMode') as 'light' | 'dark' | null;
    const currentTheme = savedThemeMode || 'dark';
    setThemeMode(currentTheme);
    setOriginalThemeMode(currentTheme);
    
    // Refresh Ollama API URL and denormalize for display
    const savedUrl = localStorage.getItem('ollamaApiUrl') || '';
    const displayUrl = denormalizeOllamaUrl(savedUrl);
    setOllamaApiUrl(displayUrl);
    setOriginalOllamaApiUrl(displayUrl);
    
    // Refresh Ollama API Key
    const savedKey = localStorage.getItem('ollamaApiKey') || '';
    setOllamaApiKey(savedKey);
    setOriginalOllamaApiKey(savedKey);
    
    setOpen(true);
    
    // If Full Voice Mode is enabled and TTS is disconnected, try to connect
    if (currentSettings.fullVoiceMode && ttsService.getStatus() === 'disconnected') {
      // console.log('🔌 Settings dialog opened with Full Voice Mode enabled but TTS disconnected - attempting to connect...');
      
      // Set status to "connecting" during the connection attempts
      setTtsStatus('connecting');
      
      // Try to connect up to 60 times
      let attempts = 0;
      const maxAttempts = 60;
      
      while (attempts < maxAttempts && ttsService.getStatus() === 'disconnected') {
        attempts++;
        // console.log(`🔌 TTS connection attempt ${attempts}/${maxAttempts}...`);
        
        try {
          await ttsService.connect();
          // console.log(`✅ TTS connected successfully on attempt ${attempts}`);
          break; // Exit loop if connection successful
        } catch (error) {
          console.error(`❌ TTS connection attempt ${attempts} failed:`, error);
          
          // Wait 1 second before next attempt (except for the last attempt)
          if (attempts < maxAttempts) {
            // console.log(`⏳ Waiting 1 second before attempt ${attempts + 1}...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }
      }
      
      // Update status based on final result
      const finalStatus = ttsService.getStatus();
      setTtsStatus(finalStatus);
      
      if (finalStatus === 'connected') {
        // console.log(`🎉 TTS connection successful after ${attempts} attempts`);
      } else {
        console.warn(`⚠️ TTS connection failed after ${maxAttempts} attempts. Final status: ${finalStatus}`);
      }
    }
  };

  const handleClose = () => {
    setOpen(false);
    // Reset to original values
    setLocalContextLength(contextLength);
    setLocalTemperature(temperature);
    setContextLengthError('');
    setTemperatureError('');
    
    // Reset TTS settings to original values
    setFullVoiceMode(originalTtsSettings.fullVoiceMode);
    setVoiceGender(originalTtsSettings.voiceGender);
    ttsService.updateSettings(originalTtsSettings);
    
    // Reset theme mode to original value
    setThemeMode(originalThemeMode);
    
    // Reset Ollama API URL and Key to original values
    setOllamaApiUrl(originalOllamaApiUrl);
    setOllamaApiKey(originalOllamaApiKey);
  };

  const handleSave = () => {
    // Validate inputs
    if (localContextLength < 2000 || localContextLength > maxContextLength) {
      setContextLengthError(`Context length must be between 2000 and ${maxContextLength}`);
      return;
    }

    if (localTemperature < 0 || localTemperature > 2) {
      setTemperatureError('Temperature must be between 0 and 2');
      return;
    }

    // Save model settings
    onSaveSettings(localContextLength, localTemperature);
    
    // Save TTS settings to localStorage
    ttsService.saveSettings();
    
    // Update original settings for next time
    setOriginalTtsSettings({ fullVoiceMode, voiceGender });
    
    // Normalize and save Ollama API URL to localStorage (add /api automatically)
    const normalizedUrl = normalizeOllamaUrl(ollamaApiUrl);
    localStorage.setItem('ollamaApiUrl', normalizedUrl);
    setOriginalOllamaApiUrl(normalizedUrl);
    
    // Save Ollama API Key to localStorage
    localStorage.setItem('ollamaApiKey', ollamaApiKey.trim());
    setOriginalOllamaApiKey(ollamaApiKey.trim());
    
    // Save theme mode to localStorage
    localStorage.setItem('themeMode', themeMode);
    setOriginalThemeMode(themeMode);
    
    // Trigger page reload to apply changes
    if (ollamaApiUrl.trim() !== originalOllamaApiUrl || 
        ollamaApiKey.trim() !== originalOllamaApiKey || 
        themeMode !== originalThemeMode) {
      window.location.reload();
    }
    
    setOpen(false);
  };

  const handleContextLengthChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseInt(event.target.value, 10);
    const newValue = isNaN(value) ? 0 : value;
    setLocalContextLength(newValue);
    
    // Validate the context length
    if (newValue < 2000 || newValue > maxContextLength) {
      setContextLengthError(`Context length must be between 2000 and ${maxContextLength}`);
    } else {
      setContextLengthError('');
    }
  };

  const handleTemperatureChange = (_event: Event, newValue: number | number[]) => {
    setLocalTemperature(newValue as number);
    setTemperatureError('');
  };

  // Function to get the default Ollama URL
  const getDefaultOllamaUrl = (): string => {
    return 'http://localhost:11434';
  };

  // Function to normalize Ollama URL (add /api if not present)
  const normalizeOllamaUrl = (url: string): string => {
    if (!url || url.trim() === '') {
      return '';
    }
    
    let normalizedUrl = url.trim();
    
    // Remove trailing slash if present
    if (normalizedUrl.endsWith('/')) {
      normalizedUrl = normalizedUrl.slice(0, -1);
    }
    
    // If URL doesn't end with /api, append it
    if (!normalizedUrl.endsWith('/api')) {
      normalizedUrl += '/api';
    }
    
    return normalizedUrl;
  };

  // Function to denormalize Ollama URL for display (remove /api if present)
  const denormalizeOllamaUrl = (url: string): string => {
    if (!url || url.trim() === '') {
      return '';
    }
    
    let displayUrl = url.trim();
    
    // Remove /api suffix if present
    if (displayUrl.endsWith('/api')) {
      displayUrl = displayUrl.slice(0, -4);
    }
    
    return displayUrl;
  };

  // Function to validate Ollama URL
  const validateOllamaUrl = async (url: string): Promise<boolean> => {
    if (!url || url.trim() === '') {
      return true; // Empty URL is valid (uses default)
    }

    const trimmedUrl = url.trim();

    // First, validate URL format
    try {
      const urlObj = new URL(trimmedUrl);
      // Check if it's http or https
      if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
        return false;
      }
    } catch (error) {
      // Invalid URL format
      return false;
    }

    // Normalize URL (add /api if needed)
    const normalizedUrl = normalizeOllamaUrl(trimmedUrl);

    // Then, try to connect to the Ollama API with timeout
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

      const response = await fetch(`${normalizedUrl}/tags`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      return response.ok;
    } catch (error: any) {
      console.error('Ollama URL validation failed:', error);
      
      // If it's a timeout or network error, still return false
      // But log the specific error for debugging
      if (error.name === 'AbortError') {
        console.error('Validation timeout - server took too long to respond');
      } else if (error.message?.includes('Failed to fetch')) {
        console.error('Network error - could not reach the server');
      }
      
      return false;
    }
  };

  // Handle Ollama URL change with validation
  const handleOllamaUrlChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newUrl = event.target.value;
    setOllamaApiUrl(newUrl);
    
    // Clear previous timeout
    if (validationTimeoutRef.current) {
      clearTimeout(validationTimeoutRef.current);
    }
    
    // If empty, set to valid (uses default)
    if (!newUrl || newUrl.trim() === '') {
      setUrlValidationStatus('idle');
      return;
    }
    
    // Set validating status
    setUrlValidationStatus('validating');
    
    // Debounce validation by 800ms
    validationTimeoutRef.current = setTimeout(async () => {
      const isValid = await validateOllamaUrl(newUrl);
      setUrlValidationStatus(isValid ? 'valid' : 'invalid');
    }, 800);
  };

  // Handle reset to default URL
  const handleResetOllamaUrl = () => {
    const defaultUrl = getDefaultOllamaUrl();
    setOllamaApiUrl(defaultUrl);
    // Trigger validation for the default URL
    setUrlValidationStatus('validating');
    setTimeout(async () => {
      const isValid = await validateOllamaUrl(defaultUrl);
      setUrlValidationStatus(isValid ? 'valid' : 'invalid');
    }, 100);
  };

  // Handle manual connection test
  const handleTestConnection = async () => {
    if (!ollamaApiUrl || ollamaApiUrl.trim() === '') {
      // Test default URL
      const defaultUrl = getDefaultOllamaUrl();
      setUrlValidationStatus('validating');
      const isValid = await validateOllamaUrl(defaultUrl);
      setUrlValidationStatus(isValid ? 'valid' : 'invalid');
    } else {
      // Test current URL
      setUrlValidationStatus('validating');
      const isValid = await validateOllamaUrl(ollamaApiUrl);
      setUrlValidationStatus(isValid ? 'valid' : 'invalid');
    }
  };

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (validationTimeoutRef.current) {
        clearTimeout(validationTimeoutRef.current);
      }
    };
  }, []);

  return (
    <>
      <IconButton
        color="primary"
        onClick={handleOpen}
        sx={styles.settingsButton}
        title="Settings"
      >
        <SettingsIcon />
      </IconButton>

      <Dialog 
        open={open} 
        onClose={handleClose} 
        maxWidth="sm" 
        fullWidth
        disableRestoreFocus
        keepMounted={false}
      >
        <DialogTitle sx={styles.dialogTitle}>
          Model Settings
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Tooltip title={themeMode === 'dark' ? 'Switch to Light Mode' : 'Switch to Dark Mode'}>
              <IconButton
                onClick={() => setThemeMode(themeMode === 'dark' ? 'light' : 'dark')}
                color="inherit"
                size="small"
              >
                {themeMode === 'dark' ? <LightModeIcon /> : <DarkModeIcon />}
              </IconButton>
            </Tooltip>
            <IconButton edge="end" color="inherit" onClick={handleClose} aria-label="close">
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={styles.sectionContainer}>
            <Typography variant="subtitle1" gutterBottom>
              Current Model: {model?.name || 'No model selected'}
            </Typography>
          </Box>

          {/* Vosk Speech Recognition Model Section */}
          <Divider sx={{ my: 2 }} />
          <VoskModelSelector
            voskRecognition={voskRecognition || null}
            onModelSelected={(modelName) => {
              // console.log('Model selected:', modelName);
            }}
            onError={(error) => {
              console.error('Vosk model selector error:', error);
            }}
            onMicStopped={onMicStopped}
            onMicStart={onMicStart}
            onMicStop={onMicStop}
            onManageModels={() => setModelManagerOpen(true)}
            onRefreshReady={(refreshFn) => setRefreshModels(() => refreshFn)}
          />
          <Divider sx={{ my: 2 }} />

          {/* Text-to-Speech Settings Section */}
          <Box sx={styles.sectionContainer}>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <VoiceIcon sx={{ mr: 1, color: 'primary.main' }} />
              <Typography variant="h6" sx={{ color: 'primary.main' }}>
                Text-to-Speech Settings
              </Typography>
            </Box>
            
            <FormControlLabel
              control={
                <Checkbox
                  checked={fullVoiceMode}
                  onChange={(e) => handleFullVoiceModeChange(e.target.checked)}
                  color="primary"
                />
              }
              label={
                <Box>
                  <Typography variant="body1">Full Voice Mode</Typography>
                  <Typography variant="caption" color="text.secondary">
                    Enable text-to-speech for LLM responses
                  </Typography>
                </Box>
              }
              sx={{ mb: 2, alignItems: 'flex-start' }}
            />

            {fullVoiceMode && (
              <FormControl component="fieldset" sx={{ mb: 2 }}>
                <FormLabel component="legend" sx={{ mb: 1 }}>
                  Voice Gender
                </FormLabel>
                <RadioGroup
                  row
                  value={voiceGender}
                  onChange={(e) => handleVoiceGenderChange(e.target.value as 'female' | 'male')}
                >
                  <FormControlLabel
                    value="female"
                    control={<Radio color="primary" />}
                    label="Female"
                  />
                  <FormControlLabel
                    value="male"
                    control={<Radio color="primary" />}
                    label="Male"
                  />
                </RadioGroup>
              </FormControl>
            )}

            {fullVoiceMode && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  TTS Status:
                </Typography>
                <Box
                  sx={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.5,
                  }}
                >
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      backgroundColor: 
                        ttsStatus === 'connected' ? 'success.main' :
                        ttsStatus === 'connecting' ? 'warning.main' :
                        ttsStatus === 'reconnecting' ? 'warning.main' :
                        'error.main',
                    }}
                  />
                  <Typography
                    variant="body2"
                    sx={{
                      color: 
                        ttsStatus === 'connected' ? 'success.main' :
                        ttsStatus === 'connecting' ? 'warning.main' :
                        ttsStatus === 'reconnecting' ? 'warning.main' :
                        'error.main',
                      textTransform: 'capitalize',
                    }}
                  >
                    {ttsStatus === 'reconnecting' ? 'Reconnecting...' : ttsStatus}
                  </Typography>
                </Box>
              </Box>
            )}
          </Box>
          <Divider sx={{ my: 2 }} />

          <Box sx={styles.sectionContainer}>
            <Typography id="context-length-slider" gutterBottom>
              Context Length (2000-{maxContextLength})
            </Typography>
            <TextField
              fullWidth
              type="number"
              value={localContextLength}
              onChange={handleContextLengthChange}
              onFocus={(e) => e.target.select()}
              inputProps={{
                min: 2000,
                max: maxContextLength,
                step: 1000,
              }}
              error={!!contextLengthError}
              helperText={contextLengthError || 'Maximum number of tokens the model can process'}
              margin="normal"
              variant="outlined"
              size="small"
            />
          </Box>

          <Box sx={styles.sliderContainer}>
            <Typography id="temperature-slider" gutterBottom>
              Temperature: {localTemperature.toFixed(2)}
            </Typography>
            <Slider
              value={localTemperature}
              onChange={handleTemperatureChange}
              aria-labelledby="temperature-slider"
              min={0}
              max={2}
              step={0.01}
              marks={[
                { value: 0, label: '0' },
                { value: 1, label: '1' },
                { value: 2, label: '2' },
              ]}
              valueLabelDisplay="auto"
            />
            {temperatureError && (
              <Typography color="error" variant="caption">
                {temperatureError}
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary">
              Lower values produce more deterministic responses, higher values produce more creative responses
            </Typography>
          </Box>

          {/* LLM API URL Section */}
          <Divider sx={{ my: 2 }} />
          <Box sx={styles.sectionContainer}>
            <Typography variant="h6" gutterBottom sx={{ color: 'primary.main' }}>
              LLM API Configuration
            </Typography>
            <TextField
              fullWidth
              label="LLM API URL"
              value={ollamaApiUrl}
              onChange={handleOllamaUrlChange}
              placeholder="http://localhost:11434"
              helperText="Enter the LLM server URL. Example: http://192.168.1.100:11434"
              margin="normal"
              variant="outlined"
              size="small"
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    {urlValidationStatus === 'validating' && (
                      <CircularProgress size={20} />
                    )}
                    {urlValidationStatus === 'valid' && (
                      <CheckCircleIcon sx={{ color: 'success.main' }} />
                    )}
                    {urlValidationStatus === 'invalid' && (
                      <ErrorIcon sx={{ color: 'error.main' }} />
                    )}
                    <Tooltip title="Reset to default">
                      <IconButton
                        size="small"
                        onClick={handleResetOllamaUrl}
                        edge="end"
                        sx={{ ml: 0.5 }}
                      >
                        <RefreshIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Test connection">
                      <IconButton
                        size="small"
                        onClick={handleTestConnection}
                        edge="end"
                        sx={{ ml: 0.5 }}
                      >
                        <CableIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </InputAdornment>
                ),
              }}
              error={urlValidationStatus === 'invalid'}
            />
            <TextField
              fullWidth
              label="API Key (Optional)"
              type={showApiKey ? 'text' : 'password'}
              value={ollamaApiKey}
              onChange={(e) => setOllamaApiKey(e.target.value)}
              placeholder="Enter API key if required"
              helperText="Optional: Only needed if your LLM server requires authentication"
              margin="normal"
              variant="outlined"
              size="small"
              InputProps={{
                endAdornment: (
                  <InputAdornment position="end">
                    <Tooltip title={showApiKey ? "Hide API key" : "Show API key"}>
                      <IconButton
                        size="small"
                        onClick={() => setShowApiKey(!showApiKey)}
                        edge="end"
                      >
                        {showApiKey ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                      </IconButton>
                    </Tooltip>
                  </InputAdornment>
                ),
              }}
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} color="primary">
            Cancel
          </Button>
          <Button onClick={handleSave} color="primary" variant="contained">
            Save
          </Button>
        </DialogActions>
      </Dialog>

      {/* Vosk Model Manager Dialog */}
      <VoskModelManager
        open={modelManagerOpen}
        onClose={() => setModelManagerOpen(false)}
        voskRecognition={voskRecognition}
        onRefreshModels={refreshModels || undefined}
      />
    </>
  );
};

export default SettingsDialog;
