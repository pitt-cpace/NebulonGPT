const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const extractZip = require('extract-zip');

// Simple development check without external dependency
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Keep a global reference of the window object
let mainWindow;
let voskProcess = null;
let ttsProcess = null;
let isQuitting = false;

// Store for chat data (replaces the Node.js server functionality)
let chatsData = [];

// Paths for bundled services
const getResourcePath = (relativePath) => {
  if (isDev) {
    return path.join(__dirname, relativePath);
  }
  return path.join(process.resourcesPath, relativePath);
};

const getBuildPath = () => {
  if (isDev) {
    return path.join(__dirname, 'build');
  }
  // In packaged app, build files are directly in __dirname (which is inside app.asar/build/)
  return __dirname;
};

const PATHS = {
  voskServer: getResourcePath('vosk-server/asr_server_with_models.py'),
  ttsServer: getResourcePath('kokoro-tts/browser_tts_server.py'),
  buildDir: getBuildPath(),
  dataDir: path.join(os.homedir(), '.nebulon-gpt'),
  chatsFile: path.join(os.homedir(), '.nebulon-gpt', 'chats.json'),
  voskModelsDir: path.join(os.homedir(), '.nebulon-gpt', 'vosk-models'),
  hfCacheDir: path.join(os.homedir(), '.nebulon-gpt', 'huggingface-cache')
};

// Ensure data directories exist
function ensureDirectories() {
  const dirs = [PATHS.dataDir, PATHS.voskModelsDir, PATHS.hfCacheDir];
  dirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  });
  
  // Initialize chats file if it doesn't exist
  if (!fs.existsSync(PATHS.chatsFile)) {
    fs.writeFileSync(PATHS.chatsFile, JSON.stringify([]));
  }
}

// Load chats data
function loadChatsData() {
  try {
    const data = fs.readFileSync(PATHS.chatsFile, 'utf8');
    chatsData = JSON.parse(data);
  } catch (error) {
    console.error('Error loading chats data:', error);
    chatsData = [];
  }
}

// Save chats data
function saveChatsData() {
  try {
    fs.writeFileSync(PATHS.chatsFile, JSON.stringify(chatsData, null, 2));
  } catch (error) {
    console.error('Error saving chats data:', error);
  }
}

// Extract bundled resources on first run with version checking
async function extractBundledResources() {
  const versionFile = path.join(PATHS.dataDir, 'VERSION.json');
  const currentVersion = { 
    version: '2025-09-17', 
    files: ['kokoro-cache', 'vosk-models'],
    appVersion: app.getVersion()
  };
  
  // Check if already extracted and up-to-date
  try {
    const existingVersion = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
    if (existingVersion.version === currentVersion.version && 
        existingVersion.appVersion === currentVersion.appVersion) {
      console.log('Models already extracted and up-to-date');
      return;
    }
  } catch (error) {
    // No version file or invalid - proceed with extraction
  }

  console.log('First run or version update detected, extracting bundled resources...');
  
  try {
    // Extract Kokoro TTS cache from bundled split files
    const kokoroModelsDir = getResourcePath('models/kokoro');
    if (fs.existsSync(kokoroModelsDir)) {
      console.log('Extracting Kokoro TTS cache...');
      await extractKokoroCache(kokoroModelsDir);
    }

    // Extract Vosk models from bundled files
    const voskModelsSource = getResourcePath('models/vosk');
    if (fs.existsSync(voskModelsSource)) {
      console.log('Extracting Vosk models...');
      await extractVoskModels(voskModelsSource);
    }

    // Write version marker
    fs.writeFileSync(versionFile, JSON.stringify(currentVersion, null, 2));
    console.log('Resource extraction completed successfully');
  } catch (error) {
    console.error('Error extracting resources:', error);
    throw error;
  }
}

// Extract Kokoro TTS cache from bundled split files
async function extractKokoroCache(kokoroModelsDir) {
  return new Promise(async (resolve, reject) => {
    try {
      const tempDir = path.join(os.tmpdir(), 'nebulon-kokoro-extract');
      
      // Create temp directory
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      // Find and concatenate split files
      const splitFiles = fs.readdirSync(kokoroModelsDir)
        .filter(file => file.startsWith('huggingface-cache.zip.'))
        .sort();

      if (splitFiles.length === 0) {
        console.log('No Kokoro cache files found to extract');
        resolve();
        return;
      }

      console.log(`Found ${splitFiles.length} Kokoro cache parts to concatenate`);
      
      // Concatenate split files
      const zipPath = path.join(tempDir, 'huggingface-cache.zip');
      const writeStream = fs.createWriteStream(zipPath);
      
      for (const splitFile of splitFiles) {
        const partPath = path.join(kokoroModelsDir, splitFile);
        const data = fs.readFileSync(partPath);
        writeStream.write(data);
      }
      writeStream.end();

      // Extract using extract-zip library
      await extractZip(zipPath, { dir: tempDir });
      
      // Move extracted content to final location
      const extractedDir = path.join(tempDir, 'huggingface-cache');
      if (fs.existsSync(extractedDir)) {
        await new Promise((resolveMove, rejectMove) => {
          exec(`cp -r "${extractedDir}"/* "${PATHS.hfCacheDir}"/`, (error) => {
            if (error) rejectMove(error);
            else resolveMove();
          });
        });
      }

      // Cleanup temp directory
      fs.rmSync(tempDir, { recursive: true, force: true });
      console.log('Kokoro cache extraction completed');
      resolve();
    } catch (error) {
      console.error('Error extracting Kokoro cache:', error);
      reject(error);
    }
  });
}

// Extract Vosk models from bundled files
async function extractVoskModels(voskModelsSource) {
  return new Promise(async (resolve, reject) => {
    try {
      // Copy all files from source to destination
      await new Promise((resolveCopy, rejectCopy) => {
        exec(`cp -r "${voskModelsSource}"/* "${PATHS.voskModelsDir}"/`, (error) => {
          if (error) rejectCopy(error);
          else resolveCopy();
        });
      });

      // Find and extract any ZIP files
      const files = fs.readdirSync(PATHS.voskModelsDir);
      const zipFiles = files.filter(file => file.endsWith('.zip'));

      for (const zipFile of zipFiles) {
        const zipPath = path.join(PATHS.voskModelsDir, zipFile);
        const extractDir = path.join(PATHS.voskModelsDir, path.basename(zipFile, '.zip'));
        
        try {
          console.log(`Extracting Vosk model: ${zipFile}`);
          await extractZip(zipPath, { dir: extractDir });
          
          // Remove the ZIP file after successful extraction
          fs.unlinkSync(zipPath);
          console.log(`Successfully extracted and removed: ${zipFile}`);
        } catch (error) {
          console.warn(`Failed to extract ${zipFile}:`, error);
        }
      }

      console.log('Vosk models extraction completed');
      resolve();
    } catch (error) {
      console.error('Error extracting Vosk models:', error);
      reject(error);
    }
  });
}

// Start the Vosk server
function startVoskServer() {
  return new Promise((resolve, reject) => {
    console.log('Starting Vosk server...');
    
    const env = {
      ...process.env,
      PYTHONPATH: getResourcePath('vosk-server'),
      VOSK_MODELS_DIR: PATHS.voskModelsDir,
      VOSK_SERVER_INTERFACE: '127.0.0.1',
      VOSK_SERVER_PORT: '2700'
    };

    // Try different Python executables in order of preference
    const pythonExecutables = ['python3', 'python', '/usr/bin/python3', '/usr/local/bin/python3'];
    let pythonCmd = 'python3'; // Default
    
    // Find available Python executable
    for (const cmd of pythonExecutables) {
      try {
        require('child_process').execSync(`${cmd} --version`, { stdio: 'ignore' });
        pythonCmd = cmd;
        console.log(`Found Python executable: ${pythonCmd}`);
        break;
      } catch (error) {
        // Continue to next option
      }
    }

    voskProcess = spawn(pythonCmd, [PATHS.voskServer], {
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    voskProcess.stdout.on('data', (data) => {
      console.log(`[VOSK] ${data}`);
    });

    voskProcess.stderr.on('data', (data) => {
      console.error(`[VOSK] ${data}`);
    });

    voskProcess.on('close', (code) => {
      console.log(`Vosk process exited with code ${code}`);
      if (!isQuitting) {
        // Restart Vosk if it crashes unexpectedly
        setTimeout(() => startVoskServer(), 2000);
      }
    });

    // Wait a bit for Vosk to start
    setTimeout(() => resolve(), 3000);
  });
}

// Start the TTS server
function startTTSServer() {
  return new Promise((resolve, reject) => {
    console.log('Starting TTS server...');
    
    const env = {
      ...process.env,
      PYTHONPATH: getResourcePath('Kokoro-TTS-Server'),
      HF_HOME: PATHS.hfCacheDir,
      TRANSFORMERS_CACHE: path.join(PATHS.hfCacheDir, 'transformers'),
      HF_DATASETS_CACHE: path.join(PATHS.hfCacheDir, 'datasets'),
      HF_HUB_OFFLINE: '1',
      KOKORO_SERVER_HOST: '127.0.0.1',
      KOKORO_SERVER_PORT: '2701'
    };

    // Try different Python executables in order of preference
    const pythonExecutables = ['python3', 'python', '/usr/bin/python3', '/usr/local/bin/python3'];
    let pythonCmd = 'python3'; // Default
    
    // Find available Python executable
    for (const cmd of pythonExecutables) {
      try {
        require('child_process').execSync(`${cmd} --version`, { stdio: 'ignore' });
        pythonCmd = cmd;
        console.log(`Found Python executable for TTS: ${pythonCmd}`);
        break;
      } catch (error) {
        // Continue to next option
      }
    }

    ttsProcess = spawn(pythonCmd, [PATHS.ttsServer, '--host', '127.0.0.1', '--port', '2701'], {
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    ttsProcess.stdout.on('data', (data) => {
      console.log(`[TTS] ${data}`);
    });

    ttsProcess.stderr.on('data', (data) => {
      console.error(`[TTS] ${data}`);
    });

    ttsProcess.on('close', (code) => {
      console.log(`TTS process exited with code ${code}`);
      if (!isQuitting) {
        // Restart TTS if it crashes unexpectedly
        setTimeout(() => startTTSServer(), 2000);
      }
    });

    // Wait a bit for TTS to start
    setTimeout(() => resolve(), 3000);
  });
}

// Create the main window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'icon.png'), // Add app icon
    titleBarStyle: 'default',
    show: false // Don't show until ready
  });

  // Load the app
  const startUrl = isDev 
    ? 'http://localhost:3000' 
    : `file://${path.join(PATHS.buildDir, 'index.html')}`;
  
  mainWindow.loadURL(startUrl);

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    
    // Keep DevTools enabled for debugging as requested
    mainWindow.webContents.openDevTools();
  });

  // Add debugging for load failures
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('Failed to load:', errorCode, errorDescription, validatedURL);
  });

  mainWindow.webContents.on('dom-ready', () => {
    console.log('DOM ready');
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('Page finished loading');
  });

  // Handle window closed
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Handle external links
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

// App event handlers
app.whenReady().then(async () => {
  console.log('Electron app ready, initializing...');
  console.log('isDev:', isDev);
  console.log('__dirname:', __dirname);
  console.log('process.resourcesPath:', process.resourcesPath);
  console.log('PATHS.buildDir:', PATHS.buildDir);
  console.log('Build dir exists:', fs.existsSync(PATHS.buildDir));
  
  if (fs.existsSync(PATHS.buildDir)) {
    const buildFiles = fs.readdirSync(PATHS.buildDir);
    console.log('Build directory contents:', buildFiles);
    
    const indexPath = path.join(PATHS.buildDir, 'index.html');
    console.log('index.html path:', indexPath);
    console.log('index.html exists:', fs.existsSync(indexPath));
  }
  
  // Ensure directories exist
  ensureDirectories();
  
  // Load chats data
  loadChatsData();
  
  // Extract bundled resources on first run
  await extractBundledResources();
  
  // Start Python services and then create window
  try {
    console.log('Starting Python services...');
    await startVoskServer();
    await startTTSServer();
    
    console.log('All services started, creating window...');
    createWindow();
  } catch (error) {
    console.error('Failed to start services:', error);
    // Still create window even if services fail
    console.log('Creating window despite service startup issues...');
    createWindow();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  
  // Save chats data before quitting
  saveChatsData();
  
  // Terminate all processes
  if (voskProcess) {
    voskProcess.kill();
  }
  if (ttsProcess) {
    ttsProcess.kill();
  }
});

// IPC handlers for communication with renderer (replacing Node.js server API)
ipcMain.handle('get-app-version', () => {
  return app.getVersion();
});

ipcMain.handle('get-chats', () => {
  return chatsData;
});

ipcMain.handle('save-chat', (event, chatId, chatData) => {
  const existingChatIndex = chatsData.findIndex(chat => chat.id === chatId);
  
  if (existingChatIndex >= 0) {
    chatsData[existingChatIndex] = { ...chatsData[existingChatIndex], ...chatData, id: chatId };
  } else {
    chatsData.unshift({ ...chatData, id: chatId });
  }
  
  saveChatsData();
  return { success: true };
});

ipcMain.handle('save-all-chats', (event, chats) => {
  chatsData = Array.isArray(chats) ? chats : [];
  saveChatsData();
  return { success: true };
});

ipcMain.handle('show-save-dialog', async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    filters: [
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  return result;
});

ipcMain.handle('show-open-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'JSON Files', extensions: ['json'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  return result;
});

// Vosk models management
ipcMain.handle('get-vosk-models', () => {
  try {
    if (!fs.existsSync(PATHS.voskModelsDir)) {
      return { models: [] };
    }
    
    const items = fs.readdirSync(PATHS.voskModelsDir);
    const models = [];
    
    for (const item of items) {
      const itemPath = path.join(PATHS.voskModelsDir, item);
      const stats = fs.statSync(itemPath);
      
      let type = 'file';
      let status = 'other';
      
      if (stats.isDirectory()) {
        type = 'directory';
        // Check if it's a valid Vosk model
        const requiredFiles = ['conf/model.conf', 'am/final.mdl', 'graph/HCLG.fst'];
        let hasRequiredFiles = 0;
        
        for (const file of requiredFiles) {
          if (fs.existsSync(path.join(itemPath, file))) {
            hasRequiredFiles++;
          }
        }
        
        status = hasRequiredFiles >= 2 ? 'ready' : 'other';
      } else if (item.endsWith('.zip')) {
        type = 'zip';
        status = 'archived';
      }
      
      models.push({
        name: item,
        type,
        size: stats.size,
        modified: stats.mtime.toISOString(),
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
    
    return { models };
  } catch (error) {
    console.error('Error listing Vosk models:', error);
    return { models: [] };
  }
});

ipcMain.handle('delete-vosk-model', (event, modelName) => {
  try {
    const modelPath = path.join(PATHS.voskModelsDir, modelName);
    
    if (!fs.existsSync(modelPath)) {
      return { success: false, error: 'Model not found' };
    }
    
    const stats = fs.statSync(modelPath);
    
    if (stats.isDirectory()) {
      fs.rmSync(modelPath, { recursive: true, force: true });
    } else {
      fs.unlinkSync(modelPath);
    }
    
    return { success: true };
  } catch (error) {
    console.error('Error deleting Vosk model:', error);
    return { success: false, error: error.message };
  }
});
