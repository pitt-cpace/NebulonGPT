const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const StreamZip = require('node-stream-zip');

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, 'nebulon-gpt-data');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');
const MODELS_DIR = process.env.NODE_ENV === 'production' 
  ? '/app/vosk-models'  // Use Docker volume path in production
  : path.join(__dirname, 'Vosk-Server', 'websocket', 'models');  // Use local path in development

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Ensure models directory exists
if (!fs.existsSync(MODELS_DIR)) {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
}

// Initialize chats file if it doesn't exist
if (!fs.existsSync(CHATS_FILE)) {
  fs.writeFileSync(CHATS_FILE, JSON.stringify([]));
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, MODELS_DIR);
  },
  filename: function (req, file, cb) {
    // Keep original filename
    cb(null, file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 * 1024 // 5GB limit for large models
  },
  fileFilter: function (req, file, cb) {
    // Accept zip files and directories
    if (file.mimetype === 'application/zip' || 
        file.mimetype === 'application/x-zip-compressed' ||
        file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only ZIP files are allowed for Vosk models'));
    }
  }
});

// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '50mb' })); // Increase limit for image attachments
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Health check endpoint for Docker
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

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

app.post('/api/chats', (req, res) => {
  try {
    const chats = req.body;
    fs.writeFileSync(CHATS_FILE, JSON.stringify(chats, null, 2));
    res.json({ success: true });
  } catch (error) {
    console.error('Error writing chats file:', error);
    res.status(500).json({ error: 'Failed to save chats' });
  }
});

// Vosk Models Management API
app.get('/api/vosk/models', (req, res) => {
  try {
    const models = [];
    const files = fs.readdirSync(MODELS_DIR);
    
    files.forEach(file => {
      const filePath = path.join(MODELS_DIR, file);
      const stats = fs.statSync(filePath);
      
      if (stats.isDirectory()) {
        // Check if it's a valid Vosk model directory
        const amPath = path.join(filePath, 'am', 'final.mdl');
        const confPath = path.join(filePath, 'conf', 'model.conf');
        
        if (fs.existsSync(amPath) || fs.existsSync(confPath)) {
          models.push({
            name: file,
            type: 'directory',
            size: getDirSize(filePath),
            modified: stats.mtime,
            status: 'ready'
          });
        }
      } else if (file.endsWith('.zip')) {
        models.push({
          name: file,
          type: 'zip',
          size: stats.size,
          modified: stats.mtime,
          status: 'archived'
        });
      }
    });
    
    res.json({ models });
  } catch (error) {
    console.error('Error reading models directory:', error);
    res.status(500).json({ error: 'Failed to load models' });
  }
});

// Get ALL files and folders in models directory (not just Vosk models)
app.get('/api/vosk/models/all', (req, res) => {
  try {
    const models = [];
    const files = fs.readdirSync(MODELS_DIR);
    
    files.forEach(file => {
      // Skip placeholder files and hidden files
      if (file === '.placeholder' || file.startsWith('.placeholder') || file.startsWith('.git')) {
        return;
      }
      
      const filePath = path.join(MODELS_DIR, file);
      const stats = fs.statSync(filePath);
      
      if (stats.isDirectory()) {
        // Check if it's a valid Vosk model directory
        const amPath = path.join(filePath, 'am', 'final.mdl');
        const confPath = path.join(filePath, 'conf', 'model.conf');
        
        if (fs.existsSync(amPath) || fs.existsSync(confPath)) {
          models.push({
            name: file,
            type: 'directory',
            size: getDirSize(filePath),
            modified: stats.mtime,
            status: 'ready'
          });
        } else {
          // Regular directory (not a Vosk model)
          models.push({
            name: file,
            type: 'directory',
            size: getDirSize(filePath),
            modified: stats.mtime,
            status: 'other'
          });
        }
      } else if (file.endsWith('.zip')) {
        models.push({
          name: file,
          type: 'zip',
          size: stats.size,
          modified: stats.mtime,
          status: 'archived'
        });
      } else {
        // Any other file type
        models.push({
          name: file,
          type: 'file',
          size: stats.size,
          modified: stats.mtime,
          status: 'other'
        });
      }
    });
    
    res.json({ models });
  } catch (error) {
    console.error('Error reading models directory:', error);
    res.status(500).json({ error: 'Failed to load models' });
  }
});

app.post('/api/vosk/models/upload', upload.single('model'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const filePath = req.file.path;
    const fileName = req.file.filename;
    
    console.log(`Model uploaded: ${fileName}`);
    
    // If it's a zip file, extract it using cross-platform library
    if (fileName.endsWith('.zip')) {
      try {
        await extractZipFile(filePath, MODELS_DIR);
        console.log('Model extracted successfully');
        res.json({ 
          success: true, 
          message: 'Model uploaded and extracted successfully',
          filename: fileName,
          extracted: true
        });
      } catch (extractError) {
        console.error('Error extracting model:', extractError);
        res.status(500).json({ 
          error: 'Failed to extract model', 
          details: extractError.message 
        });
      }
    } else {
      res.json({ 
        success: true, 
        message: 'Model uploaded successfully',
        filename: fileName,
        extracted: false
      });
    }
  } catch (error) {
    console.error('Error uploading model:', error);
    res.status(500).json({ error: 'Failed to upload model' });
  }
});

app.delete('/api/vosk/models/:modelName', (req, res) => {
  try {
    const modelName = req.params.modelName;
    const modelPath = path.join(MODELS_DIR, modelName);
    
    if (!fs.existsSync(modelPath)) {
      return res.status(404).json({ error: 'Model not found' });
    }
    
    const stats = fs.statSync(modelPath);
    
    if (stats.isDirectory()) {
      // Remove directory recursively
      fs.rmSync(modelPath, { recursive: true, force: true });
    } else {
      // Remove file
      fs.unlinkSync(modelPath);
    }
    
    console.log(`Model deleted: ${modelName}`);
    res.json({ success: true, message: 'Model deleted successfully' });
  } catch (error) {
    console.error('Error deleting model:', error);
    res.status(500).json({ error: 'Failed to delete model' });
  }
});

app.post('/api/vosk/models/:modelName/extract', async (req, res) => {
  try {
    const modelName = req.params.modelName;
    const zipPath = path.join(MODELS_DIR, modelName);
    
    if (!fs.existsSync(zipPath) || !modelName.endsWith('.zip')) {
      return res.status(404).json({ error: 'ZIP file not found' });
    }
    
    // Extract the zip file using cross-platform library
    try {
      await extractZipFile(zipPath, MODELS_DIR);
      console.log('Model extracted successfully');
      res.json({ 
        success: true, 
        message: 'Model extracted successfully'
      });
    } catch (extractError) {
      console.error('Error extracting model:', extractError);
      res.status(500).json({ 
        error: 'Failed to extract model', 
        details: extractError.message 
      });
    }
  } catch (error) {
    console.error('Error extracting model:', error);
    res.status(500).json({ error: 'Failed to extract model' });
  }
});

// Cross-platform ZIP extraction function with force overwrite
async function extractZipFile(zipPath, extractToDir) {
  return new Promise(async (resolve, reject) => {
    const zip = new StreamZip.async({ file: zipPath });
    
    try {
      // Get list of entries to check for existing models
      const entries = await zip.entries();
      const modelDirs = new Set();
      
      // Find all model directories that will be created
      for (const entry of Object.values(entries)) {
        if (entry.isDirectory) {
          const topLevelDir = entry.name.split('/')[0];
          if (topLevelDir && topLevelDir.startsWith('vosk-model-')) {
            modelDirs.add(topLevelDir);
          }
        }
      }
      
      // Remove existing model directories to force overwrite
      for (const modelDir of modelDirs) {
        const existingPath = path.join(extractToDir, modelDir);
        if (fs.existsSync(existingPath)) {
          console.log(`🗑️ Removing existing model directory: ${existingPath}`);
          fs.rmSync(existingPath, { recursive: true, force: true });
        }
      }
      
      // Extract the ZIP file
      await zip.extract(null, extractToDir);
      zip.close();
      console.log(`✅ Successfully extracted ${zipPath} to ${extractToDir} (force overwrite enabled)`);
      resolve();
    } catch (error) {
      zip.close();
      console.error(`❌ Failed to extract ${zipPath}:`, error);
      reject(error);
    }
  });
}

// Helper function to get directory size
function getDirSize(dirPath) {
  let size = 0;
  try {
    const files = fs.readdirSync(dirPath);
    files.forEach(file => {
      const filePath = path.join(dirPath, file);
      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) {
        size += getDirSize(filePath);
      } else {
        size += stats.size;
      }
    });
  } catch (error) {
    console.error('Error calculating directory size:', error);
  }
  return size;
}

// Start the server
app.listen(PORT, () => {
  console.log(`Chat data server running on port ${PORT}`);
});
