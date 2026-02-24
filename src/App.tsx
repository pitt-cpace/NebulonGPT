import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, CssBaseline, ThemeProvider } from '@mui/material';
import { createAppTheme, getThemeMode } from './styles/theme';
import * as styles from './styles/components/App.styles';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import SettingsDialog from './components/SettingsDialog';
import StartupLoader from './components/StartupLoader';
import ModelLoadingDialog from './components/ModelLoadingDialog';
import { modelLoadingService } from './services/modelLoadingService';
import { ModelType, ChatType, MessageType, FileAttachment } from './types';
import { fetchModels, cancelStream, fetchModelDetails } from './services/api';
import { chunkQueueService } from './services/chunkQueueService';
import { voskRecognition } from './services/vosk';
import { ttsService } from './services/ttsService';
import { generateChatTitle } from './services/titleGenerator';
import { checkOllamaStatus, OllamaStatus } from './services/ollamaStatus';
import { electronApi, checkElectronServer } from './services/electronApi';
import { RO } from './hooks/ResizeObserverManager';

// Global current message ID - immediately accessible everywhere
let currentMsgId: string | null = null;

// Global counter for ensuring unique message IDs
let messageIdCounter = 0;

// Function to generate unique message IDs
const generateUniqueMessageId = (): string => {
  const timestamp = Date.now();
  const uniqueId = `msg-${timestamp}-${messageIdCounter++}`;
  return uniqueId;
};

// Helper function to find default model based on priority
const findPriorityDefaultModel = (modelList: ModelType[]): ModelType | null => {
  // Priority list for default models when user hasn't selected one
  const priorityModels = ['gpt-oss:20b', 'granite4:tiny-h', 'mistral:7b'];
  
  for (const priorityModelId of priorityModels) {
    const foundModel = modelList.find(m => m.id === priorityModelId || m.name === priorityModelId);
    if (foundModel) {
      console.log(`🎯 Selected priority default model: ${foundModel.name}`);
      return foundModel;
    }
  }
  
  // Fallback to first model if none of the priority models are found
  if (modelList.length > 0) {
    console.log(`📋 No priority models found, falling back to first model: ${modelList[0].name}`);
    return modelList[0];
  }
  
  return null;
};

const App: React.FC = () => {
  // Theme state - dynamically update without reload
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>(() => getThemeMode());
  const [theme, setTheme] = useState(() => createAppTheme(themeMode));
  
  const [models, setModels] = useState<ModelType[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelType | null>(null);
  const [chats, setChats] = useState<ChatType[]>([]);
  const [currentChat, setCurrentChat] = useState<ChatType | null>(null);
  
  // Mobile detection state with resize listener
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);
  
  // Detect mobile device and close sidebar by default on mobile
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    // Check if screen width is less than 900px (mobile/tablet)
    const isMobileDevice = window.innerWidth < 900;
    return !isMobileDevice; // Sidebar open on desktop, closed on mobile
  });
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [isEditingChatTitle, setIsEditingChatTitle] = useState(false);
  
  // Model loading dialog state
  const [modelLoadingDialogOpen, setModelLoadingDialogOpen] = useState(false);
  const [modelToLoad, setModelToLoad] = useState<string>('');
  
  // Ollama status state
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>({ isAvailable: true });
  
  // Model settings
  const [contextLength, setContextLength] = useState(12000); // Default context length
  const [temperature, setTemperature] = useState(0.1); // Default temperature
  const [maxContextLength, setMaxContextLength] = useState(32768); // Default max context length for modern models

  // Lazy loading state
  const [chatPagination, setChatPagination] = useState({
    page: 0,
    limit: 50,
    hasMore: true,
    isLoading: false,
  });
  const [allChats, setAllChats] = useState<ChatType[]>([]); // Store all chats from server

  // Initialize server type detection on app start (for network access)
  useEffect(() => {
    checkElectronServer().then(isElectronServer => {
      if (isElectronServer) {
        console.log('🔍 Running on Electron server - using direct Ollama connections');
      } else {
        console.log('🔍 Running on web server - using proxy for Ollama');
      }
    }).catch(error => {
      console.error('Failed to detect server type:', error);
    });
  }, []);

  // Load saved settings from localStorage on app start
  useEffect(() => {
    try {
      const savedContextLength = localStorage.getItem('contextLength');
      const savedTemperature = localStorage.getItem('temperature');
      
      if (savedContextLength) {
        const contextLengthValue = parseInt(savedContextLength, 10);
        if (!isNaN(contextLengthValue) && contextLengthValue >= 2000) {
          setContextLength(contextLengthValue);
        }
      }
      
      if (savedTemperature) {
        const temperatureValue = parseFloat(savedTemperature);
        if (!isNaN(temperatureValue) && temperatureValue >= 0 && temperatureValue <= 2) {
          setTemperature(temperatureValue);
        }
      }
    } catch (error) {
      console.error('Failed to load settings from localStorage:', error);
    }
  }, []);

  // Removed auto-close on window resize - sidebar now only closes when user clicks X or outside

  // Vosk speech recognition state
  const [micStoppedTrigger, setMicStoppedTrigger] = useState(0);
  const [isListening, setIsListening] = useState(false);
  const onMicStartRef = useRef<(() => Promise<void>) | null>(null);
  const onMicStopRef = useRef<(() => Promise<void>) | null>(null);
  const onClearChatInput = useRef<(() => void) | null>(null);
  const onHideLoadingAnimationRef = useRef<(() => void) | null>(null);

  // Handle mic stopped from settings
  const handleMicStopped = () => {
    setMicStoppedTrigger(prev => prev + 1);
  };

  // Handle listening state change from ChatArea
  const handleListeningStateChange = useCallback((listening: boolean) => {
    setIsListening(listening);
  }, []);

  // Simple functions to manage current message ID
  const getCurrentMsgId = useCallback((): string | null => {
    return currentMsgId;
  }, [currentMsgId]);

  const setCurrentMsgId = useCallback(async (msgId: string | null): Promise<boolean> => {
    currentMsgId = msgId;

    const ttsSettings = ttsService.getSettings();
    if (ttsSettings.fullVoiceMode && isListening) {
      // Set the new active message ID for this response
      const success = await ttsService.setActiveMessageId(msgId);
      if (!success) {
        console.error('Start: Failed to set active message ID for TTS:', msgId);
      }
      return success;
    }
    
    return true; // Success when not in full voice mode or not listening
  }, [isListening]);

  // Function to save a specific chat by ID to the server
  const saveChatToServer = useCallback(async (chat: ChatType) => {
    try {
      await electronApi.saveChat(chat.id, chat);
    } catch (error) {
      console.error(`Failed to save chat ${chat.id} to server:`, error);
    }
  }, []);

  // Legacy function to save all chats (for bulk operations like deletions)
  const saveChatsToServer = useCallback(async (chatsToSave: ChatType[]) => {
    try {
      await electronApi.saveAllChats(chatsToSave);
    } catch (error) {
      console.error('Failed to save chats to server:', error);
    }
  }, []);

  // Function to load chats from the server with pagination
  const loadChatsFromServer = useCallback(async (page: number = 0, limit: number = 50): Promise<{ chats: ChatType[], hasMore: boolean }> => {
    try {
      const data = await electronApi.getChats();
      
      // Handle pagination for the loaded data
      if (Array.isArray(data)) {
        const startIndex = page * limit;
        const endIndex = startIndex + limit;
        const paginatedChats = data.slice(startIndex, endIndex);
        return {
          chats: paginatedChats,
          hasMore: endIndex < data.length
        };
      }
      
      return { chats: [], hasMore: false };
    } catch (error) {
      console.error('Failed to load chats from server:', error);
      return { chats: [], hasMore: false };
    }
  }, []);

  // Function to load more chats (lazy loading)
  const handleLoadMoreChats = useCallback(async () => {
    if (chatPagination.isLoading || !chatPagination.hasMore) return;

    setChatPagination(prev => ({ ...prev, isLoading: true }));

    try {
      const nextPage = chatPagination.page + 1;
      const { chats: newChats, hasMore } = await loadChatsFromServer(nextPage, chatPagination.limit);
      
      if (newChats.length > 0) {
        setChats(prevChats => [...prevChats, ...newChats]);
        setAllChats(prevAllChats => [...prevAllChats, ...newChats]);
      }

      setChatPagination(prev => ({
        ...prev,
        page: nextPage,
        hasMore,
        isLoading: false
      }));
    } catch (error) {
      console.error('Failed to load more chats:', error);
      setChatPagination(prev => ({ ...prev, isLoading: false }));
    }
  }, [chatPagination, loadChatsFromServer]);

  // Load chats from server when the app starts
  useEffect(() => {
    const fetchChats = async () => {
      // Always create a new chat on page load/refresh
      // This ensures every page refresh starts with a fresh chat
      setChatPagination(prev => ({
        ...prev,
        hasMore: false,
        isLoading: false
      }));
      
      // Don't load existing chats automatically - just prepare for new chat creation
      // The existing chats will be loaded in the sidebar when needed
    };
    
    fetchChats();
  }, []);

  // NOTE: Removed the useEffect that saved entire chats array on every change.
  // Now using individual chat saving with saveChatToServer() for better performance
  // and proper multi-tab support. Only bulk saving is used for deletions.

  useEffect(() => {
    const loadModels = async () => {
      try {
        setLoading(true);
        
        // Check Ollama status first
        const status = await checkOllamaStatus();
        setOllamaStatus(status);
        
        if (!status.isAvailable) {
          console.warn('Ollama is not available:', status.error);
        }
        
        const modelList = await fetchModels();
        setModels(modelList);
        
        // Set default model if available
        if (modelList.length > 0) {
          // Check if user has set a preferred default model
          let defaultModel: ModelType | null = null;
          
          try {
            const savedDefaultModelId = localStorage.getItem('defaultModelId');
            if (savedDefaultModelId) {
              const savedDefaultModel = modelList.find(m => m.id === savedDefaultModelId);
              if (savedDefaultModel) {
                defaultModel = savedDefaultModel;
                console.log(`✅ Using user's saved default model: ${defaultModel.name}`);
              } else {
                console.log(`⚠️ Saved default model '${savedDefaultModelId}' not found, using priority-based selection`);
              }
            }
          } catch (error) {
            console.error('Failed to load default model from localStorage:', error);
          }
          
          // If no saved default or saved default not found, use priority-based selection
          if (!defaultModel) {
            defaultModel = findPriorityDefaultModel(modelList);
          }
          
          if (defaultModel) {
            setSelectedModel(defaultModel);
            
            // Fetch context length for the default model
            try {
              const modelDetails = await fetchModelDetails(defaultModel.id);
              if (modelDetails && modelDetails.model_info && modelDetails.model_info['llama.context_length']) {
                const contextLength = parseInt(modelDetails.model_info['llama.context_length'], 10);
                setMaxContextLength(contextLength);
                console.log(`Default model ${defaultModel.id} has context length: ${contextLength}`);
              }
            } catch (error) {
              console.error('Failed to fetch model details for default model:', error);
            }
            
            // Load the default model into RAM on app startup using centralized function
            await loadModelWithDialog(defaultModel.id);
          }
        }
      } catch (error) {
        console.error('Failed to load models:', error);
        // Set error status if model loading fails
        setOllamaStatus({
          isAvailable: false,
          error: 'Failed to load models from Ollama'
        });
      } finally {
        setLoading(false);
      }
    };

    if (!initialized) {
      loadModels();
    }
  }, [initialized]);

  // Set up TTS service connection whenever getCurrentMsgId function changes
  useEffect(() => {
    if (initialized) {
      ttsService.setGetCurrentMsgId(getCurrentMsgId);
      ttsService.setSetCurrentMsgId(setCurrentMsgId);
      ttsService.setGetIsListening(() => isListening);
    }
  }, [initialized, getCurrentMsgId, setCurrentMsgId, isListening]);

  // Initialize app after models are loaded - always create a new chat
  useEffect(() => {
    if (models.length > 0 && !initialized) {
      setInitialized(true);
      
      // Always create a new chat on page load/refresh
      // First check for user's saved default model, then use priority-based selection
      let defaultModel: ModelType | null = null;
      
      try {
        const savedDefaultModelId = localStorage.getItem('defaultModelId');
        if (savedDefaultModelId) {
          const savedDefaultModel = models.find(m => m.id === savedDefaultModelId);
          if (savedDefaultModel) {
            defaultModel = savedDefaultModel;
          }
        }
      } catch (error) {
        console.error('Failed to load default model from localStorage:', error);
      }
      
      // If no saved default, use priority-based selection
      if (!defaultModel) {
        defaultModel = findPriorityDefaultModel(models);
      }
      
      // Final fallback to first model (should never happen since findPriorityDefaultModel handles this)
      if (!defaultModel && models.length > 0) {
        defaultModel = models[0];
      }
      
      // Ensure we have a model before creating the chat
      if (!defaultModel) return;
      
      const newChat: ChatType = {
        id: `chat-${Date.now()}`,
        title: 'New Chat',
        modelId: defaultModel.id,
        messages: [],
        createdAt: new Date().toISOString(),
        tokenStats: {
          totalTokensSent: 0,
          totalTokensReceived: 0,
          contextLength: contextLength,
          lastUpdated: new Date().toISOString()
        }
      };
      
      // Don't save empty chat to server immediately - only save when it gets messages
      
      // Load existing chats and put new chat first (but don't save the empty chat yet)
      loadChatsFromServer(0, chatPagination.limit).then(({ chats: savedChats }) => {
        // Filter out any empty chats from saved chats to clean up previous empty chats
        const nonEmptyChats = savedChats.filter(chat => chat.messages && chat.messages.length > 0);
        const allChats = [newChat, ...nonEmptyChats];
        setChats(allChats);
        setAllChats(allChats);
      });
      
      setCurrentChat(newChat);
      setSelectedModel(defaultModel);
    }
  }, [models, initialized, loadChatsFromServer, chatPagination.limit]);

  // Ensure default model is selected after initialization
  useEffect(() => {
    if (initialized && models.length > 0 && !selectedModel) {
      // Try to get default model from localStorage first
      let defaultModel: ModelType | null = null;
      
      try {
        const savedDefaultModelId = localStorage.getItem('defaultModelId');
        if (savedDefaultModelId) {
          const savedDefaultModel = models.find(m => m.id === savedDefaultModelId);
          if (savedDefaultModel) {
            defaultModel = savedDefaultModel;
          } 
        }
      } catch (error) {
        console.error('Failed to load default model from localStorage:', error);
      }
      
      // If no saved default, use priority-based selection
      if (!defaultModel) {
        defaultModel = findPriorityDefaultModel(models);
      }
      
      if (defaultModel) {
        setSelectedModel(defaultModel);
      }
    }
  }, [initialized, models, selectedModel]);

  const handleCreateNewChat = async () => {
    if (!selectedModel) return;
    
    try {
      // Stop LLM response if it's currently responding
      if (loading) {
        await handleStopResponse();
      }
      
      
      // Stop TTS when creating a new chat - only if in full voice mode and mic is listening
      const ttsSettings = ttsService.getSettings();
      if (ttsSettings.fullVoiceMode && isListening) {
        await ttsService.stop();
      }
    } catch (error) {
      console.error('Error stopping TTS or LLM response:', error);
    }

    const newChat: ChatType = {
      id: `chat-${Date.now()}`,
      title: 'New Chat',
      modelId: selectedModel.id,
      messages: [],
      createdAt: new Date().toISOString(),
      tokenStats: {
        totalTokensSent: 0,
        totalTokensReceived: 0,
        contextLength: contextLength,
        lastUpdated: new Date().toISOString()
      }
    };
    
    // Don't save empty chat to server immediately - only save when it gets messages
    
    setChats([newChat, ...chats]);
    setCurrentChat(newChat);
    
    // Clear the chat input box when creating a new chat
    // This is handled by passing a callback to ChatArea that can clear the input
    if (onClearChatInput.current) {
      onClearChatInput.current();
    }
    
  };

  const handleSelectChat = (chatId: string) => {
    const chat = chats.find(c => c.id === chatId);
    if (chat) {
      setCurrentChat(chat);
      
      // Set the model to the one used in this chat
      if (chat.modelId) {
        const chatModel = models.find(m => m.id === chat.modelId);
        if (chatModel) {
          setSelectedModel(chatModel);
        }
      }
    }
  };

  const handleDeleteChat = async (chatId: string) => {
    const updatedChats = chats.filter(chat => chat.id !== chatId);
    
    // Immediately save to server to ensure deletion persists
    try {
      await saveChatsToServer(updatedChats);
    } catch (error) {
      console.error('Failed to save chats to server after deletion:', error);
      // Continue with local state update even if server save fails
    }
    
    setChats(updatedChats);
    
    if (currentChat?.id === chatId) {
      // Set the new current chat
      const newCurrentChat = updatedChats.length > 0 ? updatedChats[0] : null;
      setCurrentChat(newCurrentChat);
      
      // Update the selected model to match the new current chat's model
      if (newCurrentChat && newCurrentChat.modelId) {
        const chatModel = models.find(m => m.id === newCurrentChat.modelId);
        if (chatModel) {
          setSelectedModel(chatModel);
        }
      } else if (!newCurrentChat) {
        // If no chats left, revert to default model
        try {
          const savedDefaultModelId = localStorage.getItem('defaultModelId');
          if (savedDefaultModelId && models.length > 0) {
            const defaultModel = models.find(m => m.id === savedDefaultModelId);
            if (defaultModel) {
              setSelectedModel(defaultModel);
            } else {
              // Fallback to first model if default not found
              setSelectedModel(models[0]);
            }
          } else if (models.length > 0) {
            // No default set, use first model
            setSelectedModel(models[0]);
          }
        } catch (error) {
          console.error('Failed to revert to default model after deleting last chat:', error);
          if (models.length > 0) {
            setSelectedModel(models[0]);
          }
        }
      }
    }
  };

  // Bulk delete multiple chats at once (for group selection feature)
  const handleBulkDeleteChats = async (chatIds: string[]) => {
    if (chatIds.length === 0) return;
    
    // Filter out all chats that are in the delete list
    const chatIdSet = new Set(chatIds);
    const updatedChats = chats.filter(chat => !chatIdSet.has(chat.id));
    
    // Immediately save to server to ensure deletions persist
    try {
      await saveChatsToServer(updatedChats);
    } catch (error) {
      console.error('Failed to save chats to server after bulk deletion:', error);
      // Continue with local state update even if server save fails
    }
    
    setChats(updatedChats);
    
    // Check if current chat was deleted
    if (currentChat && chatIdSet.has(currentChat.id)) {
      // Set the new current chat
      const newCurrentChat = updatedChats.length > 0 ? updatedChats[0] : null;
      setCurrentChat(newCurrentChat);
      
      // Update the selected model to match the new current chat's model
      if (newCurrentChat && newCurrentChat.modelId) {
        const chatModel = models.find(m => m.id === newCurrentChat.modelId);
        if (chatModel) {
          setSelectedModel(chatModel);
        }
      } else if (!newCurrentChat) {
        // If no chats left, revert to default model
        try {
          const savedDefaultModelId = localStorage.getItem('defaultModelId');
          if (savedDefaultModelId && models.length > 0) {
            const defaultModel = models.find(m => m.id === savedDefaultModelId);
            if (defaultModel) {
              setSelectedModel(defaultModel);
            } else {
              // Fallback to first model if default not found
              setSelectedModel(models[0]);
            }
          } else if (models.length > 0) {
            // No default set, use first model
            setSelectedModel(models[0]);
          }
        } catch (error) {
          console.error('Failed to revert to default model after deleting all chats:', error);
          if (models.length > 0) {
            setSelectedModel(models[0]);
          }
        }
      }
    }
  };

  const handleUpdateChatTitle = async (chatId: string, newTitle: string) => {
    const updatedChats = chats.map(chat => 
      chat.id === chatId 
        ? { ...chat, title: newTitle } 
        : chat
    );
    
    setChats(updatedChats);
    
    if (currentChat?.id === chatId) {
      const updatedCurrentChat = { ...currentChat, title: newTitle };
      setCurrentChat(updatedCurrentChat);
      
      // Save the updated chat to server immediately
      await saveChatToServer(updatedCurrentChat);
    } else {
      // Find and save the updated chat
      const updatedChat = updatedChats.find(chat => chat.id === chatId);
      if (updatedChat) {
        await saveChatToServer(updatedChat);
      }
    }
  };

  const handleStopResponse = async (): Promise<boolean> => {
    try {
      // Hide loading animation immediately when user stops the response
      if (onHideLoadingAnimationRef.current) {
        //onHideLoadingAnimationRef.current();
      }
      
      // Force stop the chunk queue and discard remaining chunks immediately when user clicks stop
      chunkQueueService.forceStop();
      
      // Also stop TTS if full voice mode is enabled
      const ttsSettings = ttsService.getSettings();
      if (ttsSettings.fullVoiceMode && isListening) {

        // Stop current playback and clear queue to prevent old messages from playing
        ttsService.pause();
        await ttsService.stop();
      }
      
      const cancelSuccess = await cancelStream();
      return cancelSuccess;
    } catch (error) {
      console.error('Error in handleStopResponse:', error);
      return false;
    }
  };

  const handleSendMessage = async (content: string, attachments?: FileAttachment[]) => {
    if (!currentChat || !selectedModel) return;

    // Stop any ongoing LLM response, TTS and clear the queue before starting new response
    
    while (!(await handleStopResponse())) {
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms before retry
    }
    
    // If still loading after stop attempt, return early
    if (loading)
    {
      return;
    }


    // Clear TTS if full voice mode is enabled (for new conversation turn)
    const ttsSettings = ttsService.getSettings();
        
    const userMessage: MessageType = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
      attachments, // Add attachments to the message
    };

    // Calculate token count synchronously for immediate context management
    const { tokenCountingService } = await import('./services/tokenCountingService');
    const userTokenCount = tokenCountingService.countMessageTokens(userMessage);
    userMessage.tokenCount = userTokenCount;
    
    // Calculate cumulative context (all previous messages + current message) 
    const allMessages = [...currentChat.messages, userMessage];
    const cumulativeContextTokens = tokenCountingService.countTotalTokens(allMessages);
    userMessage.contextTokensUsed = cumulativeContextTokens;
    
    console.log(`📊 User message: ${userTokenCount} tokens, Cumulative context: ${cumulativeContextTokens} tokens`);
    
    // Update current chat with user message
    const updatedChat = {
      ...currentChat,
      messages: [...currentChat.messages, userMessage],
    };
    
    // Update chats state
    const updatedChats = chats.map(chat => 
      chat.id === currentChat.id ? updatedChat : chat
    );
       
    setCurrentChat(updatedChat);
    setChats(updatedChats);

    // Create a placeholder for the AI response
    const aiMessageId = `msg-${Date.now() + 1}`;
            
    // Set the current message ID from the LLM response or fallback to local ID
    // Retry until successful
    while (!(await setCurrentMsgId(aiMessageId))) {
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms before retry
    }
    
    const aiMessage: MessageType = {
      id: aiMessageId,
      role: 'assistant',
      content: '', // Start with empty content that will be streamed
      timestamp: new Date().toISOString(),
    };
    
    // Add the empty AI message to the chat
    const chatWithAiMessage = {
      ...updatedChat,
      messages: [...updatedChat.messages, aiMessage],
    };
    
    const chatsWithAiMessage = updatedChats.map(chat => 
      chat.id === currentChat.id ? chatWithAiMessage : chat
    );
    
    setCurrentChat(chatWithAiMessage);
    setChats(chatsWithAiMessage);
    
    // Add AI response using the actual API with streaming
    try {
      
      //Wait additional 500ms for server and processes to respond properly
      await new Promise(resolve => setTimeout(resolve, 500));
      setLoading(true); // ← LLM response writing starts here
      
      // Import the sendMessage function from our API service
      const { sendMessage } = await import('./services/api');
      
            
            
            // Buffer for accumulating text chunks for TTS
            let ttsBuffer = '';
            
            // Start title generation in parallel BEFORE the main LLM call if chat needs a title
            const chatIdForTitle = currentChat.id;
            const userContentForTitle = content;
            const modelIdForTitle = selectedModel.id;
            
            let titleGenerationPromise: Promise<void> | null = null;
            
            // Check if chat needs a title and start generation immediately in parallel
            if (currentChat.title.toLowerCase() === 'new chat') {
              
              // Start title generation in parallel (don't await) - this runs simultaneously with main LLM
              titleGenerationPromise = (async () => {
                try {
                  // Get existing chat titles to prevent duplicates
                  const existingTitles = chats
                    .filter(chat => chat.id !== chatIdForTitle) // Exclude current chat
                    .map(chat => chat.title)
                    .filter(title => title && title.toLowerCase() !== 'new chat'); // Filter out empty and "New Chat" titles
                  
                  const newTitle = await generateChatTitle(
                    userContentForTitle,
                    modelIdForTitle,
                    existingTitles
                  );
                  
                  // Update title in state and persist to server
                  let updatedChatForSaving: ChatType | null = null;
                  
                  setChats(prevChats => {
                    const updatedChats = prevChats.map(chat => 
                      chat.id === chatIdForTitle 
                        ? { ...chat, title: newTitle }
                        : chat
                    );
                    
                    // Store the updated chat for saving
                    updatedChatForSaving = updatedChats.find(chat => chat.id === chatIdForTitle) || null;
                    
                    return updatedChats;
                  });
                  
                  setCurrentChat(prevChat => 
                    prevChat?.id === chatIdForTitle 
                      ? { ...prevChat, title: newTitle }
                      : prevChat
                  );
                  
                  // Save the updated chat to server
                  if (updatedChatForSaving) {
                    await saveChatToServer(updatedChatForSaving);
                  }
                } catch (error) {
                  console.error('Error in parallel title generation:', error);
                }
              })(); // Immediately invoke the async function
            } 
            // Create the messages array for the API call (includes all messages up to the AI placeholder)
            const updatedMessagesArray = chatWithAiMessage.messages;
            
            // Rate-limited callback that processes queued chunks for UI rendering
            const processChunkForUI = (chunk: string, responseData?: any) => {
              // Update the AI message with the new chunk
              setCurrentChat(prevChat => {
                if (!prevChat) return null;
                
                // Find the AI message and update its content
                const updatedMessages = prevChat.messages.map(msg => 
                  msg.id === aiMessageId
                    ? { ...msg, content: msg.content + chunk }
                    : msg
                );
                
                const updatedChat = {
                  ...prevChat,
                  messages: updatedMessages,
                };
                
                // Also update the chats array
                setChats(prevChats => 
                  prevChats.map(chat => 
                    chat.id === prevChat.id ? updatedChat : chat
                  )
                );
                
                // Save the updated chat to server immediately (individual chat saving)
                saveChatToServer(updatedChat);
                
                return updatedChat;
              });
            };
            
            // Start the chunk queue with rate limiting (30 characters per second for readable typewriter effect)
            chunkQueueService.setRate(60);
            chunkQueueService.start(processChunkForUI);
            
            // Function to handle streaming updates - enqueues chunks for rate-limited rendering
            const handleStreamUpdate = (chunk: string, responseData?: any) => {
              // Enqueue the chunk for rate-limited UI rendering
              chunkQueueService.enqueue(chunk, responseData);
              
              // Send to TTS if full voice mode is enabled AND microphone is listening
              // TTS is NOT rate-limited - it processes immediately for smooth audio
              if (ttsSettings.fullVoiceMode && isListening) {
                ttsBuffer += chunk;
                
                // Enhanced sentence detection for multiple languages and punctuation patterns
                // Western: . ! ? : ;
                // Chinese/Japanese: 。！？：；
                // Also handle newlines and other natural breaks
                const sentenceEndings = /[.!?:;。！？：；]\s+|\n\s*/g;
                let match;
                let lastIndex = 0;
                
                while ((match = sentenceEndings.exec(ttsBuffer)) !== null) {
                  const sentence = ttsBuffer.substring(lastIndex, match.index + match[0].length).trim();
                  if (sentence) {
                    ttsService.speak(sentence, getCurrentMsgId()); // Pass the extracted message ID from LLM
                  }
                  lastIndex = match.index + match[0].length;
                }
                
                // Fallback for languages without punctuation: prioritize line breaks
                if (lastIndex === 0 && ttsBuffer.length > 500) {
                  // No sentence boundaries found, but we have substantial text
                  
                  // Strategy 1: Look for line breaks first (most natural for languages without punctuation)
                  const lineBreakIndex = ttsBuffer.indexOf('\n');
                  if (lineBreakIndex > 0) {
                    const chunkText = ttsBuffer.substring(0, lineBreakIndex).trim();
                    if (chunkText) {
                      ttsService.speak(chunkText, getCurrentMsgId()); // Pass the extracted message ID from LLM
                    }
                    // Update buffer to remove sent chunk including the line break
                    ttsBuffer = ttsBuffer.substring(lineBreakIndex + 1);
                    lastIndex = 0; // Reset since we manually processed
                  }
                  // Strategy 2: If no line breaks and buffer is getting long, use word-based chunking
                  else if (ttsBuffer.length > 100) {
                    const words = ttsBuffer.split(' ');
                    if (words.length > 15) {
                      // Send first 15 words as a chunk
                      const chunkText = words.slice(0, 15).join(' ');
                      ttsService.speak(chunkText, getCurrentMsgId()); // Pass the extracted message ID from LLM
                      
                      // Update buffer to remove sent chunk
                      ttsBuffer = words.slice(15).join(' ');
                      lastIndex = 0; // Reset since we manually processed
                    }
                  }
                } else {
                  // Keep remaining text in buffer
                  ttsBuffer = ttsBuffer.substring(lastIndex);
                }
              }
            };
            
            // Start both operations in parallel using Promise.all or separate promises
            const apiResult = await sendMessage(
              selectedModel.id,
              updatedMessagesArray, // Use the array we created earlier that includes both user and AI messages
              {
                num_ctx: contextLength,
                temperature: temperature
              }, // Pass model settings
              handleStreamUpdate, // Streaming callback
              isListening // Pass listening state for system message logic
            );
            
            // Update chat with token statistics and context tracking
            setCurrentChat(prevChat => {
              if (!prevChat) return null;
              
              // Update messages - DON'T change user message contextTokensUsed (keep immediate display)
              const updatedMessages = prevChat.messages.map(msg => {
                if (msg.id === aiMessageId) {
                  // AI message: Calculate async for accurate token count
                  (async () => {
                    if (msg.content) {
                      const aiTokenCount = await tokenCountingService.countMessageTokensAsync(msg);
                      // Update the message with async calculated tokens
                      setCurrentChat(currentChat => {
                        if (!currentChat) return null;
                        const updatedMsgs = currentChat.messages.map(m => 
                          m.id === msg.id ? { ...m, tokenCount: aiTokenCount } : m
                        );
                        return { ...currentChat, messages: updatedMsgs };
                      });
                    }
                  })();
                  // Initially set with API result, will be updated async above
                  return { ...msg, tokenCount: apiResult.tokensReceived };
                }
                return msg; // Keep user message unchanged (preserves immediate contextTokensUsed)
              });
              
              const updatedChat = {
                ...prevChat,
                messages: updatedMessages,
                tokenStats: {
                  totalTokensSent: (prevChat.tokenStats?.totalTokensSent || 0) + apiResult.tokensSent,
                  totalTokensReceived: (prevChat.tokenStats?.totalTokensReceived || 0) + apiResult.tokensReceived,
                  contextLength: contextLength,
                  lastUpdated: new Date().toISOString()
                }
              };
              
              // Update the chats array with token stats
              setChats(prevChats => 
                prevChats.map(chat => 
                  chat.id === prevChat.id ? updatedChat : chat
                )
              );
              
              // Save the updated chat with token stats to server
              saveChatToServer(updatedChat);
              
              return updatedChat;
            });
            
            console.log(`📊 Context Tracking - ACTUAL tokens sent to LLM: ${apiResult.tokensSent}, Pre-calculation was: ${cumulativeContextTokens}`);
            
            // Send any remaining text in the TTS buffer after streaming is complete
            if (ttsSettings.fullVoiceMode && isListening && ttsBuffer.trim()) {
              // console.log('🔊 Sending final text chunk to TTS (mic is listening):', ttsBuffer.trim());
              // Use the current message ID from the centralized function (which now contains the LLM response ID)
              ttsService.speak(ttsBuffer.trim(), getCurrentMsgId()); // Pass the extracted message ID from LLM
            }

      // Optional: Wait for title generation to complete (but don't block the main flow)
      if (titleGenerationPromise) {
        titleGenerationPromise.catch(error => {
          console.error('Title generation promise rejected:', error);
        });
      }
      
    } catch (error) {
      console.error('Error sending message:', error);
      
      // Update the AI message with an error
      setCurrentChat(prevChat => {
        if (!prevChat) return null;
        
        // Find the AI message and update its content with error
        const updatedMessages = prevChat.messages.map(msg => 
          msg.id === aiMessageId
            ? { 
                ...msg, 
                content: `Error: Failed to get a response from the Ollama API. Please check your connection and try again.` 
              }
            : msg
        );
        
        const updatedChat = {
          ...prevChat,
          messages: updatedMessages,
        };
        
        // Also update the chats array
        setChats(prevChats => 
          prevChats.map(chat => 
            chat.id === prevChat.id ? updatedChat : chat
          )
        );
        
        return updatedChat;
      });
    } finally {
      // Set callback to turn off loading when queue is fully drained
      chunkQueueService.onDrainComplete(() => {
        setLoading(false);
        console.log('✅ Queue drained, loading set to false');
      });
      
      // Stop accepting new chunks but continue draining existing ones
      // The onDrainComplete callback will set loading=false when done
      chunkQueueService.stop();
      
      // If queue is already empty, set loading to false immediately
      if (!chunkQueueService.hasItems()) {
        setLoading(false);
      }
    }
  };

  const handleSelectModel = async (model: ModelType) => {
    // Check if this is a different model than currently selected
    const isDifferentModel = !selectedModel || selectedModel.id !== model.id;
    
    setSelectedModel(model);
    
    // Update the model ID in the current chat
    if (currentChat) {
      const updatedChat = {
        ...currentChat,
        modelId: model.id
      };
      
      // Update the current chat
      setCurrentChat(updatedChat);
      
      // Update the chat in the chats array
      const updatedChats = chats.map(chat => 
        chat.id === currentChat.id ? updatedChat : chat
      );
      
      setChats(updatedChats);
    }
    
    // Fetch model details to get context length
    try {
      const modelDetails = await fetchModelDetails(model.id);
      if (modelDetails && modelDetails.model_info && modelDetails.model_info['llama.context_length']) {
        // Update max context length based on model capabilities
        const contextLength = parseInt(modelDetails.model_info['llama.context_length'], 10);
        setMaxContextLength(contextLength);
        console.log(`Model ${model.id} has context length: ${contextLength}`);
      }
    } catch (error) {
      console.error('Failed to fetch model details:', error);
    }
    
    // If switching to a different model, trigger model loading with progress dialog
    if (isDifferentModel) {
      // Use centralized function to load model with dialog
      await loadModelWithDialog(model.id);
    }
  };
  
  // Handle model loading dialog close
  const handleModelLoadingDialogClose = () => {
    setModelLoadingDialogOpen(false);
    setModelToLoad('');
  };

  /**
   * Centralized function to load a model with loading dialog
   * Called from: app startup, model switch, settings change
   */
  const loadModelWithDialog = async (modelId: string): Promise<boolean> => {
    // Show loading dialog
    setModelToLoad(modelId);
    setModelLoadingDialogOpen(true);
    
    // Reset progress state before loading
    modelLoadingService.resetProgress();
    
    // Load the model and wait for completion
    const loadSuccess = await modelLoadingService.loadModel(modelId);
    
    return loadSuccess;
  };

  // Centralized function to safely close sidebar with TextField unmount delay
  const closeSidebarSafely = useCallback(() => {
    // If editing, wait for TextField to unmount before closing
    if (isEditingChatTitle) {
      setTimeout(() => {
        if (!isEditingChatTitle) {
          RO.suspendFor(600);
          setSidebarOpen(false);
        }
      }, 150);
    } else {
      // No editing, close immediately with suspension
      RO.suspendFor(600);
      setSidebarOpen(false);
    }
  }, [isEditingChatTitle]);

  const toggleSidebar = () => {
    if (sidebarOpen) {
      // Closing sidebar
      closeSidebarSafely();
    } else {
      // Opening sidebar
      RO.suspendFor(400);
      setTimeout(() => setSidebarOpen(true), 50);
    }
  };

  const handleSaveSettings = async (newContextLength: number, newTemperature: number) => {
    // Check if settings actually changed
    const settingsChanged = newContextLength !== contextLength || newTemperature !== temperature;
    
    setContextLength(newContextLength);
    setTemperature(newTemperature);
    
    // Save settings to localStorage
    try {
      localStorage.setItem('contextLength', newContextLength.toString());
      localStorage.setItem('temperature', newTemperature.toString());
      
      // Dispatch custom event to notify components of context length change
      window.dispatchEvent(new Event('contextLengthChanged'));
    } catch (error) {
      console.error('Failed to save settings to localStorage:', error);
    }
    
    // If settings changed and we have a selected model, reload the model with new settings
    // This is necessary because Ollama needs to reallocate KV cache when num_ctx or temperature changes
    if (settingsChanged && selectedModel) {
      // Use centralized function to reload model with dialog
      await loadModelWithDialog(selectedModel.id);
    }
  };

  // Set body class on mount based on initial theme mode
  useEffect(() => {
    document.body.className = themeMode === 'light' ? 'light-mode' : '';
    console.log(`🎨 Initial theme set to ${themeMode} mode`);
  }, []); // Run only once on mount

  // Listen for theme changes and update theme dynamically (no reload needed)
  useEffect(() => {
    const handleThemeChange = (event: CustomEvent<'light' | 'dark'>) => {
      const newMode = event.detail;
      setThemeMode(newMode);
      setTheme(createAppTheme(newMode));
      document.body.className = newMode === 'light' ? 'light-mode' : '';
      console.log(`🎨 Theme switched to ${newMode} mode without reload`);
    };

    window.addEventListener('themeChange' as any, handleThemeChange as any);
    
    return () => {
      window.removeEventListener('themeChange' as any, handleThemeChange as any);
    };
  }, []);

  // Function to refresh Ollama status
  const handleRefreshOllamaStatus = useCallback(async () => {
    try {
      const status = await checkOllamaStatus();
      setOllamaStatus(status);
      
      // If Ollama is available, always refresh the models list to detect changes
      if (status.isAvailable) {
        const modelList = await fetchModels();
        setModels(modelList);
        
        // If no models are available, the UI will show installation suggestions
        if (modelList.length === 0) {
          setSelectedModel(null);
        }
      }
      // If Ollama is not available, clear the models array
      else {
        setModels([]);
        setSelectedModel(null);
      }
      
      return status;
    } catch (error) {
      console.error('Failed to refresh Ollama status:', error);
      const errorStatus: OllamaStatus = {
        isAvailable: false,
        error: 'Failed to check Ollama status'
      };
      setOllamaStatus(errorStatus);
      // Clear models when there's an error
      setModels([]);
      setSelectedModel(null);
      return errorStatus;
    }
  }, [models]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={styles.container}>
        {/* Startup loader overlay */}
        <StartupLoader sidebarOpen={sidebarOpen} />
      
      {/* Settings dialog */}
      <SettingsDialog
        model={selectedModel}
        contextLength={contextLength}
        temperature={temperature}
        maxContextLength={maxContextLength}
        onSaveSettings={handleSaveSettings}
        voskRecognition={voskRecognition}
        onMicStopped={handleMicStopped}
        onMicStart={onMicStartRef}
        onMicStop={onMicStopRef}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />
      
      {/* Model loading progress dialog */}
      <ModelLoadingDialog
        open={modelLoadingDialogOpen}
        onClose={handleModelLoadingDialogClose}
        modelName={modelToLoad}
      />
      
      {/* Chat interface */}
      <Sidebar 
        open={sidebarOpen}
        chats={chats}
        onCreateNewChat={handleCreateNewChat}
        onSelectChat={handleSelectChat}
        onDeleteChat={handleDeleteChat}
        onBulkDeleteChats={handleBulkDeleteChats}
        onUpdateChatTitle={handleUpdateChatTitle}
        currentChatId={currentChat?.id}
        onLoadMoreChats={handleLoadMoreChats}
        hasMoreChats={chatPagination.hasMore}
        isLoadingChats={chatPagination.isLoading}
        onClose={toggleSidebar}
        onEditingStateChange={(isEditing) => {
          setIsEditingChatTitle(isEditing);
          // Suspend ResizeObserver when editing state changes
          if (!isEditing) {
            RO.suspendFor(400);
          }
        }}
      />
      <ChatArea 
        chat={currentChat}
        model={selectedModel}
        onSendMessage={handleSendMessage}
        onStopResponse={handleStopResponse}
        onToggleSidebar={toggleSidebar}
        loading={loading}
        models={models}
        onSelectModel={handleSelectModel}
        sidebarOpen={sidebarOpen}
        voskRecognition={voskRecognition}
        micStoppedTrigger={micStoppedTrigger}
        onMicStart={onMicStartRef}
        onMicStop={onMicStopRef}
        onListeningStateChange={handleListeningStateChange}
        onClearChatInput={onClearChatInput}
        getCurrentMsgId={getCurrentMsgId}
        ollamaStatus={ollamaStatus}
        onRefreshOllamaStatus={handleRefreshOllamaStatus}
        onCreateNewChat={handleCreateNewChat}
        onHideLoadingAnimation={onHideLoadingAnimationRef}
        onOpenSettings={() => setSettingsOpen(true)}
        isMobile={isMobile}
      />
      </Box>
    </ThemeProvider>
  );
};

export default App;
