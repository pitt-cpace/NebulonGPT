import { getAllVoskModels, deleteVoskModel as deleteVoskModelBackend, extractVoskModel as extractVoskModelBackend } from './backendApi';

// Electron API adapter to replace Node.js server calls
declare global {
  interface Window {
    electronAPI?: {
      getChats: () => Promise<any[]>;
      saveChat: (chatId: string, chatData: any) => Promise<{ success: boolean }>;
      saveAllChats: (chats: any[]) => Promise<{ success: boolean }>;
      getVoskModels: () => Promise<{ models: any[] }>;
      deleteVoskModel: (modelName: string) => Promise<{ success: boolean; error?: string }>;
      extractVoskModel: (modelName: string) => Promise<{ success: boolean; error?: string }>;
      copyFileToModels: (fileName: string, fileData: Uint8Array) => Promise<{ success: boolean; error?: string }>;
      updateVoskModelsChecksum: () => Promise<{ success: boolean; size?: number; error?: string }>;
      showSaveDialog: () => Promise<any>;
      showOpenDialog: () => Promise<any>;
      getAppVersion: () => Promise<string>;
      copyToClipboard: (text: string) => Promise<{ success: boolean; error?: string }>;
      openExternal: (url: string) => Promise<void>;
      getNetworkAddresses: () => Promise<{
        localhost: string;
        loopback: string;
        wifi: string[];
        ethernet: string[];
      }>;
      platform: string;
      isElectron: boolean;
    };
    isElectron?: boolean;
  }
}

// Cache for server type detection
let serverTypeCache: { isElectron: boolean; checkedAt: number } | null = null;
const CACHE_DURATION = 5000; // 5 seconds

export const isElectron = () => {
  // Check multiple ways to detect Electron - direct detection first
  const directElectronDetection = !!(
    window.isElectron || 
    window.electronAPI || 
    (window as any).require ||
    (window.navigator && window.navigator.userAgent && window.navigator.userAgent.includes('Electron'))
  );
  
  if (directElectronDetection) {
    return true;
  }
  
  // If direct detection fails, check cache for server-based detection
  if (serverTypeCache && (Date.now() - serverTypeCache.checkedAt) < CACHE_DURATION) {
    return serverTypeCache.isElectron;
  }
  
  // Return false by default if cache not available
  // checkElectronServer() should be called on app initialization to populate cache
  return false;
};

// Check if server is Electron-based (for network access detection)
// This should be called during app initialization
export const checkElectronServer = async (): Promise<boolean> => {
  // First check if we're directly in Electron (via preload script)
  if (window.electronAPI || window.isElectron) {
    serverTypeCache = {
      isElectron: true,
      checkedAt: Date.now()
    };
    console.log('🔍 Server type detection: Electron (via preload API)');
    return true;
  }
  
  try {
    // Only check server-info endpoint for additional detection
    // Use AbortController for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    
    const response = await fetch('/api/server-info', { 
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const data = await response.json();
      const isElectronServer = data.serverType === 'electron' || data.isElectron === true;
      
      // Update cache
      serverTypeCache = {
        isElectron: isElectronServer,
        checkedAt: Date.now()
      };
      
      console.log(`🔍 Server type detection: ${isElectronServer ? 'Electron' : 'Web/Docker'}`);
      return isElectronServer;
    }
  } catch {
    // Silently handle - endpoint doesn't exist or timed out (expected for non-Electron)
  }
  
  // Update cache with negative result (not Electron, which is expected for web/Docker)
  serverTypeCache = {
    isElectron: false,
    checkedAt: Date.now()
  };
  
  // Log quietly without error styling
  console.log('🔍 Running on web server - using proxy for Ollama');
  return false;
};

export const electronApi = {
  // Chat management
  async getChats(): Promise<any[]> {
    if (isElectron() && window.electronAPI) {
      // Electron mode: Use IPC to get chats from file system
      return await window.electronAPI.getChats();
    }
    // Browser mode: Use localStorage for device-specific storage
    try {
      const chatsJson = localStorage.getItem('nebulon-gpt-chats');
      if (chatsJson) {
        return JSON.parse(chatsJson);
      }
      return [];
    } catch (error) {
      console.error('Failed to load chats from localStorage:', error);
      return [];
    }
  },

  async saveChat(chatId: string, chatData: any): Promise<{ success: boolean }> {
    if (isElectron() && window.electronAPI) {
      // Electron mode: Use IPC to save to file system
      return await window.electronAPI.saveChat(chatId, chatData);
    }
    // Browser mode: Use localStorage for device-specific storage
    try {
      const chatsJson = localStorage.getItem('nebulon-gpt-chats');
      const chats = chatsJson ? JSON.parse(chatsJson) : [];
      
      const existingChatIndex = chats.findIndex((chat: any) => chat.id === chatId);
      
      if (existingChatIndex >= 0) {
        chats[existingChatIndex] = { ...chats[existingChatIndex], ...chatData, id: chatId };
      } else {
        chats.unshift({ ...chatData, id: chatId });
      }
      
      localStorage.setItem('nebulon-gpt-chats', JSON.stringify(chats));
      return { success: true };
    } catch (error) {
      console.error('Failed to save chat to localStorage:', error);
      return { success: false };
    }
  },

  async saveAllChats(chats: any[]): Promise<{ success: boolean }> {
    if (isElectron() && window.electronAPI) {
      // Electron mode: Use IPC to save to file system
      return await window.electronAPI.saveAllChats(chats);
    }
    // Browser mode: Use localStorage for device-specific storage
    try {
      localStorage.setItem('nebulon-gpt-chats', JSON.stringify(chats));
      return { success: true };
    } catch (error) {
      console.error('Failed to save chats to localStorage:', error);
      return { success: false };
    }
  },

  // Vosk models management
  async getVoskModels(): Promise<{ models: any[] }> {
    if (isElectron() && window.electronAPI) {
      return await window.electronAPI.getVoskModels();
    }
    // Fallback to backendApi service for web/Docker version
    return await getAllVoskModels();
  },

  async deleteVoskModel(modelName: string): Promise<{ success: boolean; error?: string }> {
    if (isElectron() && window.electronAPI) {
      return await window.electronAPI.deleteVoskModel(modelName);
    }
    // Fallback to backendApi service for web/Docker version
    try {
      await deleteVoskModelBackend(modelName);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to delete model' };
    }
  },

  async extractVoskModel(modelName: string): Promise<{ success: boolean; error?: string }> {
    if (isElectron() && window.electronAPI) {
      return await window.electronAPI.extractVoskModel(modelName);
    }
    // Fallback to backendApi service for web/Docker version
    try {
      await extractVoskModelBackend(modelName);
      return { success: true };
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to extract model' };
    }
  },

  async copyFileToModels(fileName: string, fileData: Uint8Array): Promise<{ success: boolean; error?: string }> {
    if (isElectron() && window.electronAPI) {
      return await window.electronAPI.copyFileToModels(fileName, fileData);
    }
    // Not supported in web/Docker version
    return { success: false, error: 'File copying not supported in web version' };
  },

  async updateVoskModelsChecksum(): Promise<{ success: boolean; size?: number; error?: string }> {
    if (isElectron() && window.electronAPI) {
      return await window.electronAPI.updateVoskModelsChecksum();
    }
    // Not needed in web/Docker version (no checksum validation)
    return { success: true };
  },

  // File dialogs (Electron only)
  async showSaveDialog(): Promise<any> {
    if (isElectron() && window.electronAPI) {
      return await window.electronAPI.showSaveDialog();
    }
    // For web version, we can't show native dialogs
    return { canceled: true };
  },

  async showOpenDialog(): Promise<any> {
    if (isElectron() && window.electronAPI) {
      return await window.electronAPI.showOpenDialog();
    }
    // For web version, we can't show native dialogs
    return { canceled: true };
  },

  // App info
  async getAppVersion(): Promise<string> {
    if (isElectron() && window.electronAPI) {
      return await window.electronAPI.getAppVersion();
    }
    // For web version, return package version or default
    return '0.1.0';
  },

  // Platform detection
  getPlatform(): string {
    if (isElectron() && window.electronAPI) {
      return window.electronAPI.platform;
    }
    // For web version, use navigator
    return navigator.platform;
  },

  // Open URL in external browser
  async openExternal(url: string): Promise<void> {
    if (isElectron() && window.electronAPI && window.electronAPI.openExternal) {
      await window.electronAPI.openExternal(url);
    } else {
      // For web version, open in new tab
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }
};

// WebSocket URL helpers for different environments
export const getWebSocketUrls = () => {
  // Scenario 1 & 2: Electron (production or dev) - always use direct connections
  if (isElectron()) {
    // Use current hostname to support IP address access (127.0.0.1, 10.211.33.32, etc.)
    // Default to 'localhost' if hostname is empty (file:// protocol)
    const hostname = window.location.hostname || 'localhost';
    console.log(`⚡ Electron detected - using direct WebSocket connections on ${hostname}`);
    return {
      vosk: `ws://${hostname}:3001/vosk`,  // Direct connection to unified backend
      tts: `ws://${hostname}:3001/tts`     // Direct connection to unified backend
    };
  }
  
  // We're in a web browser - determine if it's React dev server or Docker/production
  
  // Check for React development server indicators (webpack dev server)
  const hasWebpackDevServer = (
    (window as any).webpackHotUpdate !== undefined ||
    (window as any).__webpack_dev_server__ !== undefined ||
    document.querySelector('script[src*="webpack"]') !== null ||
    document.querySelector('script[src*="hot-update"]') !== null ||
    document.querySelector('script[src*="sockjs-node"]') !== null ||
    document.querySelector('script[src*="hot-reload"]') !== null
  );
  
  // Check for React development build indicators  
  const hasReactDevTools = (
    (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ !== undefined ||
    document.querySelector('script[src*="bundle.js"]') !== null ||
    document.querySelector('script[src*="main."]') !== null
  );
  
  // Additional development environment checks
  // Port 3000 is the default React dev server port, so if we're on port 3000 with dev indicators, treat as dev mode
  const isReactDevServer = (
    window.location.port === '3000' &&
    (hasWebpackDevServer || hasReactDevTools)
  );
  
  // Check for unbuilt/development assets (these indicate dev mode)
  const hasDevAssets = document.querySelector('script[src*="/static/js/bundle.js"]') !== null;
  
  // Combine development indicators - must have webpack dev server OR be on port 3000 with dev assets
  const isDevelopmentMode = hasWebpackDevServer || (isReactDevServer && hasDevAssets);
  
  // Scenario 3: Development mode (React dev server) - use direct connections to unified backend
  if (isDevelopmentMode) {
    // Use current hostname to support IP address access (127.0.0.1, 10.211.33.32, etc.)
    const hostname = window.location.hostname;
    console.log(`Development environment detected (React dev server) on ${hostname} - using direct WebSocket connections to unified backend`);
    console.log(`Development indicators: webpack=${hasWebpackDevServer}, reactDev=${isReactDevServer}, devAssets=${hasDevAssets}`);
    return {
      vosk: `ws://${hostname}:3001/vosk`,
      tts: `ws://${hostname}:3001/tts`
    };
  }
  
  // Scenario 4: Docker/production (nginx proxy) - use proxy paths with current host/port
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host; // Includes hostname:port (e.g., localhost:8080, myapp.com:443)
  console.log(`Docker/production detected on ${host} - using nginx proxy paths`);
  console.log(`Environment indicators: webpack=${hasWebpackDevServer}, port=${window.location.port}, hostname=${window.location.hostname}`);
  return {
    vosk: `${protocol}//${host}/vosk`,
    tts: `${protocol}//${host}/tts`
  };
};

export default electronApi;
