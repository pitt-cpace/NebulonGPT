export interface VoskRecognitionResult {
  text: string;
  partial: boolean;
  final: boolean;
}

export interface VoskServiceConfig {
  serverUrl?: string;
  sampleRate?: number;
  showWords?: boolean;
  maxAlternatives?: number;
}

export class VoskService {
  private webSocket: WebSocket | null = null;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: AudioWorkletNode | null = null;
  private isConnected = false;
  private isListening = false;
  private config: Required<VoskServiceConfig>;

  // Voice caching for connection recovery (2 seconds)
  private audioCache: Float32Array[] = [];
  private readonly CACHE_DURATION_MS = 2000; // 2 seconds
  private readonly CACHE_CHUNK_SIZE = 1024; // Audio chunk size
  private cacheMaxChunks: number = 0;
  private cacheIndex = 0;
  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 3;

  // Event handlers
  public onResult: ((result: VoskRecognitionResult) => void) | null = null;
  public onError: ((error: string) => void) | null = null;
  public onConnectionChange: ((connected: boolean) => void) | null = null;

  constructor(config: VoskServiceConfig = {}) {
    this.config = {
      serverUrl: config.serverUrl || 'ws://localhost:2700',
      sampleRate: config.sampleRate || 16000,
      showWords: config.showWords !== undefined ? config.showWords : true,
      maxAlternatives: config.maxAlternatives || 0,
    };
    
    // Initialize audio cache
    this.initializeAudioCache();
  }

  private initializeAudioCache(): void {
    // Calculate how many chunks we need for 10 seconds
    const chunksPerSecond = this.config.sampleRate / this.CACHE_CHUNK_SIZE;
    this.cacheMaxChunks = Math.ceil((this.CACHE_DURATION_MS / 1000) * chunksPerSecond);
    
    // Initialize circular buffer
    this.audioCache = new Array(this.cacheMaxChunks);
    for (let i = 0; i < this.cacheMaxChunks; i++) {
      this.audioCache[i] = new Float32Array(this.CACHE_CHUNK_SIZE);
    }
    
    console.log(`Audio cache initialized: ${this.cacheMaxChunks} chunks for ${this.CACHE_DURATION_MS}ms`);
  }

  private cacheAudioData(audioData: Float32Array): void {
    // Store audio data in circular buffer
    const chunk = this.audioCache[this.cacheIndex];
    const copyLength = Math.min(audioData.length, this.CACHE_CHUNK_SIZE);
    
    for (let i = 0; i < copyLength; i++) {
      chunk[i] = audioData[i];
    }
    
    // Move to next position in circular buffer
    this.cacheIndex = (this.cacheIndex + 1) % this.cacheMaxChunks;
  }

  private async attemptReconnection(): Promise<boolean> {
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.error('Max reconnection attempts reached');
      return false;
    }

    this.reconnectAttempts++;
    console.log(`Attempting reconnection ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS}`);

    try {
      await this.initWebSocket();
      
      // If reconnection successful, replay cached audio
      if (this.isConnected) {
        await this.replayCachedAudio();
        this.reconnectAttempts = 0; // Reset counter on successful reconnection
        return true;
      }
    } catch (error) {
      console.error('Reconnection failed:', error);
    }

    return false;
  }

  private async replayCachedAudio(): Promise<void> {
    if (!this.webSocket || this.webSocket.readyState !== WebSocket.OPEN) {
      return;
    }

    console.log('Replaying cached audio data...');
    
    // Send cached audio data in order (oldest first)
    for (let i = 0; i < this.cacheMaxChunks; i++) {
      const index = (this.cacheIndex + i) % this.cacheMaxChunks;
      const chunk = this.audioCache[index];
      
      // Convert Float32Array to the format expected by Vosk server
      const int16Array = new Int16Array(chunk.length);
      for (let j = 0; j < chunk.length; j++) {
        int16Array[j] = Math.max(-32768, Math.min(32767, chunk[j] * 32768));
      }
      
      // Send to server with a small delay to avoid overwhelming
      this.webSocket.send(int16Array.buffer);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    
    console.log('Cached audio replay completed');
  }

  public async initialize(): Promise<void> {
    try {
      // Initialize WebSocket connection
      await this.initWebSocket();
      
      // Initialize audio context
      this.audioContext = new AudioContext({ sampleRate: this.config.sampleRate });
      
      // Load the audio worklet processor
      await this.audioContext.audioWorklet.addModule('/data-conversion-processor.js');
      
      console.log('Vosk service initialized successfully');
    } catch (error) {
      const errorMessage = `Failed to initialize Vosk service: ${error}`;
      console.error(errorMessage);
      if (this.onError) {
        this.onError(errorMessage);
      }
      throw error;
    }
  }

  private async initWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.webSocket = new WebSocket(this.config.serverUrl);
        this.webSocket.binaryType = 'arraybuffer';

        this.webSocket.onopen = () => {
          console.log('Vosk WebSocket connection established');
          this.isConnected = true;
          if (this.onConnectionChange) {
            this.onConnectionChange(true);
          }
          
          // Send configuration to server
          const config = {
            config: {
              sample_rate: this.config.sampleRate,
              words: this.config.showWords,
              max_alternatives: this.config.maxAlternatives,
            }
          };
          this.webSocket?.send(JSON.stringify(config));
          resolve();
        };

        this.webSocket.onerror = (event) => {
          const errorMessage = 'Vosk WebSocket connection error';
          console.error(errorMessage, event);
          this.isConnected = false;
          if (this.onConnectionChange) {
            this.onConnectionChange(false);
          }
          if (this.onError) {
            this.onError(errorMessage);
          }
          reject(new Error(errorMessage));
        };

        this.webSocket.onclose = (event) => {
          console.log('Vosk WebSocket connection closed', event.code, event.reason);
          this.isConnected = false;
          if (this.onConnectionChange) {
            this.onConnectionChange(false);
          }
          
          // If connection closed unexpectedly while listening, attempt reconnection
          if (this.isListening && event.code !== 1000) { // 1000 = normal closure
            console.warn('Unexpected connection close, attempting reconnection...');
            setTimeout(() => {
              this.attemptReconnection().catch(error => {
                console.error('Auto-reconnection failed:', error);
              });
            }, 1000); // Wait 1 second before reconnecting
          }
        };

        this.webSocket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            
            if (data.text) {
              // Partial result
              if (this.onResult) {
                this.onResult({
                  text: data.text,
                  partial: true,
                  final: false,
                });
              }
            }
            
            if (data.result) {
              // Final result
              if (this.onResult) {
                this.onResult({
                  text: data.result,
                  partial: false,
                  final: true,
                });
              }
            }
          } catch (error) {
            console.error('Error parsing Vosk response:', error);
          }
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  public async startListening(): Promise<void> {
    if (!this.isConnected || !this.audioContext) {
      throw new Error('Vosk service not initialized or not connected');
    }

    if (this.isListening) {
      console.warn('Already listening');
      return;
    }

    try {
      // Get user media
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
          sampleRate: this.config.sampleRate,
        },
        video: false,
      });

      // Create audio source
      this.source = this.audioContext.createMediaStreamSource(this.mediaStream);

      // Create audio worklet processor
      this.processor = new AudioWorkletNode(this.audioContext, 'data-conversion-processor', {
        channelCount: 1,
        numberOfInputs: 1,
        numberOfOutputs: 1,
      });

      // Connect audio nodes
      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);

      // Handle audio data from processor
      this.processor.port.onmessage = (event) => {
        const audioData = new Float32Array(event.data);
        
        // Always cache audio data for potential replay
        this.cacheAudioData(audioData);
        
        // Send to server if connected
        if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
          this.webSocket.send(event.data);
        } else if (this.isListening) {
          // Connection lost while listening, attempt reconnection
          console.warn('Connection lost during listening, attempting reconnection...');
          this.attemptReconnection().catch(error => {
            console.error('Failed to reconnect:', error);
            if (this.onError) {
              this.onError('Connection lost and reconnection failed');
            }
          });
        }
      };

      this.processor.port.start();
      this.isListening = true;
      
      console.log('Started listening with Vosk');
    } catch (error) {
      const errorMessage = `Failed to start listening: ${error}`;
      console.error(errorMessage);
      if (this.onError) {
        this.onError(errorMessage);
      }
      throw error;
    }
  }

  public stopListening(): void {
    if (!this.isListening) {
      return;
    }

    try {
      // Send EOF to server to get final result
      if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
        this.webSocket.send('{"eof" : 1}');
      }

      // Clean up audio resources
      if (this.processor) {
        this.processor.port.close();
        this.processor.disconnect();
        this.processor = null;
      }

      if (this.source) {
        this.source.disconnect();
        this.source = null;
      }

      if (this.mediaStream) {
        this.mediaStream.getTracks().forEach(track => track.stop());
        this.mediaStream = null;
      }

      this.isListening = false;
      console.log('Stopped listening');
    } catch (error) {
      console.error('Error stopping listening:', error);
    }
  }

  public reset(): void {
    if (this.webSocket && this.webSocket.readyState === WebSocket.OPEN) {
      this.webSocket.send('{"reset" : 1}');
    }
  }

  public destroy(): void {
    this.stopListening();

    if (this.webSocket) {
      this.webSocket.close();
      this.webSocket = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.isConnected = false;
    this.isListening = false;
  }

  public get connected(): boolean {
    return this.isConnected;
  }

  public get listening(): boolean {
    return this.isListening;
  }

  // Cache management methods
  public clearCache(): void {
    this.cacheIndex = 0;
    for (let i = 0; i < this.cacheMaxChunks; i++) {
      this.audioCache[i].fill(0);
    }
    console.log('Audio cache cleared');
  }

  public getCacheStatus(): {
    maxDurationMs: number;
    maxChunks: number;
    currentIndex: number;
    isEnabled: boolean;
  } {
    return {
      maxDurationMs: this.CACHE_DURATION_MS,
      maxChunks: this.cacheMaxChunks,
      currentIndex: this.cacheIndex,
      isEnabled: true,
    };
  }

  public getReconnectionStatus(): {
    attempts: number;
    maxAttempts: number;
    canReconnect: boolean;
  } {
    return {
      attempts: this.reconnectAttempts,
      maxAttempts: this.MAX_RECONNECT_ATTEMPTS,
      canReconnect: this.reconnectAttempts < this.MAX_RECONNECT_ATTEMPTS,
    };
  }
}
