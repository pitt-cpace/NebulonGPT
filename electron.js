const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const extractZip = require('extract-zip');

const isDev = require('electron-is-dev');

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
  buildDir: getBuildPath(),
  dataDir: path.join(os.homedir(), '.nebulon-gpt'),
  chatsFile: path.join(os.homedir(), '.nebulon-gpt', 'chats.json'),
  voskModelsDir: path.join(os.homedir(), '.nebulon-gpt', 'vosk-models'),
  hfCacheDir: path.join(os.homedir(), '.nebulon-gpt', 'huggingface'),
  pythonBundleDir: path.join(os.homedir(), '.nebulon-gpt', 'python-bundle')
};

// Server paths will be set dynamically after extraction in the server startup functions

// Ensure data directories exist
function ensureDirectories() {
  const dirs = [PATHS.dataDir, PATHS.voskModelsDir, PATHS.hfCacheDir, PATHS.pythonBundleDir];
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
  console.log('📦 Extracting bundled resources on startup...');
  
  try {
    // Extract Python bundle if it exists as ZIP
    await extractPythonBundle();
    
    // Extract Kokoro TTS cache
    await extractKokoroCache();

    // Extract Vosk models
    await extractVoskModels();

    console.log('✅ Resource extraction completed successfully');
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
      
      console.log(`📦 Checking for Python bundle ZIP: ${pythonBundleZip}`);
      console.log(`📦 Target extraction directory: ${pythonBundleDir}`);
      console.log(`📦 ZIP file exists: ${fs.existsSync(pythonBundleZip)}`);
      console.log(`📦 Target directory exists: ${fs.existsSync(pythonBundleDir)}`);
      
      // If ZIP doesn't exist, check if directory already exists (development mode)
      if (!fs.existsSync(pythonBundleZip)) {
        if (fs.existsSync(pythonBundleDir)) {
          console.log('📦 Python bundle directory already exists, skipping extraction');
          resolve();
          return;
        } else {
          console.log('📦 No Python bundle ZIP or directory found, skipping extraction');
          resolve();
          return;
        }
      }
      
      // Check if we need to extract with 3-step verification (like extractVoskModels)
      const checksumFile = path.join(PATHS.dataDir, '.python-bundle-checksum');
      
      let needsExtraction = false;
      
      // Step 1: Check if python-bundle directory exists and has content
      if (!fs.existsSync(pythonBundleDir) || fs.readdirSync(pythonBundleDir).length === 0) {
        console.log('📦 Python bundle directory not found or empty, extracting...');
        needsExtraction = true;
      }
      // Step 2: Check if checksum file exists
      else if (!fs.existsSync(checksumFile)) {
        console.log('📦 No Python bundle checksum file found, extracting...');
        needsExtraction = true;
      }
      // Step 3: Only re-extract if checksum is bigger than current size (files missing)
      else {
        try {
          const currentExtractedSize = await calculateDirectorySize(pythonBundleDir);
          const savedSize = parseInt(fs.readFileSync(checksumFile, 'utf8').trim());
          
          if (savedSize > currentExtractedSize) {
            console.log(`📦 Python bundle incomplete (expected: ${savedSize}, current: ${currentExtractedSize}), extracting...`);
            needsExtraction = true;
          } else {
            console.log('✅ Python bundle size adequate, skipping extraction');
            needsExtraction = false;
          }
        } catch (error) {
          console.log('📦 Could not read Python bundle checksum file, extracting...');
          needsExtraction = true;
        }
      }

      if (!needsExtraction) {
        resolve();
        return;
      }

      console.log('📦 Extracting Python bundle from ZIP...');
      
      // Remove existing directory if it exists
      if (fs.existsSync(pythonBundleDir)) {
        console.log('📦 Removing existing Python bundle directory...');
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
      console.log(`✅ Python bundle extraction completed. Final size: ${finalBundleSize} bytes`);
      
      resolve();
    } catch (error) {
      console.error('❌ Error extracting Python bundle:', error);
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
        console.log('📦 Kokoro TTS source not found at:', kokoroModelsSource);
        // Try alternative path for development
        const devKokoroSource = getResourcePath('Kokoro-TTS-Server');
        if (fs.existsSync(devKokoroSource)) {
          console.log('📦 Found Kokoro TTS at dev path, extracting...');
          kokoroModelsDir = devKokoroSource;
        } else {
          console.log('📦 No Kokoro TTS found at either path');
          
          // Even if no TTS cache is found, ensure datasets directory exists
          const datasetsDir = path.join(PATHS.hfCacheDir, 'datasets');
          if (!fs.existsSync(datasetsDir)) {
            fs.mkdirSync(datasetsDir, { recursive: true });
            console.log('📦 Created datasets directory for TTS server (no cache found)');
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
        console.log('📦 HuggingFace cache directory not found, extracting...');
        needsExtraction = true;
      }
      // Step 2: Check if checksum file exists
      else if (!fs.existsSync(checksumFile)) {
        console.log('📦 No HuggingFace cache checksum file found, extracting...');
        needsExtraction = true;
      }
      // Step 3: Compare current cache size with saved size
      else {
        try {
          const currentCacheSize = await calculateDirectorySize(PATHS.hfCacheDir);
          const savedCacheSize = fs.readFileSync(checksumFile, 'utf8').trim();
          
          if (savedCacheSize === currentCacheSize.toString()) {
            console.log('✅ HuggingFace cache size unchanged, skipping extraction');
            needsExtraction = false;
          } else {
            console.log(`📦 HuggingFace cache size changed (${savedCacheSize} -> ${currentCacheSize}), extracting...`);
            needsExtraction = true;
          }
        } catch (error) {
          console.log('📦 Could not read cache checksum file, extracting...');
          needsExtraction = true;
        }
      }

      if (!needsExtraction) {
        // Still ensure datasets directory exists even if we skip extraction
        const datasetsDir = path.join(PATHS.hfCacheDir, 'datasets');
        if (!fs.existsSync(datasetsDir)) {
          fs.mkdirSync(datasetsDir, { recursive: true });
          console.log('📦 Created datasets directory for TTS server');
        }
        resolve();
        return;
      }

      console.log('📦 Extracting Kokoro TTS cache...');
      
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
      
      // Wait for concatenation to complete before extracting
      await new Promise((resolveConcatenation, rejectConcatenation) => {
        const writeStream = fs.createWriteStream(zipPath);
        
        writeStream.on('finish', () => {
          console.log('📦 Concatenation completed successfully');
          resolveConcatenation();
        });
        
        writeStream.on('error', (error) => {
          console.error('📦 Error during concatenation:', error);
          rejectConcatenation(error);
        });
        
        for (const splitFile of splitFiles) {
          const partPath = path.join(kokoroModelsDir, splitFile);
          const data = fs.readFileSync(partPath);
          writeStream.write(data);
        }
        
        writeStream.end();
      });

      // Extract using extract-zip library
      console.log('📦 Starting extraction of concatenated ZIP...');
      await extractZip(zipPath, { dir: tempDir });
      
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
        console.log('📦 Created datasets directory for TTS server');
      }
      
      // Calculate final cache size and save checksum (like extractVoskModels)
      const finalCacheSize = await calculateDirectorySize(PATHS.hfCacheDir);
      fs.writeFileSync(checksumFile, finalCacheSize.toString());
      console.log(`✅ Kokoro TTS extraction completed. Cache size: ${finalCacheSize} bytes`);
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
      
      if (fs.existsSync(voskModelsSource)) {
        console.log(`📦 Processing Vosk models from: ${voskModelsSource}`);
        voskModelsDir = voskModelsSource;
      } else {
        console.log('📦 Vosk models source not found at:', voskModelsSource);
        // Try alternative path for development
        const devVoskModelsSource = getResourcePath('Vosk-Server/websocket/models');
        if (fs.existsSync(devVoskModelsSource)) {
          console.log('📦 Found Vosk models at dev path, extracting...');
          voskModelsDir = devVoskModelsSource;
        } else {
          console.log('📦 No Vosk models found at either path');
          resolve();
          return;
        }
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

// Helper function to dynamically detect Python version in extracted bundle
function detectPythonVersion(pythonBundleDir) {
  try {
    // Windows python-build-standalone uses Lib/site-packages directly (no versioned subdirectory)
    if (process.platform === 'win32') {
      const libDir = path.join(pythonBundleDir, 'python-env', 'python-dist', 'Lib');
      const sitePackagesDir = path.join(libDir, 'site-packages');
      if (fs.existsSync(sitePackagesDir)) {
        console.log(`🐍 Detected Windows Python with direct site-packages`);
        return 'direct'; // Special marker for Windows direct structure
      }
    } else {
      // macOS/Linux: Try lowercase 'lib' with versioned subdirectory
      const libDir = path.join(pythonBundleDir, 'python-env', 'python-dist', 'lib');
      if (fs.existsSync(libDir)) {
        const pythonVersions = fs.readdirSync(libDir).filter(dir => dir.startsWith('python3.'));
        if (pythonVersions.length > 0) {
          const pythonVersion = pythonVersions[0]; // Take the first (and typically only) version
          console.log(`🐍 Detected Python version: ${pythonVersion}`);
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

// Start the Vosk server
function startVoskServer() {
  return new Promise((resolve, reject) => {
    console.log('Starting Vosk server...');
    
    let pythonCmd;
    let pythonEnv = { ...process.env };
    
    // Check if extracted Python executable exists in home directory
    // Windows python-build-standalone has python.exe in root, macOS/Linux has it in bin/
    const extractedPython = process.platform === 'win32' 
      ? path.join(PATHS.pythonBundleDir, 'python-env', 'python-dist', 'python.exe')
      : path.join(PATHS.pythonBundleDir, 'python-env', 'python-dist', 'bin', 'python3');
    
    // Dynamically detect Python version - MUST be dynamic, no fallback to hardcoded version
    const pythonVersion = detectPythonVersion(PATHS.pythonBundleDir);
    
    console.log(`🐍 Checking extracted Python: ${extractedPython}`);
    console.log(`🐍 Python exists: ${fs.existsSync(extractedPython)}`);
    
    let extractedPackages = null;
    if (pythonVersion) {
      if (pythonVersion === 'direct') {
        // Windows: Direct site-packages in Lib/
        extractedPackages = path.join(PATHS.pythonBundleDir, 'python-env', 'python-dist', 'Lib', 'site-packages');
        console.log(`🐍 Using Windows direct site-packages`);
      } else {
        // macOS/Linux: Versioned subdirectory
        extractedPackages = path.join(PATHS.pythonBundleDir, 'python-env', 'python-dist', 'lib', pythonVersion, 'site-packages');
        console.log(`🐍 Using dynamic Python version: ${pythonVersion}`);
      }
      console.log(`🐍 Checking extracted packages: ${extractedPackages}`);
      console.log(`🐍 Packages exist: ${fs.existsSync(extractedPackages)}`);
    } else {
      console.log(`🐍 Could not detect Python version in bundle, skipping extracted packages`);
    }
    
    if (fs.existsSync(extractedPython) && extractedPackages && fs.existsSync(extractedPackages)) {
      // Use extracted Python with extracted packages - 100% bundled
      pythonCmd = extractedPython;
      console.log(`Using extracted Python: ${pythonCmd}`);
      console.log(`Extracted packages path: ${extractedPackages}`);
      
      // Set up environment for extracted Python
      pythonEnv.PYTHONPATH = `${path.join(PATHS.pythonBundleDir, 'python-env/vosk-server')}:${extractedPackages}`;
      pythonEnv.PYTHONHOME = path.join(PATHS.pythonBundleDir, 'python-env/python-dist');
    } else {
      // No system Python fallback - bundled Python environment required
      const errorMsg = !fs.existsSync(extractedPython) 
        ? 'Bundled Python executable not found'
        : !extractedPackages 
          ? 'Could not detect Python version in bundle'
          : 'Bundled Python packages not found';
      
      console.error(`❌ Vosk server cannot start: ${errorMsg}`);
      console.error(`❌ Required bundled Python environment is missing`);
      reject(new Error(errorMsg));
      return;
    }
    
    const env = {
      ...pythonEnv,
      VOSK_MODELS_DIR: PATHS.voskModelsDir,
      VOSK_SERVER_INTERFACE: '127.0.0.1',
      VOSK_SERVER_PORT: '2700'
    };


    // Dynamically determine server script path after extraction
    const extractedVoskServer = path.join(PATHS.pythonBundleDir, 'python-env/vosk-server/asr_server_with_models.py');
    const devVoskServer = getResourcePath('Vosk-Server/websocket/asr_server_with_models.py');
    
    const voskServerScript = fs.existsSync(extractedVoskServer) ? extractedVoskServer : devVoskServer;
    
    console.log(`🐍 Using Vosk server script: ${voskServerScript}`);
    console.log(`🐍 Server script exists: ${fs.existsSync(voskServerScript)}`);

    voskProcess = spawn(pythonCmd, [voskServerScript], {
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
    
    // Check if extracted Python executable exists in home directory
    // Windows python-build-standalone has python.exe in root, macOS/Linux has it in bin/
    const extractedPython = process.platform === 'win32' 
      ? path.join(PATHS.pythonBundleDir, 'python-env', 'python-dist', 'python.exe')
      : path.join(PATHS.pythonBundleDir, 'python-env', 'python-dist', 'bin', 'python3');
    
    // Dynamically detect Python version - MUST be dynamic, no fallback to hardcoded version
    const pythonVersion = detectPythonVersion(PATHS.pythonBundleDir);
    
    console.log(`🔊 Checking extracted Python: ${extractedPython}`);
    console.log(`🔊 Python exists: ${fs.existsSync(extractedPython)}`);
    
    let extractedPackages = null;
    if (pythonVersion) {
      if (pythonVersion === 'direct') {
        // Windows: Direct site-packages in Lib/
        extractedPackages = path.join(PATHS.pythonBundleDir, 'python-env', 'python-dist', 'Lib', 'site-packages');
        console.log(`🔊 Using Windows direct site-packages`);
      } else {
        // macOS/Linux: Versioned subdirectory
        extractedPackages = path.join(PATHS.pythonBundleDir, 'python-env', 'python-dist', 'lib', pythonVersion, 'site-packages');
        console.log(`🔊 Using dynamic Python version: ${pythonVersion}`);
      }
      console.log(`🔊 Checking extracted packages: ${extractedPackages}`);
      console.log(`🔊 Packages exist: ${fs.existsSync(extractedPackages)}`);
    } else {
      console.log(`🔊 Could not detect Python version in bundle, skipping extracted packages`);
    }
    
    if (fs.existsSync(extractedPython) && extractedPackages && fs.existsSync(extractedPackages)) {
      // Use extracted Python with extracted packages - 100% bundled
      pythonCmd = extractedPython;
      console.log(`Using extracted Python: ${pythonCmd}`);
      console.log(`Extracted packages path: ${extractedPackages}`);
      
      // Set up environment for extracted Python
      pythonEnv.PYTHONPATH = `${path.join(PATHS.pythonBundleDir, 'python-env/kokoro-tts')}:${extractedPackages}`;
      pythonEnv.PYTHONHOME = path.join(PATHS.pythonBundleDir, 'python-env/python-dist');
    } else {
      // No system Python fallback - bundled Python environment required
      const errorMsg = !fs.existsSync(extractedPython) 
        ? 'Bundled Python executable not found'
        : !extractedPackages 
          ? 'Could not detect Python version in bundle'
          : 'Bundled Python packages not found';
      
      console.error(`❌ TTS server cannot start: ${errorMsg}`);
      console.error(`❌ Required bundled Python environment is missing`);
      reject(new Error(errorMsg));
      return;
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


    // Dynamically determine TTS server script path after extraction
    const extractedTTSServer = path.join(PATHS.pythonBundleDir, 'python-env/kokoro-tts/browser_tts_server.py');
    const devTTSServer = getResourcePath('Kokoro-TTS-Server/websocket/browser_tts_server.py');
    
    const ttsServerScript = fs.existsSync(extractedTTSServer) ? extractedTTSServer : devTTSServer;
    
    console.log(`🔊 Using TTS server script: ${ttsServerScript}`);
    console.log(`🔊 Server script exists: ${fs.existsSync(ttsServerScript)}`);

    // On Windows, redirect stderr to avoid Unicode console issues
    if (process.platform === 'win32') {
      ttsProcess = spawn(pythonCmd, [ttsServerScript, '--host', '127.0.0.1', '--port', '2701'], {
        env,
        stdio: ['pipe', 'pipe', 'ignore'], // Ignore stderr to avoid Unicode issues
        shell: false
      });
    } else {
      ttsProcess = spawn(pythonCmd, [ttsServerScript, '--host', '127.0.0.1', '--port', '2701'], {
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
    icon: path.join(__dirname, 'public', 'cpace-logo-icon-256.ico'), // Use the correct icon path
    titleBarStyle: 'default',
    show: true // Show immediately
  });

  // Load the app
  const startUrl = isDev 
    ? 'http://localhost:3000' 
    : `file://${path.join(PATHS.buildDir, 'index.html')}`;
  
  // Enable context menu (use Menu from existing require at top)
  const { Menu } = require('electron');

  mainWindow.webContents.on('context-menu', (event, params) => {
    console.log('context-menu fired'); // Sanity check log
    
    // Clean minimal template that adapts to what's under the cursor
    const template = [
      ...(params.isEditable ? [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }] : []),
      ...(!params.isEditable && params.selectionText ? [{ role: 'copy' }] : []),
      ...(params.isEditable || params.selectionText ? [{ type: 'separator' }] : []),
      { role: 'selectAll' },
      ...(params.linkURL ? [{ type: 'separator' }, { label: 'Open Link', click: () => shell.openExternal(params.linkURL) }] : [])
    ];

    const menu = Menu.buildFromTemplate(template);
    // Use mainWindow directly instead of trying to get from event.sender
    menu.popup({ window: mainWindow });
  });

  mainWindow.loadURL(startUrl);

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
