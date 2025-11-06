import axios from 'axios';
import { isElectron } from './electronApi';

// Function to get base URL for Ollama status checks
// In Electron, connect directly to Ollama (HTTP only)
// In Docker/web, use the proxied path through server
// IMPORTANT: Always use proxy on HTTPS to avoid mixed content blocking
const getBaseURL = (): string => {
  // If page is loaded via HTTPS, we MUST use proxy to avoid mixed content errors
  const isHttps = window.location.protocol === 'https:';
  
  if (isHttps) {
    // Always use proxy when on HTTPS
    return '/api/ollama';
  }
  
  // For HTTP pages: direct connection in Electron, proxy otherwise
  return isElectron() 
    ? 'http://localhost:11434/api' // Direct connection to Ollama in Electron (HTTP only)
    : '/api/ollama'; // Always use proxy through Node server (works in dev and production)
};

export interface OllamaStatus {
  isAvailable: boolean;
  error?: string;
  version?: string;
  models?: number;
}

/**
 * Check if Ollama is running and accessible
 */
export const checkOllamaStatus = async (): Promise<OllamaStatus> => {
  try {
    const baseURL = getBaseURL(); // Get base URL dynamically
    
    // Try to fetch the version endpoint first (lightweight check)
    const versionResponse = await axios.get(`${baseURL}/version`, {
      timeout: 5000, // 5 second timeout
    });
    
    if (versionResponse.status === 200) {
      // If version check succeeds, try to get models count
      try {
        const modelsResponse = await axios.get(`${baseURL}/tags`, {
          timeout: 3000, // 3 second timeout for models
        });
        
        const modelCount = modelsResponse.data?.models?.length || 0;
        
        return {
          isAvailable: true,
          version: versionResponse.data?.version || 'Unknown',
          models: modelCount,
        };
      } catch (modelsError) {
        // Version works but models endpoint failed
        return {
          isAvailable: true,
          version: versionResponse.data?.version || 'Unknown',
          models: 0,
          error: 'Could not fetch models list',
        };
      }
    }
    
    return {
      isAvailable: false,
      error: 'Ollama responded with unexpected status',
    };
  } catch (error: any) {
    // Determine the type of error
    let errorMessage = 'Ollama is not running or not accessible';
    
    if (error.code === 'ECONNREFUSED') {
      errorMessage = 'Connection refused - Ollama is not running';
    } else if (error.code === 'ENOTFOUND') {
      errorMessage = 'Ollama server not found - check configuration';
    } else if (error.code === 'ETIMEDOUT') {
      errorMessage = 'Connection timeout - Ollama may be starting up';
    } else if (error.response) {
      // Server responded with error status
      errorMessage = `Ollama error: ${error.response.status} ${error.response.statusText}`;
    } else if (error.request) {
      // Request was made but no response received
      errorMessage = 'No response from Ollama server';
    } else {
      // Something else happened
      errorMessage = error.message || 'Unknown error connecting to Ollama';
    }
    
    return {
      isAvailable: false,
      error: errorMessage,
    };
  }
};

/**
 * Check Ollama status with retry logic
 */
export const checkOllamaStatusWithRetry = async (
  maxRetries: number = 3,
  retryDelay: number = 1000
): Promise<OllamaStatus> => {
  let lastError: string = '';
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const status = await checkOllamaStatus();
      
      if (status.isAvailable) {
        return status;
      }
      
      lastError = status.error || 'Unknown error';
      
      // If this is not the last attempt, wait before retrying
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    } catch (error: any) {
      lastError = error.message || 'Connection failed';
      
      // If this is not the last attempt, wait before retrying
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }
  
  return {
    isAvailable: false,
    error: `Failed after ${maxRetries} attempts: ${lastError}`,
  };
};

/**
 * Get a user-friendly status message
 */
export const getStatusMessage = (status: OllamaStatus): string => {
  if (status.isAvailable) {
    if (status.models === 0) {
      return `Ollama is running (v${status.version}) but no models are installed`;
    }
    return `Ollama is running (v${status.version}) with ${status.models} model${status.models !== 1 ? 's' : ''}`;
  }
  
  return status.error || 'Ollama is not available';
};

/**
 * Get status color for UI display
 */
export const getStatusColor = (status: OllamaStatus): 'success' | 'warning' | 'error' => {
  if (status.isAvailable) {
    return status.models === 0 ? 'warning' : 'success';
  }
  return 'error';
};
