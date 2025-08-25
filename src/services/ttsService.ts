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
  private backgroundCleanupInterval: NodeJS.Timeout | null = null; // Background cleanup thread
  private isBackgroundCleanupRunning = false; // Flag to prevent multiple cleanup threads
  private backgroundCleanupStopTimeout: NodeJS.Timeout | null = null; // Timeout to stop cleanup after 1 minute
  private minimumWaitTimeForResume = 500; // 0.5 second minimum


  constructor(serverUrl?: string) {
    // Use environment variable if available, otherwise detect current port dynamically
    this.serverUrl = serverUrl || 
      process.env.REACT_APP_TTS_SERVER_URL || 
      this.getDefaultTTSUrl();
    
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
    // console.log(`🔗 TTS Service auto-detected URL: ${url}`);
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

  /**
   * Start background cleanup thread that runs every 50ms when TTS is active
   */
  private startBackgroundCleanup() {
    if (this.isBackgroundCleanupRunning) {
      // console.log('🧹 Background cleanup thread already running');
      return;
    }

    // console.log('🚀 Starting background cleanup thread (50ms interval)');
    this.isBackgroundCleanupRunning = true;

    this.backgroundCleanupInterval = setInterval(() => {
      // Only run cleanup when TTS is active (has audio queue or active session)
      const isTTSActive = this.audioQueue.length > 0 || this.currentSession !== null || this.isPlayingAudio;
      
      if (isTTSActive) {
        // Get current message ID from centralized function and destroy old threads
        this.destroyThreadsForOldMessages();
      }
    }, 50); // Run every 50ms
  }

  /**
   * Stop background cleanup thread
   */
  private stopBackgroundCleanup() {
    if (!this.isBackgroundCleanupRunning) {
      return;
    }

    // console.log('🛑 Stopping background cleanup thread');
    
    if (this.backgroundCleanupInterval) {
      clearInterval(this.backgroundCleanupInterval);
      this.backgroundCleanupInterval = null;
    }
    
    this.isBackgroundCleanupRunning = false;
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
      // console.log(`🔌 TTS Connect: Starting connection attempt to ${this.serverUrl}`);
      // console.log(`🔌 TTS Connect: Current WebSocket state: ${this.ws ? this.getWebSocketStateString(this.ws.readyState) : 'null'}`);
      // console.log(`🔌 TTS Connect: Reconnect attempts so far: ${this.reconnectAttempts}/${this.maxReconnectAttempts}`);
      
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // console.log('✅ TTS Connect: WebSocket already open, resolving immediately');
        resolve();
        return;
      }

      if (this.ws && this.ws.readyState === WebSocket.CONNECTING) {
        // console.log('⏳ TTS Connect: WebSocket already connecting, waiting for result...');
        // Wait for the existing connection attempt
        const checkConnection = () => {
          if (this.ws?.readyState === WebSocket.OPEN) {
            // console.log('✅ TTS Connect: Existing connection attempt succeeded');
            resolve();
          } else if (this.ws?.readyState === WebSocket.CLOSED || this.ws?.readyState === WebSocket.CLOSING) {
            // console.log('❌ TTS Connect: Existing connection attempt failed, starting new attempt');
            this.connect().then(resolve).catch(reject);
          } else {
            setTimeout(checkConnection, 100);
          }
        };
        checkConnection();
        return;
      }

      // console.log('🔄 TTS Connect: Updating status to connecting...');
      this.updateStatus('connecting');

      try {
        // console.log(`🚀 TTS Connect: Creating new WebSocket connection to ${this.serverUrl}`);
        // console.log(`🚀 TTS Connect: Browser location: ${window.location.href}`);
        // console.log(`🚀 TTS Connect: Protocol: ${window.location.protocol}, Host: ${window.location.hostname}, Port: ${window.location.port}`);
        
        this.ws = new WebSocket(this.serverUrl);
        // console.log(`✅ TTS Connect: WebSocket object created successfully`);
        // console.log(`🔍 TTS Connect: Initial WebSocket state: ${this.getWebSocketStateString(this.ws.readyState)}`);

        this.ws.onopen = (event) => {
          // console.log('🎉 TTS WebSocket CONNECTED successfully!');
          // console.log('🎉 TTS Connect: Connection event details:', {
          //   url: this.serverUrl,
          //   readyState: this.getWebSocketStateString(this.ws!.readyState),
          //   protocol: this.ws!.protocol,
          //   extensions: this.ws!.extensions,
          //   timestamp: new Date().toISOString()
          // });
          
          this.reconnectAttempts = 0;
          // console.log('🔄 TTS Connect: Reset reconnect attempts to 0');
          // console.log('🔄 TTS Connect: Updating status to connected...');
          this.updateStatus('connected');
          
          // console.log('✅ TTS Connect: Resolving connection promise');
          resolve();
        };

        this.ws.onclose = (event) => {
          // console.log('🔌 TTS WebSocket CLOSED');
          // console.log('🔌 TTS Close: Event details:', {
          //   code: event.code,
          //   reason: event.reason || 'No reason provided',
          //   wasClean: event.wasClean,
          //   timestamp: new Date().toISOString(),
          //   url: this.serverUrl
          // });
          // console.log('🔌 TTS Close: Close code meaning:', this.getCloseCodeMeaning(event.code));
          
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
          
          // console.log('🔄 TTS Error: Updating status to disconnected...');
          this.updateStatus('disconnected');
          
          // console.log('❌ TTS Error: Rejecting connection promise');
          reject(error);
        };

        this.ws.onmessage = (event) => {
          //console.log('📨 TTS WebSocket: Received message');
          //console.log('📨 TTS Message: Data preview:', event.data.substring(0, 200) + (event.data.length > 200 ? '...' : ''));
          this.handleMessage(event.data);
        };

        // console.log('🔧 TTS Connect: All event handlers attached');

      } catch (error) {
        console.error('💥 TTS Connect: EXCEPTION during WebSocket creation!');
        console.error('💥 TTS Connect: Exception details:', {
          error: error,
          message: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : 'No stack trace',
          timestamp: new Date().toISOString(),
          url: this.serverUrl
        });
        
        // console.log('🔄 TTS Connect: Updating status to disconnected due to exception...');
        this.updateStatus('disconnected');
        
        // console.log('❌ TTS Connect: Rejecting promise due to exception');
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

    // Start background cleanup thread when TTS becomes active
    this.startBackgroundCleanup();

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
      language: this.settings.language,
      assistantMessageId: assistantMessageId // Include message ID in the request
    };

    this.ws?.send(JSON.stringify(message));
  }

  /**
   * Check if the audio item should be played based on message ID match
   * If message IDs don't match, shift (remove) the item from queue and return false
   * If they match or no check needed, return true
   */
  private shouldPlayAudioItem(audioItem: TTSQueueItem): boolean {
    const currentMsgId = this.getCurrentMsgId ? this.getCurrentMsgId() : null;
    
    // Check if message IDs match
    if (currentMsgId === audioItem.assistantMessageId) {
      return true; // Message IDs match, allow playing
    }
    
    // Message IDs don't match - shift (remove) this audio from queue
    console.log(`🔇 Shifting audio from queue - message ID mismatch: current=${currentMsgId}, audio=${audioItem.assistantMessageId}`);
    
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
    
    return false; // Audio was removed, don't play
  }

  /**
   * Destroy all audio threads that belong to old assistant messages
   * Only keep threads for the current assistant message
   * Uses centralized getCurrentMsgId function to get the current message ID
   */
  private destroyThreadsForOldMessages() {
    // Always use the centralized getCurrentMsgId function to get the current message ID
    const currentMsgId = this.getCurrentMsgId ? this.getCurrentMsgId() : null;
    
    // console.log(`🧹 Using centralized getCurrentMsgId: ${currentMsgId} (function exists: ${!!this.getCurrentMsgId})`);
    if (currentMsgId === null || currentMsgId === "DESTROY_ALL") {
      // console.log(`💥 DESTROYING ALL MESSAGE THREADS - No filtering, destroy everything`);      
      // Destroy ALL threads regardless of message ID
      const threadsToDestroy = [...this.audioQueue]; // Copy all threads for destruction
      const threadsToKeep: TTSQueueItem[] = []; // Keep nothing
      
      if (threadsToDestroy.length > 0) {
        // console.log(`💥 Destroying ALL ${threadsToDestroy.length} threads (DESTROY_ALL mode)`);
        
        // Destroy all threads
        threadsToDestroy.forEach((item, index) => {
          try {
            const audio = item.audio;
            
            // Stop playback if playing
            if (!audio.paused) {
              audio.pause();
              // console.log(`💥 Force stopped audio ${index} (msg: ${item.assistantMessageId || 'unknown'}) - DESTROY_ALL`);
            }
            
            // Reset audio completely
            audio.currentTime = 0;
            audio.volume = 0;
            
            // Remove all event listeners
            audio.onended = null;
            audio.onerror = null;
            audio.onloadstart = null;
            audio.oncanplay = null;
            audio.onloadeddata = null;
            audio.onpause = null;
            audio.onplay = null;
            
            // Destroy blob URL to free memory
            if (audio.src && audio.src.startsWith('blob:')) {
              URL.revokeObjectURL(audio.src);
              // console.log(`💥 Destroyed blob URL for audio ${index} - DESTROY_ALL`);
            }
            
            // Clear source and force reload
            audio.src = '';
            audio.srcObject = null;
            audio.load();
            
            // console.log(`💥 DESTROYED audio thread ${index} (msg: ${item.assistantMessageId || 'unknown'}) - DESTROY_ALL`);
          } catch (error) {
            console.warn(`⚠️ Error destroying audio thread ${index} in DESTROY_ALL mode:`, error);
          }
        });
        
        // Update the queue to be empty
        this.audioQueue = threadsToKeep; // Empty array
        
        // Reset current playing audio since we destroyed everything
        // console.log(`💥 Resetting current playing audio - DESTROY_ALL mode`);
        this.currentPlayingAudio = null;
        this.pausedAudioTime = 0;
        this.isPlayingAudio = false;
        
        // console.log(`✅ DESTROYED ALL ${threadsToDestroy.length} threads - DESTROY_ALL completed`);
      } else {
        // console.log(`✅ No threads to destroy in DESTROY_ALL mode`);
      }
      
      return; // Exit early for DESTROY_ALL mode
    }
    
    // console.log(`🧹 DESTROYING OLD MESSAGE THREADS AND NULL MESSAGE IDs - keeping only: ${currentMsgId}`);
    
    // Find threads that are NOT equal to current message ID (destroy old/different message threads)
    const threadsToDestroy = this.audioQueue.filter(item => 
      item.assistantMessageId !== currentMsgId
    );
    
    // Keep threads that match the current message ID exactly
    const threadsToKeep = this.audioQueue.filter(item => 
      item.assistantMessageId === currentMsgId
    );
    
    if (threadsToDestroy.length > 0) {
      // console.log(`💥 Destroying ${threadsToDestroy.length} old message threads`);
      
      // Destroy old threads
      threadsToDestroy.forEach((item, index) => {
        try {
          const audio = item.audio;
          
          // Stop playback if playing
          if (!audio.paused) {
            audio.pause();
            // console.log(`💥 Force stopped old message audio ${index} (msg: ${item.assistantMessageId})`);
          }
          
          // Reset audio completely
          audio.currentTime = 0;
          audio.volume = 0;
          
          // Remove all event listeners
          audio.onended = null;
          audio.onerror = null;
          audio.onloadstart = null;
          audio.oncanplay = null;
          audio.onloadeddata = null;
          audio.onpause = null;
          audio.onplay = null;
          
          // Destroy blob URL to free memory
          if (audio.src && audio.src.startsWith('blob:')) {
            URL.revokeObjectURL(audio.src);
            // console.log(`💥 Destroyed blob URL for old message audio ${index}`);
          }
          
          // Clear source and force reload
          audio.src = '';
          audio.srcObject = null;
          audio.load();
          
          // console.log(`💥 DESTROYED old message audio thread ${index} (msg: ${item.assistantMessageId})`);
        } catch (error) {
          console.warn(`⚠️ Error destroying old message audio thread ${index}:`, error);
        }
      });
      
      // Update the queue to only contain current message threads
      this.audioQueue = threadsToKeep;
      
      // Reset current playing audio ONLY if it belonged to an old message (different message ID)
      // If we're still on the same message ID, PROTECT the paused audio reference
      if (this.currentPlayingAudio && 
          this.currentPlayingAudio.assistantMessageId && 
          this.currentPlayingAudio.assistantMessageId !== currentMsgId) {
        console.log(`💥 Clearing paused audio reference - message ID changed from ${this.currentPlayingAudio.assistantMessageId} to ${currentMsgId}`);
        this.currentPlayingAudio = null;
        this.pausedAudioTime = 0;
        this.isPlayingAudio = false;
      } else if (this.currentPlayingAudio && 
                 this.currentPlayingAudio.assistantMessageId === currentMsgId) {
        console.log(`🛡️ PROTECTING paused audio reference - still on same message ID: ${currentMsgId}`);
        // Keep the paused audio reference since we're still on the same message
      }
      
      // console.log(`✅ Kept ${threadsToKeep.length} threads for current message: ${currentMsgId}`);
    } else {
      // console.log(`✅ No old message threads to destroy for: ${currentMsgId}`);
    }
  }

  public async stop() {
    
    // STEP 0: Set centralized message ID to null to trigger background cleanup to destroy ALL threads
    if (this.setCurrentMsgId) {
      this.setCurrentMsgId(null); // This will trigger destroyThreadsForOldMessages to destroy ALL threads
    }
    
    // STEP 0.5: Schedule background cleanup thread to stop after 1 minute
    if (this.isBackgroundCleanupRunning) {
      
      // Clear any existing stop timeout
      if (this.backgroundCleanupStopTimeout) {
        clearTimeout(this.backgroundCleanupStopTimeout);
      }
      
      // Schedule stop after 1 minute (60000ms)
      this.backgroundCleanupStopTimeout = setTimeout(() => {
        this.stopBackgroundCleanup();
        this.backgroundCleanupStopTimeout = null;
      }, 60000); // 1 minute
    }
    
    // STEP 1: Immediately stop all currently playing audio
    this.audioQueue.forEach((item, index) => {
      try {
        const audio = item.audio;
        if (!audio.paused) {
          audio.pause();
          audio.currentTime = 0;
        }
      } catch (error) {
        console.warn(`⚠️ Error force stopping audio ${index}:`, error);
      }
    });
    
    // STEP 2: End streaming session first if active
    if (this.currentSession) {
      this.endStreaming();
    }
    
    // STEP 3: Send stop command to server
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = { action: 'stop' };
      this.ws.send(JSON.stringify(message));
    }
    
    // STEP 3.5: Wait 500ms for server and processes to respond properly
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // STEP 4: Force destroy all audio threads and reset everything
    this.forceDestroyAllAudioThreads();
    
    // STEP 5: Reset all flags and state for fresh start
    this.isPaused = false;
    this.isPlayingAudio = false;
    this.currentSession = null;
    
  }

  public pause() {
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = { action: 'pause' };
      this.ws.send(JSON.stringify(message));
    }
    
    // Set paused state first
    this.isPaused = true;
    
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
  }

  public async resume() {
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const message = { action: 'resume' };
      this.ws.send(JSON.stringify(message));
    }
    
    // Check if at least 1 second has passed since the last pause
    if (this.lastPauseTimestamp > 0) {
      const timeSincePause = Date.now() - this.lastPauseTimestamp;
      
      if (timeSincePause < this.minimumWaitTimeForResume) {
        const remainingWaitTime = this.minimumWaitTimeForResume - timeSincePause;
        //await new Promise(resolve => setTimeout(resolve, remainingWaitTime));
        this.resume();
        return;
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

  public async clear(): Promise<boolean> {
    
    // STEP 1: End streaming session first if active
    if (this.currentSession) {
      this.endStreaming();
      await new Promise(resolve => setTimeout(resolve, 50)); // Wait for server to process
    }
    
    // STEP 2: Send multiple clear commands to server to ensure buffer clearing
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      
      // Send stop command first
      this.ws.send(JSON.stringify({ action: 'stop' }));
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Send clear command
      this.ws.send(JSON.stringify({ action: 'clear' }));
      await new Promise(resolve => setTimeout(resolve, 50));
      
      // Send additional clear command to ensure server buffer is empty
      this.ws.send(JSON.stringify({ action: 'clear' }));
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    // STEP 3: Reset all client state immediately
    this.isPaused = false;
    this.currentSession = null;
    
    // STEP 4: Aggressively clear client-side audio buffers
    this.clearAudioQueue();
    
    // STEP 5: Additional client-side buffer clearing
    
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
      const allAudioStopped = this.audioQueue.every(item => 
        item.audio.paused && item.audio.currentTime === 0 && item.audio.volume === 0
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
        break;
      }
    }
    
    if (!cleared) {
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
    
    return cleared;
  }

  private clearAudioQueue() {
    
    // Stop and destroy ALL audio elements in queue
    this.audioQueue.forEach((item, index) => {
      try {
        const audio = item.audio;
        
        // Stop playback immediately
        if (!audio.paused) {
          audio.pause();
        }
        
        // Reset to beginning
        audio.currentTime = 0;
        
        // Remove all event listeners to prevent memory leaks and callback loops
        audio.onended = null;
        audio.onerror = null;
        audio.onloadstart = null;
        audio.oncanplay = null;
        audio.onloadeddata = null;
        audio.onpause = null;
        audio.onplay = null;
        
        // Revoke any blob URLs to free memory
        if (audio.src && audio.src.startsWith('blob:')) {
          URL.revokeObjectURL(audio.src);
        }
        
        // Clear the src to release audio data
        audio.src = '';
        audio.load(); // Force reload to clear internal buffers
        
      } catch (error) {
        console.warn(`⚠️ Error destroying audio element ${index}:`, error);
      }
    });
    
    // Completely replace the array (don't just clear it)
    this.audioQueue = [];
    
    // Reset all session state
    this.currentSession = null;
    this.isPaused = false;
    this.isPlayingAudio = false; // Reset the playing flag
    this.currentPlayingAudio = null; // Reset thread tracking
    this.pausedAudioTime = 0; // Reset paused position
    
    // Force garbage collection hint (browser may or may not honor this)
    if (window.gc) {
      window.gc();
    }
  }

  private forceDestroyAllAudioThreads() {
    
    // STEP 1: Immediately stop and destroy all audio in queue
    this.audioQueue.forEach((item, index) => {
      try {
        const audio = item.audio;
        
        // Force stop playback
        if (!audio.paused) {
          audio.pause();
        }
        
        // Reset audio completely
        audio.currentTime = 0;
        audio.volume = 0;
        
        // Remove ALL possible event listeners to kill threads
        audio.onended = null;
        audio.onerror = null;
        audio.onloadstart = null;
        audio.oncanplay = null;
        audio.onloadeddata = null;
        audio.onpause = null;
        audio.onplay = null;
        audio.onplaying = null;
        audio.onstalled = null;
        audio.onsuspend = null;
        audio.ontimeupdate = null;
        audio.onvolumechange = null;
        audio.onwaiting = null;
        audio.onabort = null;
        audio.oncanplaythrough = null;
        audio.ondurationchange = null;
        audio.onemptied = null;
        audio.onloadedmetadata = null;
        audio.onloadstart = null;
        audio.onprogress = null;
        audio.onratechange = null;
        audio.onseeked = null;
        audio.onseeking = null;
        
        // Destroy blob URL to free memory and kill processes
        if (audio.src && audio.src.startsWith('blob:')) {
          URL.revokeObjectURL(audio.src);
          console.log(`💥 Destroyed blob URL for audio thread ${index} (msg: ${item.assistantMessageId || 'unknown'})`);
        }
        
        // Clear source and force reload to kill internal threads
        audio.src = '';
        audio.srcObject = null;
        audio.load(); // Force browser to release internal audio threads
        
        // Set audio to null-like state
        audio.preload = 'none';
        
        console.log(`💥 DESTROYED audio thread ${index} completely (msg: ${item.assistantMessageId || 'unknown'})`);
      } catch (error) {
        console.warn(`⚠️ Error force destroying audio thread ${index}:`, error);
      }
    });
    
    // STEP 2: Clear the entire queue array
    this.audioQueue.length = 0; // Clear array efficiently
    this.audioQueue = []; // Create new array to ensure no references remain
    
    // STEP 3: Force stop any remaining audio in the browser
    try {
      const allBrowserAudio = document.querySelectorAll('audio');
      allBrowserAudio.forEach((audio, index) => {
        if (audio.src && audio.src.startsWith('blob:')) {
          audio.pause();
          audio.currentTime = 0;
          audio.volume = 0;
          audio.src = '';
          audio.load();
          console.log(`💥 Force stopped browser audio element ${index}`);
        }
      });
    } catch (error) {
      console.warn('⚠️ Error force stopping browser audio elements:', error);
    }
    
    // STEP 4: Reset all internal state completely
    this.isPlayingAudio = false;
    this.isPaused = false;
    this.currentSession = null;
    this.currentPlayingAudio = null; // Reset thread tracking
    this.pausedAudioTime = 0; // Reset paused position
    
    // STEP 5: Force aggressive garbage collection
    if (window.gc) {
      window.gc();
    }
    
    // STEP 6: Additional cleanup - clear any potential audio contexts
    try {
      // Clear any Web Audio API contexts that might be lingering
      if (window.AudioContext || (window as any).webkitAudioContext) {
        // Note: We don't create audio contexts in this service, but this is for safety
      }
    } catch (error) {
      // Ignore errors in audio context cleanup
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

    // Destroy threads using centralized message ID
    this.destroyThreadsForOldMessages();

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

  public sendTextChunk(textChunk: string, assistantMessageId?: string | null) {
    // Only send text chunks for English language
    if (!this.isEnglishLanguage()) {
      console.log(`🚫 Skipping TTS text chunk for non-English language: ${this.settings.language}`);
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN && this.currentSession) {
      const message = {
        text_chunk: textChunk,
        assistantMessageId: assistantMessageId // Include message ID in the request
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
      console.log(`🌐 No Vosk model selected - TTS will be skipped`);
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
    
    // console.log(`🔍 Checking Vosk model "${modelName}" for English: ${isEnglish ? 'YES' : 'NO'}`);
    
    return isEnglish;
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

  private handleMessage(data: string) {
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
          console.log('TTS Streaming started:', message.session_id);
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
            // Server confirmed cache clearing - do additional client-side cleanup
            this.clearAudioQueue(); // Double-clear to be absolutely sure
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
          }
      }
    } catch (error) {
      console.error('Failed to parse TTS message:', error);
    }
  }

  private playAudio(audioData: string, assistantMessageId?: string) {
    try {
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
          console.log(`🎵 Removed failed audio from queue (msg: ${currentItem.assistantMessageId || 'unknown'}). Remaining: ${this.audioQueue.length}`);
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
      if (this.audioQueue.length === 1 && !this.isPaused) {
        this.playNextInQueue();
      } 
      
    } catch (error) {
      console.error('Failed to process TTS audio:', error);
    }
  }

  private playNextInQueue() {
    // Don't play if paused or queue is empty
    if (this.isPaused) {
      console.log(`🎵 Queue playback paused. Queue length: ${this.audioQueue.length}`);
      return;
    }
    
    if (this.audioQueue.length === 0) {
      console.log('🎵 Queue is empty, nothing to play');
      this.isPlayingAudio = false; // Reset flag when queue is empty
      return;
    }
    
    // CRITICAL: Prevent double-play with flag
    if (this.isPlayingAudio) {
      //console.log('🎵 Audio is already being played, preventing double-play');
      return;
    }
    
    const item = this.audioQueue[0];
    if (!item) {
      console.log('🎵 No audio item found at queue position 0');
      this.isPlayingAudio = false;
      return;
    }
    
    const audio = item.audio;
    
    // Check if the audio item should be played based on message ID match
    if (!this.shouldPlayAudioItem(item)) {
      // Audio was removed due to message ID mismatch, try next in queue
      this.isPlayingAudio = false;
      this.playNextInQueue();
      return;
    }
    
    // CRITICAL: Additional check if audio is already playing
    if (!audio.paused) {
      return;
    }
    
    
    // Set flag to prevent double-play
    this.isPlayingAudio = true;
    
    // Play the audio
    audio.play().then(() => {}).catch((error: any) => {
      console.error('🎵 Failed to start audio playback:', error);
      
      // Reset flag on failure
      this.isPlayingAudio = false;
      
      // Remove failed audio and try next
      const failedItem = this.audioQueue.shift();
      if (failedItem) {
        const failedAudio = failedItem.audio;
        failedAudio.onended = null;
        failedAudio.onerror = null;
        if (failedAudio.src && failedAudio.src.startsWith('blob:')) {
          URL.revokeObjectURL(failedAudio.src);
        }
      }
      
      // CRITICAL: Recursively try next audio after a small delay to prevent stack overflow
      setTimeout(() => {
        if (!this.isPaused && this.audioQueue.length > 0) {
          console.log('🎵 Retrying with next audio after failure...');
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
