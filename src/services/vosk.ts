// Vosk Speech Recognition Service
export interface VoskResult {
  text?: string;
  partial?: string;
}

export interface VoskModelLoadedEvent {
  model: string;
}

export class VoskRecognitionService {
  private socket: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private isRecording = false;
  private currentModel: string | null = null;
  private availableModels: string[] = [];
  private isSelectingModel = false; // Flag to prevent race conditions
  
  // Event callbacks
  private onResultCallback: ((result: VoskResult) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;
  private onEndCallback: (() => void) | null = null;
  private onModelsCallback: ((models: string[]) => void) | null = null;
  private onModelLoadedCallback: ((event: VoskModelLoadedEvent) => void) | null = null;

  constructor() {
    // Initialize with default settings
  }

  private async initializeWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Use localhost for development, but can be configured for production
        const voskServerUrl = process.env.REACT_APP_VOSK_SERVER_URL || 'ws://localhost:2700';
        this.socket = new WebSocket(voskServerUrl);
        
        this.socket.onopen = () => {
          console.log('✅ WebSocket connected to Vosk server');
          
          // If we had a model selected before, reselect it after reconnection
          // But only if we're not currently in the middle of selecting a different model
          if (this.currentModel && !this.isSelectingModel) {
            console.log(`🔄 Reselecting model after reconnection: ${this.currentModel}`);
            // Use setTimeout to avoid blocking the WebSocket connection
            setTimeout(() => {
              // Double-check that we're still not selecting a model
              if (!this.isSelectingModel) {
                try {
                  // Send model selection request directly without using selectModel method
                  // to avoid callback conflicts
                  this.socket!.send(JSON.stringify({ 
                    type: 'select_model', 
                    model: this.currentModel! 
                  }));
                  console.log(`📤 Sent automatic model reselection request: ${this.currentModel}`);
                } catch (error) {
                  console.error(`❌ Failed to send automatic reselection: ${error}`);
                }
              } else {
                console.log('⏭️ Skipping automatic model reselection - manual selection in progress');
              }
            }, 100);
          } else if (!this.currentModel && !this.isSelectingModel) {
            // No model selected yet, auto-select a default model
            console.log('🎯 No model selected, auto-selecting default model...');
            setTimeout(async () => {
              try {
                const models = await this.getAvailableModels();
                if (models.length > 0) {
                  // Priority order for default model selection
                  const preferredModels = [
                    'vosk-model-small-en-us-0.15',
                    'vosk-model-en-us-0.22',
                    'vosk-model-small-en-us',
                    'vosk-model-en-us'
                  ];
                  
                  let defaultModel = '';
                  
                  // Try to find a preferred model
                  for (const preferred of preferredModels) {
                    if (models.includes(preferred)) {
                      defaultModel = preferred;
                      break;
                    }
                  }
                  
                  // If no preferred model found, use the first available model
                  if (!defaultModel) {
                    defaultModel = models[0];
                  }
                  
                  console.log(`🎤 Auto-selecting default Vosk model: ${defaultModel}`);
                  await this.selectModel(defaultModel);
                }
              } catch (error) {
                console.error('❌ Failed to auto-select default model:', error);
              }
            }, 500);
          }
          
          resolve();
        };

        this.socket.onerror = (error) => {
          console.error('WebSocket error:', error);
          reject(new Error('WebSocket connection failed'));
        };

        this.socket.onclose = () => {
          console.log('WebSocket connection closed');
          this.socket = null;
        };

        this.socket.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            
            // Handle different message types
            switch (msg.type) {
              case 'models':
                this.availableModels = msg.models || [];
                if (this.onModelsCallback) {
                  this.onModelsCallback(this.availableModels);
                }
                break;
                
              case 'model_loading':
                console.log(`🔄 Model loading: ${msg.model} - ${msg.message}`);
                break;
                
              case 'model_loaded':
                console.log(`✅ Model loaded: ${msg.model}`);
                this.currentModel = msg.model;
                if (this.onModelLoadedCallback) {
                  this.onModelLoadedCallback({ model: msg.model });
                }
                break;
                
              case 'result':
                if (this.onResultCallback) {
                  this.onResultCallback({ text: msg.text });
                }
                break;
                
              case 'partial':
                if (this.onResultCallback) {
                  this.onResultCallback({ partial: msg.partial });
                }
                break;
                
              case 'error':
                console.error('Vosk server error:', msg.message);
                if (this.onErrorCallback) {
                  this.onErrorCallback(msg.message);
                }
                break;
                
              default:
                // Handle legacy format for backward compatibility
                if (this.onResultCallback) {
                  this.onResultCallback(msg);
                }
                break;
            }
          } catch (error) {
            console.error('Error parsing Vosk response:', error);
            if (this.onErrorCallback) {
              this.onErrorCallback('Error parsing server response');
            }
          }
        };

      } catch (error) {
        reject(error);
      }
    });
  }

  private async initializeAudio(): Promise<void> {
    try {
      console.log('🎧 Creating fresh microphone stream...');
      
      // Always request fresh microphone access
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      
      console.log('✅ Fresh microphone access granted');

      console.log('🔊 Creating fresh audio context...');
      this.audioContext = new AudioContext({
        sampleRate: 16000
      });

      // Resume audio context if suspended
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      console.log('🎤 Creating audio source...');
      this.source = this.audioContext.createMediaStreamSource(this.mediaStream);

      console.log('⚙️ Creating script processor...');
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);

      this.processor.onaudioprocess = (event) => {
        if (this.socket && this.socket.readyState === WebSocket.OPEN && this.isRecording) {
          const inputBuffer = event.inputBuffer;
          const inputData = inputBuffer.getChannelData(0);
          
          // Convert float32 to int16
          const int16Array = new Int16Array(inputData.length);
          for (let i = 0; i < inputData.length; i++) {
            const sample = Math.max(-1, Math.min(1, inputData[i]));
            int16Array[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
          }
          
          // Send binary data to Vosk server
          this.socket.send(int16Array.buffer);
        }
      };

      console.log('🔗 Connecting audio nodes...');
      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      console.log('✅ Audio initialization complete');
    } catch (error) {
      console.error('❌ Audio initialization failed:', error);
      throw error;
    }
  }

  async start(): Promise<void> {
    console.log('🚀 START METHOD CALLED - isRecording:', this.isRecording);
    
    if (this.isRecording) {
      console.log('⚠️ Speech recognition is already running - EARLY RETURN');
      return;
    }

    console.log('📋 Current state before start:');
    console.log('  - socket:', this.socket?.readyState || 'null', this.socket?.readyState === WebSocket.OPEN ? '(OPEN)' : '(NOT OPEN)');
    console.log('  - audioContext:', this.audioContext?.state || 'null');
    console.log('  - mediaStream:', this.mediaStream ? `${this.mediaStream.getTracks().length} tracks` : 'null');
    console.log('  - processor:', this.processor ? 'exists' : 'null');
    console.log('  - source:', this.source ? 'exists' : 'null');
    console.log('  - currentModel:', this.currentModel);

    try {
      console.log('🔌 Checking WebSocket connection...');
      
      // Ensure WebSocket connection
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        console.log('🔌 WebSocket not available, initializing...');
        await this.initializeWebSocket();
        console.log('✅ WebSocket initialized successfully');
      } else {
        console.log('✅ WebSocket already available and open');
      }

      console.log('🎧 Starting audio initialization...');
      await this.initializeAudio();
      console.log('✅ Audio initialization completed successfully');

      this.isRecording = true;
      console.log('🎙️ Vosk speech recognition started - isRecording set to true');
      console.log('📋 Final state after start:');
      console.log('  - isRecording:', this.isRecording);
      console.log('  - socket:', this.socket?.readyState);
      console.log('  - audioContext:', this.audioContext?.state);
      console.log('  - mediaStream:', this.mediaStream ? `${this.mediaStream.getTracks().length} tracks` : 'null');
      console.log('  - processor:', this.processor ? 'exists' : 'null');
      console.log('  - source:', this.source ? 'exists' : 'null');

    } catch (error) {
      console.error('❌ Failed to start Vosk recognition:', error);
      this.isRecording = false;
      throw error;
    }
  }

  async stop(): Promise<void> {
    console.log('🛑 STOP METHOD CALLED - isRecording:', this.isRecording);
    
    if (!this.isRecording) {
      console.log('⚠️ Speech recognition is not running');
      return;
    }

    console.log('📋 State before stop:');
    console.log('  - isRecording:', this.isRecording);
    console.log('  - socket:', this.socket?.readyState);
    console.log('  - audioContext:', this.audioContext?.state);
    console.log('  - mediaStream:', this.mediaStream ? `${this.mediaStream.getTracks().length} tracks` : 'null');

    this.isRecording = false;
    console.log('🛑 Vosk speech recognition stopped - isRecording set to false');

    try {
      // Send EOF signal to server but keep connection open
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        console.log('📤 Sending EOF signal to server...');
        this.socket.send(JSON.stringify({ eof: 1 }));
      } else {
        console.log('⚠️ WebSocket not available for EOF signal');
      }

      console.log('🧹 Calling cleanup (audio only)...');
      await this.cleanupAudioOnly();
      console.log('✅ Stop method completed');

    } catch (error) {
      console.error('❌ Error during stop:', error);
      throw error;
    }
  }

  private async cleanupAudioOnly(): Promise<void> {
    console.log('🧹 Cleaning up audio resources only (keeping WebSocket)...');
    
    try {
      // Disconnect and clean up audio nodes
      if (this.processor) {
        this.processor.onaudioprocess = null;
        if (this.source) {
          this.source.disconnect(this.processor);
        }
        this.processor.disconnect();
        this.processor = null;
      }

      if (this.source) {
        this.source.disconnect();
        this.source = null;
      }

      // Stop all media tracks
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => {
          track.stop();
        });
        this.mediaStream = null;
      }

      // Close audio context
      if (this.audioContext) {
        await this.audioContext.close();
        this.audioContext = null;
      }

      console.log('✅ Audio cleanup complete - WebSocket connection preserved');
    } catch (error) {
      console.error('❌ Error during audio cleanup:', error);
    }
  }

  private async cleanup(): Promise<void> {
    console.log('🧹 Completely destroying all audio resources...');
    
    try {
      // Disconnect and clean up audio nodes
      if (this.processor) {
        this.processor.onaudioprocess = null;
        if (this.source) {
          this.source.disconnect(this.processor);
        }
        this.processor.disconnect();
        this.processor = null;
      }

      if (this.source) {
        this.source.disconnect();
        this.source = null;
      }

      // Stop all media tracks
      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => {
          track.stop();
        });
        this.mediaStream = null;
      }

      // Close audio context
      if (this.audioContext) {
        await this.audioContext.close();
        this.audioContext = null;
      }

      console.log('✅ Complete audio destruction complete - everything will be recreated fresh');
    } catch (error) {
      console.error('❌ Error during cleanup:', error);
    }
  }

  // Event handlers
  onResult(callback: (result: VoskResult) => void): void {
    this.onResultCallback = callback;
  }

  onError(callback: (error: string) => void): void {
    this.onErrorCallback = callback;
  }

  onEnd(callback: () => void): void {
    this.onEndCallback = callback;
  }

  // Model management methods
  async getAvailableModels(): Promise<string[]> {
    return new Promise(async (resolve, reject) => {
      try {
        // Ensure WebSocket connection before requesting models
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
          console.log('🔌 WebSocket not connected for getAvailableModels, reconnecting...');
          await this.initializeWebSocket();
        }

        // Set up temporary callback for models response
        const originalCallback = this.onModelsCallback;
        this.onModelsCallback = (models: string[]) => {
          this.onModelsCallback = originalCallback; // Restore original callback
          resolve(models);
        };

        // Request available models
        this.socket!.send(JSON.stringify({ type: 'get_models' }));

        // Set timeout for the request
        setTimeout(() => {
          this.onModelsCallback = originalCallback; // Restore original callback
          reject(new Error('Timeout waiting for models list'));
        }, 5000);
      } catch (error) {
        reject(error);
      }
    });
  }

  async selectModel(modelName: string): Promise<void> {
    return new Promise(async (resolve, reject) => {
      try {
        // Set flag to prevent automatic model reselection during manual selection
        this.isSelectingModel = true;
        console.log(`🎯 Starting manual model selection: ${modelName}`);

        // Ensure WebSocket connection before selecting model
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
          console.log('🔌 WebSocket not connected for selectModel, reconnecting...');
          await this.initializeWebSocket();
        }

        // Set up temporary callback for model loaded response
        const originalCallback = this.onModelLoadedCallback;
        this.onModelLoadedCallback = (event: VoskModelLoadedEvent) => {
          this.onModelLoadedCallback = originalCallback; // Restore original callback
          if (event.model === modelName) {
            this.isSelectingModel = false; // Clear flag on success
            console.log(`✅ Manual model selection completed: ${modelName}`);
            resolve();
          }
        };

        // Send model selection request
        this.socket!.send(JSON.stringify({ 
          type: 'select_model', 
          model: modelName 
        }));

        // Set timeout for the request - increased to 150 seconds to match server timeout
        setTimeout(() => {
          this.onModelLoadedCallback = originalCallback; // Restore original callback
          this.isSelectingModel = false; // Clear flag on timeout
          reject(new Error(`Timeout waiting for model '${modelName}' to load`));
        }, 150000); // 2.5 minutes timeout for large model loading
      } catch (error) {
        this.isSelectingModel = false; // Clear flag on error
        reject(error);
      }
    });
  }

  getCurrentModel(): string | null {
    return this.currentModel;
  }

  getAvailableModelsList(): string[] {
    return this.availableModels;
  }

  isConnected(): boolean {
    return this.socket !== null && this.socket.readyState === WebSocket.OPEN;
  }

  isCurrentlyRecording(): boolean {
    return this.isRecording;
  }

  // Centralized method to check model availability and get error message
  async checkModelAvailability(): Promise<{ hasModels: boolean; errorMessage?: string }> {
    try {
      // Try to get available models (this will establish connection if needed)
      const models = await this.getAvailableModels();
      if (models.length === 0) {
        return {
          hasModels: false,
          errorMessage: 'No speech recognition models found. Please download models from https://alphacephei.com/vosk/models and unzip them into the "Vosk-Server/websocket/models" folder.'
        };
      }
      return { hasModels: true };
    } catch (error) {
      // If we get here, it's likely a connection issue
      return {
        hasModels: false,
        errorMessage: 'Vosk server not available. Please ensure the server is running on localhost:2700.'
      };
    }
  }
}

// Export singleton instance
export const voskRecognition = new VoskRecognitionService();
