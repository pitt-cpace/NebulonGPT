const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const AdmZip = require('adm-zip');

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, 'data');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');

// Vosk models directory - this should match the Docker volume mount
const VOSK_MODELS_DIR = path.join(__dirname, 'vosk-server', 'models');


// Configure multer for file uploads
const upload = multer({
  dest: path.join(__dirname, 'temp-uploads'),
  limits: {
    fileSize: 5 * 1024 * 1024 * 1024, // 5GB limit
  },
});

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Ensure Vosk models directory exists
if (!fs.existsSync(VOSK_MODELS_DIR)) {
  fs.mkdirSync(VOSK_MODELS_DIR, { recursive: true });
}

// Ensure temp uploads directory exists
const TEMP_UPLOADS_DIR = path.join(__dirname, 'temp-uploads');
if (!fs.existsSync(TEMP_UPLOADS_DIR)) {
  fs.mkdirSync(TEMP_UPLOADS_DIR, { recursive: true });
}

// Initialize chats file if it doesn't exist
if (!fs.existsSync(CHATS_FILE)) {
  fs.writeFileSync(CHATS_FILE, JSON.stringify([]));
}

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' })); // Increase payload size limit for large chat histories
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// API endpoints
app.get('/api/chats', (req, res) => {
  try {
    const chatsData = fs.readFileSync(CHATS_FILE, 'utf8');
    const chats = JSON.parse(chatsData);
    res.json(chats);
  } catch (error) {
    console.error('Error reading chats file:', error);
    res.status(500).json({ error: 'Failed to load chats' });
  }
});

// Save or update a specific chat by ID
app.post('/api/chats/:chatId', (req, res) => {
  try {
    const chatId = req.params.chatId;
    const chatData = req.body;
    
    if (!chatId || !chatData) {
      console.error('Missing chat ID or chat data');
      return res.status(400).json({ error: 'Chat ID and chat data are required' });
    }
    
    // Read existing chats
    let chats = [];
    try {
      const chatsData = fs.readFileSync(CHATS_FILE, 'utf8');
      chats = JSON.parse(chatsData);
    } catch (error) {
      console.log('No existing chats file, starting with empty array');
      chats = [];
    }
    
    // Find existing chat by ID
    const existingChatIndex = chats.findIndex(chat => chat.id === chatId);
    
    if (existingChatIndex >= 0) {
      // Update existing chat
      chats[existingChatIndex] = { ...chats[existingChatIndex], ...chatData, id: chatId };
      //console.log(`Updated existing chat: ${chatId}`);
    } else {
      // Add new chat
      chats.unshift({ ...chatData, id: chatId });
      console.log(`Added new chat: ${chatId}`);
    }
    
    // Save updated chats
    fs.writeFileSync(CHATS_FILE, JSON.stringify(chats, null, 2));
    //console.log(`Saved chat ${chatId} to file (total: ${chats.length} chats)`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error saving chat:', error);
    res.status(500).json({ error: 'Failed to save chat' });
  }
});

// Legacy endpoint for backward compatibility - now just saves entire array
app.post('/api/chats', (req, res) => {
  try {
    // Handle both simple array format and session-based format for backward compatibility
    const chats = Array.isArray(req.body) ? req.body : req.body.chats || req.body;
    
    if (!chats) {
      console.error('No chats data received in request body');
      return res.status(400).json({ error: 'No chats data provided' });
    }
    
    fs.writeFileSync(CHATS_FILE, JSON.stringify(chats, null, 2));
    console.log(`Saved ${chats.length} chats to file (legacy endpoint)`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error writing chats:', error);
    res.status(500).json({ error: 'Failed to save chats' });
  }
});

// Helper function to calculate directory size recursively
const getDirectorySize = (dirPath) => {
  let totalSize = 0;
  
  try {
    const items = fs.readdirSync(dirPath);
    
    for (const item of items) {
      const itemPath = path.join(dirPath, item);
      const stats = fs.statSync(itemPath);
      
      if (stats.isDirectory()) {
        totalSize += getDirectorySize(itemPath);
      } else {
        totalSize += stats.size;
      }
    }
  } catch (error) {
    console.error(`Error calculating directory size for ${dirPath}:`, error);
  }
  
  return totalSize;
};

// Helper function to get file stats
const getFileStats = (filePath) => {
  try {
    const stats = fs.statSync(filePath);
    let size = stats.size;
    
    // For directories, calculate the total size of all contents
    if (stats.isDirectory()) {
      size = getDirectorySize(filePath);
    }
    
    return {
      size: size,
      modified: stats.mtime.toISOString(),
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile()
    };
  } catch (error) {
    return null;
  }
};

// Helper function to determine if a directory is a Vosk model
const isVoskModel = (dirPath) => {
  try {
    // Check for common Vosk model files
    const requiredFiles = ['conf/model.conf', 'am/final.mdl', 'graph/HCLG.fst'];
    const alternativeFiles = ['ivector/final.ie', 'ivector/final.dubm', 'ivector/global_cmvn.stats'];
    
    let hasRequiredFiles = 0;
    let hasAlternativeFiles = 0;
    
    for (const file of requiredFiles) {
      if (fs.existsSync(path.join(dirPath, file))) {
        hasRequiredFiles++;
      }
    }
    
    for (const file of alternativeFiles) {
      if (fs.existsSync(path.join(dirPath, file))) {
        hasAlternativeFiles++;
      }
    }
    
    // A directory is considered a Vosk model if it has most required files
    return hasRequiredFiles >= 2 || (hasRequiredFiles >= 1 && hasAlternativeFiles >= 1);
  } catch (error) {
    return false;
  }
};

// Vosk Models API Endpoints

// Get all models (files and directories)
app.get('/api/vosk/models/all', (req, res) => {
  try {
    console.log('Listing models from:', VOSK_MODELS_DIR);
    
    if (!fs.existsSync(VOSK_MODELS_DIR)) {
      console.log('Vosk models directory does not exist, creating it...');
      fs.mkdirSync(VOSK_MODELS_DIR, { recursive: true });
      return res.json({ models: [] });
    }
    
    const items = fs.readdirSync(VOSK_MODELS_DIR);
    const models = [];
    
    for (const item of items) {
      const itemPath = path.join(VOSK_MODELS_DIR, item);
      const stats = getFileStats(itemPath);
      
      if (!stats) continue;
      
      let type = 'file';
      let status = 'other';
      
      if (stats.isDirectory) {
        type = 'directory';
        status = isVoskModel(itemPath) ? 'ready' : 'other';
      } else if (item.endsWith('.zip')) {
        type = 'zip';
        status = 'archived';
      }
      
      models.push({
        name: item,
        type,
        size: stats.size,
        modified: stats.modified,
        status
      });
    }
    
    // Sort models: Vosk models first, then ZIP files, then others
    models.sort((a, b) => {
      const priority = { ready: 0, archived: 1, other: 2 };
      const aPriority = priority[a.status] || 3;
      const bPriority = priority[b.status] || 3;
      
      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }
      
      return a.name.localeCompare(b.name);
    });
    
    console.log(`Found ${models.length} models/files`);
    res.json({ models });
  } catch (error) {
    console.error('Error listing models:', error);
    res.status(500).json({ error: 'Failed to list models' });
  }
});

// Upload model (ZIP file)
app.post('/api/vosk/models/upload', upload.single('model'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const uploadedFile = req.file;
    const originalName = uploadedFile.originalname;
    
    console.log('Uploading model:', originalName);
    
    // Validate file extension
    if (!originalName.endsWith('.zip')) {
      fs.unlinkSync(uploadedFile.path); // Clean up temp file
      return res.status(400).json({ error: 'Only ZIP files are supported' });
    }
    
    // Move file to models directory (use copy + delete for cross-device compatibility)
    const targetPath = path.join(VOSK_MODELS_DIR, originalName);
    fs.copyFileSync(uploadedFile.path, targetPath);
    fs.unlinkSync(uploadedFile.path); // Clean up temp file
    
    console.log('Model uploaded successfully:', targetPath);
    
    // Auto-extract ZIP file after upload
    try {
      console.log('Auto-extracting model:', originalName);
      const zip = new AdmZip(targetPath);
      zip.extractAllTo(VOSK_MODELS_DIR, true);
      console.log('Model auto-extracted successfully:', originalName);
      res.json({ 
        message: 'Model uploaded and extracted successfully', 
        filename: originalName,
        extracted: true
      });
    } catch (extractError) {
      console.error('Error auto-extracting model:', extractError);
      // Still return success for upload, but mention extraction failed
      res.json({ 
        message: 'Model uploaded successfully, but auto-extraction failed. You can extract manually.', 
        filename: originalName,
        extracted: false,
        extractError: extractError.message
      });
    }
  } catch (error) {
    console.error('Error uploading model:', error);
    
    // Clean up temp file if it exists
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.error('Error cleaning up temp file:', cleanupError);
      }
    }
    
    res.status(500).json({ error: 'Failed to upload model' });
  }
});

// Extract model (ZIP file)
app.post('/api/vosk/models/:name/extract', (req, res) => {
  try {
    const modelName = decodeURIComponent(req.params.name);
    const zipPath = path.join(VOSK_MODELS_DIR, modelName);
    
    console.log('Extracting model:', modelName);
    
    if (!fs.existsSync(zipPath)) {
      return res.status(404).json({ error: 'Model file not found' });
    }
    
    if (!modelName.endsWith('.zip')) {
      return res.status(400).json({ error: 'File is not a ZIP archive' });
    }
    
    // Extract ZIP file
    const zip = new AdmZip(zipPath);
    const extractPath = VOSK_MODELS_DIR;
    
    zip.extractAllTo(extractPath, true);
    
    console.log('Model extracted successfully:', modelName);
    res.json({ message: 'Model extracted successfully' });
  } catch (error) {
    console.error('Error extracting model:', error);
    res.status(500).json({ error: 'Failed to extract model' });
  }
});

// Delete model (file or directory)
app.delete('/api/vosk/models/:name', (req, res) => {
  try {
    const modelName = decodeURIComponent(req.params.name);
    const modelPath = path.join(VOSK_MODELS_DIR, modelName);
    
    console.log('Deleting model:', modelName);
    
    if (!fs.existsSync(modelPath)) {
      return res.status(404).json({ error: 'Model not found' });
    }
    
    const stats = fs.statSync(modelPath);
    
    if (stats.isDirectory()) {
      // Delete directory recursively
      fs.rmSync(modelPath, { recursive: true, force: true });
    } else {
      // Delete file
      fs.unlinkSync(modelPath);
    }
    
    console.log('Model deleted successfully:', modelName);
    res.json({ message: 'Model deleted successfully' });
  } catch (error) {
    console.error('Error deleting model:', error);
    res.status(500).json({ error: 'Failed to delete model' });
  }
});

// Start the server on all network interfaces (0.0.0.0)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Chat data server running on port ${PORT} and accessible from all network interfaces`);
});
