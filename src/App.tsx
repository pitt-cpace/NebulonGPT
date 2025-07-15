import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Box, CssBaseline } from '@mui/material';
import * as styles from './styles/components/App.styles';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import SettingsDialog from './components/SettingsDialog';
import { ModelType, ChatType, MessageType, FileAttachment } from './types';
import { fetchModels, cancelStream, fetchModelDetails } from './services/api';
import { voskRecognition } from './services/vosk';

const App: React.FC = () => {
  const [models, setModels] = useState<ModelType[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelType | null>(null);
  const [chats, setChats] = useState<ChatType[]>([]);
  const [currentChat, setCurrentChat] = useState<ChatType | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [loading, setLoading] = useState(false);
  
  // Model settings
  const [contextLength, setContextLength] = useState(4096); // Default context length
  const [temperature, setTemperature] = useState(0.8); // Default temperature
  const [maxContextLength, setMaxContextLength] = useState(48000); // Default max context length

  // State to trigger ChatArea UI update when mic is stopped from settings
  const [micStoppedTrigger, setMicStoppedTrigger] = useState(0);

  // Refs to access mic functions from ChatArea
  const micStartRef = useRef<(() => Promise<void>) | null>(null);
  const micStopRef = useRef<(() => Promise<void>) | null>(null);

  // Function to handle mic stopped from settings
  const handleMicStopped = useCallback(() => {
    // This will be called when VoskModelSelector stops the mic
    // Increment the trigger to force ChatArea to update its UI state
    console.log('🔄 Mic stopped from settings, triggering ChatArea UI update...');
    setMicStoppedTrigger(prev => prev + 1);
  }, []);

  // Function to determine the chat API URL based on environment
  const getChatApiUrl = useCallback(() => {
    const isProduction = process.env.NODE_ENV === 'production';
    return isProduction ? '/api/chats' : 'http://localhost:3001/api/chats';
  }, []);

  // Function to save chats to the server
  const saveChatsToServer = useCallback(async (chatsToSave: ChatType[]) => {
    try {
      await fetch(getChatApiUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chatsToSave),
      });
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

  // Save chats to server whenever they change (only save chats with messages)
  useEffect(() => {
    if (chats.length > 0) {
      // Filter out empty chats (chats with no messages)
      const chatsWithMessages = chats.filter(chat => chat.messages.length > 0);
      if (chatsWithMessages.length > 0) {
        saveChatsToServer(chatsWithMessages);
      }
    }
  }, [chats, saveChatsToServer]);

  // Initialize app: load models and chats
  useEffect(() => {
    const initializeApp = async () => {
      try {
        setLoading(true);
        
        // Load models first
        const modelList = await fetchModels();
        setModels(modelList);
        
        // Load chats from server
        const savedChats = await loadChatsFromServer();
        
        // Set default model if available
        let defaultModel: ModelType | null = null;
        if (modelList.length > 0) {
          // Check if there's a saved default model
          const savedDefaultModelId = localStorage.getItem('defaultModel');
          defaultModel = modelList[0]; // fallback to first model
          
          if (savedDefaultModelId) {
            const savedModel = modelList.find(m => m.id === savedDefaultModelId);
            if (savedModel) {
              defaultModel = savedModel;
            }
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
        
        // Handle chats
        if (savedChats.length > 0) {
          // Use saved chats
          setChats(savedChats);
          setCurrentChat(savedChats[0]);
          
          // Set the selected model based on the first chat's model ID if models are loaded
          if (modelList.length > 0 && savedChats[0].modelId) {
            const chatModel = modelList.find(m => m.id === savedChats[0].modelId);
            if (chatModel) {
              setSelectedModel(chatModel);
            }
          }
        } else if (defaultModel) {
          // Create a new chat only if no saved chats and we have a default model
          const newChat: ChatType = {
            id: `chat-${Date.now()}`,
            title: 'New Chat',
            modelId: defaultModel.id,
            messages: [],
            createdAt: new Date().toISOString(),
          };
          
          setChats([newChat]);
          setCurrentChat(newChat);
        } else {
          // No models available
          console.warn('No models available from Ollama API');
          setSelectedModel(null);
          setChats([]);
          setCurrentChat(null);
        }
      } catch (error) {
        console.error('Failed to initialize app:', error);
      } finally {
        setLoading(false);
      }
    };

    initializeApp();
  }, []); // Run only once on mount

  const handleCreateNewChat = () => {
    if (!selectedModel) return;
    
    const newChat: ChatType = {
      id: `chat-${Date.now()}`,
      title: 'New Chat',
      modelId: selectedModel.id,
      messages: [],
      createdAt: new Date().toISOString(),
    };
    
    setChats([newChat, ...chats]);
    setCurrentChat(newChat);
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
    try {
      // Import the deleteChat function from our API service
      const { deleteChat } = await import('./services/api');
      
      // Delete the chat and its associated files from the server
      const result = await deleteChat(chatId);
      
      if (result.success) {
        console.log(`✅ Chat and files deleted successfully`);
        console.log(`📊 Files deleted: ${result.filesDeleted}, Failed: ${result.filesFailed}`);
        
        // Show user feedback if files were deleted
        if (result.filesDeleted > 0) {
          console.log(`🗑️ Cleaned up ${result.filesDeleted} associated file(s)`);
        }
        
        // Update local state after successful server deletion
        const updatedChats = chats.filter(chat => chat.id !== chatId);
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
          }
        }
      } else {
        console.error('❌ Failed to delete chat from server');
        // Still update local state as fallback
        const updatedChats = chats.filter(chat => chat.id !== chatId);
        setChats(updatedChats);
        
        if (currentChat?.id === chatId) {
          const newCurrentChat = updatedChats.length > 0 ? updatedChats[0] : null;
          setCurrentChat(newCurrentChat);
          
          if (newCurrentChat && newCurrentChat.modelId) {
            const chatModel = models.find(m => m.id === newCurrentChat.modelId);
            if (chatModel) {
              setSelectedModel(chatModel);
            }
          }
        }
      }
    } catch (error) {
      console.error('❌ Error deleting chat:', error);
      
      // Fallback: still update local state even if server deletion fails
      const updatedChats = chats.filter(chat => chat.id !== chatId);
      setChats(updatedChats);
      
      if (currentChat?.id === chatId) {
        const newCurrentChat = updatedChats.length > 0 ? updatedChats[0] : null;
        setCurrentChat(newCurrentChat);
        
        if (newCurrentChat && newCurrentChat.modelId) {
          const chatModel = models.find(m => m.id === newCurrentChat.modelId);
          if (chatModel) {
            setSelectedModel(chatModel);
          }
        }
      }
    }
  };

  const handleUpdateChatTitle = (chatId: string, newTitle: string) => {
    const updatedChats = chats.map(chat => 
      chat.id === chatId 
        ? { ...chat, title: newTitle } 
        : chat
    );
    
    setChats(updatedChats);
    
    if (currentChat?.id === chatId) {
      setCurrentChat({ ...currentChat, title: newTitle });
    }
  };

  const handleStopResponse = async () => {
    await cancelStream();
  };

  const handleSendMessage = async (content: string, attachments?: FileAttachment[]) => {
    if (!currentChat || !selectedModel) return;
    
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
      setLoading(true);
      
      // Import the sendMessage function from our API service
      const { sendMessage } = await import('./services/api');
      
      // Function to handle streaming updates
      const handleStreamUpdate = (chunk: string) => {
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
          
          return updatedChat;
        });
      };
      
      // Call the Ollama API with the current messages and streaming handler
      await sendMessage(
        selectedModel.id,
        [...updatedChat.messages], // Include the new user message
        {
          num_ctx: contextLength,
          temperature: temperature
        }, // Pass model settings
        handleStreamUpdate // Streaming callback
      );
      
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
        onMicStart={micStartRef}
        onMicStop={micStopRef}
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
        onMicStart={micStartRef}
        onMicStop={micStopRef}
      />
    </Box>
  );
};

export default App;
