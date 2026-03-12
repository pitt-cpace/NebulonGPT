// Vosk Speech Recognition Service
import { ttsService } from './ttsService';
import { getWebSocketUrls } from './electronApi';

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
  private processor: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private isRecording = false;
  private isMuted = false; // Mute state for microphone
  private currentModel: string | null = null;
  private availableModels: string[] = [];
  private isSelectingModel = false; // Flag to prevent race conditions
  private isReconnecting = false;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 500; // Start with 500ms
  private maxReconnectDelay = 5000; // Max 5 seconds
  private reconnectTimer: number | null = null;
  private wasRecordingBeforeDisconnect = false;
  
  
  // Silence detection for auto-stop
  private silenceDetectionEnabled = true;
  private silenceTimeoutNormal = 2500; // 2 seconds of silence before auto-stop in normal mode
  private silenceTimeoutFullVoice = 1500; // 1.5 seconds of silence before auto-stop in full voice mode
  private lastAudioTime = 0;
  private silenceTimer: number | null = null;
  private accumulatedSilenceTime = 0; // Variable to accumulate silence time
  private pendingText = ''; // Store text that should be sent after silence timeout
  
  // TTS resume timeout promise
  private ttsResumeTimeout: Promise<void> | null = null;
  
  // Voice detection threshold to reduce background noise sensitivity
  private voiceDetectionEnabled = true;
  private voiceDetectionThreshold = -1.0; // Root Mean Square (RMS) audio level -1.0 to 1.0 (-1.0 = default sensitivity 100 means height sensitivity) - Audio below this won't be sent to Vosk server
  
  // Real-time audio level tracking for waveform visualization
  private currentAudioLevel = 0;
  private audioLevelCallbacks: ((level: number) => void)[] = [];
  
  // Event callbacks
  private onResultCallback: ((result: VoskResult) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;
  private onEndCallback: (() => void) | null = null;
  private onModelsCallback: ((models: string[]) => void) | null = null;
  private onModelLoadedCallback: ((event: VoskModelLoadedEvent) => void) | null = null;

  constructor() {
    // Initialize with default settings and load from localStorage
    this.loadSettings();
  }

  /**
   * Get default Vosk URL based on current window location
   */
  private getDefaultVoskUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    const port = window.location.port;
    
    // Use current port if available, otherwise default to 3000
    const targetPort = port || '3000';
    
    const url = `${protocol}//${host}:${targetPort}/vosk`;
    // console.log(`🔗 Vosk Service auto-detected URL: ${url}`);
    return url;
  }

  private async initializeWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Use environment-aware WebSocket URL detection
        const { vosk: voskServerUrl } = getWebSocketUrls();
        this.socket = new WebSocket(voskServerUrl);
        
        this.socket.onopen = () => {
          // console.log('✅ WebSocket connected to Vosk server');
          
          // If we had a model selected before, reselect it after reconnection
          // But only if we're not currently in the middle of selecting a different model
          if (this.currentModel && !this.isSelectingModel) {
            // console.log(`🔄 Reselecting model after reconnection: ${this.currentModel}`);
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
                  // console.log(`📤 Sent automatic model reselection request: ${this.currentModel}`);
                } catch (error) {
                  console.error(`❌ Failed to send automatic reselection: ${error}`);
                }
              } else {
                // console.log('⏭️ Skipping automatic model reselection - manual selection in progress');
              }
            }, 100);
          } else if (!this.currentModel && !this.isSelectingModel) {
            // No model selected yet, check server first before auto-selecting
            // console.log('🔍 No local model, checking server for existing model...');
            setTimeout(async () => {
              try {
                // First check if server already has a model loaded
                const serverModel = await this.getServerCurrentModel();
                if (serverModel && serverModel !== 'none') {
                  // console.log(`✅ Server already has model loaded: ${serverModel}`);
                  this.currentModel = serverModel;
                  return; // Don't load a new model
                }
                
                // Server has no model, wait for manual selection
                // console.log('🔍 Server has no model, waiting for manual model selection...');
                // IMPORTANT: Don't auto-load any model - let VoskModelSelector handle this
              } catch (error) {
                console.error('❌ Failed to check server model:', error);
              }
            }, 500);
          }
          
          resolve();
        };

        this.socket.onerror = (error) => {
          console.error('WebSocket error:', error);
          reject(new Error('WebSocket connection failed'));
        };

        this.socket.onclose = (event) => {
          
          // Check if this was an abnormal closure or connection issue that needs reconnection
          // 1006: Abnormal closure, 1001: Going away, 1011: Server error/timeout, 1000: Normal closure but we want to reconnect
          if (event.code === 1006 || event.code === 1001 || event.code === 1011 || event.code === 1000) {
            
            // Remember if we were recording before disconnect
            this.wasRecordingBeforeDisconnect = this.isRecording;
            
            // Clean up current socket
            this.socket = null;
            
            // Start reconnection process
            this.attemptReconnection();
          } else {
            this.socket = null;
          }
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
                break;
                
              case 'model_loaded':
                this.currentModel = msg.model;
                
                // Trigger automatic language detection for TTS
                const languageResult = ttsService.autoDetectLanguageFromVoskModel(msg.model);
                if (languageResult.message) {
                }
                
                if (this.onModelLoadedCallback) {
                  this.onModelLoadedCallback({ model: msg.model });
                }
                break;
                
              case 'result':
                if (this.onResultCallback) {
                  // Filter out single meaningless words
                  const filteredText = this.filterMeaninglessWords(msg.text);
                  if (filteredText) {
                    // In full voice mode AND mic is listening, don't send the text immediately
                    // Store it and let the silence timeout handle sending it
                    const ttsSettings = ttsService.getSettings();
                    // console.log(`🔍 DEBUG: fullVoiceMode=${ttsSettings.fullVoiceMode}, isRecording=${this.isRecording}, filteredText="${filteredText}"`);
                    if (ttsSettings.fullVoiceMode && this.isRecording) {
                      // Store the result but don't send it yet - wait for silence timeout
                      this.pendingText += (this.pendingText ? ' ' : '') + filteredText;
                      // console.log(`📝 Storing final result for silence timeout: "${filteredText}" (total pending: "${this.pendingText}")`);
                      // Don't call onResultCallback({ text: filteredText }) here
                    } else {
                      // Normal mode OR mic not listening: send immediately
                      // console.log(`🚨 SENDING IMMEDIATELY: fullVoiceMode=${ttsSettings.fullVoiceMode}, isRecording=${this.isRecording}`);
                      this.onResultCallback({ text: filteredText });
                    }
                  }
                }
                break;
                
              case 'partial':
                if (this.onResultCallback) {
                  // Filter out single meaningless words from partial results too
                  const filteredPartial = this.filterMeaninglessWords(msg.partial);
                  if (filteredPartial) {
                    // Check if we're in full voice mode
                    const ttsSettings = ttsService.getSettings();
                    if (ttsSettings.fullVoiceMode && this.isRecording) {
                      
                      if (this.pendingText.trim()) {
                        // Show accumulated pending text + current partial text in the animated display
                        const combinedPartial = this.pendingText.trim() + ' ' + filteredPartial;
                        this.onResultCallback({ partial: combinedPartial });
                      } else {
                        // No pending text yet, just show current partial
                        this.onResultCallback({ partial: filteredPartial });
                      }
                    } else {
                      // Normal mode: show just the current partial
                      this.onResultCallback({ partial: filteredPartial });
                    }
                  }
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
      

      this.audioContext = new AudioContext({
        sampleRate: 16000
      });

      // Resume audio context if suspended
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      this.source = this.audioContext.createMediaStreamSource(this.mediaStream);

      try {
        // Load the AudioWorklet processor with proper path handling for Electron
        const processorPath = window.location.protocol === 'file:' 
          ? './vosk-audio-processor.js'  // For Electron (file:// protocol)
          : '/vosk-audio-processor.js';   // For web browser
        
        await this.audioContext.audioWorklet.addModule(processorPath);
        
        this.processor = new AudioWorkletNode(this.audioContext, 'vosk-audio-processor');

        // Handle messages from the AudioWorklet processor
        this.processor.port.onmessage = (event) => {
          if (event.data.type === 'audioData' && this.isRecording) {
            // Check voice detection threshold before sending to Vosk
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
              if (this.shouldSendAudioToVosk(event.data.data)) {
                // Send to server only if above voice detection threshold
                this.socket.send(event.data.data);
              }
            }
          }
        };

        this.source.connect(this.processor);
        this.processor.connect(this.audioContext.destination);

      } catch (workletError) {
        console.warn('⚠️ AudioWorklet not supported, falling back to ScriptProcessorNode...');
        
        // Fallback to ScriptProcessorNode for older browsers
        const scriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
        
        scriptProcessor.onaudioprocess = (event) => {
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

        // Store as any to avoid type conflicts
        this.processor = scriptProcessor as any;
        
        this.source.connect(scriptProcessor);
        scriptProcessor.connect(this.audioContext.destination);

      }
    } catch (error) {
      console.error('❌ Audio initialization failed:', error);
      throw error;
    }
  }

  async start(): Promise<void> {
    
    if (this.isRecording) {
      return;
    }



    try {
      
      // Ensure WebSocket connection
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        await this.initializeWebSocket();
      } 
      await this.initializeAudio();

      // Send start message to AudioWorklet processor if it exists
      if (this.processor && 'port' in this.processor) {
        try {
          this.processor.port.postMessage({ type: 'start' });
        } catch (error) {
          console.warn('⚠️ Could not send start message to AudioWorklet processor:', error);
        }
      }

      this.isRecording = true;
      
      // Clear any pending text from previous sessions
      this.pendingText = '';
      
      // Initialize silence detection
      this.lastAudioTime = Date.now();
      this.clearSilenceTimer();
      
      // Start silence timer continuously when Vosk starts
      this.startSilenceTimer();


    } catch (error) {
      console.error('❌ Failed to start Vosk recognition:', error);
      this.isRecording = false;
      throw error;
    }
  }

  async stop(): Promise<void> {
    
    if (!this.isRecording) {
      return;
    }


    this.isRecording = false;
    this.wasRecordingBeforeDisconnect = false; // Clear the flag since this is manual stop
    
    // Clear silence detection timer
    this.clearSilenceTimer();

    try {
      // Send EOF signal to server but keep connection open
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ eof: 1 }));
      } else {
      }

      await this.cleanupAudioOnly();

    } catch (error) {
      console.error('❌ Error during stop:', error);
      throw error;
    }
  }

  // Method to completely disconnect and stop all reconnection attempts
  async disconnect(): Promise<void> {
    
    // Stop any ongoing reconnection attempts
    this.stopReconnection();
    
    // Clear recording state
    this.isRecording = false;
    this.wasRecordingBeforeDisconnect = false;
    
    try {
      // Clean up audio resources
      await this.cleanupAudioOnly();
      
      // Close WebSocket connection
      if (this.socket) {
        if (this.socket.readyState === WebSocket.OPEN) {
          this.socket.close(1000, 'Manual disconnect');
        }
        this.socket = null;
      }
      
    } catch (error) {
      console.error('❌ Error during disconnect:', error);
      throw error;
    }
  }

  private async cleanupAudioOnly(): Promise<void> {
    
    try {
      // Send stop message to AudioWorklet processor if it exists
      if (this.processor && 'port' in this.processor) {
        try {
          this.processor.port.postMessage({ type: 'stop' });
        } catch (error) {
          console.warn('⚠️ Could not send stop message to AudioWorklet processor:', error);
        }
      }

      // Disconnect and clean up audio nodes
      if (this.processor) {
        // Handle both AudioWorkletNode and ScriptProcessorNode
        if ('onaudioprocess' in this.processor) {
          // This is a ScriptProcessorNode (fallback)
          (this.processor as any).onaudioprocess = null;
        }
        
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

    } catch (error) {
      console.error('❌ Error during audio cleanup:', error);
    }
  }

  private async cleanup(): Promise<void> {
    
    try {
      // Send stop message to AudioWorklet processor if it exists
      if (this.processor && 'port' in this.processor) {
        try {
          this.processor.port.postMessage({ type: 'stop' });
        } catch (error) {
          console.warn('⚠️ Could not send stop message to AudioWorklet processor:', error);
        }
      }

      // Disconnect and clean up audio nodes
      if (this.processor) {
        // Handle both AudioWorkletNode and ScriptProcessorNode
        if ('onaudioprocess' in this.processor) {
          // This is a ScriptProcessorNode (fallback)
          (this.processor as any).onaudioprocess = null;
        }
        
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

  // Automatic reconnection logic
  private attemptReconnection(): void {
    if (this.isReconnecting) {
      console.log('🔄 Reconnection already in progress, skipping...');
      return;
    }

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log('❌ Max reconnection attempts reached, giving up');
      this.isReconnecting = false;
      this.reconnectAttempts = 0;
      if (this.onErrorCallback) {
        this.onErrorCallback('Connection lost and max reconnection attempts reached');
      }
      return;
    }

    this.isReconnecting = true;
    this.reconnectAttempts++;

    // Calculate delay with exponential backoff
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), this.maxReconnectDelay);
    

    this.reconnectTimer = window.setTimeout(async () => {
      try {
        
        // Try to reconnect
        await this.initializeWebSocket();
        
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        
        
        // If we were recording before disconnect, try to resume
        if (this.wasRecordingBeforeDisconnect && this.currentModel) {

          try {
            // Wait a bit for model to be reloaded and cached data to be sent
            setTimeout(async () => {
              // Double-check the flag hasn't been cleared by manual stop
              if (this.wasRecordingBeforeDisconnect) {
                try {
                  await this.start();
                } catch (error) {
                  console.error('❌ Failed to resume recording after reconnection:', error);
                }
              }
            }, 2000);
          } catch (error) {
            console.error('❌ Failed to resume recording after reconnection:', error);
          }
        }
        
      } catch (error) {
        console.error(`❌ Reconnection attempt ${this.reconnectAttempts} failed:`, error);
        
        // Try again if we haven't reached max attempts
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.isReconnecting = false; // Reset flag so we can try again
          this.attemptReconnection();
        } else {
          this.isReconnecting = false;
          this.reconnectAttempts = 0;
          if (this.onErrorCallback) {
            this.onErrorCallback('Connection lost and all reconnection attempts failed');
          }
        }
      }
    }, delay);
  }

  // Stop reconnection attempts
  private stopReconnection(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.isReconnecting = false;
    this.reconnectAttempts = 0;
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

  // Check if server has a model currently loaded
  async getServerCurrentModel(): Promise<string | null> {
    return new Promise(async (resolve, reject) => {
      try {
        // Ensure WebSocket connection before requesting current model
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
          console.log('🔌 WebSocket not connected for getServerCurrentModel, connecting...');
          await this.initializeWebSocket();
        }

        // Set up temporary message handler for current model response
        const originalOnMessage = this.socket!.onmessage;
        
        const timeoutId = setTimeout(() => {
          if (this.socket) {
            this.socket.onmessage = originalOnMessage; // Restore original handler
          }
          resolve(null); // No response means no model loaded
        }, 15000); // Increased from 3s to 15s for concurrent usage

        this.socket!.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            
            if (msg.type === 'current_model') {
              clearTimeout(timeoutId);
              this.socket!.onmessage = originalOnMessage; // Restore original handler
              
              if (msg.model && msg.model !== 'none') {
                this.currentModel = msg.model; // Update our local state
                resolve(msg.model);
              } else {
                resolve(null);
              }
              return;
            }
            
            // For other messages, call the original handler
            if (originalOnMessage && this.socket) {
              originalOnMessage.call(this.socket, event);
            }
          } catch (error) {
            console.error('Error parsing server response for current model:', error);
            // Continue with original handler for non-JSON messages
            if (originalOnMessage && this.socket) {
              originalOnMessage.call(this.socket, event);
            }
          }
        };

        // Request current model from server
        this.socket!.send(JSON.stringify({ type: 'get_current_model' }));

      } catch (error) {
        reject(error);
      }
    });
  }

  // Model management methods
  async getAvailableModels(): Promise<string[]> {
    return new Promise(async (resolve, reject) => {
      try {
        // Ensure WebSocket connection before requesting models
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
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

        // Set timeout for the request - increased for concurrent usage
        setTimeout(() => {
          this.onModelsCallback = originalCallback; // Restore original callback
          reject(new Error('Timeout waiting for models list'));
        }, 15000); // Increased to 15s for heavy concurrent usage
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

        // Ensure WebSocket connection before selecting model
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
          await this.initializeWebSocket();
        }

        // Set up temporary callback for model loaded response
        const originalCallback = this.onModelLoadedCallback;
        this.onModelLoadedCallback = (event: VoskModelLoadedEvent) => {
          this.onModelLoadedCallback = originalCallback; // Restore original callback
          if (event.model === modelName) {
            this.isSelectingModel = false; // Clear flag on success
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

  isReconnectingNow(): boolean {
    return this.isReconnecting;
  }

  getConnectionStatus(): string {
    if (this.isReconnecting) return 'reconnecting';
    if (!this.socket) return 'disconnected';
    
    switch (this.socket.readyState) {
      case WebSocket.CONNECTING: return 'connecting';
      case WebSocket.OPEN: return 'connected';
      case WebSocket.CLOSING: return 'closing';
      case WebSocket.CLOSED: return 'disconnected';
      default: return 'unknown';
    }
  }

  // Centralized method to check model availability with retry logic for concurrent usage
  async checkModelAvailability(): Promise<{ hasModels: boolean; errorMessage?: string }> {
    const maxRetries = 10;
    let lastError: any = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        
        // Try to get available models with retry logic
        const models = await this.getAvailableModelsWithRetry();
        
        if (models.length === 0) {
          return {
            hasModels: false,
            errorMessage: 'No speech recognition models found. Please download models from https://alphacephei.com/vosk/models and unzip them into the "Vosk-Server/websocket/models" folder.'
          };
        }
        
        return { hasModels: true };
        
      } catch (error) {
        lastError = error;
        
        if (attempt < maxRetries) {
          // Exponential backoff: wait longer between retries when server is busy
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // 1s, 2s, 4s max
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // All retries failed
    console.error(`❌ Model availability check failed after ${maxRetries} attempts:`, lastError);
    return {
      hasModels: false,
      errorMessage: 'Vosk server is busy or not available. Please wait a moment and try again.'
    };
  }

  // Enhanced getAvailableModels with better concurrent usage handling
  private async getAvailableModelsWithRetry(): Promise<string[]> {
    return new Promise(async (resolve, reject) => {
      try {
        // Ensure WebSocket connection with retry logic
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
          await this.initializeWebSocket();
        }

        // Set up temporary callback for models response
        const originalCallback = this.onModelsCallback;
        let responseReceived = false;
        
        this.onModelsCallback = (models: string[]) => {
          if (!responseReceived) {
            responseReceived = true;
            this.onModelsCallback = originalCallback; // Restore original callback
            resolve(models);
          }
        };

        // Request available models
        this.socket!.send(JSON.stringify({ type: 'get_models' }));

        // Set timeout for the request - longer timeout for concurrent usage
        setTimeout(() => {
          if (!responseReceived) {
            responseReceived = true;
            this.onModelsCallback = originalCallback; // Restore original callback
            reject(new Error('Timeout waiting for models list - server may be busy'));
          }
        }, 30000); // Increased to 30s for heavy concurrent usage
        
      } catch (error) {
        reject(error);
      }
    });
  }


  // ========================================
  // TEXT FILTERING METHODS
  // ========================================

  /**
   * Filter out single meaningless words that are not useful on their own
   */
  private filterMeaninglessWords(text: string): string {
    if (!text || typeof text !== 'string') {
      return '';
    }

    // Clean and normalize the text
    const cleanedText = text.trim().toLowerCase();
    
    // If it's empty after cleaning, return empty
    if (!cleanedText) {
      return '';
    }

    // List of single words that are meaningless on their own
    const meaninglessWords = [
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
      'will', 'would', 'could', 'should', 'may', 'might', 'can', 'must', 'shall',
      'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
      'my', 'your', 'his', 'her', 'its', 'our', 'their', 'mine', 'yours', 'ours', 'theirs',
      'this', 'that', 'these', 'those', 'here', 'there', 'where', 'when', 'why', 'how',
      'up', 'down', 'out', 'off', 'over', 'under', 'again', 'further', 'then', 'once',
      'so', 'than', 'too', 'very', 'just', 'now', 'only', 'also', 'back', 'still', 'well',
      'oh', 'ah', 'um', 'uh', 'hmm', 'huh', 'yeah', 'yes', 'no', 'ok', 'okay'
    ];

    // Split into words and check if it's a single meaningless word
    const words = cleanedText.split(/\s+/).filter(word => word.length > 0);
    
    // If it's a single word and it's in our meaningless list, filter it out
    if (words.length === 1 && meaninglessWords.includes(words[0])) {
      //console.log(`🚫 Filtered out meaningless single word: "${text}"`);
      return '';
    }

    // Audio detected - reset silence timer
    this.accumulatedSilenceTime = Date.now();

    return text;
  }

  // ========================================
  // SILENCE DETECTION METHODS
  // ========================================

  /**
   * Get the appropriate silence timeout based on Full Voice Mode setting
   */
  private get silenceTimeout(): number {
    const ttsSettings = ttsService.getSettings();
    return ttsSettings.fullVoiceMode ? this.silenceTimeoutFullVoice : this.silenceTimeoutNormal;
  }


  /**
   * Start silence timer for auto-stop
   */
  private startSilenceTimer(): void {
    if (this.silenceTimer) {
      console.log(`Timer already running`);
      return; // Timer already running
    }

    // Reset accumulated silence time when starting timer
    this.accumulatedSilenceTime = Date.now();

    this.silenceTimer = window.setInterval(async () => {
      if (this.isRecording && this.silenceDetectionEnabled) {
      
       const currentTime = Date.now();
       const base = this.accumulatedSilenceTime;
       const elapsedTime = currentTime - base;

        if (elapsedTime >= this.silenceTimeout) {
          const ttsSettings = ttsService.getSettings();
          const isFullVoiceMode = ttsSettings.fullVoiceMode;
          
          if (isFullVoiceMode) {
            
            // Send any pending text that was accumulated during speech recognition
            if (this.onResultCallback && this.pendingText.trim()) {
              // console.log(`📤 Sending accumulated pending text: "${this.pendingText}"`);
              this.onResultCallback({ text: this.pendingText.trim() });
              this.pendingText = ''; // Clear pending text after sending
              
              // Reset accumulated silence time when starting timer
              this.accumulatedSilenceTime = Date.now();
              return;
            }
            

            
            // Do NOT call onEndCallback if there's text in chat box OR if there's pending text to be added
            if (this.onEndCallback) {
              
              // Flush any partial text to the chatbox before ending
              if (this.onResultCallback) {
                // Create a fake final result to flush partial text
                this.onResultCallback({ text: '' });
              }
              
              this.onEndCallback();
            }
            this.lastAudioTime = Date.now();
          } else {
            //console.log(`🔇 ${this.silenceTimeout}ms of silence detected - auto-stopping microphone`);
            try {
              await this.stop();
              
              if (this.onEndCallback) {
                this.onEndCallback();
              }
            } catch (error) {
              console.error('❌ Error auto-stopping due to silence:', error);
            }
          }
          this.clearSilenceTimer();
        }
      }
    }, 50);
  }

  /**
   * Clear silence timer
   */
  public clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearInterval(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  // ========================================
  // VOICE DETECTION METHODS
  // ========================================

  /**
   * Check if audio should be sent to Vosk based on voice detection threshold
   */
  private shouldSendAudioToVosk(audioData: ArrayBuffer): boolean {
    if (!this.voiceDetectionEnabled) {
      return true; // Always send if voice detection is disabled
    }

    try {
      // Convert ArrayBuffer to Float32Array for analysis
      const int16Array = new Int16Array(audioData);
      
      // Convert int16 to float32 and calculate RMS (Root Mean Square) for audio level
      let sum = 0;
      for (let i = 0; i < int16Array.length; i++) {
        const sample = int16Array[i] / 32768.0; // Convert to -1.0 to 1.0 range
        sum += sample * sample;
      }
      
      const rms = Math.sqrt(sum / int16Array.length);
      
      // Update current audio level for waveform visualization
      this.currentAudioLevel = rms;
      
      // Notify all audio level callbacks with the real audio level
      this.audioLevelCallbacks.forEach(callback => {
        try {
          callback(rms);
        } catch (error) {
          console.error('❌ Error in audio level callback:', error);
        }
      });
      
      // Only send to Vosk if audio level is above voice detection threshold
      const shouldSend = rms > this.voiceDetectionThreshold;

      // Silence detected - check if we should start/continue silence timer
      const silenceDuration = Date.now() - this.lastAudioTime;
      
      if (silenceDuration > 500 && !this.silenceTimer) { // Wait 500ms before starting silence timer
        this.startSilenceTimer();
      }
      
      return shouldSend;
      
    } catch (error) {
      console.error('❌ Error processing audio for voice detection:', error);
      return true; // Send anyway if there's an error
    }
  }

  // ========================================
  // SETTINGS MANAGEMENT METHODS
  // ========================================

  /**
   * Get all Vosk settings
   */
  public getSettings(): {
    voiceDetectionThreshold: number;
    silenceDetectionEnabled: boolean;
    voiceDetectionEnabled: boolean;
    silenceTimeout: number;
    detectionSensitivity: number;
  } {
    return {
      voiceDetectionThreshold: this.voiceDetectionThreshold,
      silenceDetectionEnabled: this.silenceDetectionEnabled,
      voiceDetectionEnabled: this.voiceDetectionEnabled,
      silenceTimeout: this.silenceTimeout,
      detectionSensitivity: this.getDetectionSensitivity(),
    };
  }

  /**
   * Update Vosk settings
   */
  public updateSettings(settings: {
    voiceDetectionThreshold?: number;
    silenceDetectionEnabled?: boolean;
    voiceDetectionEnabled?: boolean;
    silenceTimeout?: number;
    detectionSensitivity?: number;
  }): void {
    if (settings.detectionSensitivity !== undefined) {
      this.setDetectionSensitivity(settings.detectionSensitivity);
    }
    
    if (settings.voiceDetectionThreshold !== undefined) {
      // Updated to support new -1 to 1 range
      this.voiceDetectionThreshold = Math.max(-1, Math.min(1, settings.voiceDetectionThreshold));
    }
    
    if (settings.silenceDetectionEnabled !== undefined) {
      this.setSilenceDetectionEnabled(settings.silenceDetectionEnabled);
    }
    
    if (settings.voiceDetectionEnabled !== undefined) {
      this.setVoiceDetectionEnabled(settings.voiceDetectionEnabled);
    }
  }

  /**
   * Save settings to localStorage
   */
  public saveSettings(): void {
    try {
      const settings = this.getSettings();
      localStorage.setItem('nebulongpt_vosk_settings', JSON.stringify(settings));
    } catch (error) {
      console.error('❌ Failed to save Vosk settings:', error);
    }
  }

  /**
   * Load settings from localStorage
   */
  public loadSettings(): void {
    try {
      const savedSettings = localStorage.getItem('nebulongpt_vosk_settings');
      if (savedSettings) {
        const settings = JSON.parse(savedSettings);
        this.updateSettings(settings);
      }
    } catch (error) {
      console.error('❌ Failed to load Vosk settings:', error);
    }
  }

  /**
   * Enable or disable silence detection
   */
  public setSilenceDetectionEnabled(enabled: boolean): void {
    this.silenceDetectionEnabled = enabled;
    if (!enabled) {
      this.clearSilenceTimer();
    }
  }

  /**
   * Get current silence detection status
   */
  public getSilenceDetectionStatus(): {
    enabled: boolean;
    threshold: number;
    timeout: number;
    currentLevel: number;
    silenceDuration: number;
    isTimerActive: boolean;
  } {
    const silenceDuration = Date.now() - this.lastAudioTime;
    
    return {
      enabled: this.silenceDetectionEnabled,
      threshold: this.voiceDetectionThreshold,
      timeout: this.silenceTimeout,
      currentLevel: 0, // No longer tracking current level without caching
      silenceDuration: silenceDuration,
      isTimerActive: this.silenceTimer !== null,
    };
  }

  /**
   * Enable or disable voice detection threshold
   */
  public setVoiceDetectionEnabled(enabled: boolean): void {
    this.voiceDetectionEnabled = enabled;
  }

  /**
   * Set voice detection threshold (higher = less sensitive to background noise)
   */
  public setVoiceDetectionThreshold(threshold: number): void {
    // Clamp between -1 and 1 to match new sensitivity range
    this.voiceDetectionThreshold = Math.max(-1, Math.min(1, threshold));
  }

  /**
   * Get current voice detection settings
   */
  public getVoiceDetectionStatus(): {
    enabled: boolean;
    threshold: number;
  } {
    return {
      enabled: this.voiceDetectionEnabled,
      threshold: this.voiceDetectionThreshold,
    };
  }

  // ========================================
  // DETECTION SENSITIVITY METHODS
  // ========================================

  /**
   * Set detection sensitivity (0-100 range)
   * INVERSE mapping to voiceDetectionThreshold from -1 to 1:
   * - Sensitivity 100 → threshold = -1.0 (maximum sensitivity, picks up all sounds)
   * - Sensitivity 0 → threshold = 1.0 (minimum sensitivity, filters out most noise)
   */
  public setDetectionSensitivity(sensitivity: number): void {
    // Clamp sensitivity between 0 and 100
    const clampedSensitivity = Math.max(0, Math.min(100, sensitivity));
    
    // INVERSE mapping: sensitivity 100 → threshold -1.0, sensitivity 0 → threshold 1.0
    // Formula: threshold = (100 - 2*sensitivity) / 100
    const newVoiceDetectionThreshold = (100 - 2 * clampedSensitivity) / 100;
    
    // Update the threshold
    this.voiceDetectionThreshold = newVoiceDetectionThreshold;
    
    //console.log(`🎚️ Detection Sensitivity: ${clampedSensitivity}, Threshold: ${newVoiceDetectionThreshold.toFixed(2)}`);
  }

  /**
   * Get current detection sensitivity (0-100 range)
   * Calculated from current voiceDetectionThreshold with INVERSE relationship
   */
  public getDetectionSensitivity(): number {
    // INVERSE mapping: threshold -1.0 to 1.0 to sensitivity 100-0
    // Formula: sensitivity = 50 - (threshold * 50)
    return Math.round(50 - (this.voiceDetectionThreshold * 50));
  }

  /**
   * Get detection sensitivity settings including current values and ranges
   */
  public getDetectionSensitivityStatus(): {
    sensitivity: number;
    voiceDetectionThreshold: number;
    minSensitivity: number;
    maxSensitivity: number;
  } {
    return {
      sensitivity: this.getDetectionSensitivity(),
      voiceDetectionThreshold: this.voiceDetectionThreshold,
      minSensitivity: 0,
      maxSensitivity: 100,
    };
  }

  // ========================================
  // REAL-TIME AUDIO LEVEL METHODS
  // ========================================

  /**
   * Register a callback to receive real-time audio levels
   */
  public onAudioLevel(callback: (level: number) => void): void {
    this.audioLevelCallbacks.push(callback);
  }

  /**
   * Remove an audio level callback
   */
  public offAudioLevel(callback: (level: number) => void): void {
    const index = this.audioLevelCallbacks.indexOf(callback);
    if (index > -1) {
      this.audioLevelCallbacks.splice(index, 1);
    }
  }

  /**
   * Get the current audio level (0.0 to 1.0)
   */
  public getCurrentAudioLevel(): number {
    return this.currentAudioLevel;
  }

  /**
   * Clear all audio level callbacks
   */
  public clearAudioLevelCallbacks(): void {
    this.audioLevelCallbacks = [];
  }

  // ========================================
  // MICROPHONE MUTE/UNMUTE METHODS
  // ========================================

  /**
   * Mute the microphone (disable audio track)
   * This actually mutes the audio stream, not just filtering
   */
  public mute(): void {
    if (this.mediaStream) {
      this.mediaStream.getAudioTracks().forEach(track => {
        track.enabled = false;
      });
      this.isMuted = true;
      console.log('🔇 Microphone muted');
    }
  }

  /**
   * Unmute the microphone (enable audio track)
   */
  public unmute(): void {
    if (this.mediaStream) {
      this.mediaStream.getAudioTracks().forEach(track => {
        track.enabled = true;
      });
      this.isMuted = false;
      console.log('🔊 Microphone unmuted');
    }
  }

  /**
   * Toggle mute state
   */
  public toggleMute(): boolean {
    if (this.isMuted) {
      this.unmute();
    } else {
      this.mute();
    }
    return this.isMuted;
  }

  /**
   * Check if microphone is currently muted
   */
  public isMicMuted(): boolean {
    return this.isMuted;
  }
}

// Export singleton instance
export const voskRecognition = new VoskRecognitionService();
