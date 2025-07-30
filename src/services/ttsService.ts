export interface TTSSettings {
  fullVoiceMode: boolean;
  voiceGender: 'female' | 'male';
}

export type TTSStatus = 'connected' | 'connecting' | 'disconnected' | 'reconnecting';

export class TTSService {
  private ws: WebSocket | null = null;
  private serverUrl: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private statusCallback?: (status: TTSStatus) => void;
  private settings: TTSSettings = {
    fullVoiceMode: false,
    voiceGender: 'female'
  };
  private readonly STORAGE_KEY = 'nebulongpt_tts_settings';

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
        const parsed = JSON.parse(savedSettings) as TTSSettings;
        this.settings = {
          fullVoiceMode: parsed.fullVoiceMode ?? false,
          voiceGender: parsed.voiceGender ?? 'female'
        };
      }
    } catch (error) {
      console.error('Failed to load TTS settings from localStorage:', error);
      // Use default settings if loading fails
      this.settings = {
        fullVoiceMode: false,
        voiceGender: 'female'
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

    const message = {
      action: 'speak',
      text: text,
      voice: this.settings.voiceGender
    };

    this.ws?.send(JSON.stringify(message));
  }

  public stop() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = { action: 'stop' };
      this.ws.send(JSON.stringify(message));
    }
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
        case 'audio':
          this.playAudio(message.data);
          break;
        case 'status':
          console.log('TTS Status:', message.status);
          break;
        case 'error':
          console.error('TTS Error:', message.error);
          break;
        default:
          console.log('Unknown TTS message:', message);
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
      
      audio.play().catch(error => {
        console.error('Failed to play TTS audio:', error);
      });
      
      // Clean up the URL after playing
      audio.onended = () => {
        URL.revokeObjectURL(audioUrl);
      };
    } catch (error) {
      console.error('Failed to process TTS audio:', error);
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
