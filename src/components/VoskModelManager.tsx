import React, { useState, useEffect, useCallback } from 'react';
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
  FormControl,
  Card,
  CardContent,
  Checkbox,
  ListItemIcon
} from '@mui/material';
import {
  Delete as DeleteIcon,
  CloudUpload as UploadIcon,
  UnarchiveOutlined as ExtractIcon,
  Refresh as RefreshIcon,
  Storage as StorageIcon,
  CheckCircle as ReadyIcon,
  Close as CloseIcon,
  DeleteSweep as DeleteSweepIcon,
  Folder as FolderIcon,
  Archive as ZipIcon,
  InsertDriveFile as FileIcon,
  PictureAsPdf as PdfIcon
} from '@mui/icons-material';
import axios from 'axios';
import { VoskRecognitionService } from '../services/vosk';

interface VoskModel {
  name: string;
  type: 'directory' | 'zip' | 'file';
  size: number;
  modified: string;
  status: 'ready' | 'archived' | 'other';
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
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [selectAllZip, setSelectAllZip] = useState(false);
  const [selectAllVosk, setSelectAllVosk] = useState(false);
  const [selectAllDir, setSelectAllDir] = useState(false);
  const [selectAllOther, setSelectAllOther] = useState(false);

  const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3001';

  const loadModels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Always use the Node.js API endpoint that shows ALL files (not just Vosk models)
      // This gives us complete visibility into the models directory
      const response = await axios.get(`${API_BASE}/api/vosk/models/all`);
      setModels(response.data.models);
      setUsingVoskServer(false);
    } catch (error) {
      console.error('Error loading models:', error);
      setError('Error loading models list');
    } finally {
      setLoading(false);
    }
  }, [API_BASE]);

  useEffect(() => {
    if (open) {
      loadModels();
    }
  }, [open, loadModels]);

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
            onUploadProgress: ((currentCompleted) => (progressEvent) => {
              if (progressEvent.total) {
                const fileProgress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                const overallProgress = Math.round(((currentCompleted + (fileProgress / 100)) / totalFiles) * 100);
                setUploadProgress(overallProgress);
              }
            })(completedFiles),
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

  // Helper functions for file selection and bulk operations
  const zipFiles = models.filter(model => model.type === 'zip');
  const voskModelFiles = models.filter(model => model.type === 'directory' && model.status === 'ready');
  const otherDirectories = models.filter(model => model.type === 'directory' && model.status === 'other');
  const otherFiles = models.filter(model => model.type === 'file');

  // Helper function to get file icon based on extension
  const getFileIcon = (fileName: string) => {
    const extension = fileName.toLowerCase().split('.').pop();
    switch (extension) {
      case 'pdf':
        return <PdfIcon color="error" fontSize="small" />;
      case 'zip':
        return <ZipIcon color="warning" fontSize="small" />;
      default:
        return <FileIcon color="info" fontSize="small" />;
    }
  };

  // Helper function to get file type label
  const getFileTypeLabel = (fileName: string) => {
    const extension = fileName.toLowerCase().split('.').pop();
    switch (extension) {
      case 'pdf':
        return 'PDF';
      case 'zip':
        return 'ZIP';
      case 'txt':
        return 'Text';
      case 'json':
        return 'JSON';
      default:
        return extension?.toUpperCase() || 'File';
    }
  };

  const handleFileSelection = (fileName: string, checked: boolean) => {
    const newSelected = new Set(selectedFiles);
    if (checked) {
      newSelected.add(fileName);
    } else {
      newSelected.delete(fileName);
    }
    setSelectedFiles(newSelected);
  };

  const handleSelectAllZip = (checked: boolean) => {
    setSelectAllZip(checked);
    const newSelected = new Set(selectedFiles);
    zipFiles.forEach(file => {
      if (checked) {
        newSelected.add(file.name);
      } else {
        newSelected.delete(file.name);
      }
    });
    setSelectedFiles(newSelected);
  };

  const handleSelectAllVosk = (checked: boolean) => {
    setSelectAllVosk(checked);
    const newSelected = new Set(selectedFiles);
    voskModelFiles.forEach((file: VoskModel) => {
      if (checked) {
        newSelected.add(file.name);
      } else {
        newSelected.delete(file.name);
      }
    });
    setSelectedFiles(newSelected);
  };

  const handleSelectAllDir = (checked: boolean) => {
    setSelectAllDir(checked);
    const newSelected = new Set(selectedFiles);
    otherDirectories.forEach((file: VoskModel) => {
      if (checked) {
        newSelected.add(file.name);
      } else {
        newSelected.delete(file.name);
      }
    });
    setSelectedFiles(newSelected);
  };

  const handleSelectAllOther = (checked: boolean) => {
    setSelectAllOther(checked);
    const newSelected = new Set(selectedFiles);
    otherFiles.forEach(file => {
      if (checked) {
        newSelected.add(file.name);
      } else {
        newSelected.delete(file.name);
      }
    });
    setSelectedFiles(newSelected);
  };

  const handleBulkDelete = async () => {
    if (selectedFiles.size === 0) {
      setError('No files selected for deletion');
      return;
    }

    const fileList = Array.from(selectedFiles).join(', ');
    if (!window.confirm(`Are you sure you want to delete ${selectedFiles.size} selected files?\n\nFiles: ${fileList}`)) {
      return;
    }

    setError(null);
    const results: string[] = [];
    const errors: string[] = [];

    for (const fileName of Array.from(selectedFiles)) {
      try {
        await axios.delete(`${API_BASE}/api/vosk/models/${encodeURIComponent(fileName)}`);
        results.push(`✅ ${fileName}: Deleted successfully`);
      } catch (error: any) {
        console.error(`Error deleting ${fileName}:`, error);
        errors.push(`❌ ${fileName}: ${error.response?.data?.error || 'Delete failed'}`);
      }
    }

    // Show results
    if (results.length > 0 && errors.length === 0) {
      setSuccess(`All ${selectedFiles.size} files deleted successfully:\n${results.join('\n')}`);
    } else if (results.length > 0 && errors.length > 0) {
      setSuccess(`${results.length}/${selectedFiles.size} files deleted successfully:\n${results.join('\n')}`);
      setError(`${errors.length} deletions failed:\n${errors.join('\n')}`);
    } else {
      setError(`All deletions failed:\n${errors.join('\n')}`);
    }

    // Clear selections and reload
    setSelectedFiles(new Set());
    setSelectAllZip(false);
    setSelectAllDir(false);
    setSelectAllOther(false);
    loadModels();
  };

  const handleBulkExtract = async () => {
    const selectedZipFiles = Array.from(selectedFiles).filter(fileName => 
      zipFiles.some(file => file.name === fileName)
    );

    if (selectedZipFiles.length === 0) {
      setError('No ZIP files selected for extraction');
      return;
    }

    if (!window.confirm(`Are you sure you want to extract ${selectedZipFiles.length} selected ZIP files?\n\nFiles: ${selectedZipFiles.join(', ')}`)) {
      return;
    }

    setError(null);
    const results: string[] = [];
    const errors: string[] = [];

    for (const fileName of selectedZipFiles) {
      try {
        await axios.post(`${API_BASE}/api/vosk/models/${encodeURIComponent(fileName)}/extract`);
        results.push(`✅ ${fileName}: Extracted successfully`);
      } catch (error: any) {
        console.error(`Error extracting ${fileName}:`, error);
        errors.push(`❌ ${fileName}: ${error.response?.data?.error || 'Extract failed'}`);
      }
    }

    // Show results
    if (results.length > 0 && errors.length === 0) {
      setSuccess(`All ${selectedZipFiles.length} ZIP files extracted successfully:\n${results.join('\n')}`);
    } else if (results.length > 0 && errors.length > 0) {
      setSuccess(`${results.length}/${selectedZipFiles.length} ZIP files extracted successfully:\n${results.join('\n')}`);
      setError(`${errors.length} extractions failed:\n${errors.join('\n')}`);
    } else {
      setError(`All extractions failed:\n${errors.join('\n')}`);
    }

    // Clear selections and reload
    setSelectedFiles(new Set());
    setSelectAllZip(false);
    setSelectAllDir(false);
    loadModels();
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
            <Typography component="span" variant="h6">
              Vosk Speech Recognition Models Management
            </Typography>
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
          <>
            {/* Vosk Models Section - Most Important, Show First */}
            {voskModelFiles.length > 0 && (
              <Card sx={{ mb: 3 }}>
                <CardContent>
                  <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
                    <Box display="flex" alignItems="center" gap={1}>
                      <ReadyIcon color="success" />
                      <Typography variant="h6">
                        Vosk Models ({voskModelFiles.length})
                      </Typography>
                    </Box>
                    <Box display="flex" alignItems="center" gap={1}>
                      <Checkbox
                        checked={selectAllVosk}
                        onChange={(e) => handleSelectAllVosk(e.target.checked)}
                        size="small"
                      />
                      <Typography variant="body2" color="text.secondary">
                        Select All
                      </Typography>
                      {selectedFiles.size > 0 && (
                        <Button
                          variant="outlined"
                          size="small"
                          color="error"
                          startIcon={<DeleteSweepIcon />}
                          onClick={handleBulkDelete}
                        >
                          Delete Selected ({selectedFiles.size})
                        </Button>
                      )}
                    </Box>
                  </Box>
                  <List dense>
                    {voskModelFiles.map((model: VoskModel, index: number) => (
                      <ListItem key={`vosk-${index}`} divider>
                        <ListItemIcon>
                          <Checkbox
                            checked={selectedFiles.has(model.name)}
                            onChange={(e) => handleFileSelection(model.name, e.target.checked)}
                            size="small"
                          />
                        </ListItemIcon>
                        <ListItemText
                          primary={
                            <Box display="flex" alignItems="center" gap={1}>
                              <ReadyIcon color="success" fontSize="small" />
                              <span style={{ fontSize: '1rem', fontWeight: 500 }}>{model.name}</span>
                              <Chip
                                label="Ready"
                                size="small"
                                color="success"
                              />
                            </Box>
                          }
                          secondary={
                            <span style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.7)' }}>
                              Size: {formatFileSize(model.size)} | Modified: {formatDate(model.modified)}
                            </span>
                          }
                        />
                        <ListItemSecondaryAction>
                          <IconButton
                            edge="end"
                            onClick={() => handleDeleteModel(model.name)}
                            title="Delete Vosk Model"
                            color="error"
                            size="small"
                          >
                            <DeleteIcon />
                          </IconButton>
                        </ListItemSecondaryAction>
                      </ListItem>
                    ))}
                  </List>
                </CardContent>
              </Card>
            )}

            {/* Other Directories Section */}
            {otherDirectories.length > 0 && (
              <Card sx={{ mb: 3 }}>
                <CardContent>
                  <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
                    <Box display="flex" alignItems="center" gap={1}>
                      <FolderIcon color="info" />
                      <Typography variant="h6">
                        Other Directories ({otherDirectories.length})
                      </Typography>
                    </Box>
                    <Box display="flex" alignItems="center" gap={1}>
                      <Checkbox
                        checked={selectAllDir}
                        onChange={(e) => handleSelectAllDir(e.target.checked)}
                        size="small"
                      />
                      <Typography variant="body2" color="text.secondary">
                        Select All
                      </Typography>
                      {selectedFiles.size > 0 && (
                        <Button
                          variant="outlined"
                          size="small"
                          color="error"
                          startIcon={<DeleteSweepIcon />}
                          onClick={handleBulkDelete}
                        >
                          Delete Selected ({selectedFiles.size})
                        </Button>
                      )}
                    </Box>
                  </Box>
                  <List dense>
                    {otherDirectories.map((model: VoskModel, index: number) => (
                      <ListItem key={`dir-${index}`} divider>
                        <ListItemIcon>
                          <Checkbox
                            checked={selectedFiles.has(model.name)}
                            onChange={(e) => handleFileSelection(model.name, e.target.checked)}
                            size="small"
                          />
                        </ListItemIcon>
                        <ListItemText
                          primary={
                            <Box display="flex" alignItems="center" gap={1}>
                              <FolderIcon color="info" fontSize="small" />
                              <span style={{ fontSize: '1rem', fontWeight: 500 }}>{model.name}</span>
                              <Chip
                                label="Directory"
                                size="small"
                                color="info"
                              />
                            </Box>
                          }
                          secondary={
                            <span style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.7)' }}>
                              Size: {formatFileSize(model.size)} | Modified: {formatDate(model.modified)}
                            </span>
                          }
                        />
                        <ListItemSecondaryAction>
                          <IconButton
                            edge="end"
                            onClick={() => handleDeleteModel(model.name)}
                            title="Delete Directory"
                            color="error"
                            size="small"
                          >
                            <DeleteIcon />
                          </IconButton>
                        </ListItemSecondaryAction>
                      </ListItem>
                    ))}
                  </List>
                </CardContent>
              </Card>
            )}

            {/* ZIP Files Section - Second Priority */}
            {zipFiles.length > 0 && (
              <Card sx={{ mb: 3 }}>
                <CardContent>
                  <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
                    <Box display="flex" alignItems="center" gap={1}>
                      <ZipIcon color="warning" />
                      <Typography variant="h6">
                        ZIP Files ({zipFiles.length})
                      </Typography>
                    </Box>
                    <Box display="flex" alignItems="center" gap={1}>
                      <Checkbox
                        checked={selectAllZip}
                        onChange={(e) => handleSelectAllZip(e.target.checked)}
                        size="small"
                      />
                      <Typography variant="body2" color="text.secondary">
                        Select All
                      </Typography>
                      {selectedFiles.size > 0 && (
                        <>
                          <Button
                            variant="outlined"
                            size="small"
                            startIcon={<ExtractIcon />}
                            onClick={handleBulkExtract}
                            disabled={Array.from(selectedFiles).filter(f => zipFiles.some(z => z.name === f)).length === 0}
                          >
                            Extract Selected
                          </Button>
                          <Button
                            variant="outlined"
                            size="small"
                            color="error"
                            startIcon={<DeleteSweepIcon />}
                            onClick={handleBulkDelete}
                          >
                            Delete Selected ({selectedFiles.size})
                          </Button>
                        </>
                      )}
                    </Box>
                  </Box>
                  <List dense>
                    {zipFiles.map((model, index) => (
                      <ListItem key={`zip-${index}`} divider>
                        <ListItemIcon>
                          <Checkbox
                            checked={selectedFiles.has(model.name)}
                            onChange={(e) => handleFileSelection(model.name, e.target.checked)}
                            size="small"
                          />
                        </ListItemIcon>
                        <ListItemText
                          primary={
                            <Box display="flex" alignItems="center" gap={1}>
                              <ZipIcon color="warning" fontSize="small" />
                              <span style={{ fontSize: '1rem', fontWeight: 500 }}>{model.name}</span>
                              <Chip
                                label="Archived"
                                size="small"
                                color="warning"
                              />
                            </Box>
                          }
                          secondary={
                            <span style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.7)' }}>
                              Size: {formatFileSize(model.size)} | Modified: {formatDate(model.modified)}
                            </span>
                          }
                        />
                        <ListItemSecondaryAction>
                          <Box display="flex" gap={1}>
                            <IconButton
                              edge="end"
                              onClick={() => handleExtractModel(model.name)}
                              title="Extract ZIP File"
                              color="primary"
                              size="small"
                            >
                              <ExtractIcon />
                            </IconButton>
                            <IconButton
                              edge="end"
                              onClick={() => handleDeleteModel(model.name)}
                              title="Delete ZIP File"
                              color="error"
                              size="small"
                            >
                              <DeleteIcon />
                            </IconButton>
                          </Box>
                        </ListItemSecondaryAction>
                      </ListItem>
                    ))}
                  </List>
                </CardContent>
              </Card>
            )}

            {/* Other Files Section - Last Priority */}
            {otherFiles.length > 0 && (
              <Card sx={{ mb: 3 }}>
                <CardContent>
                  <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
                    <Box display="flex" alignItems="center" gap={1}>
                      <FileIcon color="info" />
                      <Typography variant="h6">
                        Other Files ({otherFiles.length})
                      </Typography>
                    </Box>
                    <Box display="flex" alignItems="center" gap={1}>
                      <Checkbox
                        checked={selectAllOther}
                        onChange={(e) => handleSelectAllOther(e.target.checked)}
                        size="small"
                      />
                      <Typography variant="body2" color="text.secondary">
                        Select All
                      </Typography>
                      {selectedFiles.size > 0 && (
                        <Button
                          variant="outlined"
                          size="small"
                          color="error"
                          startIcon={<DeleteSweepIcon />}
                          onClick={handleBulkDelete}
                        >
                          Delete Selected ({selectedFiles.size})
                        </Button>
                      )}
                    </Box>
                  </Box>
                  <List dense>
                    {otherFiles.map((model, index) => (
                      <ListItem key={`other-${index}`} divider>
                        <ListItemIcon>
                          <Checkbox
                            checked={selectedFiles.has(model.name)}
                            onChange={(e) => handleFileSelection(model.name, e.target.checked)}
                            size="small"
                          />
                        </ListItemIcon>
                        <ListItemText
                          primary={
                            <Box display="flex" alignItems="center" gap={1}>
                              {getFileIcon(model.name)}
                              <span style={{ fontSize: '1rem', fontWeight: 500 }}>{model.name}</span>
                              <Chip
                                label={getFileTypeLabel(model.name)}
                                size="small"
                                color="info"
                              />
                            </Box>
                          }
                          secondary={
                            <span style={{ fontSize: '0.75rem', color: 'rgba(255, 255, 255, 0.7)' }}>
                              Size: {formatFileSize(model.size)} | Modified: {formatDate(model.modified)}
                            </span>
                          }
                        />
                        <ListItemSecondaryAction>
                          <IconButton
                            edge="end"
                            onClick={() => handleDeleteModel(model.name)}
                            title="Delete File"
                            color="error"
                            size="small"
                          >
                            <DeleteIcon />
                          </IconButton>
                        </ListItemSecondaryAction>
                      </ListItem>
                    ))}
                  </List>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </DialogContent>
      
      <DialogActions>
        <Button onClick={handleClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
};

export default VoskModelManager;
