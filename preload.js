const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // App info
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  
  // Chat data management (replacing the Node.js server API)
  getChats: () => ipcRenderer.invoke('get-chats'),
  saveChat: (chatId, chatData) => ipcRenderer.invoke('save-chat', chatId, chatData),
  saveAllChats: (chats) => ipcRenderer.invoke('save-all-chats', chats),
  
  // File dialogs
  showSaveDialog: () => ipcRenderer.invoke('show-save-dialog'),
  showOpenDialog: () => ipcRenderer.invoke('show-open-dialog'),
  
  // Vosk models management
  getVoskModels: () => ipcRenderer.invoke('get-vosk-models'),
  deleteVoskModel: (modelName) => ipcRenderer.invoke('delete-vosk-model', modelName),
  
  // Platform detection
  platform: process.platform,
  
  // Environment detection
  isElectron: true
});

// Also expose a flag to detect if we're running in Electron
contextBridge.exposeInMainWorld('isElectron', true);
