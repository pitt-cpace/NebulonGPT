/**
 * Model Loading Service
 * 
 * Handles the real loading of Ollama models into RAM.
 * Uses a trigger prompt to force model loading and monitors actual progress.
 * 
 * IMPORTANT: Uses sendMessage from api.ts to ensure consistent settings
 * across all Ollama requests (main chat, title generator, and model loading).
 */

import { ollamaApi, sendMessage } from './api';
import { isElectron } from './electronApi';
import { MessageType } from '../types';

export interface ModelLoadingProgress {
  status: 'idle' | 'starting' | 'loading' | 'loaded' | 'error' | 'cancelled';
  progress: number;
  currentSize: number;
  totalSize: number;
  message: string;
  modelName: string;
  error?: string;
  startTime?: number;
  endTime?: number;
}

type ProgressCallback = (progress: ModelLoadingProgress) => void;

class ModelLoadingService {
  private progressCallbacks: Set<ProgressCallback> = new Set();
  private currentProgress: ModelLoadingProgress = {
    status: 'idle',
    progress: 0,
    currentSize: 0,
    totalSize: 0,
    message: '',
    modelName: '',
  };
  private abortController: AbortController | null = null;
  private monitoringInterval: NodeJS.Timeout | null = null;

  /**
   * Subscribe to progress updates
   */
  onProgress(callback: ProgressCallback): () => void {
    this.progressCallbacks.add(callback);
    // Immediately call with current progress
    callback(this.currentProgress);
    
    return () => {
      this.progressCallbacks.delete(callback);
    };
  }

  /**
   * Notify all subscribers of progress update
   */
  private notifyProgress(progress: Partial<ModelLoadingProgress>) {
    this.currentProgress = { ...this.currentProgress, ...progress };
    this.progressCallbacks.forEach(cb => cb(this.currentProgress));
  }

  /**
   * Cancel the current loading operation
   */
  cancelLoading() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    this.notifyProgress({
      status: 'cancelled',
      message: 'Loading cancelled',
    });
  }

  /**
   * Execute a command in Electron environment
   */
  private async executeCommand(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
    if (isElectron() && window.electronAPI?.executeCommand) {
      return await window.electronAPI.executeCommand(command);
    }
    return { stdout: '', stderr: 'Not in Electron environment', code: 1 };
  }

  /**
   * Get Ollama process memory usage using system commands (Electron only)
   */
  private async getOllamaMemoryUsage(): Promise<number> {
    try {
      // First try using ollama ps command
      const ollamaPsResult = await this.executeCommand('ollama ps');
      if (ollamaPsResult.code === 0 && ollamaPsResult.stdout) {
        // Parse ollama ps output to get model size
        const lines = ollamaPsResult.stdout.split('\n').filter(l => l.trim());
        if (lines.length > 1) {
          // Format: NAME, ID, SIZE, PROCESSOR, UNTIL
          const dataLine = lines[1]; // Skip header
          const sizeMatch = dataLine.match(/(\d+(?:\.\d+)?)\s*(KB|MB|GB)/i);
          if (sizeMatch) {
            const size = parseFloat(sizeMatch[1]);
            const unit = sizeMatch[2].toUpperCase();
            if (unit === 'GB') return size * 1024 * 1024 * 1024;
            if (unit === 'MB') return size * 1024 * 1024;
            if (unit === 'KB') return size * 1024;
            return size;
          }
        }
      }

      // Fallback: Get memory from ps command on macOS/Linux
      const platform = window.electronAPI?.platform || navigator.platform;
      if (platform === 'darwin' || platform.toLowerCase().includes('linux')) {
        const pgrepResult = await this.executeCommand('pgrep -f ollama');
        if (pgrepResult.code === 0 && pgrepResult.stdout) {
          const pids = pgrepResult.stdout.split('\n').filter(p => p.trim());
          let totalRss = 0;
          for (const pid of pids) {
            if (pid) {
              const psResult = await this.executeCommand(`ps -o pid,rss,command -p ${pid}`);
              if (psResult.code === 0 && psResult.stdout) {
                const rssMatch = psResult.stdout.match(/\s+(\d+)\s+/);
                if (rssMatch) {
                  totalRss += parseInt(rssMatch[1], 10) * 1024; // RSS is in KB
                }
              }
            }
          }
          return totalRss;
        }
      }

      return 0;
    } catch (error) {
      console.warn('Failed to get Ollama memory usage:', error);
      return 0;
    }
  }

  /**
   * Check currently loaded models via Ollama API
   */
  private async getLoadedModels(): Promise<{ models: Array<{ name: string; size: number }> }> {
    try {
      const response = await ollamaApi.get('/ps');

      if (response.status === 200) {
        const { data } = response;
        return {
          models: (data.models || []).map((m: any) => ({
            name: m.name || m.model,
            size: m.size || m.size_vram || 0,
          })),
        };
      }
    } catch (error) {
      console.warn('Failed to get loaded models:', error);
    }
    return { models: [] };
  }

  /**
   * Get model info from Ollama
   */
  private async getModelInfo(modelName: string): Promise<{ size: number }> {
    try {
      const response = await ollamaApi.post('/show', { name: modelName });

      if (response.status === 200) {
        const { data } = response;
        // Get total size from model info
        const size = data.size || data.model_info?.parameter_size || 0;
        return { size };
      }
    } catch (error) {
      console.warn('Failed to get model info:', error);
    }
    return { size: 0 };
  }

  /**
   * Load a model into RAM by sending a trigger prompt
   * This forces Ollama to fully load the model
   * 
   * For Electron: Shows progress with memory monitoring
   * For Docker/Web: Just sends trigger prompt and waits for response
   */
  async loadModel(modelName: string): Promise<boolean> {
    // Reset state
    this.abortController = new AbortController();
    const startTime = Date.now();
    
    // Check if we're in Electron environment (has memory monitoring capabilities)
    const inElectron = isElectron() && window.electronAPI?.executeCommand;

    this.notifyProgress({
      status: 'starting',
      progress: 0,
      currentSize: 0,
      totalSize: 0,
      message: `Initializing ${modelName}...`,
      modelName,
      startTime,
      error: undefined,
      endTime: undefined,
    });

    try {
      // Get model info for total size (works in both environments)
      const modelInfo = await this.getModelInfo(modelName);
      const totalSize = modelInfo.size;

      this.notifyProgress({
        status: 'loading',
        progress: 5,
        totalSize,
        message: 'Sending trigger prompt to load model...',
      });

      // Only start memory monitoring in Electron environment
      let lastProgress = 5;
      if (inElectron) {
        // Start monitoring memory usage in background
        this.monitoringInterval = setInterval(async () => {
          try {
            // Check if model is loaded via Ollama API
            const loadedModels = await this.getLoadedModels();
            const isLoaded = loadedModels.models.some(
              m => m.name === modelName || m.name.startsWith(modelName.split(':')[0])
            );

            if (isLoaded) {
              const loadedModel = loadedModels.models.find(
                m => m.name === modelName || m.name.startsWith(modelName.split(':')[0])
              );
              const currentSize = loadedModel?.size || 0;
              
              this.notifyProgress({
                progress: Math.min(95, lastProgress + 5),
                currentSize,
                message: 'Model loaded, finalizing...',
              });
              lastProgress = Math.min(95, lastProgress + 5);
            } else {
              // Try to get memory usage from system commands
              const memUsage = await this.getOllamaMemoryUsage();
              if (memUsage > 0) {
                const progress = totalSize > 0
                  ? Math.min(90, Math.round((memUsage / totalSize) * 100))
                  : Math.min(90, lastProgress + 2);
                
                this.notifyProgress({
                  progress,
                  currentSize: memUsage,
                  message: 'Loading model into memory...',
                });
                lastProgress = progress;
              } else {
                // Increment progress slowly
                lastProgress = Math.min(80, lastProgress + 1);
                this.notifyProgress({
                  progress: lastProgress,
                  message: 'Loading model into memory...',
                });
              }
            }
          } catch (error) {
            // Ignore monitoring errors
          }
        }, 500);
      } else {
        // Docker/Web mode: Simple progress increment without memory monitoring
        console.log(`📦 Docker mode - loading model without memory monitoring...`);
        this.notifyProgress({
          progress: 30,
          message: 'Loading model ...',
        });
      }

      // Read settings to match main chat (prevents model reload due to different options)
      let contextLength = 12000; // Default fallback
      let temperature = 0.1;     // Default fallback
      try {
        const savedContextLength = localStorage.getItem('contextLength');
        if (savedContextLength) {
          const parsed = parseInt(savedContextLength, 10);
          if (!isNaN(parsed) && parsed >= 2000) {
            contextLength = parsed;
          }
        }
        const savedTemperature = localStorage.getItem('temperature');
        if (savedTemperature) {
          const parsed = parseFloat(savedTemperature);
          if (!isNaN(parsed) && parsed >= 0 && parsed <= 2) {
            temperature = parsed;
          }
        }
      } catch (error) {
        console.warn('Failed to read settings, using defaults');
      }

      // Send trigger prompt to load model using the SAME sendMessage function
      // as the main app and title generator - this ensures consistent settings
      const triggerMessages: MessageType[] = [
        {
          id: 'model-load-trigger',
          role: 'user',
          content: 'Hi', // Simple trigger prompt
          timestamp: new Date().toISOString(),
        }
      ];

      // Use sendMessage from api.ts with SAME settings as main chat
      // IMPORTANT: num_ctx and temperature must match to prevent Ollama KV cache reallocation
      await sendMessage(
        modelName,
        triggerMessages,
        {
          num_ctx: contextLength,  // Use same context length as main chat (from settings)
          temperature: temperature, // Use same temperature as main chat (from settings)
        },
        // Stream callback - just to consume the stream
        (chunk: string) => {
          // We don't need to do anything with the response
          // Just need to trigger model loading
        }
      );

      // Stop monitoring
      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = null;
      }

      // Get final memory usage
      const loadedModels = await this.getLoadedModels();
      const loadedModel = loadedModels.models.find(
        m => m.name === modelName || m.name.startsWith(modelName.split(':')[0])
      );

      const endTime = Date.now();
      this.notifyProgress({
        status: 'loaded',
        progress: 100,
        currentSize: loadedModel?.size || 0,
        message: `Model ${modelName} loaded successfully!`,
        endTime,
      });

      return true;
    } catch (error: any) {
      // Stop monitoring
      if (this.monitoringInterval) {
        clearInterval(this.monitoringInterval);
        this.monitoringInterval = null;
      }

      if (error.name === 'AbortError') {
        this.notifyProgress({
          status: 'cancelled',
          message: 'Loading cancelled',
        });
        return false;
      }

      this.notifyProgress({
        status: 'error',
        message: 'Failed to load model',
        error: error.message || 'Unknown error',
      });
      return false;
    }
  }

  /**
   * Check if a model is already loaded
   */
  async isModelLoaded(modelName: string): Promise<boolean> {
    const loadedModels = await this.getLoadedModels();
    return loadedModels.models.some(
      m => m.name === modelName || m.name.startsWith(modelName.split(':')[0])
    );
  }

  /**
   * Get current progress state
   */
  getProgress(): ModelLoadingProgress {
    return this.currentProgress;
  }

  /**
   * Reset progress state
   */
  resetProgress() {
    this.currentProgress = {
      status: 'idle',
      progress: 0,
      currentSize: 0,
      totalSize: 0,
      message: '',
      modelName: '',
    };
    this.progressCallbacks.forEach(cb => cb(this.currentProgress));
  }
}

// Export singleton instance
export const modelLoadingService = new ModelLoadingService();
