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
  }
};

// WebSocket URL helpers for different environments
export const getWebSocketUrls = () => {
  if (isElectron()) {
    // In Electron, connect directly to local Python servers
    console.log('⚡ Using direct WebSocket connections for Electron');
    return {
      vosk: 'ws://localhost:2700',  // Default Vosk WebSocket port
      tts: 'ws://localhost:2701'    // Default TTS WebSocket port
    };
  } else {
    // Enhanced detection for development vs production
    const isDevelopment = (
      // Check for React dev server indicators
      window.location.hostname === 'localhost' &&
      window.location.port === '3000' &&
      (
        // Check for webpack HMR
        (window as any).webpackHotUpdate !== undefined ||
        // Check for React dev tools
        (window as any).__REACT_DEVTOOLS_GLOBAL_HOOK__ !== undefined ||
        // Check for development mode in document
        document.querySelector('script[src*="webpack"]') !== null ||
        // Check if we're running from React dev server
        (window as any).process?.env?.NODE_ENV === 'development'
      )
    );
    
    if (isDevelopment) {
      // In React development mode, connect directly to Python servers
      console.log('🔧 Using direct WebSocket connections for React dev server');
      return {
        vosk: 'ws://localhost:2700',
        tts: 'ws://localhost:2701'
      };
    } else {
      // In Docker/production mode, use nginx proxy paths
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      console.log('🐳 Using proxied WebSocket connections for Docker/production');
      return {
        vosk: `${protocol}//${host}/vosk`,
        tts: `${protocol}//${host}/tts`
      };
    }
  }
};

export default electronApi;
