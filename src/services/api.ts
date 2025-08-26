import axios from 'axios';
import { ModelType, MessageType } from '../types';
import { ttsService } from './ttsService';

// Configure axios with base URL
// In development, we use the direct URL
// In production (Docker), we use the relative path which will be proxied by Nginx
const isProduction = process.env.NODE_ENV === 'production';
const baseURL = isProduction 
  ? '/api/ollama' // This will be proxied by Nginx to the Ollama API
  : (process.env.REACT_APP_OLLAMA_API_URL || 'http://localhost:11434/api');

const api = axios.create({
  baseURL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Fetch available models
export const fetchModels = async (): Promise<ModelType[]> => {
  try {
    // In development mode, we need to be careful not to duplicate the '/api' path
    const endpoint = isProduction ? '/tags' : '/tags';
    const response = await api.get(endpoint);
    
    if (response.data && response.data.models) {
      return response.data.models.map((model: any) => ({
        id: model.name,
        name: model.name,
        size: model.size,
        quantization: model.name.includes('q') ? model.name.split('-').pop() : undefined,
        isDefault: false,
      }));
    }
    
    // Return empty array when API is not available
    return [];
  } catch (error) {
    console.error('Error fetching models:', error);
    
    // Return empty array when there's an error
    return [];
  }
};

// Variable to store the current reader for cancellation
let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

// Function to cancel the current stream
export const cancelStream = async (): Promise<void> => {
  if (currentReader) {
    try {
      await currentReader.cancel('User cancelled the response');
      currentReader = null;
    } catch (error) {
      console.error('Error cancelling stream:', error);
    }
  }
};

// Send a message to the model and get a response
export const sendMessage = async (
  modelId: string,
  messages: MessageType[],
  options?: Record<string, any>,
  onStreamUpdate?: (chunk: string, responseData?: any) => void,
  isListening?: boolean
): Promise<string> => {
  try {
    // Extract image attachments and text attachments
    const imageAttachments: string[] = [];
    
      // Process messages to include file attachments
    const formattedMessages = messages.map(msg => {
      // If the message has attachments, handle them appropriately
      if (msg.attachments && msg.attachments.length > 0) {
        // Create a new content string that includes the text file content
        let enhancedContent = msg.content;
        // Array to hold image attachments for this specific message
        const messageImages: string[] = [];
        
    // Process each attachment
    msg.attachments.forEach(attachment => {
      // Handle text and PDF attachments by including their content in the message
      if ((attachment.type === 'text' || attachment.type === 'pdf') && attachment.content) {
        enhancedContent += `\n\n--- File: ${attachment.name} ---\n${attachment.content}\n---\n`;
      }
      
      // Collect image attachments for this message
      if (attachment.type === 'image' && attachment.content) {
        // Extract base64 data from data URL (remove the prefix like "data:image/jpeg;base64,")
        const base64Data = attachment.content.split(',')[1];
        if (base64Data) {
          messageImages.push(base64Data);
          // Also add to the global array for logging purposes
          imageAttachments.push(base64Data);
        }
      }
    });
        
        // Return message with images included in the message object per Ollama API docs
        return {
          role: msg.role,
          content: enhancedContent,
          // Only include images field if there are images
          ...(messageImages.length > 0 && { images: messageImages })
        };
      }
      
      // If no attachments, just return the original message
      return {
        role: msg.role,
        content: msg.content,
      };
    });

    // Check if both full voice mode is enabled AND microphone is listening to add system message
    const ttsSettings = ttsService.getSettings();
    let finalMessages = formattedMessages;
    
    // Add system message when BOTH full voice mode is enabled AND microphone is listening
    if (ttsSettings.fullVoiceMode && isListening) {
      const systemMessage = {
        role: 'system' as const,
        content: 'You are a helpful and conversational assistant. Maintain context across turns and speak naturally as if in an ongoing dialogue.'
      };
      
      // Insert system message at the beginning if it's not already there
      const hasSystemMessage = finalMessages.some(msg => msg.role === 'system');
      if (!hasSystemMessage) {
        finalMessages = [systemMessage, ...formattedMessages];
      }
    }
  
    
// In development mode, we need to be careful not to duplicate the '/api' path
const endpoint = isProduction ? '/chat' : '/chat';
    
    // Log the full URL being used
    
    // If streaming is enabled and callback is provided
    if (onStreamUpdate) {
      // Prepare the request payload
      const payload: any = {
        model: modelId,
        messages: finalMessages,
        stream: true,
        options: options || {
          num_ctx: 4096,
          temperature: 0.8,
        },
      };
      
      
      
      // Log the complete payload with messages containing images
      //console.log('Complete Ollama API request payload:', JSON.stringify(payload, null, 2));
      
      // Use fetch for streaming
      const response = await fetch(`${baseURL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      if (!response.body) {
        throw new Error('Response body is null');
      }
      
      // Store the reader globally so it can be cancelled
      currentReader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';
      
      try {
        while (true) {
          const { done, value } = await currentReader.read();
          
          if (done) {
            break;
          }
          
          // Decode the chunk
          const chunk = decoder.decode(value, { stream: true });
          
          // Process each line (each line is a JSON object)
          const lines = chunk.split('\n').filter(line => line.trim() !== '');
          
          for (const line of lines) {
            try {
              const data = JSON.parse(line);
              
              if (data.message && data.message.content) {
                // For streaming, we get partial content
                const content = data.message.content;
                onStreamUpdate(content, data);
                fullResponse += content;
              }
            } catch (e) {
              console.error('Error parsing JSON from stream:', e, line);
            }
          }
        }
      } catch (error: any) {
        // Check if this is a cancellation error
        if (error.message === 'User cancelled the response') {
          console.log('Stream was cancelled by user');
          return fullResponse;
        }
        console.error('Error reading stream:', error);
        throw error;
      } finally {
        currentReader = null;
      }
      
      return fullResponse;
    } else {
      // Non-streaming mode (fallback)
      // Prepare the request payload
      const payload: any = {
        model: modelId,
        messages: finalMessages,
        stream: false,
        options: options || {
          num_ctx: 4096,
          temperature: 0.8,
        },
      };
      
      // Log the number of images being sent (now included in the messages)
      if (imageAttachments.length > 0) {
        console.log(`Request includes ${imageAttachments.length} images in the messages`);
      }
      
      // Log the complete payload with messages containing images
      
      const response = await api.post(endpoint, payload);
      
      
      if (response.data && response.data.message) {
        return response.data.message.content;
      }
    }
    
    return 'No response from the model. Please check the Ollama API is running correctly.';
  } catch (error: any) {
    console.error('Error sending message to Ollama API:', error);
    
    // Provide more detailed error information
    let errorMessage = 'Error: Failed to get a response from the model.';
    
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      errorMessage += ` Server responded with status ${error.response.status}: ${JSON.stringify(error.response.data)}`;
      console.error('Error response data:', error.response.data);
      console.error('Error response status:', error.response.status);
      console.error('Error response headers:', error.response.headers);
    } else if (error.request) {
      // The request was made but no response was received
      errorMessage += ' No response received from server. Check if Ollama is running.';
      console.error('Error request:', error.request);
    } else {
      // Something happened in setting up the request that triggered an Error
      errorMessage += ` ${error.message}`;
      console.error('Error message:', error.message);
    }
    
    return errorMessage;
  }
};

// Get suggested prompts
export const getSuggestedPrompts = () => {
  return [
    {
      title: 'Tell me a fun fact',
      prompt: 'Tell me a fun fact about the Roman Empire',
      description: 'about the Roman Empire',
    },
    {
      title: 'Explain options trading',
      prompt: 'Explain options trading if I\'m familiar with buying and selling stocks',
      description: 'if I\'m familiar with buying and selling stocks',
    },
    {
      title: 'Give me ideas',
      prompt: 'Give me ideas for what to do with my kids\' art',
      description: 'for what to do with my kids\' art',
    },
  ];
};

// Get detailed information about a specific model
export const fetchModelDetails = async (modelName: string): Promise<any> => {
  try {
    const endpoint = '/show';
    const response = await api.post(endpoint, {
      name: modelName
    });
    
    if (response.data) {
      return response.data;
    }
    
    return null;
  } catch (error) {
    console.error(`Error fetching details for model ${modelName}:`, error);
    return null;
  }
};

export default api;
