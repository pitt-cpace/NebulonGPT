const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('path');
const { spawn, exec, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const extractZip = require('extract-zip');
const AdmZip = require('adm-zip');

const isDev = require('electron-is-dev');

// Give Windows a stable identity for permission persistence
if (process.platform === 'win32') {
  app.setAppUserModelId('com.nebulon.gpt.dev'); // matches your build appId family
}

// Treat the server as secure to unblock getUserMedia
// In dev: CRA dev server, In production: Our Express server
// We need to allow all IP addresses on port 3000
if (isDev) {
  app.commandLine.appendSwitch(
    'unsafely-treat-insecure-origin-as-secure',
    'http://localhost:3000'
  );
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
} else {
  // Production mode: Allow all origins on port 3000
  // Get all network IP addresses
  const networkInterfaces = os.networkInterfaces();
  const addresses = ['localhost', '127.0.0.1'];
  
  for (const interfaceName in networkInterfaces) {
    const interfaces = networkInterfaces[interfaceName];
    for (const iface of interfaces) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  
  // Treat all these addresses on port 3000 as secure
  const secureOrigins = addresses.map(addr => `http://${addr}:3000`).join(',');
  app.commandLine.appendSwitch(
    'unsafely-treat-insecure-origin-as-secure',
    secureOrigins
  );
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
  
  console.log(`🔒 Treating as secure: ${secureOrigins}`);
}

// Keep a global reference of the window object
let mainWindow;
let fastAPIBackendProcess = null;
let backendServerProcess = null;
let isQuitting = false;
let httpServer = null;

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
  buildDir: getBuildPath(),
  dataDir: path.join(os.homedir(), '.nebulon-gpt'),
  chatsFile: path.join(os.homedir(), '.nebulon-gpt', 'chats.json'),
  voskModelsDir: path.join(os.homedir(), '.nebulon-gpt', 'vosk-models'),
  hfCacheDir: path.join(os.homedir(), '.nebulon-gpt', 'huggingface'),
  pythonBundleDir: path.join(os.homedir(), '.nebulon-gpt', 'python-bundle'),
  logsDir: path.join(os.homedir(), '.nebulon-gpt', 'logs')
};

// Server paths will be set dynamically after extraction in the server startup functions

// Ensure data directories exist
function ensureDirectories() {
  const dirs = [PATHS.dataDir, PATHS.voskModelsDir, PATHS.hfCacheDir, PATHS.pythonBundleDir, PATHS.logsDir];
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

// Extract bundled resources on every startup (simplified calls)
async function extractBundledResources() {
  console.log('Extracting bundled resources on startup...');
  
  try {
    // Extract Python bundle if it exists as ZIP
    await extractPythonBundle();
    
    // Extract Kokoro TTS cache
    await extractKokoroCache();

    // Extract Vosk models
    await extractVoskModels();

    console.log('Resource extraction completed successfully');
  } catch (error) {
    console.error('Error extracting resources:', error);
    throw error;
  }
}

// Extract Python bundle from ZIP file with 3-step verification (like extractVoskModels)
async function extractPythonBundle() {
  return new Promise(async (resolve, reject) => {
    try {
      const pythonBundleZip = getResourcePath('python-bundle.zip');
      const pythonBundleDir = PATHS.pythonBundleDir;
      
      console.log(`Checking for Python bundle ZIP: ${pythonBundleZip}`);
      console.log(`Target extraction directory: ${pythonBundleDir}`);
      console.log(`ZIP file exists: ${fs.existsSync(pythonBundleZip)}`);
      console.log(`Target directory exists: ${fs.existsSync(pythonBundleDir)}`);
      
      // If ZIP doesn't exist, check if directory already exists (development mode)
      if (!fs.existsSync(pythonBundleZip)) {
        if (fs.existsSync(pythonBundleDir)) {
          console.log('Python bundle directory already exists, skipping extraction');
          resolve();
          return;
        } else {
          console.log('No Python bundle ZIP or directory found, skipping extraction');
          resolve();
          return;
        }
      }
      
      // Check if we need to extract with 3-step verification (like extractVoskModels)
      const checksumFile = path.join(PATHS.dataDir, '.python-bundle-checksum');
      
      let needsExtraction = false;
      
      // Step 1: Check if python-bundle directory exists and has content
      if (!fs.existsSync(pythonBundleDir) || fs.readdirSync(pythonBundleDir).length === 0) {
        console.log('Python bundle directory not found or empty, extracting...');
        needsExtraction = true;
      }
      // Step 2: Check if checksum file exists
      else if (!fs.existsSync(checksumFile)) {
        console.log('No Python bundle checksum file found, extracting...');
        needsExtraction = true;
      }
      // Step 3: Only re-extract if checksum is bigger than current size (files missing)
      else {
        try {
          const currentExtractedSize = await calculateDirectorySize(pythonBundleDir);
          const savedSize = parseInt(fs.readFileSync(checksumFile, 'utf8').trim());
          
          if (savedSize > currentExtractedSize) {
            console.log(`Python bundle incomplete (expected: ${savedSize}, current: ${currentExtractedSize}), extracting...`);
            needsExtraction = true;
          } else {
            console.log('Python bundle size adequate, skipping extraction');
            needsExtraction = false;
          }
        } catch (error) {
          console.log('Could not read Python bundle checksum file, extracting...');
          needsExtraction = true;
        }
      }

      if (!needsExtraction) {
        resolve();
        return;
      }

      console.log('Extracting Python bundle from ZIP...');
      
      // Remove existing directory if it exists
      if (fs.existsSync(pythonBundleDir)) {
        console.log('Removing existing Python bundle directory...');
        fs.rmSync(pythonBundleDir, { recursive: true, force: true });
      }
      
      // Create temp directory for extraction
      const tempDir = path.join(os.tmpdir(), 'nebulon-python-extract');
      
      // Clean up any existing temp directory
      if (fs.existsSync(tempDir)) {
        try {
          fs.rmSync(tempDir, { recursive: true, force: true });
        } catch (error) {
          console.log('Warning: Could not clean temp directory:', error.message);
        }
      }
      
      // Create temp directory
      fs.mkdirSync(tempDir, { recursive: true });
      
      // Extract ZIP to temp directory
      await extractZip(pythonBundleZip, { dir: tempDir });
      
      // Move extracted content to final location
      const extractedBundleDir = path.join(tempDir, 'python-bundle');
      if (fs.existsSync(extractedBundleDir)) {
        // Move the entire python-bundle directory
        fs.renameSync(extractedBundleDir, pythonBundleDir);
      } else {
        // If extraction created files directly in temp dir, move them to python-bundle
        fs.mkdirSync(pythonBundleDir, { recursive: true });
        const items = fs.readdirSync(tempDir);
        for (const item of items) {
          const srcPath = path.join(tempDir, item);
          const destPath = path.join(pythonBundleDir, item);
          fs.renameSync(srcPath, destPath);
        }
      }
      
      // Cleanup temp directory
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      
      // Calculate final bundle size and save checksum (like extractVoskModels)
      const finalBundleSize = await calculateDirectorySize(pythonBundleDir);
      fs.writeFileSync(checksumFile, finalBundleSize.toString());
      console.log(`Python bundle extraction completed. Final size: ${finalBundleSize} bytes`);
      
      resolve();
    } catch (error) {
      console.error('Error extracting Python bundle:', error);
      reject(error);
    }
  });
}

// Extract Kokoro TTS cache from bundled split files with 3-step verification (like extractVoskModels)
async function extractKokoroCache() {
  return new Promise(async (resolve, reject) => {
    try {
      // Determine source paths (like extractPythonBundle)
      const kokoroModelsSource = getResourcePath('models/kokoro');
      let kokoroModelsDir = null;
      
      if (fs.existsSync(kokoroModelsSource)) {
        kokoroModelsDir = kokoroModelsSource;
      } else {
        console.log('Kokoro TTS source not found at:', kokoroModelsSource);
        // Try alternative path for development
        const devKokoroSource = getResourcePath('backend/models/kokoro');
        if (fs.existsSync(devKokoroSource)) {
          console.log('Found Kokoro TTS at dev path, extracting...');
          kokoroModelsDir = devKokoroSource;
        } else {
          console.log('No Kokoro TTS found at either path');
          
          // Even if no TTS cache is found, ensure datasets directory exists
          const datasetsDir = path.join(PATHS.hfCacheDir, 'datasets');
          if (!fs.existsSync(datasetsDir)) {
            fs.mkdirSync(datasetsDir, { recursive: true });
            console.log('Created datasets directory for TTS server (no cache found)');
          }
          resolve();
          return;
        }
      }
      
      // Check if we need to extract with 3-step verification (like extractVoskModels)
      const checksumFile = path.join(PATHS.dataDir, '.huggingface-checksum');
      
      let needsExtraction = false;
      
      // Step 1: Check if huggingface-cache directory exists
      if (!fs.existsSync(PATHS.hfCacheDir)) {
        console.log('HuggingFace cache directory not found, extracting...');
        needsExtraction = true;
      }
      // Step 2: Check if checksum file exists
      else if (!fs.existsSync(checksumFile)) {
        console.log('No HuggingFace cache checksum file found, extracting...');
        needsExtraction = true;
      }
      // Step 3: Compare current cache size with saved size
      else {
        try {
          const currentCacheSize = await calculateDirectorySize(PATHS.hfCacheDir);
          const savedCacheSize = parseInt(fs.readFileSync(checksumFile, 'utf8').trim()) || 0;
          
          // Force re-extraction if:
          // 1. Saved size is 0 (previous extraction failed)
          // 2. Current cache size is 0 (folder is empty)
          // 3. Current size is less than saved size (files missing)
          if (savedCacheSize === 0 || currentCacheSize === 0 || currentCacheSize < savedCacheSize) {
            console.log(`HuggingFace cache needs extraction (saved: ${savedCacheSize}, current: ${currentCacheSize}), extracting...`);
            needsExtraction = true;
          } else if (savedCacheSize === currentCacheSize) {
            console.log('HuggingFace cache size unchanged, skipping extraction');
            needsExtraction = false;
          } else {
            console.log(`HuggingFace cache size changed (${savedCacheSize} -> ${currentCacheSize}), skipping (more files added)`);
            needsExtraction = false;
          }
        } catch (error) {
          console.log('Could not read cache checksum file, extracting...');
          needsExtraction = true;
        }
      }

      if (!needsExtraction) {
        // Still ensure datasets directory exists even if we skip extraction
        const datasetsDir = path.join(PATHS.hfCacheDir, 'datasets');
        if (!fs.existsSync(datasetsDir)) {
          fs.mkdirSync(datasetsDir, { recursive: true });
          console.log('Created datasets directory for TTS server');
        }
        resolve();
        return;
      }

      console.log('Extracting Kokoro TTS cache...');
      
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

      // Step 1: Find all files and classify them
      const files = fs.readdirSync(kokoroModelsDir);
      
      // Identify split archive parts (files matching *.zip.*)
      const splitParts = files.filter(file => file.match(/\.zip\..+$/));
      
      if (splitParts.length > 0) {
        console.log('Found split ZIP files for Kokoro TTS, concatenating...');
        
        // Step 2: Group split parts by base name (everything before .zip)
        const splitGroups = new Map();
        for (const part of splitParts) {
          // Extract base name: everything before .zip
          const match = part.match(/^(.+)\.zip\.(.+)$/);
          if (match) {
            const baseName = match[1];
            const extension = match[2];
            
            if (!splitGroups.has(baseName)) {
              splitGroups.set(baseName, []);
            }
            splitGroups.get(baseName).push({ fileName: part, extension });
          }
        }
        
        // Step 3: Concatenate each group of split parts
        for (const [baseName, parts] of splitGroups) {
          console.log(`Concatenating split archive: ${baseName} (${parts.length} parts)`);
          
          // Sort parts: try numeric first, fall back to alphanumeric
          parts.sort((a, b) => {
            // Try to parse as numbers (e.g., 001, 002, 1, 2)
            const aNum = parseInt(a.extension);
            const bNum = parseInt(b.extension);
            
            if (!isNaN(aNum) && !isNaN(bNum)) {
              return aNum - bNum;
            }
            
            // Fall back to string comparison (e.g., a, b, c or a1, a2)
            return a.extension.localeCompare(b.extension, undefined, { numeric: true, sensitivity: 'base' });
          });
          
          const outputZip = path.join(tempDir, `${baseName}.zip`);
          
          // Wait for concatenation to complete before continuing
          await new Promise((resolveConcatenation, rejectConcatenation) => {
            const writeStream = fs.createWriteStream(outputZip);
            
            writeStream.on('finish', () => {
              console.log(`Created: ${baseName}.zip from parts: ${parts.map(p => p.extension).join(', ')}`);
              resolveConcatenation();
            });
            
            writeStream.on('error', (error) => {
              console.error(`Error concatenating ${baseName}:`, error);
              rejectConcatenation(error);
            });
            
            // Concatenate all parts in order
            for (const part of parts) {
              const partPath = path.join(kokoroModelsDir, part.fileName);
              const data = fs.readFileSync(partPath);
              writeStream.write(data);
            }
            
            writeStream.end();
          });
        }
      }

      // Step 2: Extract all complete zip files (both original and newly concatenated)
      const allFiles = fs.readdirSync(tempDir);
      
      for (const zipfile of allFiles) {
        // Only process files that end with .zip (not .zip.*)
        if (zipfile.endsWith('.zip') && !zipfile.match(/\.zip\..+$/)) {
          const zipPath = path.join(tempDir, zipfile);
          
          try {
            console.log(`Extracting: ${zipfile}`);
            await extractZip(zipPath, { dir: tempDir });
            console.log(`Successfully extracted: ${zipfile}`);
          } catch (error) {
            console.warn(`Failed to extract ${zipfile}:`, error);
          }
        }
      }
      
      // Move extracted content to final location (ZIP contains 'huggingface-cache' folder)
      const extractedDir = path.join(tempDir, 'huggingface-cache');
      if (fs.existsSync(extractedDir)) {
        // First rename the extracted folder to correct name
        const renamedDir = path.join(tempDir, 'huggingface');
        fs.renameSync(extractedDir, renamedDir);
        
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
            copyRecursive(renamedDir, PATHS.hfCacheDir);
            resolveMove();
          } catch (error) {
            rejectMove(error);
          }
        });
      }

      // Cleanup temp directory
      fs.rmSync(tempDir, { recursive: true, force: true });
      
      // Ensure datasets directory exists (required by TTS server environment variables)
      const datasetsDir = path.join(PATHS.hfCacheDir, 'datasets');
      if (!fs.existsSync(datasetsDir)) {
        fs.mkdirSync(datasetsDir, { recursive: true });
        console.log('Created datasets directory for TTS server');
      }
      
      // Calculate final cache size and save checksum (like extractVoskModels)
      const finalCacheSize = await calculateDirectorySize(PATHS.hfCacheDir);
      fs.writeFileSync(checksumFile, finalCacheSize.toString());
      console.log(`Kokoro TTS extraction completed. Cache size: ${finalCacheSize} bytes`);
      resolve();
    } catch (error) {
      console.error('Error extracting Kokoro cache:', error);
      reject(error);
    }
  });
}

// Extract Vosk models from bundled files with size-based verification
async function extractVoskModels() {
  return new Promise(async (resolve, reject) => {
    try {
      // Determine source paths (like extractPythonBundle)
      const voskModelsSource = getResourcePath('models/vosk');
      let voskModelsDir = null;
      
      // Check if primary path exists AND has content (not just an empty directory)
      if (fs.existsSync(voskModelsSource) && fs.readdirSync(voskModelsSource).length > 0) {
        console.log(`Processing Vosk models from: ${voskModelsSource}`);
        voskModelsDir = voskModelsSource;
      } else {
        console.log('Vosk models source not found or empty at:', voskModelsSource);
        // Try alternative path for development
        const devVoskModelsSource = getResourcePath('backend/models/vosk');
        if (fs.existsSync(devVoskModelsSource) && fs.readdirSync(devVoskModelsSource).length > 0) {
          console.log('Found Vosk models at dev path:', devVoskModelsSource);
          voskModelsDir = devVoskModelsSource;
        } else {
          console.log('No Vosk models found at either path');
          resolve();
          return;
        }
      }

      // Check if we need to extract with size-based verification (like TTS)
      const checksumFile = path.join(PATHS.dataDir, '.vosk-models-checksum');
      
      let needsExtraction = false;
      
      // Step 1: Check if vosk-models directory exists and has content
      if (!fs.existsSync(PATHS.voskModelsDir) || fs.readdirSync(PATHS.voskModelsDir).length === 0) {
        console.log('Vosk models directory not found or empty, extracting...');
        needsExtraction = true;
      }
      // Step 2: Check if checksum file exists
      else if (!fs.existsSync(checksumFile)) {
        console.log('No Vosk models checksum file found, extracting...');
        needsExtraction = true;
      }
      // Step 3: Compare current extracted models size with saved size
      else {
        try {
          const currentExtractedSize = await calculateDirectorySize(PATHS.voskModelsDir);
          const savedSize = parseInt(fs.readFileSync(checksumFile, 'utf8').trim()) || 0;
          
          // Force re-extraction if:
          // 1. Saved size is 0 (previous extraction failed)
          // 2. Current extracted size is 0 (folder is empty)
          // 3. Current size is less than saved size (files missing)
          if (savedSize === 0 || currentExtractedSize === 0 || currentExtractedSize < savedSize) {
            console.log(`Vosk models need extraction (saved: ${savedSize}, current: ${currentExtractedSize}), extracting...`);
            needsExtraction = true;
          } else if (savedSize === currentExtractedSize) {
            console.log('Vosk models size unchanged, skipping extraction');
            needsExtraction = false;
          } else {
            console.log(`Vosk models size changed (${savedSize} -> ${currentExtractedSize}), skipping (more files added)`);
            needsExtraction = false;
          }
        } catch (error) {
          console.log('Could not read Vosk checksum file, extracting...');
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
          // Copy all files from voskModelsDir to PATHS.voskModelsDir
          const items = fs.readdirSync(voskModelsDir);
          for (const item of items) {
            copyRecursive(path.join(voskModelsDir, item), path.join(PATHS.voskModelsDir, item));
          }
          resolveCopy();
        } catch (error) {
          rejectCopy(error);
        }
      });

      // Step 1: Find all files and classify them
      const files = fs.readdirSync(PATHS.voskModelsDir);
      
      // Identify split archive parts (files matching *.zip.*)
      const splitParts = files.filter(file => file.match(/\.zip\..+$/));
      
      if (splitParts.length > 0) {
        console.log('Found split ZIP files, concatenating...');
        
        // Step 2: Group split parts by base name (everything before .zip)
        const splitGroups = new Map();
        for (const part of splitParts) {
          // Extract base name: everything before .zip
          const match = part.match(/^(.+)\.zip\.(.+)$/);
          if (match) {
            const baseName = match[1];
            const extension = match[2];
            
            if (!splitGroups.has(baseName)) {
              splitGroups.set(baseName, []);
            }
            splitGroups.get(baseName).push({ fileName: part, extension });
          }
        }
        
        // Step 3: Concatenate each group of split parts
        for (const [baseName, parts] of splitGroups) {
          console.log(`Concatenating split archive: ${baseName} (${parts.length} parts)`);
          
          // Sort parts: try numeric first, fall back to alphanumeric
          parts.sort((a, b) => {
            // Try to parse as numbers (e.g., 001, 002, 1, 2)
            const aNum = parseInt(a.extension);
            const bNum = parseInt(b.extension);
            
            if (!isNaN(aNum) && !isNaN(bNum)) {
              return aNum - bNum;
            }
            
            // Fall back to string comparison (e.g., a, b, c or a1, a2)
            return a.extension.localeCompare(b.extension, undefined, { numeric: true, sensitivity: 'base' });
          });
          
          const outputZip = path.join(PATHS.voskModelsDir, `${baseName}.zip`);
          
          // Wait for concatenation to complete before continuing
          await new Promise((resolveConcatenation, rejectConcatenation) => {
            const writeStream = fs.createWriteStream(outputZip);
            
            writeStream.on('finish', () => {
              console.log(`Created: ${baseName}.zip from parts: ${parts.map(p => p.extension).join(', ')}`);
              resolveConcatenation();
            });
            
            writeStream.on('error', (error) => {
              console.error(`Error concatenating ${baseName}:`, error);
              rejectConcatenation(error);
            });
            
            // Concatenate all parts in order
            for (const part of parts) {
              const partPath = path.join(PATHS.voskModelsDir, part.fileName);
              const data = fs.readFileSync(partPath);
              writeStream.write(data);
            }
            
            writeStream.end();
          });
        }
      }

      // Step 2: Extract all complete zip files (both original and newly concatenated)
      const allFiles = fs.readdirSync(PATHS.voskModelsDir);
      
      for (const zipfile of allFiles) {
        // Only process files that end with .zip (not .zip.*)
        if (zipfile.endsWith('.zip') && !zipfile.match(/\.zip\..+$/)) {
          
          const zipPath = path.join(PATHS.voskModelsDir, zipfile);
          
          try {
            console.log(`Extracting: ${zipfile}`);
            // Extract to models directory (like Docker: unzip -o -q "$zipfile" -d /app/vosk-server/models)
            await extractZip(zipPath, { dir: PATHS.voskModelsDir });
            console.log(`Successfully extracted: ${zipfile}`);
          } catch (error) {
            console.warn(`Failed to extract ${zipfile}:`, error);
          }
        }
      }

      // Step 3: Clean up - remove all zip files and split parts
      console.log('Cleaning up zip files and split parts...');
      const finalFiles = fs.readdirSync(PATHS.voskModelsDir);
      
      for (const file of finalFiles) {
        // Remove both complete zips and split parts
        if (file.endsWith('.zip') || file.match(/\.zip\..+$/)) {
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
      console.log(`Vosk models extraction completed. Final size: ${finalVoskModelsSize} bytes`);
      resolve();
    } catch (error) {
      console.error('Error extracting Vosk models:', error);
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
        console.log(`Removing old extracted model: ${item}`);
        fs.rmSync(itemPath, { recursive: true, force: true });
      } catch (error) {
        console.warn(`Failed to remove ${item}:`, error);
      }
    }
  }
}

// Helper function to dynamically detect Python version in extracted bundle
function detectPythonVersion(pythonBundleDir) {
  try {
    // Windows python-build-standalone uses Lib/site-packages directly (no versioned subdirectory)
    if (process.platform === 'win32') {
      const libDir = path.join(pythonBundleDir, 'python-dist', 'Lib');
      const sitePackagesDir = path.join(libDir, 'site-packages');
      if (fs.existsSync(sitePackagesDir)) {
        console.log(`Detected Windows Python with direct site-packages`);
        return 'direct'; // Special marker for Windows direct structure
      }
    } else {
      // macOS/Linux: Try lowercase 'lib' with versioned subdirectory
      const libDir = path.join(pythonBundleDir, 'python-dist', 'lib');
      if (fs.existsSync(libDir)) {
        const pythonVersions = fs.readdirSync(libDir).filter(dir => dir.startsWith('python3.'));
        if (pythonVersions.length > 0) {
          const pythonVersion = pythonVersions[0]; // Take the first (and typically only) version
          console.log(`Detected Python version: ${pythonVersion}`);
          return pythonVersion;
        }
      }
    }
    
    return null;
  } catch (error) {
    console.warn('Failed to detect Python version:', error);
    return null;
  }
}

// Start the FastAPI Backend (replaces separate Vosk and TTS servers)
function startFastAPIBackend() {
  return new Promise((resolve, reject) => {
    console.log('Starting FastAPI unified backend...');
    
    let pythonCmd;
    let pythonEnv = { ...process.env };
    
    // Check if extracted Python executable exists in home directory
    const extractedPython = process.platform === 'win32' 
      ? path.join(PATHS.pythonBundleDir, 'python-dist', 'python.exe')
      : path.join(PATHS.pythonBundleDir, 'python-dist', 'bin', 'python3');
    
    // Dynamically detect Python version
    const pythonVersion = detectPythonVersion(PATHS.pythonBundleDir);
    
    console.log(`Checking extracted Python: ${extractedPython}`);
    console.log(`Python exists: ${fs.existsSync(extractedPython)}`);
    
    let extractedPackages = null;
    if (pythonVersion) {
      if (pythonVersion === 'direct') {
        // Windows: Direct site-packages in Lib/
        extractedPackages = path.join(PATHS.pythonBundleDir, 'python-dist', 'Lib', 'site-packages');
        console.log(`Using Windows direct site-packages`);
      } else {
        // macOS/Linux: Versioned subdirectory
        extractedPackages = path.join(PATHS.pythonBundleDir, 'python-dist', 'lib', pythonVersion, 'site-packages');
        console.log(`Using dynamic Python version: ${pythonVersion}`);
      }
      console.log(`Checking extracted packages: ${extractedPackages}`);
      console.log(`Packages exist: ${fs.existsSync(extractedPackages)}`);
    } else {
      console.log(`Could not detect Python version in bundle, skipping extracted packages`);
    }
    
    if (fs.existsSync(extractedPython) && extractedPackages && fs.existsSync(extractedPackages)) {
      // Use extracted Python with extracted packages - 100% bundled
      pythonCmd = extractedPython;
      console.log(`Using extracted Python: ${pythonCmd}`);
      console.log(`Extracted packages path: ${extractedPackages}`);
      
      // Set up environment for extracted Python
      pythonEnv.PYTHONPATH = `${extractedPackages}`;
      pythonEnv.PYTHONHOME = path.join(PATHS.pythonBundleDir, 'python-dist');
    } else {
      // No system Python fallback - bundled Python environment required
      const errorMsg = !fs.existsSync(extractedPython) 
        ? 'Bundled Python executable not found'
        : !extractedPackages 
          ? 'Could not detect Python version in bundle'
          : 'Bundled Python packages not found';
      
      console.error(`FastAPI backend cannot start: ${errorMsg}`);
      console.error(`Required bundled Python environment is missing`);
      reject(new Error(errorMsg));
      return;
    }
    
    // Set up environment variables for FastAPI backend
    // Python backend always runs on port 3001 for API endpoints only
    // Electron serves static files directly (no need for Python to serve them)
    const backendPort = '3001';
    
    const env = {
      ...pythonEnv,
      REST_API_PORT: backendPort,
      DATA_DIR: PATHS.dataDir,
      VOSK_MODELS_DIR: PATHS.voskModelsDir,
      BUILD_DIR: PATHS.buildDir,
      HF_HOME: PATHS.hfCacheDir,
      TRANSFORMERS_CACHE: path.join(PATHS.hfCacheDir, 'transformers'),
      HF_DATASETS_CACHE: path.join(PATHS.hfCacheDir, 'datasets'),
      HF_HUB_OFFLINE: '1',
      // Unicode handling for Windows
      PYTHONIOENCODING: 'utf-8',
      PYTHONLEGACYWINDOWSSTDIO: '0',
      PYTHONUTF8: '1'
    };

    // Determine backend script path
    const extractedBackendScript = path.join(PATHS.pythonBundleDir, 'backend/main.py');
    const devBackendScript = getResourcePath('backend/main.py');
    
    const backendScript = fs.existsSync(extractedBackendScript) ? extractedBackendScript : devBackendScript;
    
    console.log(`🐍 Using backend script: ${backendScript}`);
    console.log(`🐍 Backend script exists: ${fs.existsSync(backendScript)}`);

    if (!fs.existsSync(backendScript)) {
      console.error(`Backend script not found at: ${backendScript}`);
      reject(new Error('Backend script not found'));
      return;
    }

    // Create log files with rotation
    const logFile = path.join(PATHS.logsDir, 'backend.log');
    const logStream = fs.createWriteStream(logFile, { flags: 'a' });
    
    // Write startup header to log
    const timestamp = new Date().toISOString();
    logStream.write(`\n${'='.repeat(80)}\n`);
    logStream.write(`[${timestamp}] Starting FastAPI Backend\n`);
    logStream.write(`${'='.repeat(80)}\n\n`);

    // Determine correct working directory
    // For bundled: use python-bundle (contains backend/ subdirectory)
    // For dev: use project root (contains backend/ subdirectory)
    let workingDir;
    if (fs.existsSync(extractedBackendScript)) {
      // Bundled mode: backend is in python-bundle/backend/
      workingDir = PATHS.pythonBundleDir;
    } else {
      // Dev mode: backend is in project/backend/
      workingDir = path.dirname(path.dirname(backendScript)); // Go up two levels from main.py
    }
    
    console.log(`🐍 Working directory: ${workingDir}`);
    console.log(`🐍 Working directory exists: ${fs.existsSync(workingDir)}`);

    // Spawn FastAPI backend using uvicorn
    fastAPIBackendProcess = spawn(
      pythonCmd, 
      ['-m', 'uvicorn', 'backend.main:app', '--host', '0.0.0.0', '--port', backendPort],
      {
        env,
        cwd: workingDir,
        stdio: ['pipe', 'pipe', 'pipe']
      }
    );

    // Capture stdout to log file and console
    fastAPIBackendProcess.stdout.on('data', (data) => {
      const output = data.toString();
      console.log(`[BACKEND] ${output}`);
      logStream.write(`[STDOUT] ${output}`);
    });

    // Capture stderr to log file and console
    fastAPIBackendProcess.stderr.on('data', (data) => {
      const output = data.toString();
      console.error(`[BACKEND] ${output}`);
      logStream.write(`[STDERR] ${output}`);
    });

    fastAPIBackendProcess.on('close', (code) => {
      const timestamp = new Date().toISOString();
      const message = `[${timestamp}] FastAPI backend process exited with code ${code}\n`;
      console.log(message);
      logStream.write(message);
      logStream.end();
      
      if (!isQuitting && code !== 0) {
        // Restart backend if it crashes unexpectedly
        console.log('FastAPI backend crashed, restarting in 2 seconds...');
        setTimeout(() => startFastAPIBackend(), 2000);
      }
    });

    fastAPIBackendProcess.on('error', (error) => {
      const timestamp = new Date().toISOString();
      const message = `[${timestamp}] FastAPI backend error: ${error.message}\n`;
      console.error(message);
      logStream.write(message);
    });

    console.log(`FastAPI backend started on port ${backendPort}, waiting for initialization...`);
    console.log(`Mode: ${isDev ? 'Development' : 'Production'}`);
    console.log(`Static files served by: ${isDev ? 'React dev server' : 'Electron (file://)'}`);
    // Wait a bit for backend to start
    setTimeout(() => resolve(), 3000);
  });
}

// Start HTTPS server for network access (both dev and production)
function startHTTPSServer() {
  return new Promise((resolve, reject) => {
    console.log('Starting HTTPS server for network access...');
    
    try {
      const https = require('https');
      const HTTP_PORT = 3001;
      const HTTPS_PORT = 3443;
      
      // Find SSL certificate paths in unpacked location
      let certPath = path.join(PATHS.buildDir, 'Certification', 'cert.pem');
      let keyPath = path.join(PATHS.buildDir, 'Certification', 'key.pem');
      
      // Check unpacked location for certificates
      if (certPath.includes('app.asar')) {
        const unpackedCertPath = certPath.replace('app.asar', 'app.asar.unpacked');
        const unpackedKeyPath = keyPath.replace('app.asar', 'app.asar.unpacked');
        
        if (fs.existsSync(unpackedCertPath) && fs.existsSync(unpackedKeyPath)) {
          certPath = unpackedCertPath;
          keyPath = unpackedKeyPath;
          console.log('🔐 Using unpacked SSL certificates');
        }
      }
      
      // Check if certificates exist
      if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
        console.error('❌ SSL certificates not found');
        console.error('   cert.pem:', certPath);
        console.error('   key.pem:', keyPath);
        resolve(); // Don't fail, just continue without HTTPS
        return;
      }
      
      console.log('🔐 Loading SSL certificates...');
      const sslOptions = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
        // Allow self-signed certificates
        rejectUnauthorized: false
      };
      
      // Create HTTPS server that:
      // - In dev mode: proxies web requests to React dev server (3000), API to backend (3001)
      // - In production: serves static files directly, proxies API to backend (3001)
      const httpsServer = https.createServer(sslOptions, (req, res) => {
        const axios = require('axios');
        
        // Check if this is an API request that should be proxied
        const isOllamaRequest = req.url.startsWith('/api/ollama');
        const isApiRequest = req.url.startsWith('/api/') || 
                            req.url.startsWith('/vosk') || 
                            req.url.startsWith('/tts') || 
                            req.url === '/health';
        
        // In production mode, serve static files directly for non-API requests
        if (!isDev && !isOllamaRequest && !isApiRequest) {
          // Serve static files from build directory
          let filePath = req.url === '/' ? '/index.html' : req.url;
          
          // Remove query string if present
          filePath = filePath.split('?')[0];
          
          // Security: prevent directory traversal
          filePath = filePath.replace(/\.\./g, '');
          
          const fullPath = path.join(PATHS.buildDir, filePath);
          
          // Check if file exists
          if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
            // Determine content type
            const ext = path.extname(fullPath).toLowerCase();
            const contentTypes = {
              '.html': 'text/html',
              '.js': 'application/javascript',
              '.css': 'text/css',
              '.json': 'application/json',
              '.png': 'image/png',
              '.jpg': 'image/jpeg',
              '.jpeg': 'image/jpeg',
              '.gif': 'image/gif',
              '.svg': 'image/svg+xml',
              '.ico': 'image/x-icon',
              '.woff': 'font/woff',
              '.woff2': 'font/woff2',
              '.ttf': 'font/ttf',
              '.eot': 'application/vnd.ms-fontobject',
              '.map': 'application/json'
            };
            
            const contentType = contentTypes[ext] || 'application/octet-stream';
            
            console.log(`📁 HTTPS serving static file: ${filePath}`);
            
            const fileStream = fs.createReadStream(fullPath);
            res.writeHead(200, { 'Content-Type': contentType });
            fileStream.pipe(res);
            return;
          } else {
            // File not found - serve index.html for SPA routing
            const indexPath = path.join(PATHS.buildDir, 'index.html');
            if (fs.existsSync(indexPath)) {
              console.log(`📁 HTTPS serving index.html for SPA route: ${req.url}`);
              const fileStream = fs.createReadStream(indexPath);
              res.writeHead(200, { 'Content-Type': 'text/html' });
              fileStream.pipe(res);
              return;
            }
          }
        }
        
        // Proxy API requests
        let targetUrl;
        let targetPort;
        
        if (isOllamaRequest) {
          // Ollama requests: strip /api/ollama prefix and proxy to Ollama server
          const ollamaPath = req.url.replace('/api/ollama', '/api');
          targetUrl = `http://127.0.0.1:11434${ollamaPath}`;
          targetPort = 11434;
          console.log(`🔐 HTTPS Ollama proxy: ${req.method} ${req.url} -> ${targetUrl}`);
        } else if (isApiRequest) {
          // API requests go to FastAPI backend
          targetPort = HTTP_PORT;
          targetUrl = `http://127.0.0.1:${targetPort}${req.url}`;
          console.log(`🔐 HTTPS API proxy: ${req.method} ${req.url} -> port ${targetPort}`);
        } else {
          // Dev mode: proxy web requests to React dev server
          targetPort = 3000;
          targetUrl = `http://127.0.0.1:${targetPort}${req.url}`;
          console.log(`🔐 HTTPS dev proxy: ${req.method} ${req.url} -> port ${targetPort}`);
        }
        
        // Collect request body for non-GET/HEAD requests
        let body = '';
        req.on('data', chunk => {
          body += chunk.toString();
        });
        
        req.on('end', () => {
          const config = {
            method: req.method,
            url: targetUrl,
            headers: {
              ...req.headers,
              // Remove headers that shouldn't be forwarded
              host: `localhost:${HTTP_PORT}`
            },
            responseType: 'stream',
            timeout: 60000, // 60 second timeout
            validateStatus: () => true, // Accept all status codes
            maxRedirects: 0
          };
          
          // Add body for POST/PUT/PATCH requests
          if (body && req.method !== 'GET' && req.method !== 'HEAD') {
            try {
              config.data = body;
            } catch (e) {
              console.error('Error parsing request body:', e);
            }
          }
          
          axios(config).then(response => {
            console.log(`✅ HTTPS proxy response: ${response.status} for ${req.url}`);
            
            // Forward status and headers
            const headers = { ...response.headers };
            delete headers['transfer-encoding']; // Let Node.js handle this
            
            res.writeHead(response.status, headers);
            response.data.pipe(res);
          }).catch(error => {
            console.error('❌ HTTPS proxy error:', error.message);
            console.error('   URL:', targetUrl);
            console.error('   Code:', error.code);
            
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ 
              error: 'Bad Gateway',
              message: 'Failed to connect to backend server',
              details: error.message
            }));
          });
        });
      });
      
      // Add error handlers for TLS errors
      httpsServer.on('tlsClientError', (err, tlsSocket) => {
        console.error('❌ TLS Client Error:', err.message);
        // Don't crash the server on TLS errors
        if (tlsSocket && !tlsSocket.destroyed) {
          tlsSocket.end();
        }
      });
      
      httpsServer.on('clientError', (err, socket) => {
        console.error('❌ Client Error:', err.message);
        // Handle client errors gracefully
        if (socket && !socket.destroyed) {
          socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
        }
      });
      
      // Handle WebSocket upgrades for HTTPS
      httpsServer.on('upgrade', (req, socket, head) => {
        console.log(`🔄 HTTPS WebSocket upgrade request for: ${req.url}`);
        
        const net = require('net');
        const http = require('http');
        
        // Add error handler for socket
        socket.on('error', (err) => {
          console.error(`❌ HTTPS WebSocket socket error for ${req.url}:`, err.message);
        });
        
        // Create target connection to FastAPI backend
        const targetSocket = net.connect(HTTP_PORT, '127.0.0.1', () => {
          console.log(`📡 Connected to FastAPI backend for WebSocket upgrade: ${req.url}`);
          
          // Forward the original HTTP upgrade request to the target
          const upgradeRequest = [
            `${req.method} ${req.url} HTTP/1.1`,
            'Host: ' + req.headers.host,
            'Upgrade: websocket',
            'Connection: Upgrade',
            'Sec-WebSocket-Key: ' + req.headers['sec-websocket-key'],
            'Sec-WebSocket-Version: ' + req.headers['sec-websocket-version']
          ];
          
          if (req.headers['sec-websocket-protocol']) {
            upgradeRequest.push('Sec-WebSocket-Protocol: ' + req.headers['sec-websocket-protocol']);
          }
          
          upgradeRequest.push('', '');
          targetSocket.write(upgradeRequest.join('\r\n'));
          
          // Pipe the sockets bidirectionally
          targetSocket.pipe(socket);
          socket.pipe(targetSocket);
        });
        
        targetSocket.on('error', (err) => {
          console.error(`❌ HTTPS WebSocket proxy error for ${req.url}:`, err.message);
          if (!socket.destroyed) {
            socket.end();
          }
        });
        
        // Clean up on socket close
        socket.on('close', () => {
          if (!targetSocket.destroyed) {
            targetSocket.destroy();
          }
        });
        
        targetSocket.on('close', () => {
          if (!socket.destroyed) {
            socket.destroy();
          }
        });
      });
      
      // Start HTTPS server on all interfaces
      httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
        console.log(`✅ HTTPS server running on port ${HTTPS_PORT}`);
        
        const networkInterfaces = os.networkInterfaces();
        for (const interfaceName in networkInterfaces) {
          const interfaces = networkInterfaces[interfaceName];
          for (const iface of interfaces) {
            if (iface.family === 'IPv4' && !iface.internal) {
              console.log(`   - Network: https://${iface.address}:${HTTPS_PORT}`);
            }
          }
        }
        
        backendServerProcess = httpsServer; // Store reference for cleanup
        resolve();
      });
      
      httpsServer.on('error', (error) => {
        console.error('❌ HTTPS server error:', error);
        // Don't fail, just log the error
      });
      
    } catch (error) {
      console.error('❌ Failed to start HTTPS server:', error);
      resolve(); // Don't fail, just continue without HTTPS
    }
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
      preload: path.join(__dirname, 'preload.js'),
      spellcheck: true // Enable spell checking
      // Let Electron/Chromium handle security context normally
      // (no webSecurity:false; no allowRunningInsecureContent)
      // No need to force experimental flags for MediaDevices
    },
    icon: path.join(__dirname, 'public', 'cpace-logo-icon-256.ico'), // Use the correct icon path
    titleBarStyle: 'default',
    show: true // Show immediately
  });

  // Load the app from local file system (instant loading!)
  // In production, load directly from build files
  // In development, React dev server is on port 3000
  const startUrl = isDev 
    ? 'http://localhost:3000'  // Dev: React dev server
    : path.join(PATHS.buildDir, 'index.html');  // Production: Local file
  
  console.log(`Loading app from: ${isDev ? 'React dev server' : 'local build files'}`);
  
  // Enable context menu with spell checking support
  const { Menu } = require('electron');

  mainWindow.webContents.on('context-menu', (event, params) => {
    console.log('context-menu fired:', {
      misspelledWord: params.misspelledWord,
      dictionarySuggestions: params.dictionarySuggestions,
      isEditable: params.isEditable
    });
    
    const template = [];
    
    // Add spelling suggestions if there's a misspelled word
    if (params.misspelledWord) {
      // Add suggestions
      if (params.dictionarySuggestions && params.dictionarySuggestions.length > 0) {
        params.dictionarySuggestions.forEach(suggestion => {
          template.push({
            label: suggestion,
            click: () => mainWindow.webContents.replaceMisspelling(suggestion)
          });
        });
      } else {
        template.push({
          label: 'No suggestions',
          enabled: false
        });
      }
      
      template.push({ type: 'separator' });
      
      // Add to dictionary option
      template.push({
        label: 'Add to Dictionary',
        click: () => mainWindow.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
      });
      
      template.push({ type: 'separator' });
    }
    
    // Standard editing options
    if (params.isEditable) {
      template.push(
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' }
      );
    } else if (params.selectionText) {
      template.push({ role: 'copy' });
    }
    
    // Add separator if we have editing options
    if ((params.isEditable || params.selectionText) && template.length > 0) {
      template.push({ type: 'separator' });
    }
    
    template.push({ role: 'selectAll' });
    
    // Add link option if applicable
    if (params.linkURL) {
      template.push(
        { type: 'separator' },
        {
          label: 'Open Link',
          click: () => shell.openExternal(params.linkURL)
        }
      );
    }

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: mainWindow });
  });

  // Load from file or URL depending on mode
  if (isDev) {
    mainWindow.loadURL(startUrl);
  } else {
    mainWindow.loadFile(startUrl);
  }

  // Force window to show and focus
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    mainWindow.setAlwaysOnTop(true);
    setTimeout(() => mainWindow.setAlwaysOnTop(false), 1000);
    
    // Keep DevTools enabled for debugging as requested
    // mainWindow.webContents.openDevTools();
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
  
  // Configure spell checker languages
  const session = require('electron').session;
  const defaultSession = session.defaultSession;
  
  // Get available spell checker languages
  const availableLanguages = defaultSession.availableSpellCheckerLanguages;
  console.log('📝 Available spell checker languages:', availableLanguages);
  
  // Set spell checker languages (English by default, add more as needed)
  const languagesToUse = ['en-US'];
  
  // Add more languages if they're available
  if (availableLanguages.includes('en-GB')) {
    languagesToUse.push('en-GB');
  }
  
  defaultSession.setSpellCheckerLanguages(languagesToUse);
  console.log('📝 Spell checker configured with languages:', languagesToUse);
  
  // Enable spell checker
  defaultSession.setSpellCheckerEnabled(true);
  console.log('📝 Spell checker enabled');
  
  // Set up comprehensive media permissions for microphone access
  app.on('web-contents-created', (event, contents) => {
    const ses = contents.session;

    // Enable spell checker for this web contents
    ses.setSpellCheckerEnabled(true);
    
    // Configure spell checker languages for this session
    const languagesToUse = ['en-US'];
    if (ses.availableSpellCheckerLanguages.includes('en-GB')) {
      languagesToUse.push('en-GB');
    }
    ses.setSpellCheckerLanguages(languagesToUse);
    
    console.log('📝 Spell checker enabled for web contents with languages:', languagesToUse);

    // Grant microphone permissions immediately for all origins
    ses.setPermissionRequestHandler((wc, permission, callback, details) => {
      console.log(`🎤 Permission request: ${permission} from ${details.requestingUrl}`);
      
      const requestingUrl = details.requestingUrl || 'file://';
      const origin = new URL(requestingUrl).origin;
      
      // Allow any HTTP request on port 3000, plus file protocol
      const isAllowedOrigin =
        requestingUrl.startsWith('http://') && requestingUrl.includes(':3000') ||
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
      
      // Allow any HTTP request on port 3000, plus file protocol
      const isAllowedOrigin =
        requestingOrigin.startsWith('http://') && requestingOrigin.includes(':3000') ||
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
    
    // Start unified FastAPI backend (replaces separate Vosk and TTS servers)
    console.log('Starting FastAPI unified backend in background...');
    await startFastAPIBackend();
    
    // Start HTTPS server for network access (both dev and production)
    await startHTTPSServer();
    
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
  
  // Close HTTP server
  if (httpServer) {
    httpServer.close();
  }
  
  // Close HTTPS server (it's an https.Server object, not a process)
  if (backendServerProcess && typeof backendServerProcess.close === 'function') {
    backendServerProcess.close();
  }
  
  // Terminate FastAPI backend process
  if (fastAPIBackendProcess) {
    console.log('Terminating FastAPI backend...');
    fastAPIBackendProcess.kill();
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

ipcMain.handle('update-vosk-models-checksum', async () => {
  try {
    console.log('📊 Updating Vosk models checksum...');
    
    // Calculate current Vosk models directory size
    const currentVoskModelsSize = await calculateDirectorySize(PATHS.voskModelsDir);
    
    // Save updated checksum
    const checksumFile = path.join(PATHS.dataDir, '.vosk-models-checksum');
    fs.writeFileSync(checksumFile, currentVoskModelsSize.toString());
    
    console.log(`✅ Vosk models checksum updated. New size: ${currentVoskModelsSize} bytes`);
    return { success: true, size: currentVoskModelsSize };
  } catch (error) {
    console.error('Error updating Vosk models checksum:', error);
    return { success: false, error: error.message };
  }
});

// Clipboard operations
ipcMain.handle('copy-to-clipboard', (event, text) => {
  try {
    clipboard.writeText(text);
    console.log('✅ Text copied to clipboard via Electron API');
    return { success: true };
  } catch (error) {
    console.error('❌ Failed to copy to clipboard:', error);
    return { success: false, error: error.message };
  }
});

// Get network addresses for the application with enhanced Windows hotspot detection
ipcMain.handle('get-network-addresses', async () => {
  try {
    // Try to get detailed interface information from backend server first
    const axios = require('axios');
    const backendPort = isDev ? 3001 : 3000;
    const response = await axios.get(`http://127.0.0.1:${backendPort}/api/network-info`);
    const { wifiIPs, ethernetIPs, httpsPort, httpPort } = response.data;
    
    const addresses = {
      localhost: `http://localhost:${httpPort}`,
      loopback: `http://127.0.0.1:${httpPort}`,
      wifi: wifiIPs || [],
      ethernet: ethernetIPs || []
    };
    
    console.log('🌐 Network addresses from backend:', addresses);
    return addresses;
  } catch (error) {
    console.error('Error getting network addresses from backend:', error);
    // Fallback - generate addresses manually
    const backendPort = isDev ? 3001 : 3000;
    const addresses = {
      localhost: `http://localhost:${backendPort}`,
      loopback: `http://127.0.0.1:${backendPort}`,
      wifi: [],
      ethernet: []
    };
    
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
    
    // Get WiFi interface names using platform-specific commands (macOS)
    let wifiInterfaceNames = new Set();
    if (process.platform === 'darwin') {
      try {
        const output = execSync('networksetup -listallhardwareports', { encoding: 'utf8' });
        
        // Parse output to find WiFi interfaces
        const lines = output.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].includes('Hardware Port:') && 
              (lines[i].includes('Wi-Fi') || lines[i].includes('WiFi') || lines[i].includes('AirPort'))) {
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
          const address = `https://${iface.address}:3443`;
          const ipAddress = iface.address;
          
          console.log(`📡 Processing interface: ${interfaceName} → ${ipAddress}`);
          
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
            addresses.wifi.push(address);
          }
          // Ethernet patterns
          else if (/^(eth|enp|en|eno|ens|em|ethernet|lan|enx|usb|vmware|vethernet)/i.test(lowerName)) {
            console.log(`  ℹ️ Classified as Ethernet (name pattern: ${interfaceName})`);
            addresses.ethernet.push(address);
          }
          // Fallback: unknown interfaces go to Ethernet
          else {
            console.log(`  ℹ️ Classified as Ethernet (fallback: ${interfaceName})`);
            addresses.ethernet.push(address);
          }
        }
      }
    }
    
    console.log('🌐 Fallback addresses generated:', addresses);
    return addresses;
  }
});
