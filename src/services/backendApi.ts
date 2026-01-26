import axios from 'axios';

// Inline Electron detection to avoid circular dependency with electronApi.ts
const isElectronEnvironment = (): boolean => {
  return !!(
    (window as any).isElectron || 
    (window as any).electronAPI || 
    (window as any).require ||
    (window.navigator?.userAgent?.includes('Electron'))
  );
};

// Get backend URL from environment variable
const getBackendURL = (): string => {
  // Electron mode: Use direct connection to backend
  if (isElectronEnvironment()) {
    const backendUrl = process.env.REACT_APP_BACKEND_URL || 'http://localhost:3001';
    console.log(`[Electron] Using Backend URL: ${backendUrl}`);
    return backendUrl;
  }
  
  // Docker/Browser mode: Use relative paths (nginx proxy handles routing)
  console.log('[Docker/Browser] Using nginx proxy for backend (relative paths)');
  return '';  // Empty base URL = relative paths like /api/chats
};

// Create axios instance for backend API
const backendApi = axios.create({
  baseURL: getBackendURL(),
  headers: {
    'Content-Type': 'application/json',
  },
});

// Chat management endpoints
export const getChats = async () => {
  try {
    const response = await backendApi.get('/api/chats');
    return response.data;
  } catch (error) {
    console.error('Error fetching chats:', error);
    throw error;
  }
};

export const saveChat = async (chatId: string, chatData: any) => {
  try {
    const response = await backendApi.post(`/api/chats/${chatId}`, chatData);
    return response.data;
  } catch (error) {
    console.error('Error saving chat:', error);
    throw error;
  }
};

export const saveAllChats = async (chats: any[]) => {
  try {
    const response = await backendApi.post('/api/chats', chats);
    return response.data;
  } catch (error) {
    console.error('Error saving all chats:', error);
    throw error;
  }
};

// Vosk model management endpoints
export const getAllVoskModels = async () => {
  try {
    const response = await backendApi.get('/api/vosk/models/all');
    return response.data;
  } catch (error) {
    console.error('Error fetching Vosk models:', error);
    throw error;
  }
};

export const uploadVoskModel = async (file: File) => {
  try {
    const formData = new FormData();
    formData.append('model', file);
    
    const response = await backendApi.post('/api/vosk/models/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  } catch (error) {
    console.error('Error uploading Vosk model:', error);
    throw error;
  }
};

export const extractVoskModel = async (modelName: string) => {
  try {
    const response = await backendApi.post(`/api/vosk/models/${modelName}/extract`);
    return response.data;
  } catch (error) {
    console.error('Error extracting Vosk model:', error);
    throw error;
  }
};

export const deleteVoskModel = async (modelName: string) => {
  try {
    const response = await backendApi.delete(`/api/vosk/models/${modelName}`);
    return response.data;
  } catch (error) {
    console.error('Error deleting Vosk model:', error);
    throw error;
  }
};

// Network info endpoint
export const getNetworkInfo = async () => {
  try {
    const response = await backendApi.get('/api/network-info');
    return response.data;
  } catch (error) {
    console.error('Error fetching network info:', error);
    throw error;
  }
};

// Health check endpoint
export const checkHealth = async () => {
  try {
    const response = await backendApi.get('/health');
    return response.data;
  } catch (error) {
    console.error('Error checking backend health:', error);
    throw error;
  }
};

export default backendApi;
