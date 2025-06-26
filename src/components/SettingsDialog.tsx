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
} from '@mui/material';
import { Settings as SettingsIcon, Close as CloseIcon, Storage as StorageIcon } from '@mui/icons-material';
import { ModelType } from '../types';
import { VoskRecognitionService } from '../services/vosk';
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
          <Typography component="span" variant="h6">Model Settings</Typography>
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
          <VoskModelSelector
            voskRecognition={voskRecognition || null}
            onModelSelected={(modelName) => {
              console.log('Model selected:', modelName);
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
