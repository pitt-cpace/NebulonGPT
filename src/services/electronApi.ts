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
      platform: string;
      isElectron: boolean;
    };
    isElectron?: boolean;
  }
}

export const isElectron = () => {
  // Check multiple ways to detect Electron
  return !!(
    window.isElectron || 
    window.electronAPI || 
    (window as any).require ||
    (window.navigator && window.navigator.userAgent && window.navigator.userAgent.includes('Electron'))
  );
};

export const electronApi = {
  // Chat management
  async getChats(): Promise<any[]> {
    if (isElectron() && window.electronAPI) {
      return await window.electronAPI.getChats();
    }
    // Fallback to HTTP API for web/Docker version
    const response = await fetch('/api/chats');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  },

  async saveChat(chatId: string, chatData: any): Promise<{ success: boolean }> {
    if (isElectron() && window.electronAPI) {
      return await window.electronAPI.saveChat(chatId, chatData);
    }
    // Fallback to HTTP API for web/Docker version
    const response = await fetch(`/api/chats/${chatId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chatData),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  },

  async saveAllChats(chats: any[]): Promise<{ success: boolean }> {
    if (isElectron() && window.electronAPI) {
      return await window.electronAPI.saveAllChats(chats);
    }
    // Fallback to HTTP API for web/Docker version
    const response = await fetch('/api/chats', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(chats),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    return await response.json();
  },

  // Vosk models management
  async getVoskModels(): Promise<{ models: any[] }> {
    if (isElectron() && window.electronAPI) {
      return await window.electronAPI.getVoskModels();
    }
    // Fallback to HTTP API for web/Docker version
    const response = await fetch('/api/vosk/models/all');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return await response.json();
  },

  async deleteVoskModel(modelName: string): Promise<{ success: boolean; error?: string }> {
    if (isElectron() && window.electronAPI) {
      return await window.electronAPI.deleteVoskModel(modelName);
    }
    // Fallback to HTTP API for web/Docker version
    const response = await fetch(`/api/vosk/models/${encodeURIComponent(modelName)}`, {
      method: 'DELETE',
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      return { success: false, error: errorData.error || 'Failed to delete model' };
    }
    
    return { success: true };
  },

  async extractVoskModel(modelName: string): Promise<{ success: boolean; error?: string }> {
    if (isElectron() && window.electronAPI) {
      return await window.electronAPI.extractVoskModel(modelName);
    }
    // Fallback to HTTP API for web/Docker version
    const response = await fetch(`/api/vosk/models/${encodeURIComponent(modelName)}/extract`, {
      method: 'POST',
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      return { success: false, error: errorData.error || 'Failed to extract model' };
    }
    
    return { success: true };
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
    const hostname = window.location.hostname;
    console.log(`⚡ Electron detected - using direct WebSocket connections on ${hostname}`);
    return {
      vosk: `ws://${hostname}:2700`,  // Direct connection to Vosk server
      tts: `ws://${hostname}:2701`    // Direct connection to TTS server
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
  const isReactDevServer = (
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') && 
    window.location.port === '3000' &&
    (hasWebpackDevServer || hasReactDevTools)
  );
  
  // Check for unbuilt/development assets (these indicate dev mode)
  const hasDevAssets = document.querySelector('script[src*="/static/js/bundle.js"]') !== null;
  
  // Combine development indicators - must have webpack dev server OR be on localhost:3000 with dev assets
  const isDevelopmentMode = hasWebpackDevServer || (isReactDevServer && hasDevAssets);
  
  // Scenario 3: Development mode (React dev server) - use direct connections to Python services
  if (isDevelopmentMode) {
    // Use current hostname to support IP address access (127.0.0.1, 10.211.33.32, etc.)
    const hostname = window.location.hostname;
    console.log(`🔧 Development environment detected (React dev server) on ${hostname} - using direct WebSocket connections`);
    console.log(`🔧 Development indicators: webpack=${hasWebpackDevServer}, reactDev=${isReactDevServer}, devAssets=${hasDevAssets}`);
    return {
      vosk: `ws://${hostname}:2700`,
      tts: `ws://${hostname}:2701`
    };
  }
  
  // Scenario 4: Docker/production (nginx proxy) - use proxy paths with current host/port
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host; // Includes hostname:port (e.g., localhost:8080, myapp.com:443)
  console.log(`🐳 Docker/production detected on ${host} - using nginx proxy paths`);
  console.log(`🐳 Environment indicators: webpack=${hasWebpackDevServer}, port=${window.location.port}, hostname=${window.location.hostname}`);
  return {
    vosk: `${protocol}//${host}/vosk`,
    tts: `${protocol}//${host}/tts`
  };
};

export default electronApi;
