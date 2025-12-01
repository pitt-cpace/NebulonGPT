const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const AdmZip = require('adm-zip');
const axios = require('axios');
const os = require('os');
const https = require('https');
const http = require('http');
const { createProxyMiddleware } = require('http-proxy-middleware');
const { execSync } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3001;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const DATA_DIR = path.join(__dirname, 'data');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');

// Vosk models directory - detect environment and use appropriate path
// Docker: /app/vosk-server/models
// Development/Electron: ~/.nebulon-gpt/vosk-models
const VOSK_MODELS_DIR = fs.existsSync('/app/vosk-server/models') 
  ? '/app/vosk-server/models'  // Docker environment
  : path.join(os.homedir(), '.nebulon-gpt', 'vosk-models');  // Development/Electron
  
console.log(`📂 Using Vosk models directory: ${VOSK_MODELS_DIR}`);

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

// WebSocket Proxies for Vosk and TTS (must be before static file serving)
// Store proxy middleware references for manual upgrade handling
const voskProxy = createProxyMiddleware({
  target: 'ws://127.0.0.1:2700',
  ws: true,
  changeOrigin: true,
  logLevel: 'debug',
  onError: (err, req, res) => {
    console.error('Vosk WebSocket Proxy Error:', err.message);
  }
});

const ttsProxy = createProxyMiddleware({
  target: 'http://127.0.0.1:2701',
  ws: true,
  changeOrigin: true,
  logLevel: 'debug',
  onError: (err, req, res) => {
    console.error('TTS WebSocket Proxy Error:', err.message);
  }
});

// Apply proxy middlewares to Express app
app.use('/vosk', voskProxy);
app.use('/tts', ttsProxy);

// Serve static files from build directory (React app)
app.use(express.static(path.join(__dirname, 'build')));

// Ollama Proxy - Forward requests to local Ollama instance
const OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

app.all('/api/ollama/*', async (req, res) => {
  try {
    const ollamaPath = req.path.replace('/api/ollama', '');
    const ollamaUrl = `${OLLAMA_BASE_URL}/api${ollamaPath}`;
    
    console.log(`Proxying Ollama request: ${req.method} ${ollamaPath}`);
    
    const config = {
      method: req.method,
      url: ollamaUrl,
      data: req.body,
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/json',
        ...(req.headers['authorization'] && { 'Authorization': req.headers['authorization'] })
      },
      responseType: req.body && req.body.stream ? 'stream' : 'json',
      timeout: 300000
    };
    
    const response = await axios(config);
    
    if (response.data && response.data.pipe) {
      res.setHeader('Content-Type', 'text/event-stream');
      response.data.pipe(res);
    } else {
      res.json(response.data);
    }
  } catch (error) {
    console.error('Ollama proxy error:', error.message);
    res.status(error.response?.status || 500).json({ 
      error: error.message || 'Ollama proxy error' 
    });
  }
});

// API endpoints

// API endpoint to identify this server as Node.js-based
app.get('/api/server-info', (req, res) => {
  res.json({
    serverType: 'nodejs',
    platform: process.platform,
    isElectron: false
  });
});

// Get network addresses with enhanced Windows hotspot detection
// Separates WiFi/hotspot connections from Ethernet connections
app.get('/api/network-info', (req, res) => {
  try {
    const wifiIPs = [];
    const ethernetIPs = [];
    const networkInterfaces = os.networkInterfaces();
    
    // Enhanced Windows interface detection using wmic command
    let windowsInterfaceDetails = new Map();
    if (process.platform === 'win32') {
      try {
        // Use wmic to get detailed interface information including descriptions
        const wmicOutput = execSync('wmic path win32_networkadapter where "NetConnectionStatus=2" get NetConnectionID,Description /format:csv', { encoding: 'utf8' });
        
        const lines = wmicOutput.split('\n').filter(line => line.trim() && !line.startsWith('Node'));
        for (const line of lines) {
          const parts = line.split(',');
          if (parts.length >= 3) {
            const description = parts[1]?.trim();
            const connectionId = parts[2]?.trim();
            
            if (description && connectionId) {
              windowsInterfaceDetails.set(connectionId, description);
              console.log(`🔍 Windows interface: ${connectionId} → ${description}`);
            }
          }
        }
      } catch (error) {
        console.warn('Could not run wmic command for Windows interface detection:', error.message);
      }
    }
    
    // Get WiFi interface names using platform-specific commands
    let wifiInterfaceNames = new Set();
    
    // For macOS: use networksetup to get accurate WiFi interfaces
    if (process.platform === 'darwin') {
      try {
        const output = execSync('networksetup -listallhardwareports').toString();
        
        // Parse output to find WiFi interfaces
        // Format: Hardware Port: Wi-Fi\nDevice: en0\n
        const lines = output.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes('Hardware Port:') && 
              (lines[i].includes('Wi-Fi') || lines[i].includes('WiFi') || lines[i].includes('AirPort'))) {
            // Next line should have Device: enX
            if (i + 1 < lines.length && lines[i + 1].includes('Device:')) {
              const deviceMatch = lines[i + 1].match(/Device:\s*(\S+)/);
              if (deviceMatch) {
                wifiInterfaceNames.add(deviceMatch[1]);
                console.log(`🔍 Detected WiFi interface on macOS: ${deviceMatch[1]}`);
              }
            }
          }
        }
      } catch (error) {
        console.warn('Could not run networksetup command:', error.message);
      }
    }
    
    // Process interfaces with enhanced Windows hotspot detection
    for (const interfaceName in networkInterfaces) {
      const interfaces = networkInterfaces[interfaceName];
      const lowerName = interfaceName.toLowerCase();
      
      for (const iface of interfaces) {
        // Get all IPv4 addresses that are not internal
        if (iface.family === 'IPv4' && !iface.internal) {
          const address = `https://${iface.address}:${HTTPS_PORT}`;
          const ipAddress = iface.address;
          
          console.log(`📡 Processing interface: ${interfaceName} → ${iface.address}`);
          
          let isWiFi = false;
          
          // Enhanced Windows-specific detection
          if (process.platform === 'win32') {
            const description = windowsInterfaceDetails.get(interfaceName) || '';
            
            // Windows Mobile Hotspot detection
            if (lowerName.includes('local area connection') && 
                (description.includes('Wi-Fi Direct') || description.includes('Microsoft Wi-Fi Direct Virtual Adapter'))) {
              console.log(`  ✅ Classified as WiFi (Windows hotspot: ${interfaceName}, ${description})`);
              isWiFi = true;
            }
            // Windows hotspot IP range detection (192.168.137.x is default Windows hotspot range)
            else if (ipAddress.startsWith('192.168.137.')) {
              console.log(`  ✅ Classified as WiFi (Windows hotspot IP range: ${ipAddress})`);
              isWiFi = true;
            }
            // Standard Windows WiFi adapter detection
            else if (description.includes('Wi-Fi') || description.includes('Wireless') || description.includes('802.11')) {
              console.log(`  ✅ Classified as WiFi (Windows description: ${description})`);
              isWiFi = true;
            }
          }
          
          // macOS-specific detection
          if (wifiInterfaceNames.has(interfaceName)) {
            console.log(`  ✅ Classified as WiFi (macOS platform detection: ${interfaceName})`);
            isWiFi = true;
          }
          
          // Cross-platform pattern-based detection
          if (!isWiFi) {
            // Standard WiFi interface patterns
            if (/^(wlan|wlp|wl|wifi|wi-?fi|air|airport|wlx|wireless|wi_fi|wlan\d+)/i.test(lowerName)) {
              console.log(`  ✅ Classified as WiFi (name pattern: ${interfaceName})`);
              isWiFi = true;
            }
            // AWDL (Apple Wireless Direct Link)
            else if (lowerName.includes('awdl')) {
              console.log(`  ✅ Classified as WiFi (AWDL: ${interfaceName})`);
              isWiFi = true;
            }
            // Bridge interfaces (generic hotspot scenarios)
            else if (lowerName.includes('bridge')) {
              console.log(`  ✅ Classified as WiFi (bridge: ${interfaceName})`);
              isWiFi = true;
            }
          }
          
          // Classification result
          if (isWiFi) {
            wifiIPs.push(address);
          }
          // Ethernet patterns (including VMware and Hyper-V virtual adapters)
          else if (/^(eth|enp|en|eno|ens|em|ethernet|lan|enx|usb|vmware|vethernet)/i.test(lowerName)) {
            console.log(`  ℹ️ Classified as Ethernet (name pattern: ${interfaceName})`);
            ethernetIPs.push(address);
          }
          // Fallback: unknown interfaces go to Ethernet
          else {
            console.log(`  ℹ️ Classified as Ethernet (fallback: ${interfaceName})`);
            ethernetIPs.push(address);
          }
        }
      }
    }
    
    console.log('✅ WiFi/Hotspot addresses:', wifiIPs);
    console.log('✅ Ethernet/Cable addresses:', ethernetIPs);
    
    res.json({ 
      wifiIPs,
      ethernetIPs,
      networkIPs: [...wifiIPs, ...ethernetIPs], // For backward compatibility
      httpsPort: HTTPS_PORT,
      httpPort: PORT
    });
  } catch (error) {
    console.error('Error getting network addresses:', error);
    res.status(500).json({ error: 'Failed to get network addresses' });
  }
});

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

// Handle client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

// Start HTTP server (for localhost/127.0.0.1 only)
const httpServer = http.createServer(app);
httpServer.listen(PORT, '127.0.0.1', () => {
  console.log(`HTTP server running on http://127.0.0.1:${PORT} (localhost only)`);
  console.log(`HTTP server also accessible at http://localhost:${PORT}`);
});

// Start HTTPS server (for network access) with self-signed certificate
try {
  const certPath = path.join(__dirname, 'Certification', 'cert.pem');
  const keyPath = path.join(__dirname, 'Certification', 'key.pem');
  
  if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
    const httpsOptions = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    };
    
    const httpsServer = https.createServer(httpsOptions, app);
    
    // Handle WebSocket upgrades for the HTTPS server
    httpsServer.on('upgrade', (req, socket, head) => {
      console.log(`WebSocket upgrade request for: ${req.url}`);
      
      // Route to appropriate proxy based on URL
      if (req.url.startsWith('/vosk')) {
        console.log('Routing to Vosk proxy');
        voskProxy.upgrade(req, socket, head);
      } else if (req.url.startsWith('/tts')) {
        console.log('Routing to TTS proxy');
        ttsProxy.upgrade(req, socket, head);
      } else {
        console.log('Unknown WebSocket path:', req.url);
        socket.destroy();
      }
    });
    
    httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
      console.log(`HTTPS server running on port ${HTTPS_PORT} and accessible from all network interfaces`);
      console.log(`⚠️  Using self-signed certificate - browsers will show a security warning`);
      console.log(`💡 Accept the certificate warning to access from other devices`);
      console.log(`📝 WebSocket proxies enabled for /vosk and /tts`);
    });
  } else {
    console.warn('⚠️  SSL certificates not found. HTTPS server not started.');
    console.warn('📝 Run the following command to generate certificates:');
    console.warn('   openssl req -x509 -newkey rsa:2048 -keyout Certification/key.pem -out Certification/cert.pem -days 365 -nodes');
  }
} catch (error) {
  console.error('Error starting HTTPS server:', error.message);
  console.log('Continuing with HTTP server only...');
}
