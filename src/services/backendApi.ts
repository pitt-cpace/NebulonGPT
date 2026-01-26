import axios from 'axios';

// Get backend URL based on how the app is being accessed
const getBackendURL = (): string => {
  const hostname = window.location.hostname;
  const port = window.location.port;
  const protocol = window.location.protocol;
  
  // Check if accessing via network (not localhost/127.0.0.1)
  // This takes priority because remote devices can't reach "localhost"
  const isRemoteIP = hostname !== 'localhost' && hostname !== '127.0.0.1';
  
  // For network/remote access: use the same host (HTTPS proxy handles routing)
  if (isRemoteIP) {
    const host = window.location.host; // includes hostname:port
    const networkUrl = `${protocol}//${host}`;
    console.log(`Using Backend URL (network access): ${networkUrl}`);
    return networkUrl;
  }
  
  // For localhost access, check if explicitly set via environment variable
  if (process.env.REACT_APP_BACKEND_URL) {
    console.log(`Using Backend URL from env: ${process.env.REACT_APP_BACKEND_URL}`);
    return process.env.REACT_APP_BACKEND_URL;
  }
  
  // Check for React development server indicators (webpack dev server)
  const hasWebpackDevServer = (
    (window as any).webpackHotUpdate !== undefined ||
    (window as any).__webpack_dev_server__ !== undefined ||
    document.querySelector('script[src*="webpack"]') !== null ||
    document.querySelector('script[src*="hot-update"]') !== null ||
    document.querySelector('script[src*="sockjs-node"]') !== null
  );
  
  // Check if this is development mode
  const isDevelopmentMode = hasWebpackDevServer || (port === '3000' && hasWebpackDevServer);
  
  // For development: use direct connection to backend on port 3001
  if (isDevelopmentMode) {
    const devUrl = 'http://localhost:3001';
    console.log(`Using Backend URL (dev mode): ${devUrl}`);
    return devUrl;
  }
  
  // For Docker/production on localhost: use current host which is proxied
  const host = window.location.host; // includes hostname:port
  const prodUrl = `${protocol}//${host}`;
  console.log(`Using Backend URL (Docker/production mode): ${prodUrl}`);
  return prodUrl;
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

// WebSocket URL helpers
export const getVoskWebSocketURL = (): string => {
  return process.env.REACT_APP_VOSK_WS_URL || 'ws://localhost:3001/vosk';
};

export const getTTSWebSocketURL = (): string => {
  return process.env.REACT_APP_TTS_WS_URL || 'ws://localhost:3001/tts';
};

export default backendApi;
