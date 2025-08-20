import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, CssBaseline } from '@mui/material';
import * as styles from './styles/components/App.styles';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import SettingsDialog from './components/SettingsDialog';
import { ModelType, ChatType, MessageType, FileAttachment } from './types';
import { fetchModels, cancelStream, fetchModelDetails } from './services/api';
import { voskRecognition } from './services/vosk';
import { ttsService } from './services/ttsService';
import { generateChatTitle } from './services/titleGenerator';

const App: React.FC = () => {
  const [models, setModels] = useState<ModelType[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelType | null>(null);
  const [chats, setChats] = useState<ChatType[]>([]);
  const [currentChat, setCurrentChat] = useState<ChatType | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);
  
  // Current message ID from last response
  const [currentMsgId, setCurrentMsgId] = useState<string | null>(null);
  
  // Model settings
  const [contextLength, setContextLength] = useState(4096); // Default context length
  const [temperature, setTemperature] = useState(0.1); // Default temperature
  const [maxContextLength, setMaxContextLength] = useState(32768); // Default max context length for modern models

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

  // Handle mic stopped from settings
  const handleMicStopped = () => {
    setMicStoppedTrigger(prev => prev + 1);
  };

  // Handle listening state change from ChatArea
  const handleListeningStateChange = useCallback((listening: boolean) => {
    setIsListening(listening);
  }, []);

  // Functions to manage current message ID
  const getCurrentMsgId = useCallback((): string | null => {
    // console.log(`🔍 getCurrentMsgId called, returning: ${currentMsgId}`);
    return currentMsgId;
  }, [currentMsgId]);

  const setCurrentMsgIdFromResponse = useCallback((msgId: string | null) => {
    setCurrentMsgId(msgId);
    // console.log(`📝 Current message ID set to: ${msgId}`);
  }, []);

  // Function to determine the chat API URL based on environment
  const getChatApiUrl = useCallback(() => {
    const isProduction = process.env.NODE_ENV === 'production';
    return isProduction ? '/api/chats' : 'http://localhost:3001/api/chats';
  }, []);

  // Function to save a specific chat by ID to the server
  const saveChatToServer = useCallback(async (chat: ChatType) => {
    try {
      const response = await fetch(`${getChatApiUrl()}/${chat.id}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chat),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    } catch (error) {
      console.error(`Failed to save chat ${chat.id} to server:`, error);
    }
  }, [getChatApiUrl]);

  // Legacy function to save all chats (for bulk operations like deletions)
  const saveChatsToServer = useCallback(async (chatsToSave: ChatType[]) => {
    try {
      const response = await fetch(getChatApiUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chatsToSave),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to save chats to server:', error);
    }
  }, [getChatApiUrl]);

  // Function to load chats from the server
  const loadChatsFromServer = useCallback(async (): Promise<ChatType[]> => {
    try {
      const response = await fetch(getChatApiUrl());
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const chats = await response.json();
      return chats;
    } catch (error) {
      console.error('Failed to load chats from server:', error);
      return [];
    }
  }, [getChatApiUrl]);

  // Load chats from server when the app starts
  useEffect(() => {
    const fetchChats = async () => {
      const savedChats = await loadChatsFromServer();
      if (savedChats.length > 0) {
        setChats(savedChats);
        setCurrentChat(savedChats[0]);
        
        // If models are already loaded, set the selected model based on the first chat's model ID
        // BUT only if no default model has been set from localStorage
        if (models.length > 0 && savedChats[0].modelId) {
          try {
            const savedDefaultModelId = localStorage.getItem('defaultModelId');
            // Only use chat model if no default model is set
            if (!savedDefaultModelId) {
              const chatModel = models.find(m => m.id === savedChats[0].modelId);
              if (chatModel) {
                setSelectedModel(chatModel);
              }
            }
            // If default model is set, keep using it (don't override with chat model)
          } catch (error) {
            console.error('Failed to check default model when loading chats:', error);
            // Fallback to chat model if localStorage check fails
            const chatModel = models.find(m => m.id === savedChats[0].modelId);
            if (chatModel) {
              setSelectedModel(chatModel);
            }
          }
        }
      }
    };
    
    fetchChats();
  }, [loadChatsFromServer, models]);

  // NOTE: Removed the useEffect that saved entire chats array on every change.
  // Now using individual chat saving with saveChatToServer() for better performance
  // and proper multi-tab support. Only bulk saving is used for deletions.

  useEffect(() => {
    const loadModels = async () => {
      try {
        setLoading(true);
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
      // console.log('🔗 Setting up TTS service with updated getCurrentMsgId function');
      ttsService.setGetCurrentMsgId(getCurrentMsgId);
      ttsService.setSetCurrentMsgId(setCurrentMsgIdFromResponse);
      ttsService.setGetIsListening(() => isListening);
      // console.log('🔗 TTS service connected to centralized message ID functions');
    }
  }, [initialized, getCurrentMsgId, setCurrentMsgIdFromResponse, isListening]);

  // Initialize app after both models and chats are loaded
  useEffect(() => {
    if (models.length > 0 && !initialized) {
      setInitialized(true);
      
      // Only create a default chat if no chats were loaded from server
      // This should only happen on first app launch, not when user deletes all chats
      if (chats.length === 0) {
        const defaultModel = models[0];
        const newChat: ChatType = {
          id: `chat-${Date.now()}`,
          title: 'New Chat',
          modelId: defaultModel.id,
          messages: [],
          createdAt: new Date().toISOString(),
        };
        
        setChats([newChat]);
        setCurrentChat(newChat);
      }
    }
  }, [models, initialized]); // Removed 'chats' from dependency array

  const handleCreateNewChat = async () => {
    if (!selectedModel) return;
    
    const newChat: ChatType = {
      id: `chat-${Date.now()}`,
      title: 'New Chat',
      modelId: selectedModel.id,
      messages: [],
      createdAt: new Date().toISOString(),
    };
    
    // Save the new chat to server immediately
    await saveChatToServer(newChat);
    
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
    await cancelStream();
    
    // Also stop TTS if full voice mode is enabled
    const ttsSettings = ttsService.getSettings();
    if (ttsSettings.fullVoiceMode) {
      ttsService.pause();
      ttsService.clear(); // Clear any queued TTS audio
    }
  };

  const handleSendMessage = async (content: string, attachments?: FileAttachment[]) => {
    if (!currentChat || !selectedModel) return;
    
    // Clear TTS if full voice mode is enabled (for new conversation turn)
    const ttsSettings = ttsService.getSettings();
    if (ttsSettings.fullVoiceMode) {
      
      ttsService.pause();
      ttsService.clear(); // This will stop current audio and clear queue
    }
    
    const userMessage: MessageType = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
      attachments, // Add attachments to the message
    };
    
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
      // PERSISTENT LOOP - Keep trying until everything is destroyed before LLM starts (minimum 2 seconds)
      // console.log('💥 Starting persistent TTS clearing loop before LLM response (minimum 2 seconds)...');
      let clearAttempt = 0;
      const maxClearAttempts = 10; // Maximum 10 attempts
      let allCleared = false;
      const startTime = Date.now(); // Track start time
      const minimumDuration = 2000; // Minimum 2 seconds
      
      while (!allCleared && clearAttempt < maxClearAttempts) {
        clearAttempt++;
        
        try {
          // Enhanced TTS stop inside the loop
          await ttsService.pause(); // Your enhanced stop with 500ms delay
          await ttsService.clear();
          await ttsService.speak(''); // Use centralized getCurrentMsgId
          
          
          const cleared = await ttsService.clear(); // This includes server + client clearing with verification
          
          if (cleared) {
            
            // Check if we've been running for at least 2 seconds
            const elapsedTime = Date.now() - startTime;
            if (elapsedTime >= minimumDuration) {
              allCleared = true;
              break;
            } else {
              const remainingTime = minimumDuration - elapsedTime;
              // Continue the loop even though clearing was successful
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          } else {
            
            // Wait 500ms before next attempt (shorter for LLM start)
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (clearError) {
          console.error(`❌ Error in pre-LLM TTS clearing attempt ${clearAttempt}:`, clearError);
          
          // Wait 300ms before next attempt even on error
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        
        // Additional check: if we've reached minimum time and had at least one successful clear
        const elapsedTime = Date.now() - startTime;
        if (elapsedTime >= minimumDuration && clearAttempt > 0) {
          // console.log(`⏰ Minimum 2 seconds completed (${elapsedTime}ms) after ${clearAttempt} attempts - finishing`);
          allCleared = true;
          break;
        }
      }
      
      if (allCleared) {
        // console.log('🎉 PERSISTENT PRE-LLM TTS CLEARING SUCCESSFUL - Ready for clean LLM response');
      } else {
        // console.warn(`⚠️ PERSISTENT PRE-LLM TTS CLEARING TIMEOUT after ${maxClearAttempts} attempts - forcing LLM start`);
        
        // Force one final aggressive cleanup attempt before LLM
        // console.log('💥 Final aggressive TTS cleanup before LLM...');
        try {
          await ttsService.pause(); // One more aggressive stop
          // console.log('💥 Final aggressive cleanup before LLM completed');
        } catch (finalError) {
          console.error('❌ Error in final aggressive cleanup before LLM:', finalError);
        }
      }
      
      //Wait additional 500ms for server and processes to respond properly
      // console.log('⏳ Waiting additional 500ms for server and processes to respond...');
      await new Promise(resolve => setTimeout(resolve, 500));
      setLoading(true); // ← LLM response writing starts here
      
      // Import the sendMessage function from our API service
      const { sendMessage } = await import('./services/api');
      
      // Check if full voice mode is enabled for TTS
      const ttsSettings = ttsService.getSettings();
      const isFullVoiceMode = ttsSettings.fullVoiceMode;
      
      
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
            const newTitle = await generateChatTitle(
              userContentForTitle,
              modelIdForTitle
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
      } else {
        console.log('🏷️ Chat already has a title, skipping generation');
      }

      // Function to handle streaming updates
      const handleStreamUpdate = (chunk: string) => {
        // Set the current message ID from the first chunk received
        setCurrentMsgIdFromResponse(aiMessageId);        
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
        if (isFullVoiceMode && isListening) {
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
              // console.log('🔊 Sending sentence to TTS (mic is listening):', sentence);
              ttsService.speak(sentence, aiMessageId); // Pass the current message ID
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
                console.log('🔊 Sending line chunk (no punctuation, using line break, mic is listening):', chunk);
                ttsService.speak(chunk, aiMessageId); // Pass the current message ID
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
                console.log('🔊 Sending word chunk (no punctuation/line breaks found, mic is listening):', chunk);
                ttsService.speak(chunk, aiMessageId); // Pass the current message ID
                
                // Update buffer to remove sent chunk
                ttsBuffer = words.slice(15).join(' ');
                lastIndex = 0; // Reset since we manually processed
              }
            }
          } else {
            // Keep remaining text in buffer
            ttsBuffer = ttsBuffer.substring(lastIndex);
          }
        } else if (isFullVoiceMode && !isListening) {
          // Full voice mode is on but mic is not listening - don't send to TTS
          console.log('🔇 Full voice mode enabled but microphone not listening - skipping TTS');
        }
      };
      
      // Start both operations in parallel using Promise.all or separate promises
      const mainResponsePromise = sendMessage(
        selectedModel.id,
        [...updatedChat.messages], // Include the new user message
        {
          num_ctx: contextLength,
          temperature: temperature
        }, // Pass model settings
        handleStreamUpdate, // Streaming callback
        isListening // Pass listening state for system message logic
      );
      
      // Wait for the main response to complete (title generation continues in background)
      await mainResponsePromise;
      
      // Send any remaining text in the TTS buffer after streaming is complete
      if (isFullVoiceMode && isListening && ttsBuffer.trim()) {
        // console.log('🔊 Sending final text chunk to TTS (mic is listening):', ttsBuffer.trim());
        ttsService.speak(ttsBuffer.trim(), aiMessageId); // Pass the current message ID
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
      console.log(`✅ Saved settings - Context: ${newContextLength}, Temperature: ${newTemperature}`);
    } catch (error) {
      console.error('Failed to save settings to localStorage:', error);
    }
  };

  return (
    <Box sx={styles.container}>
      <CssBaseline />
      
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
      />
    </Box>
  );
};

export default App;
