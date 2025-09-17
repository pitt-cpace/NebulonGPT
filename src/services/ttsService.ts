import { 
  getKokoroMappingForVoskModel, 
  isLanguageSupportedByKokoro, 
  getUnsupportedLanguageMessage 
} from './languageMapping';
import { getWebSocketUrls } from './electronApi';

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
  assistantMessageId?: string; // Track which assistant message this session belongs to
}

export interface TTSQueueItem {
  audio: HTMLAudioElement;
  assistantMessageId?: string; // Track which assistant message this audio belongs to
}

export class TTSService {
  private ws: WebSocket | null = null;
  private serverUrl: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 60;
  private reconnectDelay = 1000;
  private statusCallback?: (status: TTSStatus) => void;
  private getCurrentMsgId?: () => string | null; // Reference to the global getCurrentMsgId function
  private setCurrentMsgId?: (msgId: string | null) => void; // Reference to set the current message ID
  private getIsListening?: () => boolean; // Reference to get the current listening state
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
  private audioQueue: TTSQueueItem[] = [];
  private isPlayingAudio = false; // Flag to prevent double-play
  private currentPlayingAudio: TTSQueueItem | null = null; // Track current playing thread
  private pausedAudioTime: number = 0; // Store paused position for resume
  private lastPauseTimestamp: number = 0; // Store when the last pause occurred
  private minimumWaitTimeForResume = 500; // 0.5 second minimum


  constructor(serverUrl?: string) {
    // Use environment-aware WebSocket URL detection
    if (serverUrl) {
      this.serverUrl = serverUrl;
    } else {
      const { tts } = getWebSocketUrls();
      this.serverUrl = tts;
    }
    
    // Load settings from localStorage
    this.loadSettings();
  }

  /**
   * Get default TTS URL based on current window location
   */
  private getDefaultTTSUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname;
    const port = window.location.port;
    
    // Use current port if available, otherwise default to 3000
    const targetPort = port || '3000';
    
    const url = `${protocol}//${host}:${targetPort}/tts`;
    return url;
  }

  public setStatusCallback(callback: (status: TTSStatus) => void) {
    this.statusCallback = callback;
  }

  public setGetCurrentMsgId(getCurrentMsgId: () => string | null) {
    this.getCurrentMsgId = getCurrentMsgId;
  }

  public setSetCurrentMsgId(setCurrentMsgId: (msgId: string | null) => void) {
    this.setCurrentMsgId = setCurrentMsgId;
  }

  public setGetIsListening(getIsListening: () => boolean) {
    this.getIsListening = getIsListening;
  }

  // Store pending setActiveMessageId promises
  private pendingSetActiveMessageId: Map<string, (success: boolean) => void> = new Map();

  /**
   * Set active message ID on server
   * Returns true if successful, false if failed
   */
  public async setActiveMessageId(assistantMessageId: string | null): Promise<boolean> {
    try {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        await this.connect();
      }

      // Generate a unique request ID to match response
      const requestId = `set_active_msg_id_${Date.now()}_${Math.random()}`;

      const message = {
        action: 'set_active_msg_id',
        assistantMessageId: assistantMessageId,
        requestId: requestId // Add request ID to match response
      };

      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          this.pendingSetActiveMessageId.delete(requestId);
          resolve(false);
        }, 10000);
        
        // Store the resolver with cleanup
        this.pendingSetActiveMessageId.set(requestId, (success: boolean) => {
          clearTimeout(timeout);
          this.pendingSetActiveMessageId.delete(requestId);
          resolve(success);
        });
        
        this.ws?.send(JSON.stringify(message));
      });
    } catch (error) {
      return false;
    }
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

  public getMinimumWaitTimeForResume(): number {
    return this.minimumWaitTimeForResume; // 2 seconds minimum wait time for resume
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

      if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
        // Wait for the existing connection attempt
        const checkConnection = () => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            resolve();
          } else if (this.ws?.readyState === WebSocket.CLOSED || this.ws?.readyState === WebSocket.CLOSING) {
            this.connect().then(resolve).catch(reject);
          } else {
            setTimeout(checkConnection, 100);
          }
        };
        checkConnection();
        return;
      }

      this.updateStatus('connecting');

      try {

        this.ws = new WebSocket(this.serverUrl);

        this.ws.onopen = (event) => {

          this.reconnectAttempts = 0;

          this.updateStatus('connected');
          
          resolve();
        };

        this.ws.onclose = (event) => {

          this.handleDisconnection();
        };

        this.ws.onerror = (error) => {
          console.error('❌ TTS WebSocket ERROR occurred!');
          console.error('❌ TTS Error: Error event details:', {
            error: error,
            timestamp: new Date().toISOString(),
            url: this.serverUrl,
            readyState: this.ws ? this.getWebSocketStateString(this.ws.readyState) : 'WebSocket is null'
          });
          
          // Try to get more error details
          if (error instanceof Event) {
            console.error('❌ TTS Error: Event type:', error.type);
            console.error('❌ TTS Error: Event target:', error.target);
          }
          
          this.updateStatus('disconnected');
          
          reject(error);
        };

        this.ws.onmessage = (event) => {

          this.handleMessage(event.data);
        };


      } catch (error) {
        console.error('💥 TTS Connect: EXCEPTION during WebSocket creation!');
        console.error('💥 TTS Connect: Exception details:', {
          error: error,
          message: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : 'No stack trace',
          timestamp: new Date().toISOString(),
          url: this.serverUrl
        });
        
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

  public async speak(text: string, assistantMessageId?: string | null): Promise<void> {
    if (!this.settings.fullVoiceMode) {
      return;
    }

    // Only process English text for TTS - skip other languages
    if (!this.isEnglishLanguage()) {
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

    await this.resume();
    
    // Use the current settings for voice, speed, and language
    const message = {
      text: cleanedText,
      voice: this.settings.voice,
      speed: this.settings.speed,
      language: this.settings.language,
      assistantMessageId: assistantMessageId // Include message ID in the request
    };

    this.ws?.send(JSON.stringify(message));
  }

  /**
   * Check if the audio item should be played based on message ID match
   * Only return true if both message IDs are exactly the same
   * Otherwise always shift (remove) the item from queue and return false
   */
  private shouldPlayAudioItem(audioItem: TTSQueueItem): boolean {
    const currentMsgId = this.getCurrentMsgId ? this.getCurrentMsgId() : null;

    
    // Only return true if both message IDs are exactly the same
    if (currentMsgId && audioItem && audioItem.assistantMessageId && currentMsgId === audioItem.assistantMessageId) {
      // Check if mic is listening and full voice mode is enabled before allowing play
      if (!this.isMicListeningAndFullVoiceMode()) {
        return false;
      }
      return true; // Message IDs match exactly, allow playing
    }
    
    // Log queue length before shifting
    const queueLengthBefore = this.audioQueue.length;

    // Message IDs don't match (including null cases) - shift (remove) this audio from queue
    
    // Remove the first item from queue using shift
    const removedItem = this.audioQueue.shift();
    if (removedItem) {
      // Clean up the removed audio
      const audio = removedItem.audio;
      if (!audio.paused) {
        audio.pause();
      }
      audio.onended = null;
      audio.onerror = null;
      if (audio.src && audio.src.startsWith('blob:')) {
        URL.revokeObjectURL(audio.src);
      }
    }
    
    // Log queue length after shifting
    const queueLengthAfter = this.audioQueue.length;
    
    return false; // Audio was removed, don't play
  }


  public async stop() {

    this.pause();

    // Generate new message ID to invalidate any remaining client-side audio
    const newMessageId = `msg-${Date.now() + 1}`;
    if (this.setCurrentMsgId) {
      this.setCurrentMsgId(newMessageId); // Update current message ID to filter out old audio
    }

    const success = await ttsService.setActiveMessageId(newMessageId);
    if (!success) {
      console.error('Stop : Failed to set active message ID for TTS:', newMessageId);
    }
    // Send stop command to server
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = { 
        action: 'stop',
      };
      this.ws.send(JSON.stringify(message));
    }

    // Immediately stop all currently playing audio on client side
    this.audioQueue.forEach((item, index) => {
      try {
        const audio = item.audio;
        if (!audio.paused) {
          audio.pause();
          audio.currentTime = 0;
        }
      } catch (error) {
        console.warn(`⚠️ Error stopping audio ${index}:`, error);
      }
    });

    // Wait for server to process stop command and cancel tasks
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Clean up audio resources and clear the queue
    this.audioQueue.forEach((item, index) => {
      try {
        const audio = item.audio;
        // Remove event listeners
        audio.onended = null;
        audio.onerror = null;
        // Free memory by revoking blob URLs
        if (audio.src && audio.src.startsWith('blob:')) {
          URL.revokeObjectURL(audio.src);
        }
      } catch (error) {
        console.warn(`⚠️ Error cleaning up audio ${index}:`, error);
      }
    });
    
    // Clear the audio queue
    this.audioQueue = [];
    
    // Reset all TTS state for fresh start
    this.isPaused = false;
    this.isPlayingAudio = false;
    this.currentSession = null;
    
    // Force garbage collection if available
    if (window.gc) {
      window.gc();
    }
  }

  public  pause() {
    if(this.isPaused) {return;}

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = { action: 'pause' };
      this.ws.send(JSON.stringify(message));
    }
    
    // Find and pause the CURRENTLY PLAYING audio thread
    if (this.audioQueue.length > 0) {
      const currentItem = this.audioQueue[0];
      const currentAudio = currentItem.audio;
      
      // Verify this is actually the current playing thread
      if (currentAudio && !currentAudio.paused) {
        try {
          // Store the current playback position for resume
          this.pausedAudioTime = currentAudio.currentTime;
          
          // Store reference to the current playing audio item AND its message ID
          this.currentPlayingAudio = currentItem;
          
          // Store the timestamp when pause occurred
          this.lastPauseTimestamp = Date.now();
          
          // Pause the audio thread
          currentAudio.pause();

          // Set paused state
          this.isPaused = true;
          
          // Reset the playing flag since we paused
          this.isPlayingAudio = false;
          
        } catch (error) {
          console.error('⚠️ Error pausing current audio thread:', error);
          // Reset tracking if pause failed
          this.currentPlayingAudio = null;
          this.pausedAudioTime = 0;
        }
      } else {
        this.currentPlayingAudio = null;
        this.pausedAudioTime = 0;
      }
    } else {
      this.currentPlayingAudio = null;
      this.pausedAudioTime = 0;
    }
    
    // Wait a brief moment to ensure pause operations complete
    new Promise(resolve => setTimeout(resolve, 100));
  }

public async resume() {
  
  if (!this.isPaused) 
    {return;}
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = { action: 'resume' };
      this.ws.send(JSON.stringify(message));
    }
    
    // Check if at least 1 second has passed since the last pause
    if (this.lastPauseTimestamp > 0) {
      const timeSincePause = Date.now() - this.lastPauseTimestamp;
      
      if (timeSincePause < this.minimumWaitTimeForResume) {
        const remainingWaitTime = this.minimumWaitTimeForResume - timeSincePause;
        await new Promise(resolve => setTimeout(resolve, remainingWaitTime));
      }
    }
    
    // Reset paused state for client-side audio
    this.isPaused = false;
    
      // Check if we have a paused thread to resume
    if (this.currentPlayingAudio && this.pausedAudioTime > 0) {
      
      // Check if the paused audio should still be played
      if (!this.shouldPlayAudioItem(this.currentPlayingAudio)) {
        // Audio was removed due to message ID mismatch, try next in queue
        this.currentPlayingAudio = null;
        this.pausedAudioTime = 0;
        this.isPlayingAudio = false;
        this.playNextInQueue();
        return;
      }
      
      const currentAudio = this.currentPlayingAudio.audio;
      try {
        // Verify the audio element is still valid and not destroyed
        if (currentAudio.src && currentAudio.src.startsWith('blob:') && !currentAudio.ended) {
          // Restore the playback position
          currentAudio.currentTime = this.pausedAudioTime;
          
          // Set the playing flag before starting playback
          this.isPlayingAudio = true;
          
          // Resume the specific paused thread
          currentAudio.play().then(() => {
            
            // Clear the stored reference since it's now playing
            this.currentPlayingAudio = null;
            this.pausedAudioTime = 0;
          }).catch((error: any) => {
            console.error('⚠️ Failed to resume paused audio thread:', error);
            
            // Reset playing flag and clear references
            this.isPlayingAudio = false;
            this.currentPlayingAudio = null;
            this.pausedAudioTime = 0;
            
            // Try to play next audio in queue
            this.playNextInQueue();
          });
          return; // Exit early since we resumed the paused thread
        } 
      } catch (error) {
        console.error('⚠️ Error validating paused audio thread:', error);
      }
      
      // Clear invalid paused thread reference
      this.currentPlayingAudio = null;
      this.pausedAudioTime = 0;
    }
    
    // If no valid paused thread exists, play the next one in queue
    if (this.audioQueue.length > 0) {
      this.playNextInQueue();
    }
  }




  public async startStreaming(assistantMessageId?: string | null): Promise<number | null> {
    if (!this.settings.fullVoiceMode) {
      return null;
    }

    // Only process English text for TTS streaming - skip other languages
    if (!this.isEnglishLanguage()) {
      return null;
    }


    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    const message = {
      start_stream: true,
      voice: this.settings.voice,
      speed: this.settings.speed,
      language: this.settings.language,
      assistantMessageId: assistantMessageId // Include message ID in the request
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


  public endStreaming(currentMsgId?: string | null) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.currentSession) {
      const message = {
        end_stream: true,
        assistantMessageId: currentMsgId
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

  public getQueueStatus(): { 
    queueLength: number; 
    isPaused: boolean; 
    isPlaying: boolean;
    currentAudioTime?: number;
  } {
    const currentItem = this.audioQueue[0];
    const currentAudio = currentItem?.audio;
    return {
      queueLength: this.audioQueue.length,
      isPaused: this.isPaused,
      isPlaying: currentAudio ? !currentAudio.paused : false,
      currentAudioTime: currentAudio ? currentAudio.currentTime : undefined
    };
  }

  /**
   * Check if current Vosk model is English
   */
  private isEnglishLanguage(): boolean {
    // Import voskRecognition to check current model
    const { voskRecognition } = require('./vosk');
    
    // Get current Vosk model
    const currentModel = voskRecognition.getCurrentModel();
    
    if (!currentModel) {
      return false;
    }
    
    // Check if the Vosk model is English based on model name
    const isEnglishModel = this.isEnglishVoskModel(currentModel);
    
    return isEnglishModel;
  }

  /**
   * Check if a Vosk model name indicates English language
   */
  private isEnglishVoskModel(modelName: string): boolean {
    if (!modelName) {
      return false;
    }
    
    // Convert to lowercase for case-insensitive matching
    const lowerModelName = modelName.toLowerCase();
    
    // English model patterns
    const englishPatterns = [
      /^vosk-model-en/,           // vosk-model-en-us-0.22, vosk-model-en-gb-0.22
      /^vosk-model-small-en/,     // vosk-model-small-en-us-0.15
      /^en-/,                     // en-us-0.22, en-gb-0.22
      /^small-en/,                // small-en-us-0.15
      /-en-/,                     // any model with -en- in the name
      /english/,                  // any model with "english" in the name
    ];
    
    // Check if any English pattern matches
    const isEnglish = englishPatterns.some(pattern => pattern.test(lowerModelName));
    
    
    return isEnglish;
  }

  private cleanTextForTTS(text: string): string {
    // Remove or replace characters that cause TTS to speak unwanted words
    let cleaned = text
      // First, protect mathematical expressions by temporarily replacing them
      .replace(/(\d+\s*\*\s*\d+)/g, '___MATH_MULT_$1___') // Protect math like "2 * 2"
      
      // Remove markdown bold/italic formatting
      .replace(/\*\*(.*?)\*\*/g, '$1') // Remove **bold** formatting, keep content
      .replace(/(?<!\w)\*([^*\s][^*]*[^*\s])\*(?!\w)/g, '$1') // Remove *italic* formatting, keep content
      
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
      
      // Normalize whitespace
      .replace(/\s+/g, ' ')
      .trim();

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
        this.connect().then(() => {
        }).catch((error) => {
          console.error(`❌ TTS Reconnect: Attempt ${this.reconnectAttempts} failed:`, error);
        });
      }, this.reconnectDelay * this.reconnectAttempts);
    }
  }

  /**
   * Get human-readable WebSocket state string
   */
  private getWebSocketStateString(readyState: number): string {
    switch (readyState) {
      case WebSocket.CONNECTING:
        return 'CONNECTING (0)';
      case WebSocket.OPEN:
        return 'OPEN (1)';
      case WebSocket.CLOSING:
        return 'CLOSING (2)';
      case WebSocket.CLOSED:
        return 'CLOSED (3)';
      default:
        return `UNKNOWN (${readyState})`;
    }
  }

  /**
   * Get human-readable close code meaning
   */
  private getCloseCodeMeaning(code: number): string {
    switch (code) {
      case 1000:
        return 'Normal Closure - Connection closed normally';
      case 1001:
        return 'Going Away - Endpoint is going away (e.g., server going down)';
      case 1002:
        return 'Protocol Error - Protocol error occurred';
      case 1003:
        return 'Unsupported Data - Received unsupported data type';
      case 1004:
        return 'Reserved - Reserved for future use';
      case 1005:
        return 'No Status Received - No status code was provided';
      case 1006:
        return 'Abnormal Closure - Connection closed abnormally (no close frame)';
      case 1007:
        return 'Invalid Frame Payload Data - Invalid UTF-8 data received';
      case 1008:
        return 'Policy Violation - Message violates policy';
      case 1009:
        return 'Message Too Big - Message too large to process';
      case 1010:
        return 'Mandatory Extension - Required extension not negotiated';
      case 1011:
        return 'Internal Server Error - Server encountered unexpected condition';
      case 1012:
        return 'Service Restart - Service is restarting';
      case 1013:
        return 'Try Again Later - Temporary server condition';
      case 1014:
        return 'Bad Gateway - Server acting as gateway received invalid response';
      case 1015:
        return 'TLS Handshake - TLS handshake failed';
      default:
        if (code >= 3000 && code <= 3999) {
          return `Library/Framework Specific (${code})`;
        } else if (code >= 4000 && code <= 4999) {
          return `Application Specific (${code})`;
        } else {
          return `Unknown Close Code (${code})`;
        }
    }
  }

  private  handleMessage(data: string) {
    try {
      const message = JSON.parse(data);
      switch (message.type) {
        case 'complete_audio':
          // Handle complete audio response from regular TTS
          if (message.audio) {
            this.playAudio(message.audio, message.assistantMessageId);
          }
          break;
        case 'audio_chunk':
          // Handle streaming audio chunk
          if (message.audio_chunk) {
            this.playAudio(message.audio_chunk, message.assistantMessageId);
          }
          break;
        case 'streaming_started':
          this.currentSession = {
            sessionId: message.session_id,
            isActive: true,
            voice: message.voice,
            speed: message.speed,
            language: message.language,
            assistantMessageId: message.assistantMessageId // Store the assistant message ID in the session
          };
          break;
        case 'streaming_ended':
          this.currentSession = null;
          break;
        case 'queue_cleared':
          if (message.action === 'stop' || message.action === 'clear') {
            // Server confirmed cache clearing - reset session and state
            this.currentSession = null; // Reset session
            this.isPaused = false; // Reset state
          }
          break;
        case 'queue_paused':
          if (message.action === 'pause') {
            this.isPaused = true;
            // Don't change status to 'paused' - keep it as 'connected'
            // this.updateStatus('paused');
          } 
          break;
        case 'queue_resumed':
          if (message.action === 'resume') {
            this.isPaused = false;
            // Status should already be 'connected', but ensure it
            this.updateStatus('connected');
          } 
          break;
        case 'chunk_received':
          // Acknowledgment of text chunk processing
          break;
        case 'active_msg_id_set':
          // Handle set active message ID response
          if (message.requestId && this.pendingSetActiveMessageId.has(message.requestId)) {
            const resolver = this.pendingSetActiveMessageId.get(message.requestId);
            if (resolver) {
              resolver(message.success === true);
            }
          }
          break;
        case 'request_queued':
          break;
        case 'status':
          break;
        case 'error':
          console.error('TTS Error:', message.error);
          break;
        default:
          // Handle error responses
          if (message.error) {
            console.error('TTS Error:', message.error);
          }
      }
    } catch (error) {
      console.error('Failed to parse TTS message:', error);
    }
  }

  private playAudio(audioData: string, assistantMessageId?: string) {
    try {
      if (this.getCurrentMsgId && this.getCurrentMsgId() !== assistantMessageId){
        return;
      }
      // Only play audio if Full Voice Mode is enabled AND microphone is listening
      if (!this.settings.fullVoiceMode) {
        return;
      }
      
      // Check if microphone is currently listening using centralized state
      if (this.getIsListening) {
        const isListening = this.getIsListening();
        
        if (!isListening) {
          return;
        }
        
      } else {
        console.warn('⚠️ No listening state callback available - skipping audio playback for safety');
        return;
      }
      
      // Convert base64 audio data to blob and play
      const binaryString = atob(audioData);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      const blob = new Blob([bytes], { type: 'audio/wav' });
      const audioUrl = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl);
      
      // Set up event handlers before adding to queue
      audio.onended = () => {        
        URL.revokeObjectURL(audioUrl);
        
        // CRITICAL: Reset the playing flag
        this.isPlayingAudio = false;
        
        // CRITICAL: Only remove THIS specific audio from queue
        const currentItem = this.audioQueue[0];
        if (currentItem && currentItem.audio === audio) {
          this.audioQueue.shift();
        }

        // Clean up event listeners
        audio.onended = null;
        audio.onerror = null;
        
        // CRITICAL: Only play next if we're not paused and there are more items
        if (!this.isPaused && this.audioQueue.length > 0) {
          this.playNextInQueue();
        }
      };
      
      audio.onerror = (error) => {
        console.error('🎵 Failed to play TTS audio:', error);
        URL.revokeObjectURL(audioUrl);
        
        // CRITICAL: Reset the playing flag
        this.isPlayingAudio = false;

        // CRITICAL: Only remove THIS specific audio from queue
        const currentItem = this.audioQueue[0];
        if (currentItem && currentItem.audio === audio) {
          this.audioQueue.shift();
        }      
        
        // Clean up event listeners
        audio.onended = null;
        audio.onerror = null;
        
        // CRITICAL: Try to play next audio even if current failed
        if (!this.isPaused && this.audioQueue.length > 0) {
          this.playNextInQueue();
        }
      };
      
      // Add to queue - create TTSQueueItem with the assistant message ID from the server
      const queueItem: TTSQueueItem = {
        audio: audio,
        assistantMessageId: assistantMessageId
      };
      
      this.audioQueue.push(queueItem);

      // CRITICAL: Only start playing if this is the first audio AND no audio is currently playing
      if (!this.isPaused) {
        this.playNextInQueue();
      } 
    } catch (error) {
      console.error('Failed to process TTS audio:', error);
    }
  }

  private  playNextInQueue() {

    // Don't play if paused
    if (this.isPaused) {
      return;
    }
    
    // CRITICAL: Prevent double-play with flag
    if (this.isPlayingAudio) {
      return;
    }
    
    // Check if queue is empty
    if (this.audioQueue.length === 0) {
      this.isPlayingAudio = false; // Reset flag when queue is empty
      return;
    }
    
    const audioItem = this.audioQueue[0];
    if (!audioItem) {
      this.audioQueue.shift();
      this.playNextInQueue();
      return;
    }

    
    // Check if the audio item should be played based on message ID match
    if (!this.shouldPlayAudioItem(audioItem)) {
      // Audio was removed by shouldPlayAudioItem, continue with next item
      // Note: shouldPlayAudioItem already removed the item from queue
      this.playNextInQueue();
      return;
    }
    
    const audio = audioItem.audio;

    // CRITICAL: Additional check if audio is already playing
    if (!audio.paused) {
      return;
    }
    
    // Set flag to prevent double-play
    this.isPlayingAudio = true;
    
    // Play the audio
    audio.play().then(() => {
      // Audio started successfully
    }).catch((error: any) => {
      console.error('🎵 Failed to start audio playback:', error);
      
      // Reset flag on failure
      this.isPlayingAudio = false;
      
      // Remove failed audio and clean up
      const failedItem = this.audioQueue.shift();
      if (failedItem) {
        const failedAudio = failedItem.audio;
        failedAudio.onended = null;
        failedAudio.onerror = null;
        if (failedAudio.src && failedAudio.src.startsWith('blob:')) {
          URL.revokeObjectURL(failedAudio.src);
        }
      }
      
      // Try next audio after a small delay to prevent stack overflow
      setTimeout(() => {
        if (!this.isPaused && this.audioQueue.length > 0) {
          this.playNextInQueue();
        }
      }, 10);
    });
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
      } else {
        message = getUnsupportedLanguageMessage(voskModelName);
      }
    }

    return {
      languageChanged,
      supportedLanguage: isSupported,
      message
    };
  }

  /**
   * Check if both microphone is listening and full voice mode is enabled
   * @returns true if both conditions are met, false otherwise
   */
  public isMicListeningAndFullVoiceMode(): boolean {
    // Check if full voice mode is enabled
    if (!this.settings.fullVoiceMode) {
      return false;
    }
    
    // Check if microphone is currently listening using the callback
    if (this.getIsListening) {
      const isListening = this.getIsListening();
      return isListening;
    }
    
    // If no listening state callback is available, return false for safety
    return false;
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
