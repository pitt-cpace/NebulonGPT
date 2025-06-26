import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Box,
  LinearProgress,
  Alert,
  Chip,
  Divider,
  Input,
  FormControl,
  InputLabel,
  Card,
  CardContent,
  Grid
} from '@mui/material';
import {
  Delete as DeleteIcon,
  CloudUpload as UploadIcon,
  UnarchiveOutlined as ExtractIcon,
  Refresh as RefreshIcon,
  Storage as StorageIcon,
  CheckCircle as ReadyIcon,
  Archive as ArchiveIcon,
  Close as CloseIcon
} from '@mui/icons-material';
import axios from 'axios';
import { VoskRecognitionService } from '../services/vosk';

interface VoskModel {
  name: string;
  type: 'directory' | 'zip';
  size: number;
  modified: string;
  status: 'ready' | 'archived';
}

interface VoskModelManagerProps {
  open: boolean;
  onClose: () => void;
  voskRecognition?: VoskRecognitionService | null;
  onRefreshModels?: () => void;
}

const VoskModelManager: React.FC<VoskModelManagerProps> = ({ open, onClose, voskRecognition, onRefreshModels }) => {
  const [models, setModels] = useState<VoskModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentUploadFile, setCurrentUploadFile] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [usingVoskServer, setUsingVoskServer] = useState(false);

  const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

  useEffect(() => {
    if (open) {
      loadModels();
    }
  }, [open]);

  const loadModels = async () => {
    setLoading(true);
    setError(null);
    try {
      // Try to get models from Vosk server first (this is where the models actually are)
      if (voskRecognition) {
        try {
          const voskModels = await voskRecognition.getAvailableModels();
          const formattedModels: VoskModel[] = voskModels.map(modelName => ({
            name: modelName,
            type: 'directory' as const,
            size: 0, // Size not available from Vosk server
            modified: new Date().toISOString(), // Use current date as fallback
            status: 'ready' as const
          }));
          setModels(formattedModels);
          setUsingVoskServer(true);
          return;
        } catch (voskError) {
          console.warn('Failed to get models from Vosk server, trying Node.js API:', voskError);
        }
      }
      
      // Fallback to Node.js API
      const response = await axios.get(`${API_BASE}/api/vosk/models`);
      setModels(response.data.models);
      setUsingVoskServer(false);
    } catch (error) {
      console.error('Error loading models:', error);
      setError('Error loading models list');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    // Validate all files are ZIP files
    const invalidFiles = Array.from(files).filter(file => !file.name.endsWith('.zip'));
    if (invalidFiles.length > 0) {
      setError(`Only ZIP files are supported. Invalid files: ${invalidFiles.map(f => f.name).join(', ')}`);
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    setCurrentUploadFile('');
    setError(null);
    setSuccess(null);

    const totalFiles = files.length;
    let completedFiles = 0;
    const results: string[] = [];
    const errors: string[] = [];

    try {
      // Upload files sequentially to avoid overwhelming the server
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setCurrentUploadFile(file.name);
        const formData = new FormData();
        formData.append('model', file);

        try {
          console.log(`Uploading file ${i + 1}/${totalFiles}: ${file.name}`);
          
          const response = await axios.post(`${API_BASE}/api/vosk/models/upload`, formData, {
            headers: {
              'Content-Type': 'multipart/form-data',
            },
            onUploadProgress: (progressEvent) => {
              if (progressEvent.total) {
                const fileProgress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                const overallProgress = Math.round(((completedFiles + (fileProgress / 100)) / totalFiles) * 100);
                setUploadProgress(overallProgress);
              }
            },
          });

          results.push(`✅ ${file.name}: ${response.data.message}`);
          completedFiles++;
          
          // Update progress for completed file
          setUploadProgress(Math.round((completedFiles / totalFiles) * 100));
          
        } catch (fileError: any) {
          console.error(`Error uploading ${file.name}:`, fileError);
          errors.push(`❌ ${file.name}: ${fileError.response?.data?.error || 'Upload failed'}`);
          completedFiles++;
        }
      }

      // Show results
      if (results.length > 0 && errors.length === 0) {
        setSuccess(`All ${totalFiles} models uploaded successfully:\n${results.join('\n')}`);
      } else if (results.length > 0 && errors.length > 0) {
        setSuccess(`${results.length}/${totalFiles} models uploaded successfully:\n${results.join('\n')}`);
        setError(`${errors.length} uploads failed:\n${errors.join('\n')}`);
      } else {
        setError(`All uploads failed:\n${errors.join('\n')}`);
      }

      loadModels();
    } catch (error: any) {
      console.error('Error during batch upload:', error);
      setError('Batch upload failed');
    } finally {
      setUploading(false);
      setUploadProgress(0);
      setCurrentUploadFile('');
      // Reset file input
      event.target.value = '';
    }
  };

  const handleDeleteModel = async (modelName: string) => {
    if (!window.confirm(`Are you sure you want to delete model "${modelName}"?`)) {
      return;
    }

    setError(null);
    try {
      await axios.delete(`${API_BASE}/api/vosk/models/${encodeURIComponent(modelName)}`);
      setSuccess('Model deleted successfully');
      loadModels();
    } catch (error: any) {
      console.error('Error deleting model:', error);
      setError(error.response?.data?.error || 'Error deleting model');
    }
  };

  const handleExtractModel = async (modelName: string) => {
    setError(null);
    try {
      await axios.post(`${API_BASE}/api/vosk/models/${encodeURIComponent(modelName)}/extract`);
      setSuccess('Model extracted successfully');
      loadModels();
    } catch (error: any) {
      console.error('Error extracting model:', error);
      setError(error.response?.data?.error || 'Error extracting model');
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateString: string): string => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const handleClose = () => {
    // Call the refresh function to update the model selector dropdown
    if (onRefreshModels) {
      onRefreshModels();
    }
    // Call the original onClose
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} maxWidth="md" fullWidth>
      <DialogTitle>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Box display="flex" alignItems="center" gap={1}>
            <StorageIcon />
            <span>Vosk Speech Recognition Models Management</span>
          </Box>
          <IconButton
            onClick={handleClose}
            size="small"
            sx={{ 
              color: 'text.secondary',
              '&:hover': {
                color: 'text.primary',
                backgroundColor: 'action.hover'
              }
            }}
          >
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      
      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        
        {success && (
          <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess(null)}>
            {success}
          </Alert>
        )}

        {/* Upload Section */}
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Upload New Model
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              Select one or more Vosk model ZIP files. You can download models from{' '}
              <a 
                href="https://alphacephei.com/vosk/models" 
                target="_blank" 
                rel="noopener noreferrer"
                style={{ 
                  color: '#90caf9',
                  textDecoration: 'underline',
                  fontWeight: 'bold'
                }}
              >
                alphacephei.com/vosk/models
              </a>
              <br />
              <strong>Note:</strong> If a model already exists, it will be automatically overwritten.
            </Typography>
            
            <Box display="flex" alignItems="center" gap={2}>
              <FormControl>
                <input
                  type="file"
                  accept=".zip"
                  multiple
                  onChange={handleFileUpload}
                  disabled={uploading}
                  style={{ display: 'none' }}
                  id="model-upload-input"
                />
                <label htmlFor="model-upload-input">
                  <Button
                    variant="contained"
                    component="span"
                    startIcon={<UploadIcon />}
                    disabled={uploading}
                  >
                    Select ZIP Files
                  </Button>
                </label>
              </FormControl>
              
              <Button
                variant="outlined"
                startIcon={<RefreshIcon />}
                onClick={loadModels}
                disabled={loading || uploading}
              >
                Refresh
              </Button>
            </Box>
            
            {uploading && (
              <Box sx={{ mt: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  Uploading... {uploadProgress}%
                </Typography>
                {currentUploadFile && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, fontStyle: 'italic' }}>
                    Current file: {currentUploadFile}
                  </Typography>
                )}
                <LinearProgress variant="determinate" value={uploadProgress} sx={{ mt: 1 }} />
              </Box>
            )}
          </CardContent>
        </Card>

        <Divider sx={{ my: 2 }} />

        {/* Models List */}
        <Typography variant="h6" gutterBottom>
          Available Models ({models.length})
        </Typography>

        {usingVoskServer && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Models are loaded from the Vosk server. Upload new models using the form above, then restart the Docker containers to see them here.
          </Alert>
        )}

        {loading ? (
          <Box display="flex" justifyContent="center" p={3}>
            <LinearProgress sx={{ width: '100%' }} />
          </Box>
        ) : models.length === 0 ? (
          <Alert severity="info">
            No models found. Please upload Vosk models.
          </Alert>
        ) : (
          <List>
            {models.map((model, index) => (
              <ListItem key={index} divider>
                <ListItemText
                  primary={
                    <Box display="flex" alignItems="center" gap={1}>
                      {model.status === 'ready' ? (
                        <ReadyIcon color="success" fontSize="small" />
                      ) : (
                        <ArchiveIcon color="warning" fontSize="small" />
                      )}
                      <span style={{ fontSize: '1.1rem', fontWeight: 500 }}>{model.name}</span>
                      <Chip
                        label={model.type === 'directory' ? 'Ready' : 'Archived'}
                        size="small"
                        color={model.type === 'directory' ? 'success' : 'warning'}
                      />
                    </Box>
                  }
                  secondary={
                    <Box component="div">
                      <div style={{ fontSize: '0.875rem', color: 'rgba(255, 255, 255, 0.7)' }}>
                        Size: {formatFileSize(model.size)}
                      </div>
                      <div style={{ fontSize: '0.875rem', color: 'rgba(255, 255, 255, 0.7)' }}>
                        Modified: {formatDate(model.modified)}
                      </div>
                    </Box>
                  }
                />
                <ListItemSecondaryAction>
                  <Box display="flex" gap={1}>
                    {model.type === 'zip' && (
                      <IconButton
                        edge="end"
                        onClick={() => handleExtractModel(model.name)}
                        title="Extract Model"
                        color="primary"
                      >
                        <ExtractIcon />
                      </IconButton>
                    )}
                    <IconButton
                      edge="end"
                      onClick={() => handleDeleteModel(model.name)}
                      title="Delete Model"
                      color="error"
                    >
                      <DeleteIcon />
                    </IconButton>
                  </Box>
                </ListItemSecondaryAction>
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>
      
      <DialogActions>
        <Button onClick={handleClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default VoskModelManager;
