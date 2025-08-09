// Vosk Speech Recognition Service
import { ttsService } from './ttsService';

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
  private silenceThreshold = 0.30; // Root Mean Square (RMS) audio level 0.0-1.0 (0.05 = 5% of max volume, roughly normal conversation ~65-70dB equivalent) - Audio below this is considered silence
  private silenceTimeout = 2000; // 1.5 seconds of silence before auto-stop
  private lastAudioTime = 0;
  private silenceTimer: number | null = null;
  
  // Voice detection threshold to reduce background noise sensitivity
  private voiceDetectionEnabled = true;
  private voiceDetectionThreshold = 0.0015; // Root Mean Square (RMS) audio level 0.0-1.0 (0.0015 = 0.15% of max volume, roughly quiet room noise ~30-40dB equivalent) - Audio below this won't be sent to Vosk server
  
  // Event callbacks
  private onResultCallback: ((result: VoskResult) => void) | null = null;
  private onErrorCallback: ((error: string) => void) | null = null;
  private onEndCallback: (() => void) | null = null;
  private onModelsCallback: ((models: string[]) => void) | null = null;
  private onModelLoadedCallback: ((event: VoskModelLoadedEvent) => void) | null = null;

  constructor() {
    // Initialize with default settings
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
    console.log(`🔗 Vosk Service auto-detected URL: ${url}`);
    return url;
  }

  private async initializeWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Use environment variable for Docker or detect current port dynamically
        const voskServerUrl = (window as any).REACT_APP_VOSK_SERVER_URL || this.getDefaultVoskUrl();
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
            // No model selected yet, check server first before auto-selecting
            console.log('🔍 No local model, checking server for existing model...');
            setTimeout(async () => {
              try {
                // First check if server already has a model loaded
                const serverModel = await this.getServerCurrentModel();
                if (serverModel && serverModel !== 'none') {
                  console.log(`✅ Server already has model loaded: ${serverModel}`);
                  this.currentModel = serverModel;
                  return; // Don't load a new model
                }
                
                // Server has no model, wait for manual selection
                console.log('🔍 Server has no model, waiting for manual model selection...');
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
          console.log(`🔌 WebSocket connection closed - Code: ${event.code}, Reason: ${event.reason}`);
          
          // Check if this was an abnormal closure or connection issue that needs reconnection
          // 1006: Abnormal closure, 1001: Going away, 1011: Server error/timeout, 1000: Normal closure but we want to reconnect
          if (event.code === 1006 || event.code === 1001 || event.code === 1011 || event.code === 1000) {
            console.log('🔄 Connection lost, attempting automatic reconnection...');
            
            // Remember if we were recording before disconnect
            this.wasRecordingBeforeDisconnect = this.isRecording;
            
            // Clean up current socket
            this.socket = null;
            
            // Start reconnection process
            this.attemptReconnection();
          } else {
            console.log('🛑 WebSocket closed normally, no reconnection needed');
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
                console.log(`🔄 Model loading: ${msg.model} - ${msg.message}`);
                break;
                
              case 'model_loaded':
                console.log(`✅ Model loaded: ${msg.model}`);
                this.currentModel = msg.model;
                
                // Trigger automatic language detection for TTS
                const languageResult = ttsService.autoDetectLanguageFromVoskModel(msg.model);
                if (languageResult.message) {
                  console.log(`🌐 ${languageResult.message}`);
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
                    this.onResultCallback({ text: filteredText });
                  }
                }
                break;
                
              case 'partial':
                if (this.onResultCallback) {
                  // Filter out single meaningless words from partial results too
                  const filteredPartial = this.filterMeaninglessWords(msg.partial);
                  if (filteredPartial) {
                    this.onResultCallback({ partial: filteredPartial });
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

      console.log('⚙️ Loading AudioWorklet processor...');
      try {
        // Load the AudioWorklet processor
        await this.audioContext.audioWorklet.addModule('/vosk-audio-processor.js');
        
        console.log('⚙️ Creating AudioWorklet node...');
        this.processor = new AudioWorkletNode(this.audioContext, 'vosk-audio-processor');

        // Handle messages from the AudioWorklet processor with silence detection
        this.processor.port.onmessage = (event) => {
          if (event.data.type === 'audioData' && this.isRecording) {
            // Process audio data for silence detection
            if (this.silenceDetectionEnabled) {
              this.processAudioForSilenceDetection(event.data.data);
            }
            
            // Check voice detection threshold before sending to Vosk
            if (this.socket && this.socket.readyState === WebSocket.OPEN) {
              if (this.shouldSendAudioToVosk(event.data.data)) {
                // Send to server only if above voice detection threshold
                this.socket.send(event.data.data);
              }
            }
          }
        };

        console.log('🔗 Connecting audio nodes...');
        this.source.connect(this.processor);
        this.processor.connect(this.audioContext.destination);

        console.log('✅ Audio initialization complete');
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
        
        console.log('🔗 Connecting audio nodes (fallback)...');
        this.source.connect(scriptProcessor);
        scriptProcessor.connect(this.audioContext.destination);

        console.log('✅ Audio initialization complete (using fallback)');
      }
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

      // Send start message to AudioWorklet processor if it exists
      if (this.processor && 'port' in this.processor) {
        try {
          this.processor.port.postMessage({ type: 'start' });
          console.log('📤 Sent start message to AudioWorklet processor');
        } catch (error) {
          console.warn('⚠️ Could not send start message to AudioWorklet processor:', error);
        }
      }

      this.isRecording = true;
      
      // Initialize silence detection
      this.lastAudioTime = Date.now();
      this.clearSilenceTimer();
      console.log(`🔇 Silence detection initialized - enabled: ${this.silenceDetectionEnabled}, timeout: ${this.silenceTimeout}ms`);
      
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
    this.wasRecordingBeforeDisconnect = false; // Clear the flag since this is manual stop
    
    // Clear silence detection timer
    this.clearSilenceTimer();
    console.log('🔇 Silence detection timer cleared');
    
    console.log('🛑 Vosk speech recognition stopped - isRecording set to false');
    console.log('🛑 wasRecordingBeforeDisconnect cleared to prevent auto-resume');

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

  // Method to completely disconnect and stop all reconnection attempts
  async disconnect(): Promise<void> {
    console.log('🔌 DISCONNECT METHOD CALLED - stopping all connections and reconnection attempts');
    
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
          console.log('📤 Sending close signal to server...');
          this.socket.close(1000, 'Manual disconnect');
        }
        this.socket = null;
      }
      
      console.log('✅ Complete disconnection successful');
    } catch (error) {
      console.error('❌ Error during disconnect:', error);
      throw error;
    }
  }

  private async cleanupAudioOnly(): Promise<void> {
    console.log('🧹 Cleaning up audio resources only (keeping WebSocket)...');
    
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

      console.log('✅ Audio cleanup complete - WebSocket connection preserved');
    } catch (error) {
      console.error('❌ Error during audio cleanup:', error);
    }
  }

  private async cleanup(): Promise<void> {
    console.log('🧹 Completely destroying all audio resources...');
    
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
    
    console.log(`🔄 Attempting reconnection ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms...`);

    this.reconnectTimer = window.setTimeout(async () => {
      try {
        console.log(`🔌 Reconnection attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
        
        // Try to reconnect
        await this.initializeWebSocket();
        
        console.log('✅ Reconnection successful!');
        this.isReconnecting = false;
        this.reconnectAttempts = 0;
        
        
        // If we were recording before disconnect, try to resume
        if (this.wasRecordingBeforeDisconnect && this.currentModel) {
          console.log('🎙️ Attempting to resume recording after reconnection...');
          console.log('🔍 wasRecordingBeforeDisconnect:', this.wasRecordingBeforeDisconnect);
          console.log('🔍 currentModel:', this.currentModel);
          try {
            // Wait a bit for model to be reloaded and cached data to be sent
            setTimeout(async () => {
              // Double-check the flag hasn't been cleared by manual stop
              if (this.wasRecordingBeforeDisconnect) {
                try {
                  await this.start();
                  console.log('✅ Recording resumed successfully after reconnection');
                } catch (error) {
                  console.error('❌ Failed to resume recording after reconnection:', error);
                }
              } else {
                console.log('🛑 wasRecordingBeforeDisconnect was cleared, skipping auto-resume');
              }
            }, 2000);
          } catch (error) {
            console.error('❌ Failed to resume recording after reconnection:', error);
          }
        } else {
          console.log('🔍 Not resuming recording - wasRecordingBeforeDisconnect:', this.wasRecordingBeforeDisconnect, 'currentModel:', this.currentModel);
        }
        
      } catch (error) {
        console.error(`❌ Reconnection attempt ${this.reconnectAttempts} failed:`, error);
        
        // Try again if we haven't reached max attempts
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.isReconnecting = false; // Reset flag so we can try again
          this.attemptReconnection();
        } else {
          console.log('❌ All reconnection attempts failed');
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
            console.log('📨 Received message from server:', msg);
            
            if (msg.type === 'current_model') {
              clearTimeout(timeoutId);
              this.socket!.onmessage = originalOnMessage; // Restore original handler
              
              console.log('✅ Received current_model response:', msg.model);
              if (msg.model && msg.model !== 'none') {
                console.log(`🔍 Server reports current model: ${msg.model}`);
                this.currentModel = msg.model; // Update our local state
                resolve(msg.model);
              } else {
                console.log('🔍 Server reports no model currently loaded');
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
            console.log('Raw event data:', event.data);
            // Continue with original handler for non-JSON messages
            if (originalOnMessage && this.socket) {
              originalOnMessage.call(this.socket, event);
            }
          }
        };

        // Request current model from server
        console.log('📤 Requesting current model from server...');
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
    const maxRetries = 3;
    let lastError: any = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`🔍 Checking model availability (attempt ${attempt}/${maxRetries})`);
        
        // Try to get available models with retry logic
        const models = await this.getAvailableModelsWithRetry();
        
        if (models.length === 0) {
          return {
            hasModels: false,
            errorMessage: 'No speech recognition models found. Please download models from https://alphacephei.com/vosk/models and unzip them into the "Vosk-Server/websocket/models" folder.'
          };
        }
        
        console.log(`✅ Model availability check successful: ${models.length} models found`);
        return { hasModels: true };
        
      } catch (error) {
        lastError = error;
        console.log(`⚠️ Model availability check failed (attempt ${attempt}/${maxRetries}):`, error);
        
        if (attempt < maxRetries) {
          // Exponential backoff: wait longer between retries when server is busy
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // 1s, 2s, 4s max
          console.log(`⏳ Waiting ${delay}ms before retry (server may be busy with other users)...`);
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
          console.log('🔌 WebSocket not connected for getAvailableModelsWithRetry, connecting...');
          await this.initializeWebSocket();
        }

        // Set up temporary callback for models response
        const originalCallback = this.onModelsCallback;
        let responseReceived = false;
        
        this.onModelsCallback = (models: string[]) => {
          if (!responseReceived) {
            responseReceived = true;
            this.onModelsCallback = originalCallback; // Restore original callback
            console.log(`📋 Received models list: ${models.length} models`);
            resolve(models);
          }
        };

        // Request available models
        console.log('📤 Requesting available models from server...');
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
      console.log(`🚫 Filtered out meaningless single word: "${text}"`);
      return '';
    }

    // If it's multiple words or a meaningful single word, keep the original text
    return text;
  }

  // ========================================
  // SILENCE DETECTION METHODS
  // ========================================

  /**
   * Process audio data for silence detection
   */
  private processAudioForSilenceDetection(audioData: ArrayBuffer): void {
    if (!this.silenceDetectionEnabled || !this.isRecording) {
      return;
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
      
      // Check if audio level is above silence threshold
      if (rms > this.silenceThreshold) {
        // Audio detected - reset silence timer
        this.lastAudioTime = Date.now();
        this.clearSilenceTimer();
        
        // Pause TTS if full voice mode is enabled and user starts speaking (above threshold)
        const ttsSettings = ttsService.getSettings();
        if (ttsSettings.fullVoiceMode) {
          ttsService.pause();
        }
        
        console.log(`🔊 Audio detected (level: ${rms.toFixed(4)}, threshold: ${this.silenceThreshold})`);
      } else {
        // Silence detected - check if we should start/continue silence timer
        const silenceDuration = Date.now() - this.lastAudioTime;
        
        // Resume TTS if full voice mode is enabled and user stops speaking (below threshold)
        const ttsSettings = ttsService.getSettings();
        if (ttsSettings.fullVoiceMode && silenceDuration > 200) { // Wait 200ms to avoid rapid pause/resume
          ttsService.resume();
        }
        
        if (silenceDuration > 500 && !this.silenceTimer) { // Wait 500ms before starting silence timer
          console.log(`🔇 Silence detected, starting ${this.silenceTimeout}ms timer...`);
          this.startSilenceTimer();
        }
      }
      
    } catch (error) {
      console.error('❌ Error processing audio for silence detection:', error);
    }
  }

  /**
   * Start silence timer for auto-stop
   */
  private startSilenceTimer(): void {
    if (this.silenceTimer) {
      return; // Timer already running
    }

    this.silenceTimer = window.setTimeout(async () => {
      if (this.isRecording && this.silenceDetectionEnabled) {
        // Check if full voice mode is enabled
        const ttsSettings = ttsService.getSettings();
        const isFullVoiceMode = ttsSettings.fullVoiceMode;
        
        if (isFullVoiceMode) {
          console.log(`🔇 ${this.silenceTimeout}ms of silence detected - full voice mode enabled, triggering onEnd but keeping microphone active`);
          
          // In full voice mode: trigger onEnd callback but don't stop the microphone
          if (this.onEndCallback) {
            this.onEndCallback();
          }
          
          // Reset silence timer for next detection cycle
          this.lastAudioTime = Date.now();
        } else {
          console.log(`🔇 ${this.silenceTimeout}ms of silence detected - auto-stopping microphone`);
          try {
            await this.stop();
            
            // Notify that recording ended due to silence
            if (this.onEndCallback) {
              this.onEndCallback();
            }
          } catch (error) {
            console.error('❌ Error auto-stopping due to silence:', error);
          }
        }
      }
      this.silenceTimer = null;
    }, this.silenceTimeout);
  }

  /**
   * Clear silence timer
   */
  private clearSilenceTimer(): void {
    if (this.silenceTimer) {
      clearTimeout(this.silenceTimer);
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
      
      // Only send to Vosk if audio level is above voice detection threshold
      const shouldSend = rms > this.voiceDetectionThreshold;
      
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
    silenceThreshold: number;
    voiceDetectionThreshold: number;
    silenceDetectionEnabled: boolean;
    voiceDetectionEnabled: boolean;
    silenceTimeout: number;
  } {
    return {
      silenceThreshold: this.silenceThreshold,
      voiceDetectionThreshold: this.voiceDetectionThreshold,
      silenceDetectionEnabled: this.silenceDetectionEnabled,
      voiceDetectionEnabled: this.voiceDetectionEnabled,
      silenceTimeout: this.silenceTimeout,
    };
  }

  /**
   * Update Vosk settings
   */
  public updateSettings(settings: {
    silenceThreshold?: number;
    voiceDetectionThreshold?: number;
    silenceDetectionEnabled?: boolean;
    voiceDetectionEnabled?: boolean;
    silenceTimeout?: number;
  }): void {
    if (settings.silenceThreshold !== undefined) {
      this.silenceThreshold = Math.max(0.001, Math.min(1.0, settings.silenceThreshold));
      console.log(`🔇 Silence threshold updated: ${this.silenceThreshold}`);
    }
    
    if (settings.voiceDetectionThreshold !== undefined) {
      this.voiceDetectionThreshold = Math.max(0, Math.min(0.05, settings.voiceDetectionThreshold));
      console.log(`🎤 Voice detection threshold updated: ${this.voiceDetectionThreshold}`);
    }
    
    if (settings.silenceDetectionEnabled !== undefined) {
      this.setSilenceDetectionEnabled(settings.silenceDetectionEnabled);
    }
    
    if (settings.voiceDetectionEnabled !== undefined) {
      this.setVoiceDetectionEnabled(settings.voiceDetectionEnabled);
    }
    
    if (settings.silenceTimeout !== undefined) {
      this.silenceTimeout = Math.max(500, Math.min(10000, settings.silenceTimeout));
      console.log(`🔇 Silence timeout updated: ${this.silenceTimeout}ms`);
    }
  }

  /**
   * Save settings to localStorage
   */
  public saveSettings(): void {
    try {
      const settings = this.getSettings();
      localStorage.setItem('nebulongpt_vosk_settings', JSON.stringify(settings));
      console.log('💾 Vosk settings saved to localStorage');
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
        console.log('📂 Vosk settings loaded from localStorage');
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
    console.log(`🔇 Silence detection ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Set silence detection parameters
   */
  public setSilenceDetectionParams(threshold: number, timeout: number): void {
    this.silenceThreshold = Math.max(0.001, Math.min(0.1, threshold)); // Clamp between 0.001 and 0.1
    this.silenceTimeout = Math.max(500, Math.min(10000, timeout)); // Clamp between 0.5s and 10s
    console.log(`🔇 Silence detection params updated - threshold: ${this.silenceThreshold}, timeout: ${this.silenceTimeout}ms`);
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
      threshold: this.silenceThreshold,
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
    console.log(`🎤 Voice detection threshold ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Set voice detection threshold (higher = less sensitive to background noise)
   */
  public setVoiceDetectionThreshold(threshold: number): void {
    this.voiceDetectionThreshold = Math.max(0.001, Math.min(0.5, threshold)); // Clamp between 0.001 and 0.5
    console.log(`🎤 Voice detection threshold updated: ${this.voiceDetectionThreshold} (higher = less sensitive to background noise)`);
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
}

// Export singleton instance
export const voskRecognition = new VoskRecognitionService();
