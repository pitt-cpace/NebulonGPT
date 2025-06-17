import React, { useState, useEffect } from 'react';
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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  CircularProgress,
  Alert,
  Divider,
} from '@mui/material';
import { Settings as SettingsIcon, Close as CloseIcon, Mic as MicIcon } from '@mui/icons-material';
import { ModelType } from '../types';
import { VoskRecognitionService } from '../services/vosk';
import * as styles from '../styles/components/SettingsDialog.styles';

interface SettingsDialogProps {
  model: ModelType | null;
  contextLength: number;
  temperature: number;
  maxContextLength?: number; // Maximum context length supported by the model
  onSaveSettings: (contextLength: number, temperature: number) => void;
  voskRecognition?: VoskRecognitionService | null;
}

const SettingsDialog: React.FC<SettingsDialogProps> = ({
  model,
  contextLength,
  temperature,
  maxContextLength = 48000, // Default to 48000 if not provided
  onSaveSettings,
  voskRecognition,
}) => {
  const [open, setOpen] = useState(false);
  const [localContextLength, setLocalContextLength] = useState(contextLength);
  const [localTemperature, setLocalTemperature] = useState(temperature);
  const [contextLengthError, setContextLengthError] = useState('');
  const [temperatureError, setTemperatureError] = useState('');

  // Vosk model selector state
  const [availableVoskModels, setAvailableVoskModels] = useState<string[]>([]);
  const [selectedVoskModel, setSelectedVoskModel] = useState<string>('vosk-model-small-en-us-0.15');
  const [loadingVoskModels, setLoadingVoskModels] = useState(false);
  const [loadingVoskModel, setLoadingVoskModel] = useState(false);
  const [voskError, setVoskError] = useState<string | null>(null);
  const [voskServerAvailable, setVoskServerAvailable] = useState<boolean | null>(null);

  // Helper function to format model names for display
  const formatModelName = (modelName: string): string => {
    const parts = modelName.toLowerCase().split('-');
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
    };

    // Extract language
    for (const part of parts) {
      if (languageMap[part]) {
        language = languageMap[part];
        break;
      }
      if (part.includes('us') && parts.includes('en')) {
        language = 'English (US)';
        break;
      }
    }

    // Extract size information
    if (parts.includes('small')) size = 'Small';
    else if (parts.includes('large')) size = 'Large';
    else if (parts.includes('medium')) size = 'Medium';

    // Create display name
    if (language && size) {
      return `${language} (${size})`;
    } else if (language) {
      return language;
    } else {
      return modelName.replace(/vosk-model-/gi, '').replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }
  };

  // Load available Vosk models
  const loadVoskModels = async () => {
    if (!voskRecognition) {
      setVoskError('Vosk recognition not available');
      return;
    }

    setLoadingVoskModels(true);
    setVoskError(null);

    try {
      const models = await voskRecognition.getAvailableModels();
      setAvailableVoskModels(models);
      
      // Set default model if available
      if (models.includes('vosk-model-small-en-us-0.15')) {
        setSelectedVoskModel('vosk-model-small-en-us-0.15');
      } else if (models.length > 0) {
        setSelectedVoskModel(models[0]);
      }
      
      // Set current model if available
      const currentModel = voskRecognition.getCurrentModel();
      if (currentModel && models.includes(currentModel)) {
        setSelectedVoskModel(currentModel);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to load Vosk models';
      setVoskError(errorMessage);
    } finally {
      setLoadingVoskModels(false);
    }
  };

  // Handle Vosk model selection
  const handleVoskModelChange = async (modelName: string) => {
    if (!voskRecognition || !modelName) return;

    setLoadingVoskModel(true);
    setVoskError(null);

    try {
      await voskRecognition.selectModel(modelName);
      setSelectedVoskModel(modelName);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to select Vosk model';
      setVoskError(errorMessage);
    } finally {
      setLoadingVoskModel(false);
    }
  };

  // Check Vosk server availability when dialog opens
  useEffect(() => {
    if (open && voskRecognition) {
      const checkVoskServer = async () => {
        try {
          // Try to get available models - this will trigger connection if needed
          setLoadingVoskModels(true);
          setVoskError(null);
          
          const models = await voskRecognition.getAvailableModels();
          setAvailableVoskModels(models);
          setVoskServerAvailable(true);
          
          // Set current model if available
          const currentModel = voskRecognition.getCurrentModel();
          if (currentModel && models.includes(currentModel)) {
            setSelectedVoskModel(currentModel);
          } else if (models.length > 0) {
            // Set default model if available
            if (models.includes('vosk-model-small-en-us-0.15')) {
              setSelectedVoskModel('vosk-model-small-en-us-0.15');
            } else {
              setSelectedVoskModel(models[0]);
            }
          }
        } catch (err) {
          console.error('Failed to connect to Vosk server:', err);
          setVoskServerAvailable(false);
          setVoskError('Failed to connect to Vosk server');
        } finally {
          setLoadingVoskModels(false);
        }
      };
      
      // Check server when dialog opens
      checkVoskServer();
    }
  }, [open, voskRecognition]);

  // Update local state when props change
  useEffect(() => {
    setLocalContextLength(contextLength);
    setLocalTemperature(temperature);
  }, [contextLength, temperature]);

  const handleOpen = () => {
    setOpen(true);
  };

  const handleClose = () => {
    setOpen(false);
    // Reset to original values
    setLocalContextLength(contextLength);
    setLocalTemperature(temperature);
    setContextLengthError('');
    setTemperatureError('');
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

    onSaveSettings(localContextLength, localTemperature);
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

      <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
        <DialogTitle sx={styles.dialogTitle}>
          <Typography variant="h6">Model Settings</Typography>
          <IconButton edge="end" color="inherit" onClick={handleClose} aria-label="close">
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          <Box sx={styles.sectionContainer}>
            <Typography variant="subtitle1" gutterBottom>
              Current Model: {model?.name || 'No model selected'}
            </Typography>
          </Box>

          {/* Vosk Speech Recognition Model Section */}
          <Divider sx={{ my: 2 }} />
          <Box sx={styles.sectionContainer}>
            <Typography variant="subtitle1" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <MicIcon sx={{ fontSize: 20 }} />
              Speech Recognition Model
            </Typography>
            
            {voskServerAvailable === false ? (
              <Alert severity="warning" sx={{ mt: 1 }}>
                Vosk server not available. Please ensure the server is running on localhost:2700.
              </Alert>
            ) : voskError ? (
              <Alert severity="error" sx={{ mt: 1 }}>
                {voskError}
              </Alert>
            ) : (
              <FormControl fullWidth size="small" sx={{ mt: 1 }}>
                <InputLabel id="vosk-model-select-label">
                  {loadingVoskModels ? 'Loading models...' : 'Select Speech Recognition Model'}
                </InputLabel>
                <Select
                  labelId="vosk-model-select-label"
                  value={selectedVoskModel}
                  label={loadingVoskModels ? 'Loading models...' : 'Select Speech Recognition Model'}
                  onChange={(e) => handleVoskModelChange(e.target.value)}
                  disabled={loadingVoskModels || loadingVoskModel || availableVoskModels.length === 0}
                  startAdornment={
                    loadingVoskModel ? (
                      <CircularProgress size={16} sx={{ mr: 1 }} />
                    ) : selectedVoskModel ? (
                      <MicIcon sx={{ fontSize: 16, mr: 1, color: 'success.main' }} />
                    ) : null
                  }
                >
                  {availableVoskModels.length === 0 ? (
                    <MenuItem disabled>
                      {loadingVoskModels ? 'Loading...' : 'No models available'}
                    </MenuItem>
                  ) : (
                    availableVoskModels.map((modelName) => (
                      <MenuItem key={modelName} value={modelName}>
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '100%' }}>
                          <Typography variant="body2">
                            {formatModelName(modelName)}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {modelName}
                          </Typography>
                        </Box>
                      </MenuItem>
                    ))
                  )}
                </Select>
                {selectedVoskModel && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                    Active: {formatModelName(selectedVoskModel)}
                  </Typography>
                )}
              </FormControl>
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
    </>
  );
};

export default SettingsDialog;
