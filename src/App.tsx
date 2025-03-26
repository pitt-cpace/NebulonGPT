import React, { useState, useEffect, useCallback } from 'react';
import { Box, CssBaseline } from '@mui/material';
import * as styles from './styles/components/App.styles';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import SettingsDialog from './components/SettingsDialog';
import { ModelType, ChatType, MessageType } from './types';
import { fetchModels, cancelStream, fetchModelDetails } from './services/api';

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
  const [maxContextLength, setMaxContextLength] = useState(2048); // Default max context length

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

  // Load chats from server when the app starts
  useEffect(() => {
    const fetchChats = async () => {
      const savedChats = await loadChatsFromServer();
      if (savedChats.length > 0) {
        setChats(savedChats);
        setCurrentChat(savedChats[0]);
      }
    };
    
    fetchChats();
  }, [loadChatsFromServer]);

  // Save chats to server whenever they change
  useEffect(() => {
    if (chats.length > 0) {
      saveChatsToServer(chats);
    }
  }, [chats, saveChatsToServer]);

  useEffect(() => {
    const loadModels = async () => {
      try {
        setLoading(true);
        const modelList = await fetchModels();
        setModels(modelList);
        
        // Set default model if available
        if (modelList.length > 0) {
          const defaultModel = modelList[0];
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
          
          // Only create a new chat if no chats were loaded from the server
          if (chats.length === 0) {
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
      } catch (error) {
        console.error('Failed to load models:', error);
      } finally {
        setLoading(false);
      }
    };

    loadModels();
  }, [chats.length]);

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
    }
  };

  const handleDeleteChat = (chatId: string) => {
    const updatedChats = chats.filter(chat => chat.id !== chatId);
    setChats(updatedChats);
    
    if (currentChat?.id === chatId) {
      setCurrentChat(updatedChats.length > 0 ? updatedChats[0] : null);
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

  const handleSendMessage = async (content: string) => {
    if (!currentChat || !selectedModel) return;
    
    const userMessage: MessageType = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content,
      timestamp: new Date().toISOString(),
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
      />
    </Box>
  );
};

export default App;
