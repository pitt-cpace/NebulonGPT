const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const extractZip = require('extract-zip');

// Simple development check without external dependency
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Give Windows a stable identity for permission persistence
if (process.platform === 'win32') {
  app.setAppUserModelId('com.nebulon.gpt.dev'); // matches your build appId family
}

// Treat the CRA dev server as secure to unblock getUserMedia in dev
if (isDev) {
  app.commandLine.appendSwitch(
    'unsafely-treat-insecure-origin-as-secure',
    'http://localhost:3000'
  );
  // Optional: let audio start without click, if you auto-start streams
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
}

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

// Helper function to get server paths with fallback for development/production
const getServerPath = (bundledPath, fallbackPath) => {
  const bundled = getResourcePath(bundledPath);
  const fallback = getResourcePath(fallbackPath);
  
  // Check if bundled version exists (production/distribution)
  if (fs.existsSync(bundled)) {
    return bundled;
  }
  
  // Fall back to development paths
  if (fs.existsSync(fallback)) {
    return fallback;
  }
  
  // Return bundled path as default (for error reporting)
  return bundled;
};

const PATHS = {
  voskServer: getServerPath('python-bundle/python-env/vosk-server/asr_server_with_models.py', 'Vosk-Server/websocket/asr_server_with_models.py'),
  ttsServer: getServerPath('python-bundle/python-env/kokoro-tts/browser_tts_server.py', 'Kokoro-TTS-Server/websocket/browser_tts_server.py'),
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

// Extract bundled resources on every startup (like Docker version)
async function extractBundledResources() {
  console.log('📦 Extracting bundled resources on startup...');
  
  try {
    // Extract Kokoro TTS cache from bundled files with size-based verification (like Vosk)
    const kokoroModelsSource = getResourcePath('models/kokoro');
    if (fs.existsSync(kokoroModelsSource)) {
      const ttsChecksumFile = path.join(PATHS.dataDir, '.huggingface-cache-checksum');
      
      let needsTTSExtraction = false;
      
      // Step 1: Check if huggingface-cache directory exists
      if (!fs.existsSync(PATHS.hfCacheDir)) {
        console.log('📦 HuggingFace cache directory not found, extracting...');
        needsTTSExtraction = true;
      }
      // Step 2: Check if checksum file exists
      else if (!fs.existsSync(ttsChecksumFile)) {
        console.log('📦 No HuggingFace cache checksum file found, extracting...');
        needsTTSExtraction = true;
      }
      // Step 3: Compare current cache size with saved size
      else {
        try {
          const currentCacheSize = await calculateDirectorySize(PATHS.hfCacheDir);
          const savedCacheSize = fs.readFileSync(ttsChecksumFile, 'utf8').trim();
          
          if (savedCacheSize === currentCacheSize.toString()) {
            console.log('✅ HuggingFace cache size unchanged, skipping extraction');
            needsTTSExtraction = false;
          } else {
            console.log(`📦 HuggingFace cache size changed (${savedCacheSize} -> ${currentCacheSize}), extracting...`);
            needsTTSExtraction = true;
          }
        } catch (error) {
          console.log('📦 Could not read cache checksum file, extracting...');
          needsTTSExtraction = true;
        }
      }

      if (needsTTSExtraction) {
        console.log('📦 Extracting Kokoro TTS cache...');
        await extractKokoroCache(kokoroModelsSource);
        
        // After successful extraction, calculate and save the cache size
        const finalCacheSize = await calculateDirectorySize(PATHS.hfCacheDir);
        fs.writeFileSync(ttsChecksumFile, finalCacheSize.toString());
        console.log(`✅ Kokoro TTS extraction completed. Cache size: ${finalCacheSize} bytes`);
      }
      
      // Ensure datasets directory exists (required by TTS server environment variables)
      const datasetsDir = path.join(PATHS.hfCacheDir, 'datasets');
      if (!fs.existsSync(datasetsDir)) {
        fs.mkdirSync(datasetsDir, { recursive: true });
        console.log('📦 Created datasets directory for TTS server');
      }
    } else {
      console.log('📦 Kokoro TTS source not found at:', kokoroModelsSource);
      // Try alternative path for development
      const devKokoroSource = getResourcePath('Kokoro-TTS-Server');
      if (fs.existsSync(devKokoroSource)) {
        console.log('📦 Found Kokoro TTS at dev path, extracting...');
        await extractKokoroCache(devKokoroSource);
        
        // After successful extraction, calculate and save the cache size
        const finalCacheSize = await calculateDirectorySize(PATHS.hfCacheDir);
        const ttsChecksumFile = path.join(PATHS.dataDir, '.huggingface-cache-checksum');
        fs.writeFileSync(ttsChecksumFile, finalCacheSize.toString());
        console.log(`✅ Kokoro TTS extraction completed. Cache size: ${finalCacheSize} bytes`);
        
        // Ensure datasets directory exists (required by TTS server environment variables)
        const datasetsDir = path.join(PATHS.hfCacheDir, 'datasets');
        if (!fs.existsSync(datasetsDir)) {
          fs.mkdirSync(datasetsDir, { recursive: true });
          console.log('📦 Created datasets directory for TTS server');
        }
      } else {
        console.log('📦 No Kokoro TTS found at either path');
        
        // Even if no TTS cache is found, ensure datasets directory exists
        const datasetsDir = path.join(PATHS.hfCacheDir, 'datasets');
        if (!fs.existsSync(datasetsDir)) {
          fs.mkdirSync(datasetsDir, { recursive: true });
          console.log('📦 Created datasets directory for TTS server (no cache found)');
        }
      }
    }

    // Always extract Vosk models from bundled files (like Docker version)
    const voskModelsSource = getResourcePath('models/vosk');
    if (fs.existsSync(voskModelsSource)) {
      console.log('📦 Extracting Vosk models...');
      await extractVoskModels(voskModelsSource);
    } else {
      console.log('📦 Vosk models source not found at:', voskModelsSource);
      // Try alternative path for development
      const devVoskModelsSource = getResourcePath('Vosk-Server/websocket/models');
      if (fs.existsSync(devVoskModelsSource)) {
        console.log('📦 Found Vosk models at dev path, extracting...');
        await extractVoskModels(devVoskModelsSource);
      } else {
        console.log('📦 No Vosk models found at either path');
      }
    }

    console.log('✅ Resource extraction completed successfully');
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
      
      // Clean up any existing temp directory first (Windows symlink fix)
      if (fs.existsSync(tempDir)) {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (error) {
          console.log('Warning: Could not clean temp directory:', error.message);
        }
      }
      
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
          // Cross-platform recursive copy function
          const copyRecursive = (src, dest) => {
            if (!fs.existsSync(src)) return;
            
            const stats = fs.statSync(src);
            if (stats.isDirectory()) {
              if (!fs.existsSync(dest)) {
                fs.mkdirSync(dest, { recursive: true });
              }
              const items = fs.readdirSync(src);
              for (const item of items) {
                copyRecursive(path.join(src, item), path.join(dest, item));
              }
            } else {
              const destDir = path.dirname(dest);
              if (!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true });
              }
              fs.copyFileSync(src, dest);
            }
          };
          
          try {
            copyRecursive(extractedDir, PATHS.hfCacheDir);
            resolveMove();
          } catch (error) {
            rejectMove(error);
          }
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

// Extract Vosk models from bundled files with size-based verification
async function extractVoskModels(voskModelsSource) {
  return new Promise(async (resolve, reject) => {
    try {
      console.log(`📦 Processing Vosk models from: ${voskModelsSource}`);
      
      if (!fs.existsSync(voskModelsSource)) {
        console.log('📦 No Vosk models source directory found, skipping extraction');
        resolve();
        return;
      }

      // Check if we need to extract with size-based verification (like TTS)
      const checksumFile = path.join(PATHS.dataDir, '.vosk-models-checksum');
      
      let needsExtraction = false;
      
      // Step 1: Check if vosk-models directory exists and has content
      if (!fs.existsSync(PATHS.voskModelsDir) || fs.readdirSync(PATHS.voskModelsDir).length === 0) {
        console.log('📦 Vosk models directory not found or empty, extracting...');
        needsExtraction = true;
      }
      // Step 2: Check if checksum file exists
      else if (!fs.existsSync(checksumFile)) {
        console.log('📦 No Vosk models checksum file found, extracting...');
        needsExtraction = true;
      }
      // Step 3: Compare current extracted models size with saved size
      else {
        try {
          const currentExtractedSize = await calculateDirectorySize(PATHS.voskModelsDir);
          const savedSize = fs.readFileSync(checksumFile, 'utf8').trim();
          
          if (savedSize === currentExtractedSize.toString()) {
            console.log('✅ Vosk models size unchanged, skipping extraction');
            needsExtraction = false;
          } else {
            console.log(`📦 Vosk models size changed (${savedSize} -> ${currentExtractedSize}), extracting...`);
            needsExtraction = true;
          }
        } catch (error) {
          console.log('📦 Could not read Vosk checksum file, extracting...');
          needsExtraction = true;
        }
      }

      if (!needsExtraction) {
        resolve();
        return;
      }

      // Clear existing extracted models (but keep user-added ones)
      await cleanupExtractedModels();

      // Copy all files from source to destination first
      await new Promise((resolveCopy, rejectCopy) => {
        // Cross-platform recursive copy function
        const copyRecursive = (src, dest) => {
          if (!fs.existsSync(src)) return;
          
          const stats = fs.statSync(src);
          if (stats.isDirectory()) {
            if (!fs.existsSync(dest)) {
              fs.mkdirSync(dest, { recursive: true });
            }
            const items = fs.readdirSync(src);
            for (const item of items) {
              copyRecursive(path.join(src, item), path.join(dest, item));
            }
          } else {
            const destDir = path.dirname(dest);
            if (!fs.existsSync(destDir)) {
              fs.mkdirSync(destDir, { recursive: true });
            }
            fs.copyFileSync(src, dest);
          }
        };
        
        try {
          // Copy all files from voskModelsSource to PATHS.voskModelsDir
          const items = fs.readdirSync(voskModelsSource);
          for (const item of items) {
            copyRecursive(path.join(voskModelsSource, item), path.join(PATHS.voskModelsDir, item));
          }
          resolveCopy();
        } catch (error) {
          rejectCopy(error);
        }
      });

      // Step 1: Concatenate all split zip files into single zip files (exactly like Docker)
      const files = fs.readdirSync(PATHS.voskModelsDir);
      const splitFiles = files.filter(file => file.match(/\.zip\.\d+$/));
      
      if (splitFiles.length > 0) {
        console.log('📦 Found split ZIP files, concatenating...');
        
        // Get unique base names (like Docker: sed 's/\.zip\..*$//' | sort -u)
        const baseNames = [...new Set(splitFiles.map(file => file.replace(/\.zip\.\d+$/, '')))];

        for (const baseName of baseNames) {
          console.log(`📦 Concatenating split archive: ${baseName}`);
          
          // Get all parts for this base name and sort them (like Docker: sort -V)
          const parts = files
            .filter(file => file.startsWith(`${baseName}.zip.`))
            .sort((a, b) => {
              const aNum = parseInt(a.split('.').pop());
              const bNum = parseInt(b.split('.').pop());
              return aNum - bNum;
            });

          if (parts.length > 0) {
            const outputZip = path.join(PATHS.voskModelsDir, `${baseName}.zip`);
            
            // Concatenate parts using cat (like Docker: cat $parts > "${base_name}.zip")
            const writeStream = fs.createWriteStream(outputZip);
            
            for (const part of parts) {
              const partPath = path.join(PATHS.voskModelsDir, part);
              const data = fs.readFileSync(partPath);
              writeStream.write(data);
            }
            writeStream.end();
            
            console.log(`📦 Created: ${baseName}.zip`);
          }
        }
      }

      // Step 2: Extract all zip files (both original and newly concatenated)
      const allFiles = fs.readdirSync(PATHS.voskModelsDir);
      
      for (const zipfile of allFiles) {
        if (zipfile.endsWith('.zip')) {
          // Skip split file parts (like Docker case statement)
          if (zipfile.match(/\.zip\.\d+$/)) {
            continue;
          }
          
          const zipPath = path.join(PATHS.voskModelsDir, zipfile);
          
          try {
            console.log(`📦 Extracting: ${zipfile}`);
            // Extract to models directory (like Docker: unzip -o -q "$zipfile" -d /app/vosk-server/models)
            await extractZip(zipPath, { dir: PATHS.voskModelsDir });
            console.log(`✅ Successfully extracted: ${zipfile}`);
          } catch (error) {
            console.warn(`❌ Failed to extract ${zipfile}:`, error);
          }
        }
      }

      // Step 3: Clean up - remove all zip files (split parts and complete zips)
      console.log('📦 Cleaning up zip files...');
      const finalFiles = fs.readdirSync(PATHS.voskModelsDir);
      
      for (const file of finalFiles) {
        if (file.endsWith('.zip') || file.match(/\.zip\.\d+$/)) {
          try {
            fs.unlinkSync(path.join(PATHS.voskModelsDir, file));
          } catch (error) {
            console.warn(`Failed to remove ${file}:`, error);
          }
        }
      }

      // Step 4: Calculate final vosk-models folder size and save it
      const finalVoskModelsSize = await calculateDirectorySize(PATHS.voskModelsDir);
      fs.writeFileSync(checksumFile, finalVoskModelsSize.toString());
      console.log(`✅ Vosk models extraction completed. Final size: ${finalVoskModelsSize} bytes`);
      resolve();
    } catch (error) {
      console.error('❌ Error extracting Vosk models:', error);
      reject(error);
    }
  });
}

// Calculate total size of a directory (recursive)
async function calculateDirectorySize(dirPath) {
  let totalSize = 0;
  
  function addDirectorySize(currentPath) {
    const items = fs.readdirSync(currentPath);
    for (const item of items) {
      const itemPath = path.join(currentPath, item);
      const stats = fs.statSync(itemPath);
      
      if (stats.isDirectory()) {
        addDirectorySize(itemPath);
      } else {
        totalSize += stats.size;
      }
    }
  }
  
  if (fs.existsSync(dirPath)) {
    addDirectorySize(dirPath);
  }
  
  return totalSize;
}

// Clean up previously extracted models (but preserve user-added ones)
async function cleanupExtractedModels() {
  if (!fs.existsSync(PATHS.voskModelsDir)) {
    return;
  }
  
  const items = fs.readdirSync(PATHS.voskModelsDir);
  const systemFiles = [
    '.DS_Store', '._.DS_Store', 'Thumbs.db', 'desktop.ini', 
    '.directory', '.localized', '.placeholder', '.gitkeep', 
    '.gitignore'
  ];
  
  for (const item of items) {
    // Skip system files
    if (systemFiles.includes(item) || item.startsWith('._')) {
      continue;
    }
    
    const itemPath = path.join(PATHS.voskModelsDir, item);
    const stats = fs.statSync(itemPath);
    
    // Only remove directories that look like extracted Vosk models
    if (stats.isDirectory() && item.startsWith('vosk-model-')) {
      try {
        console.log(`📦 Removing old extracted model: ${item}`);
        fs.rmSync(itemPath, { recursive: true, force: true });
      } catch (error) {
        console.warn(`Failed to remove ${item}:`, error);
      }
    }
  }
}

// Start the Vosk server
function startVoskServer() {
  return new Promise((resolve, reject) => {
    console.log('Starting Vosk server...');
    
    let pythonCmd;
    let pythonEnv = { ...process.env };
    
    // Check if bundled Python executable exists
    const bundledPython = path.join(getResourcePath('python-bundle'), 'python-env', process.platform === 'win32' ? 'python.exe' : 'python3');
    const bundledPackages = path.join(getResourcePath('python-bundle'), 'python-env', 'lib', 'python3.9', 'site-packages');
    
    if (fs.existsSync(bundledPython) && fs.existsSync(bundledPackages)) {
      // Use bundled Python with bundled packages
      pythonCmd = bundledPython;
      console.log(`Using bundled Python: ${pythonCmd}`);
      console.log(`Bundled packages path: ${bundledPackages}`);
      
      // Set up environment for bundled Python
      pythonEnv.PYTHONPATH = `${getResourcePath('python-bundle/python-env/vosk-server')}:${bundledPackages}`;
      pythonEnv.PYTHONHOME = path.join(getResourcePath('python-bundle'), 'python-env');
    } else if (fs.existsSync(bundledPackages)) {
      // Use system Python with bundled packages
      pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
      console.log(`Using system Python with bundled packages: ${pythonCmd}`);
      console.log(`Bundled packages path: ${bundledPackages}`);
      
      // Set up environment to use bundled packages with system Python
      pythonEnv.PYTHONPATH = `${getResourcePath('python-bundle/vosk-server')}:${bundledPackages}`;
    } else {
      // Fallback to system Python with dev paths
      pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
      console.log(`Bundled packages not found, using system Python with dev paths: ${pythonCmd}`);
      
      // Fallback to development paths
      pythonEnv.PYTHONPATH = `${getResourcePath('Vosk-Server/websocket')}`;
    }
    
    const env = {
      ...pythonEnv,
      VOSK_MODELS_DIR: PATHS.voskModelsDir,
      VOSK_SERVER_INTERFACE: '127.0.0.1',
      VOSK_SERVER_PORT: '2700'
    };

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
    
    let pythonCmd;
    let pythonEnv = { ...process.env };
    
    // Check if bundled Python executable exists
    const bundledPython = path.join(getResourcePath('python-bundle'), 'python-env', process.platform === 'win32' ? 'python.exe' : 'python3');
    const bundledPackages = path.join(getResourcePath('python-bundle'), 'python-env', 'lib', 'python3.9', 'site-packages');
    
    if (fs.existsSync(bundledPython) && fs.existsSync(bundledPackages)) {
      // Use bundled Python with bundled packages
      pythonCmd = bundledPython;
      console.log(`Using bundled Python: ${pythonCmd}`);
      console.log(`Bundled packages path: ${bundledPackages}`);
      
      // Set up environment for bundled Python
      pythonEnv.PYTHONPATH = `${getResourcePath('python-bundle/python-env/kokoro-tts')}:${bundledPackages}`;
      pythonEnv.PYTHONHOME = path.join(getResourcePath('python-bundle'), 'python-env');
    } else if (fs.existsSync(bundledPackages)) {
      // Use system Python with bundled packages
      pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
      console.log(`Using system Python with bundled packages: ${pythonCmd}`);
      console.log(`Bundled packages path: ${bundledPackages}`);
      
      // Set up environment to use bundled packages with system Python
      pythonEnv.PYTHONPATH = `${getResourcePath('python-bundle/kokoro-tts')}:${bundledPackages}`;
    } else {
      // Fallback to system Python with dev paths
      pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
      console.log(`Bundled packages not found, using system Python with dev paths: ${pythonCmd}`);
      
      // Fallback to development paths
      pythonEnv.PYTHONPATH = `${getResourcePath('Kokoro-TTS-Server/websocket')}`;
    }
    
    const env = {
      ...pythonEnv,
      HF_HOME: PATHS.hfCacheDir,
      TRANSFORMERS_CACHE: path.join(PATHS.hfCacheDir, 'transformers'),
      HF_DATASETS_CACHE: path.join(PATHS.hfCacheDir, 'datasets'),
      HF_HUB_OFFLINE: '1',
      KOKORO_SERVER_HOST: '127.0.0.1',
      KOKORO_SERVER_PORT: '2701',
      // Comprehensive Windows Unicode fix
      PYTHONIOENCODING: 'utf-8',
      PYTHONLEGACYWINDOWSSTDIO: '0',
      PYTHONUTF8: '1',
      // Force console to use UTF-8
      CHCP: '65001'
    };

    // On Windows, redirect stderr to avoid Unicode console issues
    if (process.platform === 'win32') {
      ttsProcess = spawn(pythonCmd, [PATHS.ttsServer, '--host', '127.0.0.1', '--port', '2701'], {
        env,
        stdio: ['pipe', 'pipe', 'ignore'], // Ignore stderr to avoid Unicode issues
        shell: false
      });
    } else {
      ttsProcess = spawn(pythonCmd, [PATHS.ttsServer, '--host', '127.0.0.1', '--port', '2701'], {
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    }

    ttsProcess.stdout.on('data', (data) => {
      console.log(`[TTS] ${data}`);
    });

    if (process.platform !== 'win32') {
      ttsProcess.stderr.on('data', (data) => {
        console.error(`[TTS] ${data}`);
      });
    }

    ttsProcess.on('close', (code) => {
      console.log(`TTS process exited with code ${code}`);
      if (!isQuitting && code !== 0) {
        // Only restart TTS if it crashed (non-zero exit code)
        console.log('TTS server crashed, restarting in 2 seconds...');
        setTimeout(() => startTTSServer(), 2000);
      } else if (code === 0) {
        console.log('TTS server exited normally, not restarting');
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
      // Let Electron/Chromium handle security context normally
      // (no webSecurity:false; no allowRunningInsecureContent)
      // No need to force experimental flags for MediaDevices
    },
    icon: path.join(__dirname, 'icon.png'), // Add app icon
    titleBarStyle: 'default',
    show: true // Show immediately
  });

  // Load the app
  const startUrl = isDev 
    ? 'http://localhost:3000' 
    : `file://${path.join(PATHS.buildDir, 'index.html')}`;
  
  mainWindow.loadURL(startUrl);

  // Force window to show and focus
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.setAlwaysOnTop(true);
    setTimeout(() => mainWindow.setAlwaysOnTop(false), 1000);
    
    // Keep DevTools enabled for debugging as requested
    mainWindow.webContents.openDevTools();
  });

  // Also force show immediately after load
  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.show();
    mainWindow.focus();
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
  
  // Set up comprehensive media permissions for microphone access
  app.on('web-contents-created', (event, contents) => {
    const ses = contents.session;

    // Grant microphone permissions immediately for all origins
    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      console.log(`🎤 Permission request: ${permission} from ${details.requestingUrl}`);
      
      const origin = new URL(details.requestingUrl || 'file://').origin;
      const isAllowedOrigin =
        origin === 'http://localhost:3000' || 
        origin.startsWith('file://') || 
        origin === 'null'; // Handle null origin for file:// protocol

      if (!isAllowedOrigin) {
        console.log(`❌ Permission denied for origin: ${origin}`);
        return callback(false);
      }

      // Always allow microphone and camera
      if (permission === 'microphone' || permission === 'camera') {
        console.log(`✅ Granting ${permission} permission`);
        return callback(true);
      }

      // Handle Chrome's grouped 'media' permission with mediaTypes
      if (permission === 'media') {
        const wantsAudio = details.mediaTypes?.includes('audio');
        const wantsVideo = details.mediaTypes?.includes('video');
        console.log(`✅ Granting media permission (audio: ${wantsAudio}, video: ${wantsVideo})`);
        return callback(Boolean(wantsAudio || wantsVideo));
      }

      // Allow other common permissions that might be needed
      if (permission === 'notifications' || permission === 'clipboard-read' || permission === 'clipboard-write') {
        console.log(`✅ Granting ${permission} permission`);
        return callback(true);
      }

      console.log(`❌ Denying unknown permission: ${permission}`);
      callback(false);
    });

    ses.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => {
      const origin = new URL(requestingOrigin || 'file://').origin;
      const isAllowedOrigin =
        origin === 'http://localhost:3000' || 
        origin.startsWith('file://') || 
        origin === 'null'; // Handle null origin for file:// protocol

      if (!isAllowedOrigin) {
        console.log(`❌ Permission check failed for origin: ${origin}`);
        return false;
      }

      // Always allow microphone and camera
      if (permission === 'microphone' || permission === 'camera') {
        console.log(`✅ Permission check passed for ${permission}`);
        return true;
      }
      
      if (permission === 'media') {
        const wantsAudio = details?.mediaTypes?.includes('audio');
        const wantsVideo = details?.mediaTypes?.includes('video');
        console.log(`✅ Media permission check passed (audio: ${wantsAudio}, video: ${wantsVideo})`);
        return Boolean(wantsAudio || wantsVideo);
      }
      
      // Allow other common permissions
      if (permission === 'notifications' || permission === 'clipboard-read' || permission === 'clipboard-write') {
        return true;
      }
      
      return false;
    });

    // Always allow device access
    ses.setDevicePermissionHandler((details) => {
      console.log(`🎤 Device permission request:`, details);
      return true;
    });

    // Add additional security bypass for getUserMedia in Electron
    contents.on('did-finish-load', () => {
      // Inject code to ensure getUserMedia works properly in Electron
      contents.executeJavaScript(`
        // Override getUserMedia to ensure it works in Electron
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
          navigator.mediaDevices.getUserMedia = function(constraints) {
            console.log('🎤 getUserMedia called with constraints:', constraints);
            return originalGetUserMedia(constraints).then(stream => {
              console.log('✅ getUserMedia successful, stream:', stream);
              return stream;
            }).catch(error => {
              console.error('❌ getUserMedia failed:', error);
              throw error;
            });
          };
        }
      `).catch(err => {
        console.error('Failed to inject getUserMedia override:', err);
      });
    });
  });
  
  // Ensure directories exist
  ensureDirectories();
  
  // Load chats data
  loadChatsData();
  
  // Create window FIRST for faster startup
  console.log('Creating window immediately...');
  createWindow();
  
  // Start background initialization (Python services) after window is shown
  console.log('Starting background initialization...');
  initializeBackgroundServices();
});

// Background initialization function
async function initializeBackgroundServices() {
  try {
    // Extract bundled resources in background
    await extractBundledResources();
    
    // Start Python services in background
    console.log('Starting Python services in background...');
    await startVoskServer();
    await startTTSServer();
    
    console.log('✅ All background services started successfully');
  } catch (error) {
    console.error('❌ Failed to start background services:', error);
    // Services failed but window is already available to user
  }
}

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
ipcMain.handle('get-vosk-models', async () => {
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
      let size = stats.size; // Default to file size
      
      if (stats.isDirectory()) {
        type = 'directory';
        // Calculate actual directory size (recursive)
        try {
          size = await calculateDirectorySize(itemPath);
        } catch (error) {
          console.warn(`Failed to calculate size for directory ${item}:`, error);
          size = 0; // Fallback to 0 if calculation fails
        }
        
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
        // For ZIP files, use the actual file size
        size = stats.size;
      }
      
      models.push({
        name: item,
        type,
        size: size,
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

ipcMain.handle('extract-vosk-model', async (event, modelName) => {
  try {
    const zipPath = path.join(PATHS.voskModelsDir, modelName);
    
    if (!fs.existsSync(zipPath)) {
      return { success: false, error: 'ZIP file not found' };
    }
    
    if (!modelName.endsWith('.zip')) {
      return { success: false, error: 'File is not a ZIP archive' };
    }
    
    console.log(`Extracting Vosk model: ${modelName}`);
    
    // Extract ZIP file to models directory
    await extractZip(zipPath, { dir: PATHS.voskModelsDir });
    
    console.log(`Successfully extracted: ${modelName}`);
    return { success: true };
  } catch (error) {
    console.error('Error extracting Vosk model:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('copy-file-to-models', async (event, fileName, fileData) => {
  try {
    const filePath = path.join(PATHS.voskModelsDir, fileName);
    
    console.log(`Copying file to models directory: ${fileName}`);
    
    // Write the file data to the models directory
    fs.writeFileSync(filePath, Buffer.from(fileData));
    
    console.log(`Successfully copied: ${fileName}`);
    return { success: true };
  } catch (error) {
    console.error('Error copying file to models:', error);
    return { success: false, error: error.message };
  }
});
