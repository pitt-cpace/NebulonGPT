import { 
  getKokoroMappingForVoskModel, 
  isLanguageSupportedByKokoro, 
  getUnsupportedLanguageMessage 
} from './languageMapping';

export interface TTSSettings {
  fullVoiceMode: boolean;
  voiceGender: 'female' | 'male';
  voice: string;
  speed: number;
  language: string;
  autoLanguageDetection: boolean;
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
    language: 'a',
    autoLanguageDetection: true
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
          language: parsed.language ?? 'a',
          autoLanguageDetection: parsed.autoLanguageDetection ?? true
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
        language: 'a',
        autoLanguageDetection: true
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

    // Clean the text before sending to TTS
    const cleanedText = this.cleanTextForTTS(text);
    
    // Skip if text becomes empty after cleaning
    if (!cleanedText.trim()) {
      return;
    }

    // Use the current settings for voice, speed, and language
    const message = {
      text: cleanedText,
      voice: this.settings.voice,
      speed: this.settings.speed,
      language: this.settings.language
    };

    this.ws?.send(JSON.stringify(message));
  }

  public stop() {
    // End streaming session first if active
    if (this.currentSession) {
      this.endStreaming();
    }
    
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

  public async clear(): Promise<boolean> {
    console.log('🧹 STARTING COMPLETE TTS BUFFER CLEARING (SERVER + CLIENT)...');
    
    // STEP 1: End streaming session first if active
    if (this.currentSession) {
      console.log('🛑 Ending active streaming session...');
      this.endStreaming();
      await new Promise(resolve => setTimeout(resolve, 50)); // Wait for server to process
    }
    
    // STEP 2: Send multiple clear commands to server to ensure buffer clearing
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('📤 Sending aggressive server buffer clear commands...');
      
      // Send stop command first
      this.ws.send(JSON.stringify({ action: 'stop' }));
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Send clear command
      this.ws.send(JSON.stringify({ action: 'clear' }));
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Send additional clear command to ensure server buffer is empty
      this.ws.send(JSON.stringify({ action: 'clear' }));
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Send force clear command (if server supports it)
      this.ws.send(JSON.stringify({ action: 'force_clear' }));
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    // STEP 3: Reset all client state immediately
    this.isPaused = false;
    this.currentSession = null;
    
    // STEP 4: Aggressively clear client-side audio buffers
    console.log('🧹 Clearing client-side audio buffers...');
    this.clearAudioQueue();
    
    // STEP 5: Additional client-side buffer clearing
    console.log('🧹 Additional client-side buffer clearing...');
    
    // Clear any pending audio that might be in browser's audio pipeline
    try {
      // Stop all audio contexts that might be playing TTS audio
      const allAudioElements = document.querySelectorAll('audio');
      allAudioElements.forEach((audio) => {
        if (audio.src && audio.src.startsWith('blob:')) {
          audio.pause();
          audio.currentTime = 0;
          audio.volume = 0;
          audio.src = '';
          audio.load();
        }
      });
    } catch (error) {
      console.warn('⚠️ Error during additional audio clearing:', error);
    }
    
    // STEP 6: Wait for server confirmation and verify clearing
    console.log('⏳ Waiting for server and client buffer clearing confirmation...');
    
    const maxAttempts = 20; // Maximum 2 seconds (20 * 100ms)
    let attempt = 0;
    let cleared = false;
    
    while (!cleared && attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms
      attempt++;
      
      // Check if everything is properly cleared on client side
      const audioQueueEmpty = this.audioQueue.length === 0;
      const notPaused = !this.isPaused;
      const noActiveSession = this.currentSession === null;
      
      // Check if all audio elements are stopped
      const allAudioStopped = this.audioQueue.every(audio => 
        audio.paused && audio.currentTime === 0 && audio.volume === 0
      );
      
      // Additional check: ensure no audio is currently playing in the browser
      let noAudioPlaying = true;
      try {
        const allAudio = Array.from(document.querySelectorAll('audio'));
        for (const audio of allAudio) {
          if (!audio.paused && audio.src.startsWith('blob:')) {
            noAudioPlaying = false;
            console.log('🔊 Found still playing audio, forcing stop...');
            audio.pause();
            audio.currentTime = 0;
            audio.volume = 0;
            break;
          }
        }
      } catch (error) {
        // Ignore errors in audio checking
      }
      
      cleared = audioQueueEmpty && notPaused && noActiveSession && allAudioStopped && noAudioPlaying;
      
      if (cleared) {
        console.log(`✅ COMPLETE TTS BUFFER CLEARING SUCCESSFUL after ${attempt * 100}ms`);
        break;
      } else {
        console.log(`⏳ Clearing verification attempt ${attempt}/${maxAttempts}...`);
      }
    }
    
    if (!cleared) {
      console.warn(`⚠️ TTS buffer clearing verification timeout after ${maxAttempts * 100}ms`);
      // Force final cleanup even if verification failed
      this.audioQueue = [];
      this.currentSession = null;
      this.isPaused = false;
    }
    
    // STEP 7: Force garbage collection
    if (window.gc) {
      window.gc();
      console.log('🧹 Forced garbage collection after buffer clearing');
    }
    
    console.log('🏁 TTS BUFFER CLEARING PROCESS COMPLETED');
    return cleared;
  }

  private clearAudioQueue() {
    console.log('🧹 AGGRESSIVE client-side audio cache clearing...');
    
    // Stop and destroy ALL audio elements in queue
    this.audioQueue.forEach((audio, index) => {
      try {
        // Stop playback immediately
        if (!audio.paused) {
          audio.pause();
        }
        
        // Reset to beginning
        audio.currentTime = 0;
        
        // Remove all event listeners to prevent memory leaks
        audio.onended = null;
        audio.onerror = null;
        audio.onloadstart = null;
        audio.oncanplay = null;
        
        // Revoke any blob URLs to free memory
        if (audio.src && audio.src.startsWith('blob:')) {
          URL.revokeObjectURL(audio.src);
        }
        
        // Clear the src to release audio data
        audio.src = '';
        audio.load(); // Force reload to clear internal buffers
        
        console.log(`🗑️ Destroyed audio element ${index}`);
      } catch (error) {
        console.warn(`⚠️ Error destroying audio element ${index}:`, error);
      }
    });
    
    // Completely replace the array (don't just clear it)
    this.audioQueue = [];
    
    // Reset all session state
    this.currentSession = null;
    this.isPaused = false;
    
    // Force garbage collection hint (browser may or may not honor this)
    if (window.gc) {
      window.gc();
      console.log('🧹 Forced garbage collection');
    }
    
    console.log('✅ Client-side audio cache completely cleared');
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

  private cleanTextForTTS(text: string): string {
    // Remove or replace characters that cause TTS to speak unwanted words
    let cleaned = text
      // First, protect mathematical expressions by temporarily replacing them
      .replace(/(\d+\s*\*\s*\d+)/g, '___MATH_MULT_$1___') // Protect math like "2 * 2"
      .replace(/(\w+\s*\*\s*\w+)/g, '___WORD_MULT_$1___') // Protect expressions like "x * y"
      
      // Remove markdown bold/italic formatting (but not math)
      .replace(/\*\*(.*?)\*\*/g, '$1') // Remove **bold** formatting, keep content
      .replace(/(?<!\w)\*([^*\s][^*]*[^*\s])\*(?!\w)/g, '$1') // Remove *italic* but not math
      
      // Remove standalone asterisks (not part of math or formatting)
      .replace(/(?<!\w)\*+(?!\w)/g, '') // Remove standalone asterisks
      
      // Remove markdown formatting
      .replace(/#{1,6}\s+/g, '') // Remove markdown headers
      .replace(/`{1,3}(.*?)`{1,3}/g, '$1') // Remove code formatting, keep content
      .replace(/\[(.*?)\]\(.*?\)/g, '$1') // Remove links, keep text
      .replace(/!\[.*?\]\(.*?\)/g, '') // Remove images completely
      
      // Remove table formatting characters
      .replace(/\|/g, ' ') // Replace table pipes with spaces
      .replace(/[-=]{2,}/g, ' ') // Remove table separators
      
      // Clean up special characters that might be spoken
      .replace(/[_~`]/g, '') // Remove underscores, tildes, backticks
      
      // Restore protected mathematical expressions
      .replace(/___MATH_MULT_(.*?)___/g, '$1') // Restore math expressions
      .replace(/___WORD_MULT_(.*?)___/g, '$1') // Restore word expressions
      
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim();

    // Log the cleaning for debugging
    if (text !== cleaned) {
      console.log('🧹 TTS text cleaned:', { original: text, cleaned });
    }

    return cleaned;
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
          console.log('TTS Queue action:', message.action, message.message);
          if (message.action === 'stop' || message.action === 'clear') {
            // Server confirmed cache clearing - do additional client-side cleanup
            console.log('🔄 Server confirmed cache clearing - performing additional client cleanup');
            this.clearAudioQueue(); // Double-clear to be absolutely sure
            this.currentSession = null; // Reset session
            this.isPaused = false; // Reset state
          }
          break;
        case 'queue_paused':
          //console.log('TTS Queue action:', message.action, message.message);
          if (message.action === 'pause') {
            this.isPaused = true;
            this.updateStatus('paused');
          } 
          break;
        case 'queue_resumed':
          //console.log('TTS Queue action:', message.action, message.message);
          if (message.action === 'resume') {
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

  /**
   * Automatically detect and switch TTS language based on active Vosk model
   */
  public autoDetectLanguageFromVoskModel(voskModelName: string): { 
    languageChanged: boolean; 
    supportedLanguage: boolean; 
    message?: string; 
  } {
    if (!this.settings.autoLanguageDetection) {
      return { languageChanged: false, supportedLanguage: true };
    }

    if (!voskModelName) {
      return { languageChanged: false, supportedLanguage: true };
    }

    // Get the Kokoro mapping for this Vosk model
    const mapping = getKokoroMappingForVoskModel(voskModelName);
    const isSupported = mapping.supported;
    
    // Check if language needs to be changed
    const currentLanguage = this.settings.language;
    const newLanguage = mapping.kokoroLanguageCode;
    const newVoice = mapping.defaultVoice;
    
    let languageChanged = false;
    let message: string | undefined;

    if (currentLanguage !== newLanguage) {
      // Update TTS settings with new language and voice
      this.updateSettings({
        language: newLanguage,
        voice: newVoice
      });
      
      languageChanged = true;
      
      if (isSupported) {
        message = `TTS language automatically switched to ${mapping.kokoroLanguageName} based on Vosk model: ${voskModelName}`;
        console.log(`🌐 ${message}`);
      } else {
        message = getUnsupportedLanguageMessage(voskModelName);
        console.log(`⚠️ ${message}`);
      }
    }

    return {
      languageChanged,
      supportedLanguage: isSupported,
      message
    };
  }

  /**
   * Get current language mapping information
   */
  public getCurrentLanguageInfo(voskModelName?: string): {
    currentLanguage: string;
    currentVoice: string;
    mapping?: any;
    isSupported?: boolean;
  } {
    const result = {
      currentLanguage: this.settings.language,
      currentVoice: this.settings.voice
    };

    if (voskModelName) {
      const mapping = getKokoroMappingForVoskModel(voskModelName);
      const isSupported = isLanguageSupportedByKokoro(voskModelName);
      
      return {
        ...result,
        mapping,
        isSupported
      };
    }

    return result;
  }
}

// Create a singleton instance
export const ttsService = new TTSService();
