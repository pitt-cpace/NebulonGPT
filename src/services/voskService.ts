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

  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 3;

  // Event handlers
  public onResult: ((result: VoskRecognitionResult) => void) | null = null;
  public onError: ((error: string) => void) | null = null;
  public onConnectionChange: ((connected: boolean) => void) | null = null;

  constructor(config: VoskServiceConfig = {}) {
    // Use current hostname to support IP address access (localhost, 127.0.0.1, 10.211.33.32, etc.)
    const defaultServerUrl = config.serverUrl || `ws://${window.location.hostname}:3001/vosk`;
    this.config = {
      serverUrl: defaultServerUrl,
      sampleRate: config.sampleRate || 16000,
      showWords: config.showWords !== undefined ? config.showWords : true,
      maxAlternatives: config.maxAlternatives || 0,
    };
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
      
      if (this.isConnected) {
        this.reconnectAttempts = 0; // Reset counter on successful reconnection
        return true;
      }
    } catch (error) {
      console.error('Reconnection failed:', error);
    }

    return false;
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
