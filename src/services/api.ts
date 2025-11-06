import axios from 'axios';
import { ModelType, MessageType } from '../types';
import { ttsService } from './ttsService';
import { isElectron } from './electronApi';
import { tokenCountingService } from './tokenCountingService';

// Function to get the base URL, checking localStorage first
const getBaseURL = (): string => {
  // Check if user has set a custom Ollama API URL
  const customUrl = localStorage.getItem('ollamaApiUrl');
  if (customUrl && customUrl.trim() !== '') {
    // Custom URL is already normalized with /api appended
    return customUrl.trim();
  }
  
  // Otherwise, use default logic
  // IMPORTANT: If page is loaded via HTTPS, we MUST use proxy to avoid mixed content errors
  // Browser blocks HTTP requests from HTTPS pages for security
  const isHttps = window.location.protocol === 'https:';
  
  if (isHttps) {
    // Always use proxy when on HTTPS to avoid mixed content blocking
    console.log('🔒 Using Ollama proxy (HTTPS page - mixed content protection)');
    return '/api/ollama';
  }
  
  // For HTTP pages: In Electron, connect directly to Ollama
  // In Docker/web, use the proxied path through server
  return isElectron() 
    ? 'http://localhost:11434/api' // Direct connection to Ollama in Electron (HTTP only)
    : '/api/ollama'; // Always use proxy through Node server (works in dev and production)
};

// Function to get the API key from localStorage
const getApiKey = (): string => {
  return localStorage.getItem('ollamaApiKey') || '';
};

// Function to get headers with optional API key
const getHeaders = (): Record<string, string> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  
  const apiKey = getApiKey();
  if (apiKey && apiKey.trim() !== '') {
    headers['Authorization'] = `Bearer ${apiKey.trim()}`;
  }
  
  return headers;
};

// Get the initial base URL
let baseURL = getBaseURL();

const api = axios.create({
  baseURL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Function to update the base URL dynamically
export const updateBaseURL = (newUrl?: string): void => {
  baseURL = newUrl || getBaseURL();
  api.defaults.baseURL = baseURL;
};

// Fetch available models
export const fetchModels = async (): Promise<ModelType[]> => {
  try {
    const endpoint = '/tags';
    const response = await api.get(endpoint, {
      headers: getHeaders(),
    });
    
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
// Returns true if successfully cancelled, false otherwise
export const cancelStream = async (): Promise<boolean> => {
  if (currentReader) {
    try {
      await currentReader.cancel('User cancelled the response');
      currentReader = null;
      return true;
    } catch (error) {
      console.error('Error cancelling stream:', error);
      return false;
    }
  }
  return true; // No active reader to cancel, so return true
};

// Helper function to filter out chain-of-thought reasoning (text starting with asterisk)
const filterThinkingText = (text: string): string => {
  // Remove text starting with asterisk at the beginning of responses
  // Pattern 1: *...* (both asterisks) followed by actual response
  // Pattern 2: *...punctuation...CapitalLetter (thinking ends with punctuation/ellipsis before actual response)
  
  // First try to remove text wrapped in asterisks followed by whitespace
  let filtered = text.replace(/^\*[^*]+\*\s+/g, '');
  
  // If that didn't work, try to remove thinking text that starts with * but doesn't end with *
  if (filtered === text && text.startsWith('*')) {
    // Look for patterns like:
    // "*thinking text about...Hello!" -> keep "Hello!"
    // "*thinking text.Hello!" -> keep "Hello!"
    // Match from * until we find punctuation followed by capital letter starting a sentence
    filtered = text.replace(/^\*.*?[.!?…]+(?=[A-Z][a-z])/, '');
    
    // If still no match, try the original pattern (lowercase followed by capital)
    if (filtered === text) {
      filtered = text.replace(/^\*.*?[a-z](?=[A-Z][a-z])/, '');
    }
  }
  
  return filtered.trim();
};

// Send a message to the model and get a response
export const sendMessage = async (
  modelId: string,
  messages: MessageType[],
  options?: Record<string, any>,
  onStreamUpdate?: (chunk: string, responseData?: any) => void,
  isListening?: boolean
): Promise<{response: string, tokensSent: number, tokensReceived: number}> => {
  // Initialize token counting variables outside try block for proper scope
  let tokensSent = 0;

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
    let systemMessage: any = null;
    let systemMessageTokens = 0;
    
    // Add system message when BOTH full voice mode is enabled AND microphone is listening
    if (ttsSettings.fullVoiceMode && isListening) {
      systemMessage = {
        role: 'system' as const,
        content: 'You are a helpful and conversational assistant. Maintain context across turns and speak naturally as if in an ongoing dialogue.'
      };
      
      // Count tokens in system message for truncation calculation
      systemMessageTokens = tokenCountingService.countTokens(systemMessage.content) + 10; // +10 for overhead
    }

    // Get context length from options
    const contextLength = options?.num_ctx || 4096;
    
    // Log token usage before truncation
    console.log('📊 Pre-truncation token analysis:');
    console.log(tokenCountingService.getTokenUsageSummary(messages, contextLength));
    
    // Check if we need to truncate messages to fit context length
    let truncatedMessages = messages;
    if (tokenCountingService.exceedsContextLength(messages, contextLength)) {
      console.log('⚠️ Messages exceed context length, applying truncation...');
      truncatedMessages = tokenCountingService.truncateMessagesToFitContext(
        messages, // Use original messages for better truncation decisions
        contextLength,
        systemMessageTokens
      );
      
      console.log('✅ Post-truncation token analysis:');
      console.log(tokenCountingService.getTokenUsageSummary(truncatedMessages, contextLength));
    }
    
    // Now format the (possibly truncated) messages for the API
    const messagesToSend = truncatedMessages.map(msg => {
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
    
    // Prepare final messages with system message if needed
    let finalMessages = messagesToSend;
    if (systemMessage) {
      // Insert system message at the beginning if it's not already there
      const hasSystemMessage = finalMessages.some(msg => msg.role === 'system');
      if (!hasSystemMessage) {
        finalMessages = [systemMessage, ...messagesToSend];
      }
    }

    // Calculate tokens sent (after truncation and formatting)
    let tokensSent = tokenCountingService.countTotalTokens(truncatedMessages) + systemMessageTokens;
    console.log(`📤 Tokens sent to LLM: ${tokensSent}`);
  
    
const endpoint = '/chat';
    
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
        headers: getHeaders(),
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
                let content = data.message.content;
                
                // Filter out thinking text if it appears at the start
                // Only filter on the first chunks when fullResponse is still short
                if (fullResponse.length < 500) {
                  const beforeFilter = fullResponse + content;
                  const afterFilter = filterThinkingText(beforeFilter);
                  
                  // If filtering removed text, adjust the content
                  if (afterFilter.length < beforeFilter.length) {
                    const removedLength = beforeFilter.length - afterFilter.length;
                    const alreadyProcessed = fullResponse.length;
                    
                    if (removedLength > alreadyProcessed) {
                      // Some or all of the thinking text is in this chunk
                      const toRemoveFromChunk = removedLength - alreadyProcessed;
                      content = content.substring(toRemoveFromChunk);
                      // Reset fullResponse to the filtered version
                      fullResponse = afterFilter.substring(0, alreadyProcessed);
                    }
                  }
                }
                
                // Only stream if there's content left after filtering
                if (content) {
                  onStreamUpdate(content, data);
                  fullResponse += content;
                }
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
          const tokensReceived = tokenCountingService.countTokens(fullResponse);
          console.log(`📥 Tokens received from LLM: ${tokensReceived} (cancelled)`);
          return { response: fullResponse, tokensSent, tokensReceived };
        }
        console.error('Error reading stream:', error);
        throw error;
      } finally {
        currentReader = null;
      }
      
      // Calculate tokens received and return complete object
      const tokensReceived = tokenCountingService.countTokens(fullResponse);
      console.log(`📥 Tokens received from LLM: ${tokensReceived}`);
      return { response: fullResponse, tokensSent, tokensReceived };
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
      
      const response = await api.post(endpoint, payload, {
        headers: getHeaders(),
      });
      
      
      if (response.data && response.data.message) {
        // Filter out thinking text from non-streaming responses too
        const filteredContent = filterThinkingText(response.data.message.content);
        const tokensReceived = tokenCountingService.countTokens(filteredContent);
        console.log(`📥 Tokens received from LLM: ${tokensReceived} (non-streaming)`);
        return { response: filteredContent, tokensSent, tokensReceived: 0 };
      }
    }
    
    return { response: 'No response from the model. Please check the Ollama API is running correctly.', tokensSent, tokensReceived: 0 };
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
    
    return { response: errorMessage, tokensSent: tokensSent || 0, tokensReceived: 0 };
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
      title: 'Explain supervised machine learning.',
      prompt: 'Explain supervised machine learning. \n Specifically difference between classification and regression models in machine learning.',
      description: 'Specifically difference between classification and regression models in machine learning.',
    },
    {
      title: 'Give me ideas',
      prompt: 'Give me ideas about common tourist attractions in the world.',
      description: 'Common tourist attractions in the world.',
    },
  ];
};

// Get detailed information about a specific model
export const fetchModelDetails = async (modelName: string): Promise<any> => {
  try {
    const endpoint = '/show';
    const response = await api.post(endpoint, {
      name: modelName
    }, {
      headers: getHeaders(),
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
