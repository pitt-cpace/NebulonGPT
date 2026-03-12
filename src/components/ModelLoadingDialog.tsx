/**
 * Model Loading Dialog Component
 * 
 * Shows real-time progress when loading a model into RAM.
 * Displays actual memory usage and loading status from Ollama.
 */

import React, { useEffect, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  LinearProgress,
  CircularProgress,
  IconButton,
} from '@mui/material';
import {
  Close as CloseIcon,
  Memory as MemoryIcon,
  CheckCircle as CheckCircleIcon,
  Error as ErrorIcon,
} from '@mui/icons-material';
import { modelLoadingService, ModelLoadingProgress } from '../services/modelLoadingService';

interface ModelLoadingDialogProps {
  open: boolean;
  onClose: () => void;
  modelName: string;
}

const ModelLoadingDialog: React.FC<ModelLoadingDialogProps> = ({
  open,
  onClose,
  modelName,
}) => {
  const [progress, setProgress] = useState<ModelLoadingProgress>({
    status: 'idle',
    progress: 0,
    currentSize: 0,
    totalSize: 0,
    message: '',
    modelName: '',
  });

  // Subscribe to progress updates
  useEffect(() => {
    const unsubscribe = modelLoadingService.onProgress((newProgress) => {
      setProgress(newProgress);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  // Handle close button
  const handleClose = () => {
    if (progress.status === 'loading' || progress.status === 'starting') {
      // Cancel loading if in progress
      modelLoadingService.cancelLoading();
    }
    onClose();
  };

  // Format bytes to human readable
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Get status color
  const getStatusColor = () => {
    switch (progress.status) {
      case 'loaded':
        return 'success.main';
      case 'error':
        return 'error.main';
      case 'loading':
      case 'starting':
        return 'primary.main';
      default:
        return 'text.secondary';
    }
  };

  // Get status icon
  const getStatusIcon = () => {
    switch (progress.status) {
      case 'loaded':
        return <CheckCircleIcon sx={{ fontSize: 48, color: 'success.main' }} />;
      case 'error':
        return <ErrorIcon sx={{ fontSize: 48, color: 'error.main' }} />;
      case 'loading':
      case 'starting':
        return <CircularProgress size={48} />;
      default:
        return <MemoryIcon sx={{ fontSize: 48, color: 'text.secondary' }} />;
    }
  };

  // Only prevent backdrop click during loading - allow when done
  const isLoading = progress.status === 'loading' || progress.status === 'starting';

  return (
    <Dialog
      open={open}
      onClose={(event, reason) => {
        // During loading: prevent closing on backdrop click or escape key
        // When done (loaded/error/cancelled): allow closing
        if (isLoading && (reason === 'backdropClick' || reason === 'escapeKeyDown')) {
          return;
        }
        handleClose();
      }}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 2,
          overflow: 'hidden',
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <MemoryIcon color="primary" />
          <Typography variant="h6">Loading Model</Typography>
        </Box>
        <IconButton
          onClick={handleClose}
          size="small"
          sx={{
            color: 'text.secondary',
            '&:hover': { bgcolor: 'action.hover' },
          }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ py: 4 }}>
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 3,
          }}
        >
          {/* Status Icon */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 80,
              height: 80,
              borderRadius: '50%',
              bgcolor: 'action.hover',
            }}
          >
            {getStatusIcon()}
          </Box>

          {/* Model Name */}
          <Typography
            variant="h6"
            sx={{
              fontWeight: 'bold',
              color: getStatusColor(),
              textAlign: 'center',
            }}
          >
            {progress.modelName || modelName}
          </Typography>

          {/* Status Message */}
          <Typography
            variant="body1"
            color="text.secondary"
            sx={{ textAlign: 'center' }}
          >
            {progress.message || 'Preparing to load model...'}
          </Typography>

          {/* Progress Bar */}
          {(progress.status === 'loading' || progress.status === 'starting') && (
            <Box sx={{ width: '100%', mt: 2 }}>
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  mb: 1,
                }}
              >
                <Typography variant="body2" color="text.secondary">
                  Progress
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {progress.progress}%
                </Typography>
              </Box>
              <LinearProgress
                variant="determinate"
                value={progress.progress}
                sx={{
                  height: 10,
                  borderRadius: 5,
                  bgcolor: 'action.hover',
                  '& .MuiLinearProgress-bar': {
                    borderRadius: 5,
                    background: 'linear-gradient(90deg, #2196f3 0%, #21cbf3 100%)',
                  },
                }}
              />
            </Box>
          )}

          {/* Memory Info */}
          {(progress.currentSize > 0 || progress.totalSize > 0) && (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 1,
                mt: 2,
                p: 2,
                bgcolor: 'action.hover',
                borderRadius: 2,
                width: '100%',
              }}
            >
              <Typography variant="subtitle2" color="text.secondary">
                Memory Usage
              </Typography>
              <Box sx={{ display: 'flex', gap: 2, alignItems: 'baseline' }}>
                <Typography
                  variant="h5"
                  sx={{ fontWeight: 'bold', color: 'primary.main' }}
                >
                  {formatBytes(progress.currentSize)}
                </Typography>
                {progress.totalSize > 0 && (
                  <Typography variant="body2" color="text.secondary">
                    / {formatBytes(progress.totalSize)}
                  </Typography>
                )}
              </Box>
            </Box>
          )}

          {/* Load Time */}
          {progress.status === 'loaded' && progress.startTime && progress.endTime && (
            <Typography variant="body2" color="text.secondary">
              Loaded in {((progress.endTime - progress.startTime) / 1000).toFixed(1)}s
            </Typography>
          )}

          {/* Error Message */}
          {progress.status === 'error' && progress.error && (
            <Box
              sx={{
                mt: 2,
                p: 2,
                bgcolor: 'error.light',
                borderRadius: 1,
                color: 'error.contrastText',
                width: '100%',
              }}
            >
              <Typography variant="body2">{progress.error}</Typography>
            </Box>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, borderTop: 1, borderColor: 'divider' }}>
        {progress.status === 'loading' || progress.status === 'starting' ? (
          <Button
            onClick={handleClose}
            variant="outlined"
            color="error"
            sx={{ borderRadius: 2 }}
          >
            Cancel
          </Button>
        ) : (
          <Button
            onClick={handleClose}
            variant="contained"
            color="primary"
            sx={{ borderRadius: 2 }}
          >
            {progress.status === 'loaded' ? 'Done' : 'Close'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default ModelLoadingDialog;
