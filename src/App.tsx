import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, CssBaseline } from '@mui/material';
import * as styles from './styles/components/App.styles';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import SettingsDialog from './components/SettingsDialog';
import StartupLoader from './components/StartupLoader';
import { ModelType, ChatType, MessageType, FileAttachment } from './types';
import { fetchModels, cancelStream, fetchModelDetails } from './services/api';
import { voskRecognition } from './services/vosk';
import { ttsService } from './services/ttsService';
import { generateChatTitle } from './services/titleGenerator';
import { checkOllamaStatus, OllamaStatus } from './services/ollamaStatus';
import { electronApi } from './services/electronApi';

// Global current message ID - immediately accessible everywhere
let currentMsgId: string | null = null;

const App: React.FC = () => {
  const [models, setModels] = useState<ModelType[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelType | null>(null);
  const [chats, setChats] = useState<ChatType[]>([]);
  const [currentChat, setCurrentChat] = useState<ChatType | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);
  
  // Ollama status state
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>({ isAvailable: true });
  
  // Model settings
  const [contextLength, setContextLength] = useState(4096); // Default context length
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
  }, []);

  const setCurrentMsgId = useCallback((msgId: string | null) => {
    currentMsgId = msgId;
  }, []);

  // Function to determine the chat API URL based on environment
  const getChatApiUrl = useCallback(() => {
    const isProduction = process.env.NODE_ENV === 'production';
    return isProduction ? '/api/chats' : 'http://localhost:3001/api/chats';
  }, []);

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
          let defaultModel = modelList[0]; // fallback to first model
          
          try {
            const savedDefaultModelId = localStorage.getItem('defaultModelId');
            if (savedDefaultModelId) {
              const savedDefaultModel = modelList.find(m => m.id === savedDefaultModelId);
              if (savedDefaultModel) {
                defaultModel = savedDefaultModel;
              } else {
                console.log(`⚠️ Saved default model '${savedDefaultModelId}' not found, using first available model`);
              }
            }
          } catch (error) {
            console.error('Failed to load default model from localStorage:', error);
          }
          
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
      const defaultModel = models.find(m => {
        try {
          const savedDefaultModelId = localStorage.getItem('defaultModelId');
          return savedDefaultModelId ? m.id === savedDefaultModelId : false;
        } catch (error) {
          return false;
        }
      }) || models[0];
      
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
      let defaultModel = models[0]; // fallback to first model
      
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
      
      setSelectedModel(defaultModel);
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

  const handleStopResponse = async () => {
    // Hide loading animation immediately when user stops the response
    if (onHideLoadingAnimationRef.current) {
      //onHideLoadingAnimationRef.current();
    }
    
    // Also stop TTS if full voice mode is enabled
    const ttsSettings = ttsService.getSettings();
    if (ttsSettings.fullVoiceMode && isListening) {
      ttsService.pause();
    }
    await cancelStream();
  };

  const handleSendMessage = async (content: string, attachments?: FileAttachment[]) => {
    if (!currentChat || !selectedModel) return;
    
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
    setCurrentMsgId(aiMessageId);
    
    // Set active message ID for TTS if full voice mode is enabled and mic is listening
    if (ttsSettings.fullVoiceMode && isListening) {
      const success = await ttsService.setActiveMessageId(aiMessageId);
      if (!success) {
        console.error('Srart : Failed to set active message ID for TTS:', aiMessageId);
      }
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
      // Function to handle streaming updates
      const handleStreamUpdate = (chunk: string, responseData?: any) => {
        
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
        
        // Send to TTS if full voice mode is enabled AND microphone is listening
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
              const chunk = ttsBuffer.substring(0, lineBreakIndex).trim();
              if (chunk) {
                ttsService.speak(chunk, getCurrentMsgId()); // Pass the extracted message ID from LLM
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
                const chunk = words.slice(0, 15).join(' ');
                ttsService.speak(chunk, getCurrentMsgId()); // Pass the extracted message ID from LLM
                
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
        [...updatedChat.messages], // Include the new user message
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
      setLoading(false);
    }
  };

  const handleSelectModel = async (model: ModelType) => {
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
  };

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen);
  };

  const handleSaveSettings = (newContextLength: number, newTemperature: number) => {
    setContextLength(newContextLength);
    setTemperature(newTemperature);
    
    // Save settings to localStorage
    try {
      localStorage.setItem('contextLength', newContextLength.toString());
      localStorage.setItem('temperature', newTemperature.toString());
    } catch (error) {
      console.error('Failed to save settings to localStorage:', error);
    }
  };

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
    <Box sx={styles.container}>
      <CssBaseline />
      
      {/* Startup loader overlay */}
      <StartupLoader />
      
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
      />
      
      {/* Chat interface */}
      <Sidebar 
        open={sidebarOpen}
        chats={chats}
        onCreateNewChat={handleCreateNewChat}
        onSelectChat={handleSelectChat}
        onDeleteChat={handleDeleteChat}
        onUpdateChatTitle={handleUpdateChatTitle}
        currentChatId={currentChat?.id}
        onLoadMoreChats={handleLoadMoreChats}
        hasMoreChats={chatPagination.hasMore}
        isLoadingChats={chatPagination.isLoading}
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
      />
    </Box>
  );
};

export default App;
