export interface TTSSettings {
  fullVoiceMode: boolean;
  voiceGender: 'female' | 'male';
  voice: string;
  speed: number;
  language: string;
}

export type TTSStatus = 'connected' | 'connecting' | 'disconnected' | 'reconnecting' | 'paused';

export interface StreamingSession {
  sessionId: number;
  isActive: boolean;
  voice: string;
  speed: number;
  language: string;
}

export class TTSService {
  private ws: WebSocket | null = null;
  private serverUrl: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private statusCallback?: (status: TTSStatus) => void;
  private settings: TTSSettings = {
    fullVoiceMode: false,
    voiceGender: 'female',
    voice: 'af_heart',
    speed: 1.0,
    language: 'a'
  };
  private readonly STORAGE_KEY = 'nebulongpt_tts_settings';
  private currentSession: StreamingSession | null = null;
  private isPaused = false;
  private audioQueue: HTMLAudioElement[] = [];

  constructor(serverUrl?: string) {
    // Use environment variable if available, otherwise fallback to localhost
    this.serverUrl = serverUrl || 
      process.env.REACT_APP_TTS_SERVER_URL || 
      'ws://localhost:2701';
    
    // Load settings from localStorage
    this.loadSettings();
  }

  public setStatusCallback(callback: (status: TTSStatus) => void) {
    this.statusCallback = callback;
  }

  public updateSettings(settings: Partial<TTSSettings>) {
    this.settings = { ...this.settings, ...settings };
    
    // Update voice based on gender if not explicitly set
    if (settings.voiceGender && !settings.voice) {
      const voiceMap = {
        'female': 'af_heart',
        'male': 'am_adam'
      };
      this.settings.voice = voiceMap[settings.voiceGender];
    }
  }

  public saveSettings() {
    try {
      localStorage.setItem(this.STORAGE_KEY, JSON.stringify(this.settings));
    } catch (error) {
      console.error('Failed to save TTS settings to localStorage:', error);
    }
  }

  public getSettings(): TTSSettings {
    return { ...this.settings };
  }

  private loadSettings() {
    try {
      const savedSettings = localStorage.getItem(this.STORAGE_KEY);
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings) as Partial<TTSSettings>;
        this.settings = {
          fullVoiceMode: parsed.fullVoiceMode ?? false,
          voiceGender: parsed.voiceGender ?? 'female',
          voice: parsed.voice ?? 'af_heart',
          speed: parsed.speed ?? 1.0,
          language: parsed.language ?? 'a'
        };
      }
    } catch (error) {
      console.error('Failed to load TTS settings from localStorage:', error);
      // Use default settings if loading fails
      this.settings = {
        fullVoiceMode: false,
        voiceGender: 'female',
        voice: 'af_heart',
        speed: 1.0,
        language: 'a'
      };
    }
  }

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      this.updateStatus('connecting');

      try {
        this.ws = new WebSocket(this.serverUrl);

        this.ws.onopen = () => {
          console.log('TTS WebSocket connected');
          this.reconnectAttempts = 0;
          this.updateStatus('connected');
          resolve();
        };

        this.ws.onclose = (event) => {
          console.log('TTS WebSocket closed:', event.code, event.reason);
          this.handleDisconnection();
        };

        this.ws.onerror = (error) => {
          console.error('TTS WebSocket error:', error);
          this.updateStatus('disconnected');
          reject(error);
        };

        this.ws.onmessage = (event) => {
          this.handleMessage(event.data);
        };

      } catch (error) {
        console.error('Failed to create TTS WebSocket:', error);
        this.updateStatus('disconnected');
        reject(error);
      }
    });
  }

  public disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.updateStatus('disconnected');
  }

  public async speak(text: string): Promise<void> {
    if (!this.settings.fullVoiceMode) {
      return;
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    // Use the current settings for voice, speed, and language
    const message = {
      text: text,
      voice: this.settings.voice,
      speed: this.settings.speed,
      language: this.settings.language
    };

    this.ws?.send(JSON.stringify(message));
  }

  public stop() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = { action: 'stop' };
      this.ws.send(JSON.stringify(message));
    }
    
    // Immediately clear client-side audio for real-time stop
    this.clearAudioQueue();
    this.isPaused = false; // Reset paused state
  }

  public pause() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = { action: 'pause' };
      this.ws.send(JSON.stringify(message));
    }
    
    // Immediately stop client-side audio playback for real-time pause
    this.clearAudioQueue();
    this.isPaused = true;
  }

  public resume() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = { action: 'resume' };
      this.ws.send(JSON.stringify(message));
    }
    
    // Reset paused state for client-side audio
    this.isPaused = false;
  }

  public clear() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = { action: 'clear' };
      this.ws.send(JSON.stringify(message));
    }
    
    // Reset paused state when clearing (important for new conversations)
    this.isPaused = false;
    
    // Clear the local audio queue to prevent overlapping
    this.clearAudioQueue();
  }

  private clearAudioQueue() {
    // Stop current audio if playing
    if (this.audioQueue.length > 0) {
      const currentAudio = this.audioQueue[0];
      if (!currentAudio.paused) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
      }
    }
    
    // Clear all queued audio
    this.audioQueue.forEach(audio => {
      if (!audio.paused) {
        audio.pause();
        audio.currentTime = 0;
      }
    });
    
    this.audioQueue = [];
    console.log('🔇 Audio queue cleared');
  }

  public async startStreaming(): Promise<number | null> {
    if (!this.settings.fullVoiceMode) {
      return null;
    }

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    const message = {
      start_stream: true,
      voice: this.settings.voice,
      speed: this.settings.speed,
      language: this.settings.language
    };

    this.ws?.send(JSON.stringify(message));
    
    // Return the session ID when we get the response
    return new Promise((resolve) => {
      const originalCallback = this.statusCallback;
      this.setStatusCallback((status) => {
        if (originalCallback) originalCallback(status);
        if (this.currentSession) {
          resolve(this.currentSession.sessionId);
        }
      });
    });
  }

  public sendTextChunk(textChunk: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.currentSession) {
      const message = {
        text_chunk: textChunk
      };
      this.ws.send(JSON.stringify(message));
    }
  }

  public endStreaming() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.currentSession) {
      const message = {
        end_stream: true
      };
      this.ws.send(JSON.stringify(message));
    }
  }

  public getCurrentSession(): StreamingSession | null {
    return this.currentSession;
  }

  public isPausedState(): boolean {
    return this.isPaused;
  }

  private updateStatus(status: TTSStatus) {
    if (this.statusCallback) {
      this.statusCallback(status);
    }
  }

  private handleDisconnection() {
    this.updateStatus('disconnected');
    
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      this.updateStatus('reconnecting');
      
      setTimeout(() => {
        this.connect().catch(() => {
          // Reconnection failed, will try again or give up
        });
      }, this.reconnectDelay * this.reconnectAttempts);
    }
  }

  private handleMessage(data: string) {
    try {
      const message = JSON.parse(data);
      
      switch (message.type) {
        case 'complete_audio':
          // Handle complete audio response from regular TTS
          if (message.audio) {
            this.playAudio(message.audio);
          }
          break;
        case 'audio_chunk':
          // Handle streaming audio chunk
          if (message.audio_chunk) {
            this.playAudio(message.audio_chunk);
          }
          break;
        case 'streaming_started':
          console.log('TTS Streaming started:', message.session_id);
          this.currentSession = {
            sessionId: message.session_id,
            isActive: true,
            voice: message.voice,
            speed: message.speed,
            language: message.language
          };
          break;
        case 'streaming_ended':
          console.log('TTS Streaming ended:', message.session_id);
          this.currentSession = null;
          break;
        case 'queue_cleared':
        case 'queue_paused':
        case 'queue_resumed':
          console.log('TTS Queue action:', message.action, message.message);
          if (message.action === 'pause') {
            this.isPaused = true;
            this.updateStatus('paused');
          } else if (message.action === 'resume') {
            this.isPaused = false;
            this.updateStatus('connected');
          }
          break;
        case 'chunk_received':
          // Acknowledgment of text chunk processing
          console.log('TTS Chunk processed:', message.processed_sentences);
          break;
        case 'request_queued':
          console.log('TTS Request queued:', message.message);
          break;
        case 'status':
          console.log('TTS Status:', message.status);
          break;
        case 'error':
          console.error('TTS Error:', message.error);
          break;
        default:
          // Handle error responses
          if (message.error) {
            console.error('TTS Error:', message.error);
          } else {
            console.log('Unknown TTS message:', message);
          }
      }
    } catch (error) {
      console.error('Failed to parse TTS message:', error);
    }
  }

  private playAudio(audioData: string) {
    try {
      // Convert base64 audio data to blob and play
      const binaryString = atob(audioData);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      const blob = new Blob([bytes], { type: 'audio/wav' });
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      
      // Add to queue instead of playing immediately
      this.audioQueue.push(audio);
      
      // Clean up the URL after playing
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
        // Remove from queue and play next
        this.audioQueue.shift();
        this.playNextInQueue();
      };
      
      audio.onerror = () => {
        console.error('Failed to play TTS audio');
        URL.revokeObjectURL(audioUrl);
        // Remove from queue and play next
        this.audioQueue.shift();
        this.playNextInQueue();
      };
      
      // If this is the only audio in queue, start playing
      if (this.audioQueue.length === 1) {
        this.playNextInQueue();
      }
      
    } catch (error) {
      console.error('Failed to process TTS audio:', error);
    }
  }

  private playNextInQueue() {
    if (this.audioQueue.length > 0 && !this.isPaused) {
      const audio = this.audioQueue[0];
      audio.play().catch(error => {
        console.error('Failed to play TTS audio:', error);
        // Remove failed audio and try next
        this.audioQueue.shift();
        this.playNextInQueue();
      });
    }
  }

  public getStatus(): TTSStatus {
    if (!this.ws) return 'disconnected';
    
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return 'connecting';
      case WebSocket.OPEN:
        return 'connected';
      case WebSocket.CLOSING:
      case WebSocket.CLOSED:
      default:
        return 'disconnected';
    }
  }
}

// Create a singleton instance
export const ttsService = new TTSService();
