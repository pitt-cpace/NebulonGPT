import React, { useState, useRef, useEffect, useCallback } from 'react';
import katex from 'katex';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import 'katex/dist/katex.min.css';
import {
  Box,
  Typography,
  TextField,
  IconButton,
  Paper,
  Divider,
  AppBar,
  Toolbar,
  Menu,
  MenuItem,
  Button,
  Grid,
  Card,
  CardContent,
  CardActionArea,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Chip,
  Slider,
} from '@mui/material';
import {
  Send as SendIcon,
  Stop as StopIcon,
  Menu as MenuIcon,
  Mic as MicIcon,
  MoreVert as MoreVertIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  Add as AddIcon,
  Description as DescriptionIcon,
  Close as CloseIcon,
  InsertDriveFile as InsertDriveFileIcon,
  Image as ImageIcon,
  People as PeopleIcon,
  KeyboardArrowDown as ArrowDownIcon,
  Refresh as RefreshIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
  CheckCircle as CheckCircleIcon,
  ContentCopy as ContentCopyIcon,
} from '@mui/icons-material';
import ReactMarkdown from 'react-markdown';
import { ModelType, ChatType, MessageType, FileAttachment } from '../types';
import { getSuggestedPrompts } from '../services/api';
import { VoskRecognitionService } from '../services/vosk';
import { ttsService } from '../services/ttsService';
import { electronApi } from '../services/electronApi';
import { useStickyAutoScroll } from '../hooks/useStickyAutoScroll';
import { getTextDirectionStyles, analyzeMixedContent } from '../services/rtlDetection';
import { OllamaStatus } from '../services/ollamaStatus';
import { takeThinkingThenBody } from '../services/thinkingExtractor';
import * as styles from '../styles/components/ChatArea.styles';
import WaveformVisualization from './WaveformVisualization';
import InputArea from './InputArea';

interface ChatAreaProps {
  chat: ChatType | null;
  model: ModelType | null;
  models: ModelType[];
  loading: boolean;
  onSendMessage: (content: string, attachments?: FileAttachment[]) => void;
  onStopResponse: () => Promise<void>;
  onToggleSidebar: () => void;
  onSelectModel: (model: ModelType) => void;
  sidebarOpen: boolean;
  voskRecognition?: VoskRecognitionService | null;
  micStoppedTrigger?: number;
  onMicStart?: React.MutableRefObject<(() => Promise<void>) | null>;
  onMicStop?: React.MutableRefObject<(() => Promise<void>) | null>;
  onListeningStateChange?: (listening: boolean) => void;
  onClearChatInput?: React.MutableRefObject<(() => void) | null>;
  onHideLoadingAnimation?: React.MutableRefObject<(() => void) | null>;
  getCurrentMsgId?: () => string | null;
  ollamaStatus: OllamaStatus;
  onRefreshOllamaStatus: () => Promise<OllamaStatus>;
  onCreateNewChat: () => Promise<void>;
}

const ChatArea: React.FC<ChatAreaProps> = ({
  chat,
  model,
  models,
  loading,
  onSendMessage,
  onStopResponse,
  onToggleSidebar,
  onSelectModel,
  sidebarOpen,
  voskRecognition,
  micStoppedTrigger,
  onMicStart,
  onMicStop,
  onListeningStateChange,
  onClearChatInput,
  onHideLoadingAnimation,
  ollamaStatus,
  onRefreshOllamaStatus,
  onCreateNewChat,
}) => {
  const [message, setMessage] = useState('');
  const messageRef = useRef('');
  const attachmentsRef = useRef<FileAttachment[]>([]);
  const [modelMenuAnchor, setModelMenuAnchor] = useState<null | HTMLElement>(null);
  const [attachMenuAnchor, setAttachMenuAnchor] = useState<null | HTMLElement>(null);
  const [contributorsOpen, setContributorsOpen] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isProcessingMic, setIsProcessingMic] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [isTurningOff, setIsTurningOff] = useState(false);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [defaultModelId, setDefaultModelId] = useState<string | null>(null);
  const [detectionSensitivity, setDetectionSensitivity] = useState<number>(100); // Default sensitivity display value (inverse of internal 0)
  const [showLoadingAnimation, setShowLoadingAnimation] = useState(false);
  const [currentTokens, setCurrentTokens] = useState(0);
  const [isContextExceeded, setIsContextExceeded] = useState(false);
  const [contextWarning, setContextWarning] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const onClearInputAreaRef = useRef<(() => void) | null>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const finalTranscriptRef = useRef<string>('');
  const interimTranscriptRef = useRef<string>('');
  const loadingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const suggestedPrompts = getSuggestedPrompts();

  // Function to detect "stop stop" command
  const detectStopCommand = useCallback((text: string): boolean => {
    if (!text || typeof text !== 'string') return false;
    
    // Normalize the text: lowercase, remove extra spaces
    const normalizedText = text.toLowerCase()
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .trim();
    
    // Check for "stop stop" pattern
    const stopStopPattern = /\bstop\s+stop\b/;
    
    if (stopStopPattern.test(normalizedText)) {
      console.log(`🎯 "Stop stop" command detected in text: "${text}"`);
      return true;
    }
    
    return false;
  }, []);

  // Use ref for typing state to avoid re-renders
  const userTypingRef = useRef(false);
  
  // Initialize the battle-tested auto-scroll system
  const { isPinned, unread, showJumpButton, onNewContent, jumpToLatest, setUserTyping } = useStickyAutoScroll({
    containerRef: messagesContainerRef,
    endRef: messagesEndRef,
    bottomThreshold: 64,
    smoothBehavior: "smooth",
    generating: loading,
    chatId: chat?.id, // Add chatId to trigger re-initialization when chat changes
  });
  
  // Typing timeout ref
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // Wrapper to update both ref and hook without causing re-renders
  const handleUserTyping = useCallback((typing: boolean) => {
    userTypingRef.current = typing;
    setUserTyping(typing);
  }, [setUserTyping]);

  const handleSendMessage = useCallback(async (messageText: string, messageAttachments?: FileAttachment[]) => {
    // Check Ollama status before sending message
    // Refresh status to get latest state
    const status = await onRefreshOllamaStatus();
    if (!status.isAvailable) {
      alert('Cannot send message: Ollama is not available. Please check your Ollama connection.');
      return;
    }
    
    // Check if models are available after refreshing status
    if (models.length === 0) {
      alert('Cannot send message: No models are installed. Please install a model first using the commands shown in the model dropdown.');
      return;
    }
    
    // First scroll to bottom smoothly, then send message
    jumpToLatest('smooth');
    
    // Wait for smooth scroll animation to complete
    await new Promise(resolve => setTimeout(resolve, 700));
    
    // Send message with any attachments
    onSendMessage(messageText, messageAttachments);
  }, [models.length, loading, onSendMessage, jumpToLatest, onRefreshOllamaStatus]);

  // Trigger auto-scroll when new assistant messages arrive (not user messages)
  const prevMessagesLengthRef = useRef(0);
  useEffect(() => {
    if (!chat?.messages || chat.messages.length === 0) {
      prevMessagesLengthRef.current = 0;
      return;
    }
    
    // Only trigger if message count increased (new message added)
    // Don't trigger on chat switch (different message array with same or different length)
    if (chat.messages.length > prevMessagesLengthRef.current) {
      const lastMessage = chat.messages[chat.messages.length - 1];
      // Only trigger auto-scroll for assistant messages (LLM responses)
      if (lastMessage.role === 'assistant') {
        onNewContent();
      }
    }
    
    prevMessagesLengthRef.current = chat.messages.length;
  }, [chat?.messages, onNewContent]);

  // Reset typing state when chat changes and scroll to bottom
  useEffect(() => {
    userTypingRef.current = false;
    
    // Scroll to bottom when switching chats
    if (chat?.id && messagesContainerRef.current) {
      setTimeout(() => {
        if (messagesContainerRef.current) {
          const container = messagesContainerRef.current;
          container.scrollTop = container.scrollHeight;
        }
      }, 10);
    }
  }, [chat?.id]);

  // Load default model ID from localStorage on component mount
  useEffect(() => {
    try {
      const savedDefaultModelId = localStorage.getItem('defaultModelId');
      setDefaultModelId(savedDefaultModelId);
    } catch (error) {
      console.error('Failed to load default model ID from localStorage:', error);
    }
  }, []);

  // Initialize detection sensitivity from Vosk service (inverse relationship)
  useEffect(() => {
    if (voskRecognition) {
      const internalSensitivity = voskRecognition.getDetectionSensitivity();
      const displayValue = 100 - internalSensitivity; // Inverse for display
      setDetectionSensitivity(displayValue);
    }
  }, [voskRecognition]);

  // Handle detection sensitivity change (inverse relationship)
  const handleDetectionSensitivityChange = useCallback((event: Event, newValue: number | number[]) => {
    const displayValue = Array.isArray(newValue) ? newValue[0] : newValue;
    const internalValue = 100 - displayValue; // Inverse relationship
    
    setDetectionSensitivity(displayValue);
    
    if (voskRecognition) {
      voskRecognition.updateSettings({ detectionSensitivity: internalValue });
      voskRecognition.saveSettings();
    }
  }, [voskRecognition]);

  // Function to set detection sensitivity to 100
  const handleSetSensitivityTo100 = useCallback(() => {
    const displayValue = 100;
    const internalValue = 100 - displayValue; // Inverse relationship
    
    setDetectionSensitivity(displayValue);
    
    if (voskRecognition) {
      voskRecognition.updateSettings({ detectionSensitivity: internalValue });
      voskRecognition.saveSettings();
      console.log(`🎚️ Detection sensitivity set to 100 (internal: ${internalValue})`);
    }
  }, [voskRecognition]);

  // Real-time token calculation function with intelligent history management
  const calculateCurrentTokens = useCallback(async () => {
    try {
      const { tokenCountingService } = await import('../services/tokenCountingService');
      
      // Get current context length from settings (localStorage)
      let contextLength = 4096; // Default fallback
      try {
        const savedContextLength = localStorage.getItem('contextLength');
        if (savedContextLength) {
          const parsed = parseInt(savedContextLength, 10);
          if (!isNaN(parsed) && parsed >= 2000) {
            contextLength = parsed;
          }
        }
      } catch (error) {
        console.error('Error reading context length from settings:', error);
      }
      
      // Calculate tokens for CURRENT input (prompt + attachments)
      // Use refs which are updated from InputArea without causing re-renders
      const currentMessage = messageRef.current;
      const currentAttachments = attachmentsRef.current;
      
      const currentPromptTokens = tokenCountingService.countTokens(currentMessage) + 10; // +10 for overhead
      
      let currentAttachmentsTokens = 0;
      for (const attachment of currentAttachments) {
        currentAttachmentsTokens += tokenCountingService.countAttachmentTokens(attachment);
      }
      
      // Calculate how much conversation history can be included
      const historyAllowance = tokenCountingService.calculateHistoryAllowance(
        currentPromptTokens,
        currentAttachmentsTokens,
        contextLength
      );
      
      // Get previous messages (excluding the one we're about to send)
      const previousMessages = chat?.messages || [];
      
      // Calculate tokens from previous conversation that will be included
      let historyTokensUsed = 0;
      if (previousMessages.length > 0 && historyAllowance.historyTokens > 0) {
        // Count tokens from most recent messages until we hit the limit
        for (let i = previousMessages.length - 1; i >= 0 && historyTokensUsed < historyAllowance.historyTokens; i--) {
          const msgTokens = tokenCountingService.countMessageTokens(previousMessages[i]);
          if (historyTokensUsed + msgTokens <= historyAllowance.historyTokens) {
            historyTokensUsed += msgTokens;
          } else {
            break; // Can't fit this message
          }
        }
      }
      
      // Total tokens that will be sent = current + attachments + history
      const totalTokens = currentPromptTokens + currentAttachmentsTokens + historyTokensUsed;
      
      setCurrentTokens(totalTokens);
      
      // Check if we've exceeded the available context (reserve 500 for response)
      const reservedForResponse = 500;
      const maxAllowedTokens = contextLength - reservedForResponse;
      const isExceeded = totalTokens > maxAllowedTokens;
      
      setIsContextExceeded(isExceeded);
      
      // Determine warning state based on token usage
      const hasUserInput = currentMessage.trim().length > 0 || currentAttachments.length > 0;
      
      // ALWAYS update or clear warning to show fresh token counts
      // Calculate if history is fully reduced (cannot be reduced further)
      const totalHistoryTokens = previousMessages.length > 0 
        ? tokenCountingService.countTotalTokens(previousMessages)
        : 0;
      const hasNoHistory = totalHistoryTokens === 0;
      const isHistoryFullyReduced = historyTokensUsed === 0 && totalHistoryTokens > 0;
      
      if (isExceeded) {
        // Show red warning if: history is fully reduced OR there's no history at all
        if (isHistoryFullyReduced || hasNoHistory) {
          const historyMessage = isHistoryFullyReduced 
            ? `All previous chat history has been excluded. ` 
            : ``;
          
          setContextWarning(
            `Context limit exceeded! ~${totalTokens}/${contextLength} tokens ` +
            `(Current: ${currentPromptTokens + currentAttachmentsTokens}, Chat History Included: ${historyTokensUsed}, Safety Buffer: 500). ` +
            `${historyMessage}You must remove text/attachments or increase context length from settings before sending.`
          );
        } else {
          // History can still be reduced, don't show warning yet
          setContextWarning(null);
        }
      } else if (hasUserInput && totalTokens > maxAllowedTokens - 500) {
        // Show orange warning if: history is fully reduced OR there's no history at all
        if (isHistoryFullyReduced || hasNoHistory) {
          const safeArea = maxAllowedTokens - totalTokens;
          const historyMessage = isHistoryFullyReduced 
            ? `All previous chat history has been excluded. ` 
            : ``;
          
          setContextWarning(
            `Approaching context limit: ${totalTokens}/${contextLength} tokens ` +
            `(Current: ${currentPromptTokens + currentAttachmentsTokens}, Chat History Included: ${historyTokensUsed}, Safety Buffer: 500). ` +
            `${safeArea} tokens remaining. ${historyMessage}Consider keeping your message shorter or increase context length from settings.`
          );
        } else {
          // History can still be reduced, don't show warning
          setContextWarning(null);
        }
      } else {
        // Clear warning in all other cases (safe zone or no input)
        setContextWarning(null);
      }
       
    } catch (error) {
      console.error('Error calculating real-time tokens:', error);
    }
  }, [chat]);

  // Listen for localStorage changes to recalculate when settings are updated
  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      // Only recalculate if context length setting changed
      if (event.key === 'contextLength' && chat) {
        console.log('🔄 Context length setting changed, recalculating tokens...');
        calculateCurrentTokens();
      }
    };

    // Listen for localStorage changes from other windows/tabs
    window.addEventListener('storage', handleStorageChange);

    // Also listen for manual localStorage updates in same window
    const originalSetItem = localStorage.setItem;
    localStorage.setItem = function(key: string, value: string) {
      const result = originalSetItem.call(this, key, value);
      if (key === 'contextLength' && chat) {
        console.log('🔄 Context length setting updated, recalculating tokens...');
        // Use setTimeout to ensure the value is saved before recalculating
        setTimeout(() => {
          calculateCurrentTokens();
        }, 100);
      }
      return result;
    };

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      // Restore original setItem (though component unmount usually means app is closing)
      localStorage.setItem = originalSetItem;
    };
  }, [calculateCurrentTokens, chat]);

  // Keep ref in sync with state
  useEffect(() => {
    interimTranscriptRef.current = interimTranscript;
  }, [interimTranscript]);

  // Initialize Vosk speech recognition event handlers
  useEffect(() => {
    if (!voskRecognition) {
      console.warn('Vosk speech recognition is not available.');
      setSpeechError('Speech recognition not available');
      return;
    }

    // Set up event handlers for the VoskRecognitionService instance
    voskRecognition.onResult(async (result: { text?: string; partial?: string }) => {
      if (result.partial) {

        // In full voice mode: if user starts speaking while LLM is generating, stop the LLM and TTS
        const ttsSettings = ttsService.getSettings();
        const isFullVoiceMode = ttsSettings.fullVoiceMode;

        // Update interim transcript for real-time display
        setInterimTranscript(result.partial);   
        
        // Check for "stop stop" command in partial results when in full voice mode
        if (isFullVoiceMode && isListening) {
          const partialLower = result.partial.toLowerCase().trim();
          if (detectStopCommand(partialLower)) {
            console.log('🛑 "Stop stop" command detected in partial result - stopping microphone');
            await stopMicListening();
            return;
          }
        }
        
        ttsService.pause();
        voskRecognition.clearSilenceTimer();
        
        // Wait 1000ms then check if partial result disappeared (filtered out as noise)
        setTimeout(() => {
          // Check if interim transcript has been cleared (indicating partial result disappeared)
          // Use ref to get current value, not closure variable
          if (interimTranscriptRef.current === '' || interimTranscriptRef.current === undefined) {
            // Partial result disappeared - resume TTS if in full voice mode and mic is listening
            const ttsSettings = ttsService.getSettings();
            if (ttsSettings.fullVoiceMode && isListening) {
              ttsService.resume();
              voskRecognition.clearSilenceTimer();
            }
            return;
          }
        }, 1000);
        
        if (isFullVoiceMode && loading && result.partial.trim().length > 0) {
          await onStopResponse(); // This will stop LLM and also clear TTS (handled in App.tsx)
          //await ttsService.stop();
        }
      }
      
      if (result.text) {  
        // Final transcript received
        finalTranscriptRef.current += result.text + ' ';
        setMessage(finalTranscriptRef.current);
        setInterimTranscript(''); // Clear interim transcript
        
        const ttsSettings = ttsService.getSettings();
        const isFullVoiceMode = ttsSettings.fullVoiceMode;

        // Check for "stop stop" command in final results when in full voice mode
        if (isFullVoiceMode && isListening) {
          const finalTextLower = finalTranscriptRef.current.toLowerCase().trim();
          if (detectStopCommand(finalTextLower)) {
            console.log('🛑 "Stop stop" command detected in final result - stopping microphone');
            await stopMicListening();
            return;
          }
        }

        ttsService.pause();
        voskRecognition.clearSilenceTimer();
        
        if (isFullVoiceMode && loading && finalTranscriptRef.current.length > 0) {
          await onStopResponse(); // This will stop LLM and also clear TTS (handled in App.tsx)
          //await ttsService.stop();
        }
      }
    });
    
    voskRecognition.onError((error: string) => {
      console.error('Vosk speech recognition error:', error);
      setSpeechError(error);
      setIsListening(false);
    });
    
    voskRecognition.onEnd(() => {
      // Check if full voice mode is enabled
      const ttsSettings = ttsService.getSettings();
      const isFullVoiceMode = ttsSettings.fullVoiceMode;
      
      if (isFullVoiceMode) {
        // In full voice mode: auto-send message but keep microphone active
        if (message.trim()) {
          // Send the voice-recognized message
          handleSendMessage(message.trim(), undefined);
          
          // Clear the message and reset transcript for next speech recognition
          setMessage('');
          finalTranscriptRef.current = '';
        }
        // Don't stop listening - keep microphone active for continuous conversation
        // Only clear interim transcript
        setInterimTranscript('');
      } else {
        // Normal mode: stop listening but DON'T auto-send (user must click send button manually)
        setIsListening(false);
        setInterimTranscript('');
        
        // No auto-send in normal mode - user must manually click send button
      }
    });

    // Clear any previous errors
    setSpeechError(null);

    // Clean up on component unmount
    return () => {
      // Cleanup handled by Vosk service
    };
  }, [voskRecognition, message, handleSendMessage, detectStopCommand, isListening, loading, onStopResponse]);

  // Handle mic stopped from settings - listen for the trigger
  useEffect(() => {
    if (micStoppedTrigger && micStoppedTrigger > 0 && voskRecognition && !voskRecognition.isCurrentlyRecording() && isListening) {
      setIsListening(false);
      setInterimTranscript('');
    }
  }, [micStoppedTrigger, voskRecognition, isListening]);

  // Dedicated function to start mic listening
  const startMicListening = useCallback(async () => {
    
    if (!voskRecognition) {
      setSpeechError('Speech recognition not available');
      return;
    }

    if (isListening) {
      return;
    }

    try {
      const modelCheck = await voskRecognition.checkModelAvailability();
      if (!modelCheck.hasModels) {
        console.error('❌ Model availability check failed:', modelCheck.errorMessage);
        setSpeechError(modelCheck.errorMessage || 'Speech recognition not available');
        throw new Error(modelCheck.errorMessage || 'Speech recognition not available');
      }
      
      // Check if a model is currently loaded on the server
      const currentModel = await voskRecognition.getServerCurrentModel();
      
      if (!currentModel || currentModel === 'none') {
        // No model loaded, auto-load default model when user clicks microphone
        
        const availableModels = await voskRecognition.getAvailableModels();
        if (availableModels.length === 0) {
          throw new Error('No speech recognition models available');
        }
        
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
          if (availableModels.includes(preferred)) {
            defaultModel = preferred;
            break;
          }
        }
        
        // If no preferred model found, use the first available model
        if (!defaultModel) {
          defaultModel = availableModels[0];
        }
        
        await voskRecognition.selectModel(defaultModel);
        // console.log(`✅ Default model loaded successfully: ${defaultModel}`);
      } 
    } catch (error) {
      console.error('❌ Failed to check/load model for speech recognition:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to prepare speech recognition';
      setSpeechError(errorMessage);
      throw error;
    }
    
    setSpeechError(null); // Clear any previous errors
    
    try {
      // Reset the final transcript when starting a new recognition session
      finalTranscriptRef.current = message;
      
      // Start recognition
      await voskRecognition.start();
      
      setIsListening(true);

    } catch (error) {
      console.error('❌ Error starting Vosk speech recognition:', error);
      setSpeechError('Failed to start Vosk speech recognition');
      throw error;
    }
  }, [isListening, message, voskRecognition]);

  // Dedicated function to stop mic listening
  const stopMicListening = useCallback(async () => {
    
    if (voskRecognition) {
      if (!isListening) {
        return;
      }
      
      try {
        await voskRecognition.stop();
      } catch (error) {
        console.error('❌ Error stopping Vosk speech recognition:', error);
        // Don't throw here, we still want to update UI state
      }
    }
    
    // Stop TTS playback
    try {
      // Stop LLM generation if it's currently running
      if (loading) {
        await onStopResponse();
      }
      await ttsService.stop();
    } catch (error) {
      console.error('❌ Error stopping TTS:', error);
    }
    
    // Update all UI states
    setIsListening(false);
    setInterimTranscript('');
  }, [voskRecognition, isListening, loading, onStopResponse]);

  // Toggle speech recognition with debounce protection
  const toggleListening = useCallback(async () => {

    
    // Prevent rapid clicks - debounce protection
    if (isProcessingMic) {
      return;
    }
    
    // Set processing state to prevent rapid clicks
    setIsProcessingMic(true);
    
    try {
      if (isListening) {
        // Check if we're in Full Voice Mode when stopping
        const ttsSettings = ttsService.getSettings();
        const isFullVoiceMode = ttsSettings.fullVoiceMode;
        
        if (isFullVoiceMode) {
          // Start the turning off animation (color change) when stopping mic in Full Voice Mode
          setIsTurningOff(true);
        }
        
        // Stop listening
        await stopMicListening();
      } else {
        // Start listening
        await startMicListening();
      }
    } catch (error) {
      console.error('❌ Error in mic toggle operation:', error);
      // Error handling is already done in individual functions
    } finally {
      // Always clear processing state after operation completes
      setIsProcessingMic(false);
    }
  }, [isListening, isProcessingMic, startMicListening, stopMicListening]);

  // Function to clear chat input
  const clearChatInput = useCallback(() => {
    setMessage('');
    setAttachments([]);
    setInterimTranscript('');
    finalTranscriptRef.current = '';
    // Also call InputArea's clear function
    if (onClearInputAreaRef.current) {
      onClearInputAreaRef.current();
    }
  }, []);

  // Function to hide loading animation
  const hideLoadingAnimation = useCallback(() => {
    setShowLoadingAnimation(false);
    // Clear the timeout as well
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }
  }, []);

  // Expose mic functions and clear function to parent components
  useEffect(() => {
    if (onMicStart) {
      onMicStart.current = startMicListening;
    }
    if (onMicStop) {
      onMicStop.current = stopMicListening;
    }
    if (onClearChatInput) {
      onClearChatInput.current = clearChatInput;
    }
    if (onHideLoadingAnimation) {
      onHideLoadingAnimation.current = hideLoadingAnimation;
    }
  }, [startMicListening, stopMicListening, clearChatInput, hideLoadingAnimation, onMicStart, onMicStop, onClearChatInput, onHideLoadingAnimation]);

  // Notify parent component when listening state changes
  useEffect(() => {
    if (onListeningStateChange) {
      onListeningStateChange(isListening);
    }
  }, [isListening, onListeningStateChange]);

  // Reset turning off state when microphone actually stops (with gradual fade)
  useEffect(() => {
    if (!isListening && isTurningOff) {
      // Add a delay for gradual disappearance when mic stops
      setTimeout(() => {
        setIsTurningOff(false);
      }, 2000); // 2 seconds gradual fade when mic stops
    }
  }, [isListening, isTurningOff]);


  // Handle 3-second loading animation timeout
  useEffect(() => {
    if (loading) {
      // Start 3-second timeout when loading begins
      loadingTimeoutRef.current = setTimeout(() => {
        setShowLoadingAnimation(true);
      }, 3000);
    } else {
      // Clear timeout and hide animation when loading stops (including when user stops LLM)
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
      setShowLoadingAnimation(false);
    }

    // Cleanup timeout on unmount
    return () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current);
        loadingTimeoutRef.current = null;
      }
    };
  }, [loading]);

  // Hide loading animation when first chunk arrives (streaming starts)
  useEffect(() => {
    if (chat?.messages && chat.messages.length > 0) {
      const lastMessage = chat.messages[chat.messages.length - 1];
      // If the last message is from assistant and has content, streaming has started
      if (lastMessage.role === 'assistant' && lastMessage.content && lastMessage.content.length > 0) {
        // Hide the loading animation as soon as we get the first chunk
        setShowLoadingAnimation(false);
        // Also clear the timeout since we no longer need it
        if (loadingTimeoutRef.current) {
          clearTimeout(loadingTimeoutRef.current);
          loadingTimeoutRef.current = null;
        }
      }
    }
  }, [chat?.messages]);





  const handleOpenModelMenu = (event: React.MouseEvent<HTMLElement>) => {
    setModelMenuAnchor(event.currentTarget);
  };

  const handleCloseModelMenu = () => {
    setModelMenuAnchor(null);
  };

  const handleSelectModel = (selectedModel: ModelType) => {
    onSelectModel(selectedModel);
    handleCloseModelMenu();
  };

  const handleSuggestedPrompt = async (prompt: string) => {
    // First call createNewChat
    await onCreateNewChat();
    
    // Then set the prompt in the chatbox (message state)
    setMessage(prompt);
  };

  // Check if current model is the default model
  const isCurrentModelDefault = () => {
    if (!model) return false;
    try {
      const defaultModelId = localStorage.getItem('defaultModelId');
      return defaultModelId === model.id;
    } catch (error) {
      console.error('Failed to check default model:', error);
      return false;
    }
  };

  // Handle setting current model as default
  const handleSetAsDefault = () => {
    if (!model) {
      console.warn('No model selected to set as default');
      return;
    }

    // If it's already the default, don't do anything
    if (isCurrentModelDefault()) {
      console.log(`${model.name} is already the default model`);
      return;
    }

    try {
      // Store the default model in localStorage
      localStorage.setItem('defaultModelId', model.id);
           
      // Update state to trigger re-render and change button text
      setDefaultModelId(model.id);
    } catch (error) {
      console.error('Failed to set default model:', error);
    }
  };

  // Process files from either file input or drag and drop
  const processFiles = (files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    
    // Convert FileList to Array if needed
    const fileArray = Array.from(files);
    
    // Process each selected file
    fileArray.forEach(file => {
      // Process image files
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        
        reader.onload = (event) => {
          if (!event.target || typeof event.target.result !== 'string') return;
          
          const dataUrl = event.target.result;
          
          // Create a new image attachment
          const newAttachment: FileAttachment = {
            id: `image-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: file.name,
            type: 'image',
            content: dataUrl, // Store the image as a data URL
            size: file.size,
            timestamp: new Date().toISOString(),
          };
          
          // Add the attachment to the state
          setAttachments(prevAttachments => [...prevAttachments, newAttachment]);
        };
        
        reader.onerror = () => {
          alert(`Error reading image: ${file.name}`);
        };
        
        // Read the image as a data URL
        reader.readAsDataURL(file);
      }
      // Skip PDF files (PDF support removed)
      else if (file.name.endsWith('.pdf')) {
        alert(`PDF files are not supported. Skipping ${file.name}`);
      }
      // Process text files
      else if (file.name.endsWith('.txt')) {
        const reader = new FileReader();
        
        reader.onload = (event) => {
          if (!event.target || typeof event.target.result !== 'string') return;
          
          const content = event.target.result;
          
          // Create a new file attachment
          const newAttachment: FileAttachment = {
            id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: file.name,
            type: 'text',
            content: content,
            size: file.size,
            timestamp: new Date().toISOString(),
          };
          
          // Add the attachment to the state
          setAttachments(prevAttachments => [...prevAttachments, newAttachment]);
        };
        
        reader.onerror = () => {
          alert(`Error reading file: ${file.name}`);
        };
        
        // Read the file as text
        reader.readAsText(file);
      }
      // Process Word files
      else if (file.name.endsWith('.docx')) {
        const reader = new FileReader();
        
        reader.onload = async (event) => {
          if (!event.target || !event.target.result) return;
          
          try {
            // Import mammoth for Word file processing
            const mammoth = await import('mammoth');
            
            // Convert the ArrayBuffer to a Uint8Array for mammoth
            const arrayBuffer = event.target.result as ArrayBuffer;
            
            // Extract text from the Word document
            const result = await mammoth.extractRawText({ arrayBuffer });
            const content = result.value; // The extracted text
            
            // Create a new file attachment
            const newAttachment: FileAttachment = {
              id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              name: file.name,
              type: 'text', // Still treat it as text for the LLM
              content: content,
              size: file.size,
              timestamp: new Date().toISOString(),
            };
            
            // Add the attachment to the state
            setAttachments(prevAttachments => [...prevAttachments, newAttachment]);
          } catch (error) {
            console.error('Error extracting text from Word file:', error);
            alert(`Error processing Word file: ${file.name}`);
          }
        };
        
        reader.onerror = () => {
          alert(`Error reading file: ${file.name}`);
        };
        
        // Read the file as an ArrayBuffer for mammoth
        reader.readAsArrayBuffer(file);
      }
      // Skip unsupported files
      else {
        alert(`Only .txt, .docx, and image files are supported. PDF files are not supported. Skipping ${file.name}`);
      }
    });
  };

  
  // Format file size for display
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Helper function to parse HTML table to data structure
  const parseHtmlTable = (htmlString: string): { headers: string[], rows: string[][] } | null => {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlString, 'text/html');
      const table = doc.querySelector('table');
      
      if (!table) return null;
      
      const headers: string[] = [];
      const rows: string[][] = [];
      
      // Extract headers - use innerHTML to preserve LaTeX delimiters
      const headerCells = table.querySelectorAll('th');
      headerCells.forEach(th => headers.push(th.innerHTML?.trim() || ''));
      
      // Extract rows - use innerHTML to preserve LaTeX delimiters
      const tableRows = table.querySelectorAll('tr');
      tableRows.forEach(tr => {
        const cells = tr.querySelectorAll('td');
        if (cells.length > 0) {
          const rowData: string[] = [];
          cells.forEach(td => rowData.push(td.innerHTML?.trim() || ''));
          rows.push(rowData);
        }
      });
      
      return headers.length > 0 && rows.length > 0 ? { headers, rows } : null;
    } catch (error) {
      console.error('Error parsing HTML table:', error);
      return null;
    }
  };

  // Helper function to parse CSV to data structure
  const parseCsvTable = (csvString: string): { headers: string[], rows: string[][] } | null => {
    try {
      const lines = csvString.trim().split('\n');
      if (lines.length < 2) return null;
      
      // Simple CSV parser (handles quoted values)
      const parseRow = (line: string): string[] => {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
          const char = line[i];
          
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            result.push(current.trim().replace(/^"|"$/g, ''));
            current = '';
          } else {
            current += char;
          }
        }
        result.push(current.trim().replace(/^"|"$/g, ''));
        return result;
      };
      
      const headers = parseRow(lines[0]);
      const rows = lines.slice(1).map(line => parseRow(line));
      
      return { headers, rows };
    } catch (error) {
      console.error('Error parsing CSV table:', error);
      return null;
    }
  };

  // Helper function to parse JSON array table
  const parseJsonTable = (jsonString: string): { headers: string[], rows: string[][] } | null => {
    try {
      const data = JSON.parse(jsonString);
      if (!Array.isArray(data) || data.length === 0) return null;
      
      // Extract headers from first object keys
      const headers = Object.keys(data[0]);
      
      // Extract rows
      const rows = data.map(obj => headers.map(key => String(obj[key] || '')));
      
      return { headers, rows };
    } catch (error) {
      return null;
    }
  };

  // Helper function to parse ASCII/Text table
  const parseTextTable = (textString: string): { headers: string[], rows: string[][] } | null => {
    try {
      const lines = textString.trim().split('\n');
      if (lines.length < 3) return null;
      
      // Find header row (typically between two border lines)
      let headerIndex = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('|') && !lines[i].match(/^[+\-=|]+$/)) {
          headerIndex = i;
          break;
        }
      }
      
      if (headerIndex === -1) return null;
      
      const headerLine = lines[headerIndex];
      const headers = headerLine.split('|')
        .filter(cell => cell.trim() && !cell.match(/^[\s+\-=]+$/))
        .map(cell => cell.trim());
      
      // Extract data rows (skip border lines)
      const rows: string[][] = [];
      for (let i = headerIndex + 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line.match(/^[+\-=|]+$/) && line.includes('|')) {
          const cells = line.split('|')
            .filter(cell => cell.trim() && !cell.match(/^[\s+\-=]+$/))
            .map(cell => cell.trim());
          if (cells.length > 0) {
            rows.push(cells);
          }
        }
      }
      
      return headers.length > 0 && rows.length > 0 ? { headers, rows } : null;
    } catch (error) {
      return null;
    }
  };


  // Helper function to extract table data as plain text
  const tableToPlainText = (headers: string[], rows: string[][]): string => {
    // Create a plain text representation of the table
    let result = headers.join('\t') + '\n';
    rows.forEach(row => {
      result += row.join('\t') + '\n';
    });
    return result;
  };

  // Helper function to render a table with a permanent copy button below it
  const renderTableWithCopyButton = (tableId: string, headers: string[], rows: string[][], tableElement: React.ReactNode) => {
    return (
      <Box key={tableId} sx={{ mb: 2 }}>
        {tableElement}
        {/* Enhanced copy button below the table */}
        <Box sx={{ display: 'flex', justifyContent: 'flex-start', mt: 0.5, ml: 1 }}>
          <IconButton
            size="small"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleCopyTable(tableId, headers, rows);
            }}
            sx={{
              opacity: 0.75,
              backgroundColor: 'rgba(0, 0, 0, 0.03)',
              borderRadius: '8px',
              padding: '6px',
              border: '1px solid rgba(0, 0, 0, 0.08)',
              transition: 'all 0.2s ease-in-out',
              '&:hover': {
                opacity: 1,
                backgroundColor: 'rgba(76, 175, 80, 0.1)',
                borderColor: 'success.main',
                color: 'success.main',
                transform: 'scale(1.1)',
                boxShadow: '0 2px 6px rgba(76, 175, 80, 0.2)',
              },
              '&:active': {
                transform: 'scale(0.95)',
              },
            }}
            title="Copy table data"
          >
            <ContentCopyIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>
      </Box>
    );
  };

  // Helper function to copy table to clipboard
  const handleCopyTable = useCallback(async (tableId: string, headers: string[], rows: string[][]) => {
    try {
      const plainText = tableToPlainText(headers, rows);
      
      // Try Electron clipboard API first
      if (window.electronAPI && window.electronAPI.copyToClipboard) {
        const result = await window.electronAPI.copyToClipboard(plainText);
        if (result.success) {
          console.log('✅ Table copied successfully');
        } else {
          throw new Error(result.error || 'Electron clipboard copy failed');
        }
      }
      // Try modern clipboard API
      else if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(plainText);
        console.log('✅ Table copied successfully');
      }
      // Fallback method
      else {
        const textArea = document.createElement('textarea');
        textArea.value = plainText;
        textArea.style.position = 'absolute';
        textArea.style.left = '-9999px';
        textArea.style.top = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        console.log('✅ Table copied successfully');
      }
    } catch (error) {
      console.error('❌ Failed to copy table:', error);
    }
  }, []);

  // Helper function to copy code block to clipboard
  const handleCopyCode = useCallback(async (code: string) => {
    try {
      // Try Electron clipboard API first
      if (window.electronAPI && window.electronAPI.copyToClipboard) {
        const result = await window.electronAPI.copyToClipboard(code);
        if (result.success) {
          console.log('✅ Code copied successfully');
        } else {
          throw new Error(result.error || 'Electron clipboard copy failed');
        }
      }
      // Try modern clipboard API
      else if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(code);
        console.log('✅ Code copied successfully');
      }
      // Fallback method
      else {
        const textArea = document.createElement('textarea');
        textArea.value = code;
        textArea.style.position = 'absolute';
        textArea.style.left = '-9999px';
        textArea.style.top = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        console.log('✅ Code copied successfully');
      }
    } catch (error) {
      console.error('❌ Failed to copy code:', error);
    }
  }, []);

  // Helper function to render LaTeX formulas
  const renderLatex = (text: string): React.ReactNode => {
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    
    // Match multiple LaTeX notations:
    // 1. Display math \[...\] - with optional whitespace
    // 2. Double dollar: $$ block $$
    // 3. Inline math \(...\)
    // 4. Single dollar: $ inline $
    const latexPattern = /\\\[\s*([\s\S]*?)\s*\\\]|\$\$([\s\S]+?)\$\$|\\\(\s*([\s\S]*?)\s*\\\)|\$([^$]+)\$/g;
    let match;
    
    while ((match = latexPattern.exec(text)) !== null) {
      // Add text before formula
      if (match.index > lastIndex) {
        parts.push(<span key={`text-${lastIndex}`}>{text.substring(lastIndex, match.index)}</span>);
      }
      
      // Determine formula and type
      const formula = (match[1] || match[2] || match[3] || match[4] || '').trim();
      const isBlock = !!(match[1] !== undefined || match[2] !== undefined); // \[...\] or $$...$$
      
      try {
        const html = katex.renderToString(formula, {
          displayMode: isBlock,
          throwOnError: false,
          output: 'html',
          strict: false
        });
        
        parts.push(
          <Box
            key={`latex-${match.index}`}
            component={isBlock ? 'div' : 'span'}
            dangerouslySetInnerHTML={{ __html: html }}
            sx={isBlock ? { my: 1, display: 'block' } : {}}
          />
        );
      } catch (error) {
        // If KaTeX fails, show original text
        parts.push(<span key={`error-${match.index}`}>{match[0]}</span>);
      }
      
      lastIndex = match.index + match[0].length;
    }
    
    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(<span key={`text-${lastIndex}-end`}>{text.substring(lastIndex)}</span>);
    }
    
    // Return as a single element instead of an array
    return parts.length > 0 ? <>{parts}</> : <span>{text}</span>;
  };

  // Helper function to render markdown within table cells with LaTeX support
  const renderCellContent = (content: any): React.ReactNode => {
    // If content is already a React element, return it
    if (React.isValidElement(content)) {
      return content;
    }
    
    // Extract text from children if it's an array
    const extractText = (node: any): string => {
      if (typeof node === 'string') return node;
      if (typeof node === 'number') return String(node);
      if (Array.isArray(node)) return node.map(extractText).join('');
      if (node?.props?.children) return extractText(node.props.children);
      return String(node);
    };
    
    // Convert to string - handle arrays and nested structures
    let textContent = extractText(content);
    
    // Don't process empty content
    if (!textContent || textContent.trim() === '') {
      return textContent;
    }
    
    // Decode HTML entities that might be in the innerHTML
    // This ensures LaTeX delimiters like \[ are properly detected
    const decodeHtmlEntities = (text: string): string => {
      const textarea = document.createElement('textarea');
      textarea.innerHTML = text;
      return textarea.value;
    };
    
    textContent = decodeHtmlEntities(textContent);
    
    // Check if content is wrapped in backticks (inline code)
    const inlineCodeMatch = textContent.match(/^`([^`]+)`$/);
    if (inlineCodeMatch) {
      // Render as inline code
      return (
        <code style={{ 
          backgroundColor: 'rgba(0, 0, 0, 0.08)',
          padding: '2px 4px',
          borderRadius: '3px',
          fontSize: '0.85em',
          fontFamily: 'monospace',
          wordBreak: 'break-word'
        }}>
          {inlineCodeMatch[1]}
        </code>
      );
    }
    
    // CRITICAL FIX: Check for LaTeX patterns BEFORE other processing
    // This ensures LaTeX in tables is rendered properly
    const hasLatexDelimiters = /\\\[|\\\(|\$\$|\$/.test(textContent);
    
    if (hasLatexDelimiters) {
      // Use renderLatex which handles all LaTeX delimiters correctly
      return renderLatex(textContent);
    }
    
    // Handle content with <br> tags by converting them to actual line breaks
    textContent = textContent.replace(/<br\s*\/?>/gi, '\n');
    
    // Clean up incomplete LaTeX tabular syntax that appears as text
    // Only remove \begin{tabular}{...} if it appears at the start and is followed by nothing or just whitespace
    // Use nested pattern to handle up to 2 levels of braces like {|p{0.4\textwidth}|}
    const incompleteTabularPattern = /^\\begin\{tabular\}\{(?:[^{}]|\{(?:[^{}]|\{[^}]*\})*\})*\}\s*$/;
    if (incompleteTabularPattern.test(textContent.trim())) {
      // This is ONLY the tabular declaration without any other content - remove it completely
      return '';
    }
    
    // Also remove if it appears at the very beginning, with or without whitespace after it (including newlines)
    // This handles cases like "\begin{tabular}{...}\n\nArea of Rectangle"
    textContent = textContent.replace(/^\\begin\{tabular\}\{(?:[^{}]|\{(?:[^{}]|\{[^}]*\})*\})*\}\s*/, '');
    
    
    // Check for complete LaTeX tabular environment in cell content (nested tables)
    const hasTabularTable = /\\begin\{tabular\}\{[^}]*\}[\s\S]*(?:\\\\|&)/.test(textContent);
    if (hasTabularTable) {
      // Try to extract and render the tabular environment
      // Make \end{tabular} optional in case it's cut off
      const tableMatch = textContent.match(/\\begin\{tabular\}\{(?:[^{}]|\{[^}]*\})*\}([\s\S]*?)(?:\\end\{tabular\}|$)/);
      
      if (tableMatch) {
        const tableContent = tableMatch[1];
        // Remove all \hline commands and trim
        const cleanedContent = tableContent.replace(/\\hline/g, '').trim();
        
        // Split by \\ or newlines and filter out empty lines
        const lines = cleanedContent
          .split(/\\\\|\n/)
          .map(line => line.trim())
          .filter(line => line.length > 0);
        
        if (lines.length >= 1) {
          // If we have at least one line, try to parse it as a simple table
          // Split cells by & or tabs
          const rows = lines.map(line => 
            line.split(/[&\t]/).map(cell => cell.trim()).filter(cell => cell.length > 0)
          );
          
          if (rows.length > 0 && rows[0].length > 0) {
            // Render as a simple nested table
            return (
              <Box sx={{ my: 1 }}>
                <Table size="small" sx={{ border: '1px solid rgba(0,0,0,0.12)' }}>
                  <TableBody>
                    {rows.map((row, rowIdx) => (
                      <TableRow key={rowIdx}>
                        {row.map((cell, cellIdx) => (
                          <TableCell 
                            key={cellIdx}
                            sx={{ 
                              fontSize: '0.85em',
                              p: 0.5,
                              border: '1px solid rgba(0,0,0,0.12)'
                            }}
                          >
                            {/* Recursively render cell content to handle formulas */}
                            {/\$[^$]+\$/.test(cell) ? renderCellContent(cell) : cell}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </Box>
            );
          }
        }
      }
    }
    
    
    // For content without math, use ReactMarkdown for other markdown features
    return (
      <ReactMarkdown
        remarkPlugins={[[remarkMath, { singleDollarTextMath: true }] as any]}
        rehypePlugins={[rehypeRaw as any, rehypeKatex as any]}
        components={{
          p: ({ children }) => <span>{children}</span>,
          strong: ({ children }) => <strong>{children}</strong>,
          em: ({ children }) => <em>{children}</em>,
          code: ({ children, inline, className }) => {
            let text = String(children);
            
            // For non-inline code (code blocks), handle specially
            if (!inline) {
              // Convert literal \n to actual newlines in code blocks
              text = text.replace(/\\n/g, '\n');
              
              return (
                <Box
                  component="pre"
                  sx={{
                    backgroundColor: 'rgba(0, 0, 0, 0.08)',
                    padding: '8px',
                    borderRadius: '4px',
                    fontSize: '0.85em',
                    overflowX: 'auto',
                    margin: '4px 0',
                    whiteSpace: 'pre-wrap',
                    maxWidth: '100%',
                    fontFamily: 'monospace'
                  }}
                >
                  <code>{text}</code>
                </Box>
              );
            }
            
            // For inline code, try to render as LaTeX if it contains LaTeX-like patterns
            const hasLatexPattern = /\\[a-zA-Z]+|^\$.*\$$|[\^_{}]/.test(text);
            
            if (hasLatexPattern) {
              try {
                const html = katex.renderToString(text, {
                  displayMode: false,
                  throwOnError: false,
                  output: 'html',
                  strict: false
                });
                return <span dangerouslySetInnerHTML={{ __html: html }} />;
              } catch (error) {
                // Silently fall back to regular code rendering
              }
            }
            
            // Regular inline code
            return (
              <code style={{ 
                backgroundColor: 'rgba(0, 0, 0, 0.08)',
                padding: '2px 4px',
                borderRadius: '3px',
                fontSize: '0.85em',
                fontFamily: 'monospace',
                wordBreak: 'break-word'
              }}>
                {text}
              </code>
            );
          },
          ul: ({ children }) => (
            <ul style={{ margin: '4px 0', paddingLeft: '20px' }}>
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol style={{ margin: '4px 0', paddingLeft: '20px' }}>
              {children}
            </ol>
          ),
          li: ({ children }) => (
            <li style={{ margin: '2px 0' }}>
              {children}
            </li>
          ),
          br: () => <br />
        }}
      >
        {textContent}
      </ReactMarkdown>
    );
  };

  // Custom renderers for ReactMarkdown
  const markdownComponents = {
    // Override the default link renderer
    a: ({ node, children, href, ...props }: any) => (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => {
          e.preventDefault();
          // Use electronApi to open in external browser
          electronApi.openExternal(href);
        }}
        style={{
          color: '#2196f3',
          textDecoration: 'underline',
          cursor: 'pointer',
        }}
        {...props}
      >
        {children}
      </a>
    ),
    // Override the default table renderer
    table: ({ node, children, ...props }: any) => (
      <TableContainer 
        component={Paper} 
        sx={styles.tableContainer}
        className="enhanced-table"
      >
        <Table size="small" {...props}>
          {children}
        </Table>
      </TableContainer>
    ),
    // Override the default thead renderer
    thead: ({ node, children, ...props }: any) => (
      <TableHead 
        sx={styles.tableHead} 
        {...props}
      >
        {children}
      </TableHead>
    ),
    // Override the default tbody renderer
    tbody: ({ node, children, ...props }: any) => (
      <TableBody {...props}>
        {children}
      </TableBody>
    ),
    // Override the default tr renderer
    tr: ({ node, children, isHeader, index, ...restProps }: any) => {
      // Filter out any non-DOM props before spreading
      const { isheader, ...domProps } = restProps;
      const isOdd = index % 2 === 1;
      return (
        <TableRow 
          sx={isOdd ? styles.tableRowOdd : styles.tableRowEven} 
          {...domProps}
        >
          {children}
        </TableRow>
      );
    },
    // Override the default th renderer with markdown support
    th: ({ node, children, isHeader, ...props }: any) => (
      <TableCell 
        component="th"
        align="left"
        sx={styles.tableHeaderCell} 
        {...props}
      >
        {renderCellContent(children)}
      </TableCell>
    ),
    // Override the default td renderer with markdown support
    td: ({ node, children, isHeader, ...props }: any) => (
      <TableCell 
        align="left"
        sx={styles.tableCell} 
        {...props}
      >
        {renderCellContent(children)}
      </TableCell>
    ),
    // Improve code blocks - extract and render formulas and tables from code blocks with copy button
    code: ({ node, inline, className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || '');
      const content = String(children).replace(/\n$/, '');
      
      // For non-inline code blocks, check if they contain LaTeX tables or formulas
      if (!inline) {
        // Check for LaTeX table (tabular environment)
        const hasTabularTable = /\\begin\{tabular\}[\s\S]*?\\end\{tabular\}/.test(content);
        
        // Parse LaTeX tables from any code block, not just those marked as latex/tex
        if (hasTabularTable) {
          // Parse the LaTeX table - extract the tabular environment with better regex
          // Handle nested braces in column spec like {|c|l|l|p{8cm}|}
          const tableMatch = content.match(/\\begin\{tabular\}\{(?:[^{}]|\{[^}]*\})*\}([\s\S]*?)\\end\{tabular\}/);
          
          if (tableMatch) {
            const tableContent = tableMatch[1];
            // Remove all \hline commands and trim
            const cleanedContent = tableContent.replace(/\\hline/g, '').trim();
            
            // Split by \\ and filter out empty lines
            const lines = cleanedContent
              .split('\\\\')
              .map(line => line.trim())
              .filter(line => line.length > 0);
            
            if (lines.length >= 2) {
              // First line is headers
              const headerLine = lines[0];
              const headers = headerLine.split('&').map(h => h.trim()).filter(h => h.length > 0);
              
              // Rest are data rows
              const dataRows = lines.slice(1);
              const rows = dataRows.map(row => 
                row.split('&').map(cell => cell.trim()).filter(cell => cell.length > 0)
              );
              
              // Render as Material-UI table with copy button - use stable ID based on content
              const tableId = `latex-table-${headers.join('-').substring(0, 20)}-${rows.length}`;
              return renderTableWithCopyButton(
                tableId,
                headers,
                rows,
                <TableContainer 
                  component={Paper} 
                  sx={styles.tableContainer}
                >
                  <Table>
                    <TableHead sx={styles.tableHead}>
                      <TableRow>
                        {headers.map((header, idx) => (
                          <TableCell 
                            key={idx}
                            sx={styles.tableHeaderCell}
                          >
                            {renderCellContent(header)}
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {rows.map((row, rowIdx) => (
                        <TableRow 
                          key={rowIdx}
                          sx={rowIdx % 2 === 1 ? styles.tableRowOdd : styles.tableRowEven}
                        >
                          {row.map((cell, cellIdx) => (
                            <TableCell 
                              key={cellIdx}
                              sx={{
                                ...styles.tableCell,
                                userSelect: 'text',
                                WebkitUserSelect: 'text',
                                MozUserSelect: 'text',
                                msUserSelect: 'text',
                              }}
                            >
                              {renderCellContent(cell)}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              );
            }
          }
        }
        
        const hasDocumentCommands = /\\documentclass|\\begin\{document\}|\\usepackage/.test(content);
        const hasLatexFormulas = /\$[^\$]+\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\\frac|\\int|\\sum/.test(content);
        
        // If it's a LaTeX code block OR any code block with formulas, extract and render
        if (hasLatexFormulas || className === 'language-latex' || className === 'language-tex') {
          if (hasDocumentCommands) {
            // Full LaTeX document - extract formulas
            const formulas: Array<{ formula: string; isDisplay: boolean }> = [];
            
            // Extract \[ \] display formulas
            const displayMatches = content.match(/\\\[([\s\S]*?)\\\]/g);
            if (displayMatches) {
              displayMatches.forEach(match => {
                const formula = match.replace(/^\\\[/, '').replace(/\\\]$/, '').trim();
                if (formula) formulas.push({ formula, isDisplay: true });
              });
            }
            
            // Extract \( \) inline formulas
            const inlineMatches = content.match(/\\\(([\s\S]*?)\\\)/g);
            if (inlineMatches) {
              inlineMatches.forEach(match => {
                const formula = match.replace(/^\\\(/, '').replace(/\\\)$/, '').trim();
                if (formula) formulas.push({ formula, isDisplay: false });
              });
            }
            
            // Render extracted formulas
            if (formulas.length > 0) {
              return (
                <Box sx={{ my: 2 }}>
                  {formulas.map((item, idx) => {
                    try {
                      const html = katex.renderToString(item.formula, {
                        displayMode: item.isDisplay,
                        throwOnError: false,
                        output: 'html'
                      });
                      
                      return (
                        <Box
                          key={idx}
                          sx={{ 
                            my: item.isDisplay ? 2 : 1,
                            p: item.isDisplay ? 2 : 1,
                            bgcolor: 'action.hover',
                            borderRadius: 1
                          }}
                          dangerouslySetInnerHTML={{ __html: html }}
                        />
                      );
                    } catch (error) {
                      return (
                        <Box key={idx} sx={{ color: 'error.main', fontSize: '0.9em' }}>
                          Failed to render: {item.formula.substring(0, 50)}...
                        </Box>
                      );
                    }
                  })}
                </Box>
              );
            }
          } else if (hasLatexFormulas || className === 'language-latex' || className === 'language-tex') {
            // Code block with LaTeX formulas but no document structure
            
            // Check if there are $ $ wrapped formulas
            const dollarMatches = content.match(/\$([^\$]+)\$/g);
            if (dollarMatches) {
              // Extract $ $ formulas and render them
              const formulas: Array<{ formula: string; isDisplay: boolean }> = [];
              dollarMatches.forEach(match => {
                const formula = match.replace(/^\$/, '').replace(/\$$/, '').trim();
                if (formula) formulas.push({ formula, isDisplay: false });
              });
              
              if (formulas.length > 0) {
                return (
                  <Box sx={{ position: 'relative' }}>
                    <Box sx={{ my: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
                      {formulas.map((item, idx) => {
                        try {
                          const html = katex.renderToString(item.formula, {
                            displayMode: false,
                            throwOnError: false,
                            output: 'html'
                          });
                          
                          return (
                            <Box
                              key={idx}
                              sx={{ my: 1 }}
                              dangerouslySetInnerHTML={{ __html: html }}
                            />
                          );
                        } catch (error) {
                          return null;
                        }
                      })}
                    </Box>
                    {/* Copy button for rendered LaTeX */}
                    <Box sx={{ display: 'flex', justifyContent: 'flex-start', mt: 0.5, ml: 1 }}>
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleCopyCode(content);
                        }}
                        sx={{
                          opacity: 0.75,
                          backgroundColor: 'rgba(0, 0, 0, 0.03)',
                          borderRadius: '8px',
                          padding: '6px',
                          border: '1px solid rgba(0, 0, 0, 0.08)',
                          transition: 'all 0.2s ease-in-out',
                          '&:hover': {
                            opacity: 1,
                            backgroundColor: 'rgba(156, 39, 176, 0.1)',
                            borderColor: 'secondary.main',
                            color: 'secondary.main',
                            transform: 'scale(1.1)',
                            boxShadow: '0 2px 6px rgba(156, 39, 176, 0.2)',
                          },
                          '&:active': {
                            transform: 'scale(0.95)',
                          },
                        }}
                        title="Copy LaTeX code"
                      >
                        <ContentCopyIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Box>
                  </Box>
                );
              }
            } else if (className === 'language-latex' || className === 'language-tex') {
              // Pure LaTeX code block without $ delimiters - render entire content
              try {
                const html = katex.renderToString(content, {
                  displayMode: true,
                  throwOnError: false,
                  output: 'html'
                });
                
                return (
                  <Box sx={{ position: 'relative' }}>
                    <Box
                      sx={{ my: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}
                      dangerouslySetInnerHTML={{ __html: html }}
                    />
                    {/* Copy button for rendered LaTeX */}
                    <Box sx={{ display: 'flex', justifyContent: 'flex-start', mt: 0.5, ml: 1 }}>
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleCopyCode(content);
                        }}
                        sx={{
                          opacity: 0.75,
                          backgroundColor: 'rgba(0, 0, 0, 0.03)',
                          borderRadius: '8px',
                          padding: '6px',
                          border: '1px solid rgba(0, 0, 0, 0.08)',
                          transition: 'all 0.2s ease-in-out',
                          '&:hover': {
                            opacity: 1,
                            backgroundColor: 'rgba(156, 39, 176, 0.1)',
                            borderColor: 'secondary.main',
                            color: 'secondary.main',
                            transform: 'scale(1.1)',
                            boxShadow: '0 2px 6px rgba(156, 39, 176, 0.2)',
                          },
                          '&:active': {
                            transform: 'scale(0.95)',
                          },
                        }}
                        title="Copy LaTeX code"
                      >
                        <ContentCopyIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Box>
                  </Box>
                );
              } catch (error) {
                // Fall through to normal code block rendering
              }
            }
          }
        }
      }
      
      return !inline ? (
        <Box sx={{ position: 'relative', mb: 2 }}>
          <Box
            component="pre"
            sx={styles.codeBlock}
            className={className}
            {...props}
          >
            <code className={className} {...props}>
              {children}
            </code>
          </Box>
          {/* Enhanced copy button for code blocks */}
          <Box sx={{ display: 'flex', justifyContent: 'flex-start', mt: 0.5, ml: 1 }}>
            <IconButton
              size="small"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                handleCopyCode(content);
              }}
              sx={{
                opacity: 0.75,
                backgroundColor: 'rgba(0, 0, 0, 0.03)',
                borderRadius: '8px',
                padding: '6px',
                border: '1px solid rgba(0, 0, 0, 0.08)',
                transition: 'all 0.2s ease-in-out',
                '&:hover': {
                  opacity: 1,
                  backgroundColor: 'rgba(156, 39, 176, 0.1)',
                  borderColor: 'secondary.main',
                  color: 'secondary.main',
                  transform: 'scale(1.1)',
                  boxShadow: '0 2px 6px rgba(156, 39, 176, 0.2)',
                },
                '&:active': {
                  transform: 'scale(0.95)',
                },
              }}
              title="Copy code"
            >
              <ContentCopyIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </Box>
        </Box>
      ) : (
        <code
          className={className}
          sx={styles.inlineCode}
          {...props}
        >
          {children}
        </code>
      );
    },
  };

  // Function to preprocess LaTeX delimiters for proper rendering
  const preprocessLatexDelimiters = (content: string): string => {
    // First, fix common LaTeX errors in \text{} environments
    let processed = content;
    
    // Fix complex unit expressions like \text{N·m}^2/\text{kg}^2
    // Replace \text{} with \mathrm{} for better handling of units
    processed = processed.replace(/\\text\{/g, '\\mathrm{');
    
    // Convert \( \) to $ $ for inline math (remark-math standard)
    // Use non-greedy match to handle nested parentheses correctly
    processed = processed.replace(/\\\(([\s\S]+?)\\\)/g, (match, p1) => `$${p1}$`);
    // Convert \[ \] to $$ $$ for display math (remark-math standard)
    // Use non-greedy match to handle nested brackets correctly
    processed = processed.replace(/\\\[([\s\S]+?)\\\]/g, (match, p1) => `$$${p1}$$`);
    
    return processed;
  };

  // ============================================================================
  // STRUCTURAL CONTENT DETECTION AND RENDERING SYSTEM
  // ============================================================================

  // Content type enumeration
  enum ContentType {
    HTML_TABLE = 'HTML_TABLE',
    LATEX_TABLE = 'LATEX_TABLE',
    MARKDOWN_TABLE = 'MARKDOWN_TABLE',
    WIKI_TABLE = 'WIKI_TABLE',
    CSV_TABLE = 'CSV_TABLE',
    JSON_TABLE = 'JSON_TABLE',
    TEXT_TABLE = 'TEXT_TABLE',
    CODE_BLOCK = 'CODE_BLOCK',
    PLAIN_TEXT = 'PLAIN_TEXT'
  }

  // Content block interface
  interface ContentBlock {
    type: ContentType;
    content: string;
    startIndex: number;
    endIndex: number;
    data?: {
      headers?: string[];
      rows?: string[][];
      language?: string;
    };
  }

  // 1. TABLE TYPE DETECTORS
  const detectHtmlTable = (content: string, startIndex: number = 0): ContentBlock | null => {
    const htmlTableRegex = /<table[\s\S]*?<\/table>/i;
    const match = content.substring(startIndex).match(htmlTableRegex);
    
    if (match && match.index !== undefined) {
      const tableContent = match[0];
      const tableData = parseHtmlTable(tableContent);
      
      if (tableData) {
        return {
          type: ContentType.HTML_TABLE,
          content: tableContent,
          startIndex: startIndex + match.index,
          endIndex: startIndex + match.index + tableContent.length,
          data: tableData
        };
      }
    }
    return null;
  };

  const detectLatexTable = (content: string, startIndex: number = 0): ContentBlock | null => {
    const latexTableRegex = /\\begin\{tabular\}\{(?:[^{}]|\{[^}]*\})*\}([\s\S]*?)\\end\{tabular\}/;
    const match = content.substring(startIndex).match(latexTableRegex);
    
    if (match && match.index !== undefined) {
      const tableContent = match[1];
      const cleanedContent = tableContent.replace(/\\hline/g, '').trim();
      const lines = cleanedContent.split('\\\\').map(line => line.trim()).filter(line => line.length > 0);
      
      if (lines.length >= 1) {
        const headers = lines[0].split('&').map(h => h.trim()).filter(h => h.length > 0);
        const rows = lines.slice(1).map(row => 
          row.split('&').map(cell => cell.trim()).filter(cell => cell.length > 0)
        );
        
        return {
          type: ContentType.LATEX_TABLE,
          content: match[0],
          startIndex: startIndex + match.index,
          endIndex: startIndex + match.index + match[0].length,
          data: { headers, rows }
        };
      }
    }
    return null;
  };

  const detectMarkdownTable = (content: string, startIndex: number = 0): ContentBlock | null => {
    // Flexible regex that matches markdown tables with or without leading/trailing pipes
    // Removed ^ anchor to allow tables anywhere in the content, not just at line start
    const markdownTableRegex = /[^\n]*\|[^\n]+\n[^\n]*[-:]+\|[-:\s|]+[^\n]*\n(?:[^\n]*\|[^\n]+\n?)+/;
    const searchContent = content.substring(startIndex);
    const match = searchContent.match(markdownTableRegex);
    
    if (match && match.index !== undefined) {
      let tableContent = match[0];
      
      // Remove trailing newline if present for cleaner processing
      tableContent = tableContent.replace(/\n$/, '');
      
      const lines = tableContent.split('\n').filter(line => line.trim());
      
      if (lines.length >= 3) {
        const smartSplit = (line: string): string[] => {
          const cells: string[] = [];
          let current = '';
          let inBackticks = false;
          let inDollarSigns = false;
          
          // Remove leading/trailing pipes if present
          let processLine = line.trim();
          if (processLine.startsWith('|')) processLine = processLine.substring(1);
          if (processLine.endsWith('|')) processLine = processLine.substring(0, processLine.length - 1);
          
          for (let i = 0; i < processLine.length; i++) {
            const char = processLine[i];
            
            // Track backticks
            if (char === '`' && !inDollarSigns) {
              inBackticks = !inBackticks;
              current += char;
            }
            // Track dollar signs
            else if (char === '$' && !inBackticks) {
              inDollarSigns = !inDollarSigns;
              current += char;
            }
            // Split on pipe only when not inside backticks or dollar signs
            else if (char === '|' && !inBackticks && !inDollarSigns) {
              cells.push(current);
              current = '';
            } else {
              current += char;
            }
          }
          cells.push(current);
          return cells.filter(cell => cell.trim() !== '').map(cell => cell.trim());
        };
        
        const headers = smartSplit(lines[0]);
        const rows = lines.slice(2).map(row => smartSplit(row));
        
        // Validate we have valid headers and rows
        if (headers.length > 0 && rows.length > 0) {
          return {
            type: ContentType.MARKDOWN_TABLE,
            content: tableContent,
            startIndex: startIndex + match.index,
            endIndex: startIndex + match.index + tableContent.length,
            data: { headers, rows }
          };
        }
      }
    }
    return null;
  };

  const detectWikiTable = (content: string, startIndex: number = 0): ContentBlock | null => {
    const wikiTableRegex = /\{\|[^\n]*\n[\s\S]*?\|\}/;
    const match = content.substring(startIndex).match(wikiTableRegex);
    
    if (match && match.index !== undefined) {
      const tableContent = match[0];
      const { parseMediaWikiTable } = require('./TableRenderer');
      const tableData = parseMediaWikiTable(tableContent);
      
      if (tableData) {
        return {
          type: ContentType.WIKI_TABLE,
          content: tableContent,
          startIndex: startIndex + match.index,
          endIndex: startIndex + match.index + tableContent.length,
          data: tableData
        };
      }
    }
    return null;
  };

  // 2. LATEX DETECTOR
  const detectLatex = (text: string): boolean => {
    // Check for LaTeX delimiters: $...$, $$...$$, \[...\], \(...\)
    return /\$|\\\[|\\\(|\\frac|\\sqrt|\\int|\\sum/.test(text);
  };

  // 3. CONTENT BLOCK DETECTOR (Main detector that finds all content blocks)
  const detectContentBlocks = (content: string): ContentBlock[] => {
    const blocks: ContentBlock[] = [];
    let currentIndex = 0;
    
    while (currentIndex < content.length) {
      // Try to detect tables in priority order
      let detected = 
        detectHtmlTable(content, currentIndex) ||
        detectLatexTable(content, currentIndex) ||
        detectWikiTable(content, currentIndex) ||
        detectMarkdownTable(content, currentIndex);
      
      if (detected) {
        // Add any plain text before this block
        if (detected.startIndex > currentIndex) {
          blocks.push({
            type: ContentType.PLAIN_TEXT,
            content: content.substring(currentIndex, detected.startIndex),
            startIndex: currentIndex,
            endIndex: detected.startIndex
          });
        }
        
        // Add the detected block
        blocks.push(detected);
        currentIndex = detected.endIndex;
      } else {
        // No more structured content, rest is plain text
        if (currentIndex < content.length) {
          blocks.push({
            type: ContentType.PLAIN_TEXT,
            content: content.substring(currentIndex),
            startIndex: currentIndex,
            endIndex: content.length
          });
        }
        break;
      }
    }
    
    return blocks;
  };

  // 4. CONTENT RENDERERS
  const renderTableBlock = (block: ContentBlock): React.ReactNode => {
    if (!block.data?.headers || !block.data?.rows) return null;
    
    const tableId = `${block.type}-${block.startIndex}`;
    
    return renderTableWithCopyButton(
      tableId,
      block.data.headers,
      block.data.rows,
      <TableContainer component={Paper} sx={styles.tableContainer}>
        <Table>
          <TableHead sx={styles.tableHead}>
            <TableRow>
              {block.data.headers.map((header: string, idx: number) => (
                <TableCell key={idx} sx={styles.tableHeaderCell}>
                  {renderCellContent(header)}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {block.data.rows.map((row: string[], rowIdx: number) => (
              <TableRow 
                key={rowIdx}
                sx={rowIdx % 2 === 1 ? styles.tableRowOdd : styles.tableRowEven}
              >
                {row.map((cell: string, cellIdx: number) => (
                  <TableCell key={cellIdx} sx={styles.tableCell}>
                    {renderCellContent(cell)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    );
  };

  const renderContentBlock = (block: ContentBlock, key: number): React.ReactNode => {
    switch (block.type) {
      case ContentType.HTML_TABLE:
      case ContentType.LATEX_TABLE:
      case ContentType.WIKI_TABLE:
      case ContentType.MARKDOWN_TABLE:
        return <Box key={key} sx={{ mb: 2 }}>{renderTableBlock(block)}</Box>;
      
      case ContentType.PLAIN_TEXT:
        return (
          <Box key={key}>
            <ReactMarkdown 
              remarkPlugins={[[remarkMath, { singleDollarTextMath: true }] as any]}
              rehypePlugins={[rehypeRaw as any, rehypeKatex as any]}
              components={markdownComponents}
            >
              {block.content}
            </ReactMarkdown>
          </Box>
        );
      
      default:
        return null;
    }
  };

  // 5. MAIN RENDERING FUNCTION (Structural approach)
  const renderContentStructurally = (content: string): React.ReactNode => {
    // This is the main entry point for rendering any content
    // It uses a hierarchical detection system:
    // 1. First, detect structured content (tables) - they take priority
    // 2. Then, plain text is passed to ReactMarkdown which handles:
    //    - LaTeX (via remark-math and rehype-katex)
    //    - Code blocks (via markdown code fence syntax)
    //    - Regular markdown formatting
    // 3. Within tables, renderCellContent handles nested content:
    //    - LaTeX formulas (via renderLatex)
    //    - Nested tables (via recursive table parsing)
    //    - Inline code and markdown
    
    // Detect all content blocks (tables and text)
    const blocks = detectContentBlocks(content);
    
    // Render each block with its appropriate renderer
    // Tables → renderTableBlock (which uses renderCellContent for cells)
    // Plain text → ReactMarkdown (which handles LaTeX, code, markdown)
    // The nesting is automatic:
    // - renderCellContent is called for each table cell and handles LaTeX
    // - ReactMarkdown processes LaTeX in plain text
    // - Both can handle nested structures recursively
    
    return (
      <div>
        {blocks.map((block, index) => renderContentBlock(block, index))}
      </div>
    );
  };

  // ============================================================================
  // END OF STRUCTURAL SYSTEM
  // ============================================================================

  // Function to preprocess content to fix Llama3-3 table format and single-line tables
  const preprocessLlama3TableFormat = (content: string): string => {
    // Note: LaTeX delimiters are already preprocessed before this function is called
    let processed = content;
    
    // Look for the specific Llama3-3 table pattern
    const llama3TablePattern = /\| [^|]+ \| [^|]+ \| [^|]+ \| \| --- \| --- \| --- \|/;
    
    if (llama3TablePattern.test(processed)) {
      // This is likely a Llama3-3 table format
      // Fix the format by adding line breaks and removing extra pipes
      return processed.replace(/\| ([^|]+) \| ([^|]+) \| ([^|]+) \| \|/g, '| $1 | $2 | $3 |\n|')
                   .replace(/\| --- \| --- \| --- \| \|/g, '| --- | --- | --- |\n|');
    }
    
    // Fix single-line tables (all on one line)
    // Pattern: | header | header | ... | |----|----| ... | | data | data | ... |
    const singleLineTablePattern = /\|[^|\n]+\|[^|\n]+\|[^|\n]*\|\s*\|[-\s]+\|[-\s]+\|[-\s]*\|\s*\|[^|\n]+\|[^|\n]+\|/g;
    
    if (singleLineTablePattern.test(processed)) {
      
      // Split table by separator pattern
      processed = processed.replace(
        /(\|[^|\n]+(?:\|[^|\n]+)*\|)\s*(\|[-\s]+(?:\|[-\s]+)*\|)\s*(\|[^|\n]+(?:\|[^|\n]+)*\|)/g,
        (match, header, separator, dataRows) => {
          // Add line breaks between header, separator, and data rows
          let result = header.trim() + '\n' + separator.trim() + '\n';
          
          // Split remaining data rows if they're concatenated
          // Look for patterns like | data | data | immediately followed by | data | data |
          const remainingText = match.substring(header.length + separator.length).trim();
          const rows = [];
          let currentRow = '';
          let pipeCount = 0;
          
          for (let i = 0; i < remainingText.length; i++) {
            const char = remainingText[i];
            currentRow += char;
            
            if (char === '|') {
              pipeCount++;
              // If we've seen enough pipes for a complete row, check if next char starts a new row
              if (pipeCount >= 4 && i < remainingText.length - 1 && remainingText[i + 1] === ' ') {
                // Look ahead to see if we're starting a new row
                const ahead = remainingText.substring(i + 1).trim();
                if (ahead.startsWith('|')) {
                  rows.push(currentRow.trim());
                  currentRow = '';
                  pipeCount = 0;
                }
              }
            }
          }
          
          // Add the last row
          if (currentRow.trim()) {
            rows.push(currentRow.trim());
          }
          
          result += rows.join('\n');
          return result;
        }
      );
      
      return processed;
    }
    
    return processed;
  };

  // Function to detect and render tables from markdown
  const renderMarkdownWithTables = (content: string) => {
    // FIRST: Extract and protect LaTeX tabular environments BEFORE any other processing
    // This prevents markdown from breaking up the table syntax
    const tabularRegexEarly = /\\begin\{tabular\}\{(?:[^{}]|\{[^}]*\})*\}([\s\S]*?)\\end\{tabular\}/g;
    const earlyTabularMatches: Array<{match: string, headers: string[], rows: string[][], placeholder: string}> = [];
    let tabularMatchEarly;
    let earlyMatchIndex = 0;
    
    let processedContent = content;
    
    while ((tabularMatchEarly = tabularRegexEarly.exec(content)) !== null) {
      const tableContent = tabularMatchEarly[1];
      const cleanedContent = tableContent.replace(/\\hline/g, '').trim();
      const lines = cleanedContent
        .split('\\\\')
        .map(line => line.trim())
        .filter(line => line.length > 0);
      
      if (lines.length >= 1) {
        const placeholder = `__EARLY_LATEX_TABLE_${earlyMatchIndex}__`;
        
        // Parse headers and rows
        const headers = lines[0].split('&').map(h => h.trim()).filter(h => h.length > 0);
        const dataRows = lines.slice(1);
        const rows = dataRows.map(row => 
          row.split('&').map(cell => cell.trim()).filter(cell => cell.length > 0)
        );
        
        earlyTabularMatches.push({
          match: tabularMatchEarly[0],
          headers,
          rows,
          placeholder
        });
        
        // Replace the entire tabular block with placeholder
        processedContent = processedContent.replace(tabularMatchEarly[0], placeholder);
        earlyMatchIndex++;
      }
    }
    
    // Now strip LaTeX table environment metadata (table, centering, caption, label)
    processedContent = processedContent
      // Remove \begin{table}[...] and \end{table}
      .replace(/\\begin\{table\}(?:\[[^\]]*\])?\s*/g, '')
      .replace(/\\end\{table\}\s*/g, '')
      // Remove \centering
      .replace(/\\centering\s*/g, '')
      // Remove \caption{...}
      .replace(/\\caption\{[^}]*\}\s*/g, '')
      // Remove \label{...}
      .replace(/\\label\{[^}]*\}\s*/g, '')
      // Remove \hline commands
      .replace(/\\hline\s*/g, '')
      // Clean up orphaned LaTeX table fragments
      // Remove & followed by text and ending with \ (incomplete table row)
      .replace(/&\s*([^&\n]+?)\s*\\/g, '$1')
      // Remove orphaned \end{tabular} 
      .replace(/\\end\{tabular\}/g, '');
    
    // Note: remark-math handles \[...\] and \(...\) natively when configured properly
    const displayMathBlocks: Array<{ placeholder: string, html: string }> = [];
    
    // Check for LaTeX tabular environments in plain text and store them for rendering
    const tabularRegex = /\\begin\{tabular\}\{(?:[^{}]|\{[^}]*\})*\}([\s\S]*?)\\end\{tabular\}/g;
    const tabularMatches: Array<{match: string, headers: string[], rows: string[][], index: number}> = [];
    let tabularMatch;
    
    // Store all matches first, then replace from end to beginning to preserve indices
    const tempMatches: Array<{match: string, headers: string[], rows: string[][], index: number}> = [];
    
    while ((tabularMatch = tabularRegex.exec(processedContent)) !== null) {
      const tableContent = tabularMatch[1];
      // Remove all \hline commands and trim
      const cleanedContent = tableContent.replace(/\\hline/g, '').trim();
      
      // Split by \\ and filter out empty lines
      const lines = cleanedContent
        .split('\\\\')
        .map(line => line.trim())
        .filter(line => line.length > 0);
      
      if (lines.length >= 2) {
        // First line is headers
        const headerLine = lines[0];
        const headers = headerLine.split('&').map(h => h.trim()).filter(h => h.length > 0);
        
        // Rest are data rows
        const dataRows = lines.slice(1);
        const rows = dataRows.map(row => 
          row.split('&').map(cell => cell.trim()).filter(cell => cell.length > 0)
        );
        
        tempMatches.push({
          match: tabularMatch[0],
          headers,
          rows,
          index: tabularMatch.index
        });
      }
    }
    
    // Replace from end to beginning to preserve indices
    for (let i = tempMatches.length - 1; i >= 0; i--) {
      const tableInfo = tempMatches[i];
      const placeholder = `__LATEX_TABLE_${i}__`;
      const before = processedContent.substring(0, tableInfo.index);
      const after = processedContent.substring(tableInfo.index + tableInfo.match.length);
      processedContent = before + placeholder + after;
    }
    
    // Add all matches to tabularMatches in the correct order (same as tempMatches)
    tabularMatches.push(...tempMatches);
    
    // Note: We've already converted \[...\] to $$...$$ in preprocessing, 
    // so remark-math and rehype-katex will handle all math rendering
    
    // Convert HTML sub/sup tags to LaTeX notation wrapped in $ delimiters
    processedContent = processedContent
      .replace(/<sub>([^<]+)<\/sub>/g, '$_{$1}$')
      .replace(/<sup>([^<]+)<\/sup>/g, '$^{$1}$');
    
    // Preprocess content to fix Llama3-3 table format (which also applies LaTeX preprocessing)
    processedContent = preprocessLlama3TableFormat(processedContent);
    
    // Detect and replace HTML tables
    const htmlTableRegex = /<table[\s\S]*?<\/table>/gi;
    const htmlTables = processedContent.match(htmlTableRegex) || [];
    const htmlTableData: Array<{ index: number, data: { headers: string[], rows: string[][] } | null }> = [];
    
    htmlTables.forEach((htmlTable, idx) => {
      const tableData = parseHtmlTable(htmlTable);
      if (tableData) {
        const placeholder = `__HTML_TABLE_${idx}__`;
        const index = processedContent.indexOf(htmlTable);
        htmlTableData.push({ index, data: tableData });
        processedContent = processedContent.replace(htmlTable, placeholder);
      }
    });
    
    // Detect and replace CSV tables (quoted values with commas)
    const csvTableRegex = /"[^"]+","[^"]+(?:","[^"]+)*"\n(?:"[^"]+","[^"]+(?:","[^"]+)*"\n)+/g;
    const csvTables = processedContent.match(csvTableRegex) || [];
    const csvTableData: Array<{ index: number, data: { headers: string[], rows: string[][] } | null }> = [];
    
    csvTables.forEach((csvTable, idx) => {
      const tableData = parseCsvTable(csvTable);
      if (tableData) {
        const placeholder = `__CSV_TABLE_${idx}__`;
        const index = processedContent.indexOf(csvTable);
        csvTableData.push({ index, data: tableData });
        processedContent = processedContent.replace(csvTable, placeholder);
      }
    });
    
    // Detect and replace JSON array tables
    const jsonTableRegex = /\[\s*\{[^}]+\}(?:\s*,\s*\{[^}]+\})*\s*\]/g;
    const jsonTables = processedContent.match(jsonTableRegex) || [];
    const jsonTableData: Array<{ index: number, data: { headers: string[], rows: string[][] } | null }> = [];
    
    jsonTables.forEach((jsonTable, idx) => {
      const tableData = parseJsonTable(jsonTable);
      if (tableData) {
        const placeholder = `__JSON_TABLE_${idx}__`;
        const index = processedContent.indexOf(jsonTable);
        jsonTableData.push({ index, data: tableData });
        processedContent = processedContent.replace(jsonTable, placeholder);
      }
    });
    
    // Detect and replace ASCII/Text tables
    const textTableRegex = /\+[-+]+\+\n\|[^\n]+\|\n\+[=+]+\+\n(?:\|[^\n]+\|\n)+\+[-+]+\+/g;
    const textTables = processedContent.match(textTableRegex) || [];
    const textTableData: Array<{ index: number, data: { headers: string[], rows: string[][] } | null }> = [];
    
    textTables.forEach((textTable, idx) => {
      const tableData = parseTextTable(textTable);
      if (tableData) {
        const placeholder = `__TEXT_TABLE_${idx}__`;
        const index = processedContent.indexOf(textTable);
        textTableData.push({ index, data: tableData });
        processedContent = processedContent.replace(textTable, placeholder);
      }
    });
    
    // Detect if content contains a table in Llama3-3 format
    const llama3TableRegex = /\|[^\n]*\|[^\n]*\|\n\|[\s-]*\|[\s-]*\|[\s-]*\|\n(\|[^\n]*\|[^\n]*\|[^\n]*\|\n)+/g;
    
    // Detect if content contains a table in Phi4 format (tab-separated)
    const tabTableRegex = /^([^\t\n]+\t[^\t\n]+(\t[^\t\n]+)*\n){2,}/gm;
    
    // Detect if content contains a general markdown table
    // This pattern matches tables with any number of columns
    const markdownTableRegex = /\|.+\|\n\|[-:\s|]+\|\n(?:\|.+\|\n)+/g;
    
    // Detect if content contains a MediaWiki table
    const mediaWikiTableRegex = /\{\|[^\n]*\n[\s\S]*?\|\}/g;
    
    // Check if content contains any table patterns
    const hasLlama3Table = llama3TableRegex.test(processedContent);
    const hasTabTable = tabTableRegex.test(processedContent);
    const hasMarkdownTable = markdownTableRegex.test(processedContent);
    const hasMediaWikiTable = mediaWikiTableRegex.test(processedContent);
    const hasAnySpecialTable = htmlTableData.length > 0 || csvTableData.length > 0 || jsonTableData.length > 0 || textTableData.length > 0 || tabularMatches.length > 0 || earlyTabularMatches.length > 0;
    
    // Reset regex states
    llama3TableRegex.lastIndex = 0;
    tabTableRegex.lastIndex = 0;
    markdownTableRegex.lastIndex = 0;
    mediaWikiTableRegex.lastIndex = 0;
    
    // Helper function to replace KaTeX placeholders in any text content
    const replaceKatexPlaceholders = (text: string): React.ReactNode => {
      const hasKatexPlaceholder = /\{\{KATEX_DISPLAY_\d+\}\}/.test(text);
      
      if (!hasKatexPlaceholder) {
        return text;
      }
      
      // Replace placeholders with rendered HTML
      const parts: React.ReactNode[] = [];
      let remaining = text;
      let partKey = 0;
      
      displayMathBlocks.forEach((block) => {
        const index = remaining.indexOf(block.placeholder);
        if (index !== -1) {
          // Add text before placeholder
          if (index > 0) {
            parts.push(<span key={`text-${partKey++}`}>{remaining.substring(0, index)}</span>);
          }
          // Add rendered math
          parts.push(
            <Box
              key={`math-${partKey++}`}
              sx={{ my: 2, display: 'block' }}
              dangerouslySetInnerHTML={{ __html: block.html }}
            />
          );
          remaining = remaining.substring(index + block.placeholder.length);
        }
      });
      
      // Add any remaining text
      if (remaining) {
        parts.push(<span key={`text-${partKey++}`}>{remaining}</span>);
      }
      
      return parts.length > 0 ? <>{parts}</> : text;
    };
    
    // Create enhanced markdown components that restore KaTeX display math
    const customMarkdownComponents = {
      ...markdownComponents,
      // Override paragraph renderer to check for KaTeX placeholders
      p: ({ node, children, ...props }: any) => {
        const childText = String(children);
        const replaced = replaceKatexPlaceholders(childText);
        
        if (replaced !== childText) {
          return <div>{replaced}</div>;
        }
        
        // Default paragraph rendering
        return <p {...props}>{children}</p>;
      },
      // Override list item renderer to check for KaTeX placeholders
      li: ({ node, children, ...props }: any) => {
        // Extract text from children recursively
        const extractText = (node: any): string => {
          if (typeof node === 'string') return node;
          if (Array.isArray(node)) return node.map(extractText).join('');
          if (node?.props?.children) return extractText(node.props.children);
          return '';
        };
        
        const childText = extractText(children);
        const hasPlaceholder = /\{\{KATEX_DISPLAY_\d+\}\}/.test(childText);
        
        if (hasPlaceholder) {
          const replaced = replaceKatexPlaceholders(childText);
          return <li style={{ margin: '2px 0' }}>{replaced}</li>;
        }
        
        // Default list item rendering from markdownComponents
        return <li style={{ margin: '2px 0' }}>{children}</li>;
      },
    };
    
    // If no tables detected, render content with KaTeX display math restoration
    if (!hasLlama3Table && !hasTabTable && !hasMarkdownTable && !hasMediaWikiTable && !hasAnySpecialTable) {
      // Check if there are KaTeX display math blocks to restore
      if (displayMathBlocks.length > 0) {
        const parts: React.ReactNode[] = [];
        let remaining = processedContent;
        let key = 0;
        
        displayMathBlocks.forEach((block) => {
          const index = remaining.indexOf(block.placeholder);
          if (index !== -1) {
            // Add text before placeholder through ReactMarkdown
            const beforeText = remaining.substring(0, index);
            if (beforeText.trim()) {
              parts.push(
                <Box key={`text-${key++}`}>
                  <ReactMarkdown 
                    remarkPlugins={[[remarkMath, { singleDollarTextMath: true }] as any]}
                    rehypePlugins={[rehypeRaw as any, rehypeKatex as any]}
                    components={customMarkdownComponents}
                  >
                    {beforeText}
                  </ReactMarkdown>
                </Box>
              );
            }
            // Add rendered math
            parts.push(
              <Box
                key={`math-${key++}`}
                sx={{ my: 2, display: 'block' }}
                dangerouslySetInnerHTML={{ __html: block.html }}
              />
            );
            remaining = remaining.substring(index + block.placeholder.length);
          }
        });
        
        // Add any remaining text
        if (remaining.trim()) {
          parts.push(
            <Box key={`text-${key++}`}>
              <ReactMarkdown 
                remarkPlugins={[[remarkMath, { singleDollarTextMath: true }] as any]}
                rehypePlugins={[rehypeRaw as any, rehypeKatex as any]}
                components={customMarkdownComponents}
              >
                {remaining}
              </ReactMarkdown>
            </Box>
          );
        }
        
        return <div>{parts}</div>;
      }
      
      // No display math blocks, just render normally
      return (
        <ReactMarkdown 
          remarkPlugins={[[remarkMath, { singleDollarTextMath: true }] as any]}
          rehypePlugins={[rehypeRaw as any, rehypeKatex as any]}
          components={markdownComponents}
        >
          {processedContent}
        </ReactMarkdown>
      );
    }
    
    // Process content with tables
    const result = [];
    let lastIndex = 0;
    let match;
    let key = 0;
    
    // Process MediaWiki tables first (highest priority)
    if (hasMediaWikiTable) {
      while ((match = mediaWikiTableRegex.exec(processedContent)) !== null) {
        // Add text before the table
        const beforeTable = processedContent.substring(lastIndex, match.index);
        if (beforeTable.trim()) {
          result.push(
            <Box key={`text-${key++}`}>
              <ReactMarkdown 
                remarkPlugins={[[remarkMath, { singleDollarTextMath: true }] as any]}
                rehypePlugins={[rehypeRaw as any, rehypeKatex as any]}
                components={customMarkdownComponents}
              >
                {beforeTable}
              </ReactMarkdown>
            </Box>
          );
        }
        
        // Process the MediaWiki table using the parser from TableRenderer
        const tableContent = match[0];
        // Import the parser function synchronously since it's already available
        const { parseMediaWikiTable } = require('./TableRenderer');
        const tableData = parseMediaWikiTable(tableContent);
        
        if (tableData) {
          // Render Material-UI table with markdown support in cells and copy button
          const tableId = `mediawiki-table-${key}`;
          result.push(
            renderTableWithCopyButton(
              tableId,
              tableData.headers,
              tableData.rows,
              <TableContainer 
                key={`table-${key++}`}
                component={Paper} 
                sx={styles.tableContainer}
              >
                <Table>
                  <TableHead sx={styles.tableHead}>
                    <TableRow>
                      {tableData.headers.map((header: string, idx: number) => (
                        <TableCell 
                          key={idx}
                          sx={styles.tableHeaderCell}
                        >
                          {renderCellContent(header)}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {tableData.rows.map((row: string[], rowIdx: number) => (
                      <TableRow 
                        key={rowIdx}
                        sx={rowIdx % 2 === 1 ? styles.tableRowOdd : styles.tableRowEven}
                      >
                        {row.map((cell: string, cellIdx: number) => (
                          <TableCell 
                            key={cellIdx}
                            sx={styles.tableCell}
                          >
                            {renderCellContent(cell)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )
          );
        }
        
        // Update lastIndex to after this table
        lastIndex = match.index + match[0].length;
      }
    }
    
    // Process Llama3-3 tables
    if (hasLlama3Table) {
      while ((match = llama3TableRegex.exec(processedContent)) !== null) {
        // Add text before the table
        const beforeTable = processedContent.substring(lastIndex, match.index);
        if (beforeTable.trim()) {
          result.push(
            <Box key={`text-${key++}`}>
              <ReactMarkdown 
                remarkPlugins={[[remarkMath, { singleDollarTextMath: true }] as any]}
                rehypePlugins={[rehypeRaw as any, rehypeKatex as any]}
                components={customMarkdownComponents}
              >
                {beforeTable}
              </ReactMarkdown>
            </Box>
          );
        }
        
        // Process the table
        const tableMatch = match[0];
        
        // Extract headers and rows
        const lines = tableMatch.trim().split('\n');
        const headerLine = lines[0];
        
        // Helper function to split by | but not inside backticks
        const smartSplit = (line: string): string[] => {
          const cells: string[] = [];
          let current = '';
          let inBackticks = false;
          let backticksCount = 0;
          
          for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            // Check for backticks
            if (char === '`') {
              current += char;
              // Count consecutive backticks
              let count = 1;
              while (i + 1 < line.length && line[i + 1] === '`') {
                current += '`';
                i++;
                count++;
              }
              
              // Toggle state based on backtick count
              if (inBackticks && count === backticksCount) {
                inBackticks = false;
                backticksCount = 0;
              } else if (!inBackticks) {
                inBackticks = true;
                backticksCount = count;
              }
            } else if (char === '|' && !inBackticks) {
              cells.push(current);
              current = '';
            } else {
              current += char;
            }
          }
          cells.push(current);
          return cells.filter(cell => cell.trim() !== '').map(cell => cell.trim());
        };
        
        // Extract headers
        const headers = smartSplit(headerLine);
        
        // Skip the separator line (line with |---|---|)
        const dataRows = lines.slice(2);
        
        // Extract rows
        const rows = dataRows.map(row => smartSplit(row));
        
        // Render Material-UI table with markdown support in cells and copy button
        const tableId = `llama3-table-${key}`;
        result.push(
          renderTableWithCopyButton(
            tableId,
            headers,
            rows,
            <TableContainer 
              key={`table-${key++}`}
              component={Paper} 
              sx={styles.tableContainer}
            >
              <Table>
                <TableHead sx={styles.tableHead}>
                  <TableRow>
                    {headers.map((header, idx) => (
                      <TableCell 
                        key={idx}
                        sx={styles.tableHeaderCell}
                      >
                        {renderCellContent(header)}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row, rowIdx) => (
                    <TableRow 
                      key={rowIdx}
                      sx={rowIdx % 2 === 1 ? styles.tableRowOdd : styles.tableRowEven}
                    >
                      {row.map((cell, cellIdx) => (
                        <TableCell 
                          key={cellIdx}
                          sx={styles.tableCell}
                        >
                          {renderCellContent(cell)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )
        );
        
        // Update lastIndex to after this table
        lastIndex = match.index + match[0].length;
      }
    }
    
    // Process tab-separated tables (Phi4 format)
    if (hasTabTable) {
      tabTableRegex.lastIndex = 0; // Reset regex state
      
      while ((match = tabTableRegex.exec(processedContent)) !== null) {
        // Skip if this section was already processed as part of a Llama3 table
        if (match.index < lastIndex) continue;
        
        // Add text before the table
        const beforeTable = processedContent.substring(lastIndex, match.index);
        if (beforeTable.trim()) {
          result.push(
            <Box key={`text-${key++}`}>
              <ReactMarkdown 
                remarkPlugins={[[remarkMath, { singleDollarTextMath: true }] as any]}
                rehypePlugins={[rehypeRaw as any, rehypeKatex as any]}
                components={customMarkdownComponents}
              >
                {beforeTable}
              </ReactMarkdown>
            </Box>
          );
        }
        
        // Process the table
        const tableMatch = match[0];
        
        // Extract headers and rows
        const lines = tableMatch.trim().split('\n');
        
        // Extract headers from the first line
        const headerLine = lines[0];
        const headers = headerLine.split('\t').map(cell => cell.trim());
        
        // Extract data rows (all lines except the first)
        const dataRows = lines.slice(1);
        const rows = dataRows.map(row => 
          row.split('\t').map(cell => {
            // Remove markdown bold formatting if present (e.g., **text**)
            return cell.trim().replace(/^\*\*(.*)\*\*$/, '$1');
          })
        );
        
        // Render Material-UI table with markdown support in cells and copy button
        const tableId = `tab-table-${key}`;
        result.push(
          renderTableWithCopyButton(
            tableId,
            headers,
            rows,
            <TableContainer 
              key={`table-${key++}`}
              component={Paper} 
              sx={styles.tableContainer}
            >
              <Table>
                <TableHead sx={styles.tableHead}>
                  <TableRow>
                    {headers.map((header, idx) => (
                      <TableCell 
                        key={idx}
                        sx={styles.tableHeaderCell}
                      >
                        {renderCellContent(header)}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row, rowIdx) => (
                    <TableRow 
                      key={rowIdx}
                      sx={rowIdx % 2 === 1 ? styles.tableRowOdd : styles.tableRowEven}
                    >
                      {row.map((cell, cellIdx) => (
                        <TableCell 
                          key={cellIdx}
                          sx={styles.tableCell}
                        >
                          {renderCellContent(cell)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )
        );
        
        // Update lastIndex to after this table
        lastIndex = match.index + match[0].length;
      }
    }
    
    // Process general markdown tables
    if (hasMarkdownTable) {
      markdownTableRegex.lastIndex = 0; // Reset regex state
      
      while ((match = markdownTableRegex.exec(processedContent)) !== null) {
        // Skip if this section was already processed as part of another table
        if (match.index < lastIndex) {
          continue;
        }
        
        // Add text before the table
        const beforeTable = processedContent.substring(lastIndex, match.index);
        if (beforeTable.trim()) {
          result.push(
            <Box key={`text-${key++}`}>
              <ReactMarkdown 
                remarkPlugins={[[remarkMath, { singleDollarTextMath: true }] as any]}
                rehypePlugins={[rehypeRaw as any, rehypeKatex as any]}
                components={customMarkdownComponents}
              >
                {beforeTable}
              </ReactMarkdown>
            </Box>
          );
        }
        
        // Process the table
        const tableMatch = match[0];
        
        // Extract headers and rows
        const lines = tableMatch.trim().split('\n');
        const headerLine = lines[0];
        
        // Helper function to split by | but not inside backticks
        const smartSplit = (line: string): string[] => {
          const cells: string[] = [];
          let current = '';
          let inBackticks = false;
          let backticksCount = 0;
          
          for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            // Check for backticks
            if (char === '`') {
              current += char;
              // Count consecutive backticks
              let count = 1;
              while (i + 1 < line.length && line[i + 1] === '`') {
                current += '`';
                i++;
                count++;
              }
              
              // Toggle state based on backtick count
              if (inBackticks && count === backticksCount) {
                inBackticks = false;
                backticksCount = 0;
              } else if (!inBackticks) {
                inBackticks = true;
                backticksCount = count;
              }
            } else if (char === '|' && !inBackticks) {
              cells.push(current);
              current = '';
            } else {
              current += char;
            }
          }
          cells.push(current);
          return cells.filter(cell => cell.trim() !== '').map(cell => cell.trim());
        };
        
        // Extract headers using smart split
        const headers = smartSplit(headerLine);
        
        // Skip the separator line (line with |---|---|)
        const dataRows = lines.slice(2);
        
        // Extract rows using smart split
        const rows = dataRows.map(row => smartSplit(row));
        
        // Render Material-UI table with markdown support in cells and copy button
        const tableId = `markdown-table-${key}`;
        result.push(
          renderTableWithCopyButton(
            tableId,
            headers,
            rows,
            <TableContainer 
              key={`table-${key++}`}
              component={Paper} 
              sx={styles.tableContainer}
            >
              <Table>
                <TableHead sx={styles.tableHead}>
                  <TableRow>
                    {headers.map((header, idx) => (
                      <TableCell 
                        key={idx}
                        sx={styles.tableHeaderCell}
                      >
                        {renderCellContent(header)}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map((row, rowIdx) => (
                    <TableRow 
                      key={rowIdx}
                      sx={rowIdx % 2 === 1 ? styles.tableRowOdd : styles.tableRowEven}
                    >
                      {row.map((cell, cellIdx) => (
                        <TableCell 
                          key={cellIdx}
                          sx={styles.tableCell}
                        >
                          {renderCellContent(cell)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )
        );
        
        // Update lastIndex to after this table
        lastIndex = match.index + match[0].length;
      }
      
      // Add any remaining content after markdown tables
      const afterMarkdownTables = processedContent.substring(lastIndex);
      if (afterMarkdownTables.trim()) {
        result.push(
          <Box key={`text-${key++}`}>
            <ReactMarkdown 
              remarkPlugins={[[remarkMath, { singleDollarTextMath: true }] as any]}
              rehypePlugins={[rehypeRaw as any, rehypeKatex as any]}
              components={customMarkdownComponents}
            >
              {afterMarkdownTables}
            </ReactMarkdown>
          </Box>
        );
      }
      
      // Return early - we've processed all content
      return <div>{result}</div>;
    }
    
    // Add any remaining content after all table processing
    const afterLastTable = processedContent.substring(lastIndex);
    if (afterLastTable.trim()) {
      // Check for special table placeholders and render them
      let finalContent = afterLastTable;
      const specialTableMatches: Array<{ type: string, index: number, data: any }> = [];
      
      // Find ALL table placeholders by searching the entire content
      // Use a global regex to find all placeholders (including early extracted ones)
      const placeholderRegex = /__(?:EARLY_LATEX|HTML|CSV|JSON|TEXT|LATEX)_TABLE_(\d+)__/g;
      let placeholderMatch;
      
      while ((placeholderMatch = placeholderRegex.exec(finalContent)) !== null) {
        const fullPlaceholder = placeholderMatch[0];
        const typeMatch = fullPlaceholder.match(/__([A-Z_]+)_TABLE_(\d+)__/);
        
        if (typeMatch) {
          const type = typeMatch[1]; // EARLY_LATEX, HTML, CSV, JSON, TEXT, or LATEX
          const tableIndex = parseInt(typeMatch[2], 10);
          
          let tableData = null;
          
          // Get the table data based on type
          if (type === 'EARLY_LATEX' && earlyTabularMatches[tableIndex]) {
            tableData = {
              headers: earlyTabularMatches[tableIndex].headers,
              rows: earlyTabularMatches[tableIndex].rows
            };
          } else if (type === 'HTML' && htmlTableData[tableIndex]) {
            tableData = htmlTableData[tableIndex].data;
          } else if (type === 'CSV' && csvTableData[tableIndex]) {
            tableData = csvTableData[tableIndex].data;
          } else if (type === 'JSON' && jsonTableData[tableIndex]) {
            tableData = jsonTableData[tableIndex].data;
          } else if (type === 'TEXT' && textTableData[tableIndex]) {
            tableData = textTableData[tableIndex].data;
          } else if (type === 'LATEX' && tabularMatches[tableIndex]) {
            tableData = {
              headers: tabularMatches[tableIndex].headers,
              rows: tabularMatches[tableIndex].rows
            };
          }
          
          if (tableData) {
            specialTableMatches.push({
              type: fullPlaceholder,
              index: placeholderMatch.index,
              data: tableData
            });
          }
        }
      }
      
      // Sort by index to process in order
      specialTableMatches.sort((a, b) => a.index - b.index);
      
      // If there are special tables, process them
      if (specialTableMatches.length > 0) {
        let currentIndex = 0;
        
        specialTableMatches.forEach((tableMatch, idx) => {
          // Add text before this table
          const beforeTable = finalContent.substring(currentIndex, tableMatch.index);
          if (beforeTable.trim()) {
            result.push(
              <Box key={`text-${key++}`}>
                <ReactMarkdown 
                  remarkPlugins={[[remarkMath, { singleDollarTextMath: true }] as any]}
                  rehypePlugins={[rehypeRaw as any, rehypeKatex as any]}
                  components={customMarkdownComponents}
                >
                  {beforeTable}
                </ReactMarkdown>
              </Box>
            );
          }
          
          // Render the special table with markdown support in cells and copy button
          if (tableMatch.data) {
            const tableId = `special-table-${tableMatch.type}-${key}`;
            result.push(
              renderTableWithCopyButton(
                tableId,
                tableMatch.data.headers,
                tableMatch.data.rows,
                <TableContainer 
                  key={`table-${key++}`}
                  component={Paper} 
                  sx={styles.tableContainer}
                >
                  <Table>
                    <TableHead sx={styles.tableHead}>
                      <TableRow>
                        {tableMatch.data.headers.map((header: string, idx: number) => (
                          <TableCell 
                            key={idx}
                            sx={styles.tableHeaderCell}
                          >
                            {renderCellContent(header)}
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {tableMatch.data.rows.map((row: string[], rowIdx: number) => (
                        <TableRow 
                          key={rowIdx}
                          sx={rowIdx % 2 === 1 ? styles.tableRowOdd : styles.tableRowEven}
                        >
                          {row.map((cell: string, cellIdx: number) => (
                            <TableCell 
                              key={cellIdx}
                              sx={styles.tableCell}
                            >
                              {renderCellContent(cell)}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )
            );
          }
          
          // Move past this table
          currentIndex = tableMatch.index + tableMatch.type.length;
        });
        
        // Add any remaining content
        const remaining = finalContent.substring(currentIndex);
        if (remaining.trim() && !remaining.match(/__(?:EARLY_LATEX|HTML|CSV|JSON|TEXT|LATEX)_TABLE_\d+__/)) {
          result.push(
            <Box key={`text-${key++}`}>
              <ReactMarkdown 
                remarkPlugins={[[remarkMath, { singleDollarTextMath: true }] as any]}
                rehypePlugins={[rehypeRaw as any, rehypeKatex as any]}
                components={customMarkdownComponents}
              >
                {remaining}
              </ReactMarkdown>
            </Box>
          );
        }
      } else {
        result.push(
          <Box key={`text-${key++}`}>
            <ReactMarkdown 
              remarkPlugins={[[remarkMath, { singleDollarTextMath: true }] as any]}
              rehypePlugins={[rehypeRaw as any, rehypeKatex as any]}
              components={customMarkdownComponents}
            >
              {afterLastTable}
            </ReactMarkdown>
          </Box>
        );
      }
    }
    
    return <div>{result}</div>;
  };

  // Direct table detection and rendering for Llama3-3 format
  const detectAndRenderLlama3Table = (content: string) => {
    // This regex specifically targets the Llama3-3 table format with joined lines
    const llama3TableRegex = /\| ([^|]+) \| ([^|]+) \| ([^|]+) \| \| --- \| --- \| --- \| \| ([^|]+) \| ([^|]+) \| ([^|]+) \|/g;
    
    if (!llama3TableRegex.test(content)) {
      return null; // Not a Llama3-3 table
    }
    
    // Reset regex state
    llama3TableRegex.lastIndex = 0;
    
    // Extract table data
    const tableData: string[][] = [];
    let headers: string[] = [];
    let match: RegExpExecArray | null;
    
    while ((match = llama3TableRegex.exec(content)) !== null) {
      if (headers.length === 0) {
        // First match contains headers
        headers = [match[1].trim(), match[2].trim(), match[3].trim()];
        // Add first row
        tableData.push([match[4].trim(), match[5].trim(), match[6].trim()]);
      } else {
        // Subsequent matches are rows
        tableData.push([match[1].trim(), match[2].trim(), match[3].trim()]);
      }
    }
    
    if (headers.length === 0 || tableData.length === 0) {
      return null; // No valid table data extracted
    }
    
    // Render Material-UI table
    return (
      <TableContainer 
        component={Paper} 
        sx={styles.tableContainer}
      >
        <Table>
          <TableHead sx={styles.tableHead}>
            <TableRow>
              {headers.map((header, idx) => (
                <TableCell 
                  key={idx}
                  sx={styles.tableHeaderCell}
                >
                  {header}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {tableData.map((row, rowIdx) => (
              <TableRow 
                key={rowIdx}
                sx={rowIdx % 2 === 1 ? styles.tableRowOdd : styles.tableRowEven}
              >
                {row.map((cell, cellIdx) => (
                  <TableCell 
                    key={cellIdx}
                    sx={styles.tableCell}
                  >
                    {cell}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    );
  };

  // Function to copy message content to clipboard
  const handleCopyMessage = useCallback(async (messageId: string, content: string) => {
    try {
      // Try Electron clipboard API first (if in Electron environment)
      if (window.electronAPI && window.electronAPI.copyToClipboard) {
        const result = await window.electronAPI.copyToClipboard(content);
        if (result.success) {
          console.log('✅ Message copied successfully');
        } else {
          throw new Error(result.error || 'Electron clipboard copy failed');
        }
      }
      // Try modern clipboard API for browsers
      else if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(content);
        console.log('✅ Message copied successfully');
      }
      // Fallback for older browsers
      else {
        const textArea = document.createElement('textarea');
        textArea.value = content;
        textArea.style.position = 'absolute';
        textArea.style.left = '-9999px';
        textArea.style.top = '-9999px';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        console.log('✅ Message copied successfully');
      }
    } catch (error) {
      console.error('❌ Failed to copy message:', error);
    }
  }, []);


  // Memoized message component to prevent re-renders during streaming
  const MessageComponent = React.memo<{ message: MessageType; chatMessages?: MessageType[]; isStreaming: boolean }>(({ message, chatMessages, isStreaming }) => {
    const isUser = message.role === 'user';
    
    // Extract thinking and body from assistant messages
    const { thinking, body } = isUser ? { thinking: null, body: message.content } : takeThinkingThenBody(message.content);
    const displayContent = body;
    
    // Auto-detect RTL/LTR for both user and assistant messages
    const textDirectionStyles = getTextDirectionStyles(displayContent);
    const mixedContentAnalysis = analyzeMixedContent(displayContent);
    
    return (
      <Box
        key={message.id}
        sx={styles.messageBox}
      >
        <Box
          sx={isUser ? styles.userMessage : styles.assistantMessage}
        >
          <Box sx={{ width: '100%' }}>
            {/* Render message content with RTL/LTR support */}
            <Typography
              variant="body1"
              component="div"
              className="markdown-content"
              sx={{
                ...styles.messageContent,
                // Apply RTL/LTR styling for assistant messages
                ...(textDirectionStyles && {
                  direction: textDirectionStyles.direction,
                  textAlign: textDirectionStyles.textAlign,
                  unicodeBidi: mixedContentAnalysis?.shouldUseBidi ? 'bidi-override' : textDirectionStyles.unicodeBidi,
                }),
              }}
            >
              {isUser ? (
                displayContent
              ) : (
                <>
                  {/* Use structural rendering system */}
                  {renderContentStructurally(displayContent)}
                  {isStreaming && (
                    <span className="streaming-cursor"></span>
                  )}
                </>
              )}
            </Typography>

            {/* Thinking chunk display - streaming tape animation */}
            {!isUser && thinking && (
              <Box
                sx={{
                  mt: 1,
                  p: 1.5,
                  backgroundColor: 'rgba(0, 0, 0, 0.02)',
                  borderRadius: '8px',
                  border: '1px solid',
                  borderColor: 'divider',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    color: 'text.secondary',
                    fontStyle: 'italic',
                    fontSize: '0.85rem',
                    opacity: 0.7,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    animation: 'streamingTape 8s linear infinite',
                    '@keyframes streamingTape': {
                      '0%': {
                        transform: 'translateX(0%)',
                      },
                      '100%': {
                        transform: 'translateX(-50%)',
                      },
                    },
                  }}
                >
                  {thinking} {thinking}
                </Typography>
              </Box>
            )}

            {/* Token count display - always on right side for both user and AI messages */}
            {(() => {
              // Get current context length from settings (localStorage)
              let currentContextLength = 4096; // Default fallback
              try {
                const savedContextLength = localStorage.getItem('contextLength');
                if (savedContextLength) {
                  const parsed = parseInt(savedContextLength, 10);
                  if (!isNaN(parsed) && parsed >= 2000) {
                    currentContextLength = parsed;
                  }
                }
              } catch (error) {
                console.error('Error reading context length from settings:', error);
              }

              return (
                <Box sx={{ 
                  display: 'flex', 
                  justifyContent: 'flex-end', // Always on right side
                  mt: 0.5 
                }}>
                  {isUser && message.contextTokensUsed && message.contextTokensUsed > 0 ? (
                    // User messages: Show total context sent to LLM
                    <Typography
                      variant="caption"
                      sx={{
                        fontSize: '9px',
                        color: 'text.disabled',
                        opacity: 0.4,
                        fontFamily: 'monospace',
                        userSelect: 'none',
                      }}
                    >
                      ~{message.contextTokensUsed}/{currentContextLength}
                    </Typography>
                  ) : !isUser && message.tokenCount && message.tokenCount > 0 ? (
                    // AI messages: Show only tokens received in this response
                    <Typography
                      variant="caption"
                      sx={{
                        fontSize: '9px',
                        color: 'text.disabled',
                        opacity: 0.4,
                        fontFamily: 'monospace',
                        userSelect: 'none',
                      }}
                    >
                      ~{message.tokenCount}/{currentContextLength}
                    </Typography>
                  ) : null}
                </Box>
              );
            })()}
            
            {/* Render file attachments if present */}
            {message.attachments && message.attachments.length > 0 && (
              <Box sx={{ mt: 2, mb: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                  Attachments:
                </Typography>
                {message.attachments.map((attachment) => {
                  if (attachment.type === 'image') {
                    return (
                      <Box key={attachment.id} sx={{ mb: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                          <ImageIcon sx={{ fontSize: 16, mr: 0.5, color: 'text.secondary' }} />
                          <Typography variant="body2" sx={styles.attachmentName}>
                            {attachment.name}
                          </Typography>
                          <Typography variant="caption" sx={styles.attachmentSize}>
                            {formatFileSize(attachment.size)}
                          </Typography>
                        </Box>
                        <Box 
                          component="img"
                          src={attachment.content}
                          alt={attachment.name}
                          sx={{ 
                            maxWidth: '100%', 
                            maxHeight: '300px',
                            borderRadius: 1,
                            objectFit: 'contain'
                          }}
                        />
                      </Box>
                    );
                  } else if (attachment.type === 'pdf') {
                    return (
                      <Box key={attachment.id} sx={{ mb: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
                          <DescriptionIcon sx={{ fontSize: 16, mr: 0.5, color: 'text.secondary' }} />
                          <Typography variant="body2" sx={styles.attachmentName}>
                            {attachment.name} (PDF)
                          </Typography>
                          <Typography variant="caption" sx={styles.attachmentSize}>
                            {formatFileSize(attachment.size)}
                          </Typography>
                        </Box>
                        
                        {/* Simple PDF preview with extracted content */}
                        <Box sx={{ 
                          border: '1px solid',
                          borderColor: 'divider',
                          borderRadius: 1,
                          p: 1,
                          bgcolor: 'background.paper',
                        }}>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                            PDF Content Preview
                          </Typography>
                          
                          {/* Show a small preview of the text */}
                          {attachment.content && (
                            <Box 
                              sx={{ 
                                maxHeight: '100px', 
                                overflowY: 'auto',
                                p: 1,
                                bgcolor: 'action.hover',
                                borderRadius: 1,
                                mb: 1,
                                fontSize: '0.75rem'
                              }}
                            >
                              <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                                {attachment.content.length > 300 
                                  ? `${attachment.content.substring(0, 300)}...`
                                  : attachment.content
                                }
                              </pre>
                            </Box>
                          )}
                          
                          {/* Show thumbnails of extracted images if any */}
                          {attachment.images && attachment.images.length > 0 && (
                            <Box>
                              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.5 }}>
                                {attachment.images.length} image{attachment.images.length !== 1 ? 's' : ''} extracted
                              </Typography>
                              <Box sx={{ 
                                display: 'flex', 
                                flexWrap: 'wrap', 
                                gap: 0.5,
                                maxHeight: '100px',
                                overflowY: 'auto'
                              }}>
                                {attachment.images.slice(0, 4).map((imgSrc, index) => (
                                  <Box 
                                    key={index}
                                    component="img"
                                    src={imgSrc}
                                    alt={`Image ${index + 1} from ${attachment.name}`}
                                    sx={{ 
                                      width: '40px', 
                                      height: '40px',
                                      objectFit: 'cover',
                                      borderRadius: 0.5,
                                    }}
                                  />
                                ))}
                                {attachment.images.length > 4 && (
                                  <Box sx={{ 
                                    width: '40px', 
                                    height: '40px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    bgcolor: 'action.hover',
                                    borderRadius: 0.5,
                                    fontSize: '0.75rem'
                                  }}>
                                    +{attachment.images.length - 4}
                                  </Box>
                                )}
                              </Box>
                            </Box>
                          )}
                        </Box>
                      </Box>
                    );
                  } else {
                    return (
                      <Box key={attachment.id} sx={styles.attachmentPreview}>
                        <DescriptionIcon sx={styles.attachmentIcon} />
                        <Typography variant="body2" sx={styles.attachmentName}>
                          {attachment.name}
                        </Typography>
                        <Typography variant="caption" sx={styles.attachmentSize}>
                          {formatFileSize(attachment.size)}
                        </Typography>
                      </Box>
                    );
                  }
                })}
              </Box>
            )}
          </Box>
        </Box>
        
        {/* Copy message button - visually distinct from table/code copy buttons */}
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'flex-start',
            mt: 1,
            ml: 1,
          }}
        >
          <Button
            size="small"
            startIcon={<ContentCopyIcon sx={{ fontSize: 16 }} />}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleCopyMessage(message.id, displayContent);
            }}
            sx={{
              opacity: 0.7,
              fontSize: '0.75rem',
              textTransform: 'none',
              color: 'text.secondary',
              borderRadius: '12px',
              px: 1.5,
              py: 0.5,
              minWidth: 'auto',
              transition: 'all 0.2s',
              border: '1px solid',
              borderColor: 'divider',
              backgroundColor: 'transparent',
              '&:hover': {
                opacity: 1,
                backgroundColor: 'rgba(33, 150, 243, 0.08)',
                borderColor: 'primary.main',
                color: 'primary.main',
                transform: 'translateY(-1px)',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              },
            }}
          >
            Copy Message
          </Button>
        </Box>
      </Box>
    );
  }, (prevProps, nextProps) => {
    // Only re-render if the message content changed or streaming status changed
    return prevProps.message.content === nextProps.message.content && 
           prevProps.isStreaming === nextProps.isStreaming;
  });

  // Create a stable renderMessage that doesn't depend on loading
  const renderMessage = useCallback((message: MessageType, chatMessages?: MessageType[], currentlyLoading?: boolean) => {
    const isLastMessage = !!(chatMessages && message.id === chatMessages[chatMessages.length - 1]?.id);
    const isStreaming = currentlyLoading === true && isLastMessage;
    
    return <MessageComponent message={message} chatMessages={chatMessages} isStreaming={isStreaming} />;
  }, []);

  // Split messages into completed and streaming for better performance
  const { completedMessages, streamingMessage } = React.useMemo(() => {
    if (!chat?.messages || chat.messages.length === 0) {
      return { completedMessages: [], streamingMessage: null };
    }
    
    if (loading) {
      // Last message is streaming
      const completed = chat.messages.slice(0, -1);
      const streaming = chat.messages[chat.messages.length - 1];
      return { completedMessages: completed, streamingMessage: streaming };
    } else {
      // All messages are completed
      return { completedMessages: chat.messages, streamingMessage: null };
    }
  }, [chat?.messages, loading]);
  
  // Memoize completed messages - these NEVER re-render during streaming
  const renderedCompletedMessages = React.useMemo(() =>
    completedMessages.map(msg => (
      <React.Fragment key={msg.id}>
        {renderMessage(msg, completedMessages, false)}
      </React.Fragment>
    )),
    [completedMessages, renderMessage]
  );

  return (
    <Box
      component="main"
      sx={styles.container(sidebarOpen)}
    >
      <AppBar
        position="static"
        color="transparent"
        elevation={0}
        sx={styles.appBar}
      >
        <Toolbar>
          <IconButton
            edge="start"
            color="inherit"
            aria-label="menu"
            onClick={onToggleSidebar}
            sx={{ mr: 2 }}
          >
            <MenuIcon />
          </IconButton>

          <Button
            onClick={handleOpenModelMenu}
            endIcon={<KeyboardArrowDownIcon />}
            sx={{
              ...styles.modelSelector,
              // Change to red background with white text when Ollama has an error
              ...((!ollamaStatus.isAvailable && ollamaStatus.error) && {
                backgroundColor: 'error.main',
                color: 'white',
                borderColor: 'error.main',
                '&:hover': {
                  backgroundColor: 'error.dark',
                  borderColor: 'error.dark',
                },
              }),
            }}
          >
            {(!ollamaStatus.isAvailable && ollamaStatus.error) 
              ? 'Error' 
              : (model?.name || 'Select Model')
            }
          </Button>
          <Menu
            anchorEl={modelMenuAnchor}
            open={Boolean(modelMenuAnchor)}
            onClose={handleCloseModelMenu}
          >
            {/* Show Ollama status error if there's an issue */}
            {!ollamaStatus.isAvailable && ollamaStatus.error && (
              <>
                <MenuItem
                  disabled
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    color: 'error.main',
                    backgroundColor: 'rgba(244, 67, 54, 0.08)',
                    '&.Mui-disabled': {
                      opacity: 1,
                    },
                  }}
                >
                  <ErrorIcon sx={{ fontSize: 18, color: 'error.main' }} />
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                      Ollama Connection Error
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Make sure Ollama is installed and running properly.
                    </Typography>
                  </Box>
                </MenuItem>
                <MenuItem
                  onClick={async () => {
                    handleCloseModelMenu();
                    await onRefreshOllamaStatus();
                  }}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    color: 'primary.main',
                  }}
                >
                  <RefreshIcon sx={{ fontSize: 18 }} />
                  <Typography variant="body2">
                    Retry Connection
                  </Typography>
                </MenuItem>
                <Divider sx={{ my: 1 }} />
              </>
            )}
            
            {/* Show warning if Ollama is available but there are no models */}
            {ollamaStatus.isAvailable && models.length === 0 && (
              <>
                <MenuItem
                  disabled
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    color: 'warning.main',
                    backgroundColor: 'rgba(255, 152, 0, 0.08)',
                    '&.Mui-disabled': {
                      opacity: 1,
                    },
                  }}
                >
                  <WarningIcon sx={{ fontSize: 18, color: 'warning.main' }} />
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
                      No Models Available
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Ollama is running but no models are installed
                    </Typography>
                  </Box>
                </MenuItem>
                <Divider sx={{ my: 1 }} />
                
                {/* Model installation suggestions */}
                <Box sx={{ px: 2, py: 2 }}>
                  <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'primary.main', mb: 1 }}>
                    📥 Suggested Models to Install:
                  </Typography>
                  
                  {/* High-performance model suggestion */}
                  <Box sx={{ 
                    width: '100%', 
                    p: 1.5, 
                    borderRadius: 1, 
                    bgcolor: 'rgba(76, 175, 80, 0.08)',
                    border: '1px solid rgba(76, 175, 80, 0.2)',
                    mb: 1
                  }}>
                    <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'success.main' }}>
                      🚀 For High-Performance Computers(More Than 16GB RAM):
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 0.5, fontFamily: 'monospace', fontSize: '0.85rem' }}>
                      ollama pull gpt-oss:20b
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                      Advanced 20B parameter model - requires 16GB+ RAM
                    </Typography>
                    <Typography 
                      variant="caption" 
                      component="a"
                      href="https://ollama.com/library/gpt-oss"
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{ 
                        color: 'primary.main', 
                        textDecoration: 'underline',
                        cursor: 'pointer',
                        display: 'inline-block',
                        mt: 0.5,
                        '&:hover': { color: 'primary.dark' }
                      }}
                    >
                      📖 View Documentation
                    </Typography>
                  </Box>
                  
                  {/* Light-weight model suggestion */}
                  <Box sx={{ 
                    width: '100%', 
                    p: 1.5, 
                    borderRadius: 1, 
                    bgcolor: 'rgba(33, 150, 243, 0.08)',
                    border: '1px solid rgba(33, 150, 243, 0.2)'
                  }}>
                    <Typography variant="body2" sx={{ fontWeight: 'bold', color: 'info.main' }}>
                      💻 For Light Computers(Less Than 16GB RAM):
                    </Typography>
                    <Typography variant="body2" sx={{ mt: 0.5, fontFamily: 'monospace', fontSize: '0.85rem' }}>
                      ollama pull mistral:7b
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                      Efficient 7B parameter model - requires 4GB+ RAM
                    </Typography>
                    <Typography 
                      variant="caption" 
                      component="a"
                      href="https://ollama.com/library/mistral"
                      target="_blank"
                      rel="noopener noreferrer"
                      sx={{ 
                        color: 'primary.main', 
                        textDecoration: 'underline',
                        cursor: 'pointer',
                        display: 'inline-block',
                        mt: 0.5,
                        '&:hover': { color: 'primary.dark' }
                      }}
                    >
                      📖 View Documentation
                    </Typography>
                  </Box>
                  
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, fontStyle: 'italic', display: 'block' }}>
                    💡 Run these commands in your terminal to install models
                  </Typography>
                </Box>
                <Divider sx={{ my: 1 }} />
              </>
            )}
            
            
            {/* Model list */}
            {models
              .filter((m) => !m.name.toLowerCase().startsWith('nomic'))
              .map((m) => (
                <MenuItem
                  key={m.id}
                  selected={m.id === model?.id}
                  onClick={() => handleSelectModel(m)}
                  disabled={!ollamaStatus.isAvailable}
                >
                  {m.name}
                </MenuItem>
              ))}
            
            {/* Show message when no models and Ollama is offline */}
            {!ollamaStatus.isAvailable && models.length === 0 && (
                <MenuItem disabled>
                <Typography variant="body2" color="text.secondary">
                  {ollamaStatus.error}
                </Typography>
              </MenuItem>
            )}
          </Menu>

          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ ml: 1, cursor: 'pointer' }}
            onClick={handleSetAsDefault}
          >
            {isCurrentModelDefault() ? 'Default' : 'Set as default'}
          </Typography>

          <Box sx={{ flexGrow: 1 }} />
          
          {/* Contributors Button */}
          <IconButton
            color="inherit"
            onClick={() => setContributorsOpen(true)}
            title="Contributors"
            sx={{ mr: 5 }}
          >
            <PeopleIcon />
          </IconButton>
        </Toolbar>
      </AppBar>
      
      {!chat || !chat.id ? (
        <Box
          sx={styles.welcomeContainer}
        >
          <Box sx={styles.welcomeHeader}>
            <Typography variant="h4" gutterBottom>
              {model?.name || 'Nebulon-GPT'}
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Your Fully Private Ollama-based Web User Interface
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              by HH Rashidi
            </Typography>
          </Box>

          <Typography variant="h6" gutterBottom sx={styles.suggestedPromptsHeader}>
            <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box component="span" sx={styles.sparkleIcon}>✨</Box> Suggested
            </Box>
          </Typography>

          <Grid container spacing={2}>
            {suggestedPrompts.map((prompt, index) => (
              <Grid item xs={12} key={index}>
                <Card 
                  variant="outlined" 
                  sx={styles.promptCard}
                >
                  <CardActionArea onClick={() => handleSuggestedPrompt(prompt.prompt)}>
                    <CardContent>
                      <Typography variant="subtitle1">{prompt.title}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {prompt.description}
                      </Typography>
                    </CardContent>
                  </CardActionArea>
                </Card>
              </Grid>
            ))}
          </Grid>
        </Box>
      ) : (
        <>
          <Box
            key={chat.id}
            ref={messagesContainerRef}
            sx={styles.messagesContainer}
          >
            {/* Full Voice Mode Indicator */}
            {(() => {
              const ttsSettings = ttsService.getSettings();
              const isFullVoiceMode = ttsSettings.fullVoiceMode;
              const ttsQueueStatus = ttsService.getQueueStatus();
              const isTTSPaused = ttsService.isPausedState();
              
              // Show indicator if Full Voice Mode is active OR if we're in the process of turning off
              if ((isFullVoiceMode && isListening) || (isTurningOff && isListening)) {
                return (
                  <Box
                    sx={{
                      position: 'fixed',
                      bottom: '120px',
                      right: '20px',
                      zIndex: 1000,
                      backgroundColor: isTurningOff ? 'rgba(158, 158, 158, 0.95)' : 'rgba(244, 67, 54, 0.95)',
                      color: 'white',
                      padding: '20px',
                      borderRadius: '16px',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 2,
                      boxShadow: isTurningOff 
                        ? '0 8px 32px rgba(158, 158, 158, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1)'
                        : '0 8px 32px rgba(244, 67, 54, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1)',
                      backdropFilter: 'blur(20px)',
                      border: isTurningOff ? '2px solid rgba(158, 158, 158, 0.8)' : '2px solid rgba(244, 67, 54, 0.8)',
                      minWidth: '200px',
                      animation: isTurningOff ? 'none' : 'pulseRed 2s infinite',
                      transition: 'all 0.5s ease-in-out',
                      '@keyframes pulseRed': {
                        '0%': {
                          boxShadow: '0 8px 32px rgba(244, 67, 54, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1), 0 0 0 0 rgba(244, 67, 54, 0.7)',
                        },
                        '70%': {
                          boxShadow: '0 8px 32px rgba(244, 67, 54, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1), 0 0 0 15px rgba(244, 67, 54, 0)',
                        },
                        '100%': {
                          boxShadow: '0 8px 32px rgba(244, 67, 54, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1), 0 0 0 0 rgba(244, 67, 54, 0)',
                        },
                      },
                      '@keyframes fadeOut': {
                        '0%': {
                          opacity: 1,
                          transform: 'scale(1)',
                          backgroundColor: 'rgba(244, 67, 54, 0.95)',
                        },
                        '50%': {
                          opacity: 0.7,
                          transform: 'scale(0.9)',
                          backgroundColor: 'rgba(158, 158, 158, 0.95)',
                        },
                        '100%': {
                          opacity: 0,
                          transform: 'scale(0.8)',
                          backgroundColor: 'rgba(158, 158, 158, 0.5)',
                        },
                      },
                    }}
                  >
                    {/* Main indicator content */}
                    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
                      {/* Large animated microphone icon */}
                      <Box
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          width: '60px',
                          height: '60px',
                          borderRadius: '50%',
                          backgroundColor: 'rgba(255, 255, 255, 0.2)',
                          animation: 'bounce 1.5s infinite',
                          '@keyframes bounce': {
                            '0%, 20%, 50%, 80%, 100%': {
                              transform: 'translateY(0)',
                            },
                            '40%': {
                              transform: 'translateY(-5px)',
                            },
                            '60%': {
                              transform: 'translateY(-2px)',
                            },
                          },
                        }}
                      >
                        <MicIcon sx={{ fontSize: 32, color: 'white' }} />
                      </Box>
                      
                      {/* Title */}
                      <Typography variant="h6" sx={{ fontWeight: 'bold', fontSize: '1.1rem', textAlign: 'center' }}>
                        Full Voice Mode
                      </Typography>
                      
                      {/* Status text - changes based on TTS state */}
                      <Typography variant="body2" sx={{ fontSize: '0.9rem', opacity: 0.9, textAlign: 'center' }}>
                        {isTTSPaused ? (
                          '⏸️ Audio Paused - Listening...'
                        ) : ttsQueueStatus.isPlaying ? (
                          '🔊 Playing Audio - Listening...'
                        ) : (
                          '🎙️ Listening for your voice...'
                        )}
                      </Typography>
                      
                      {/* Helpful tip about "stop stop" command */}
                      <Typography variant="caption" sx={{ 
                        fontSize: '0.75rem', 
                        opacity: 0.8, 
                        textAlign: 'center',
                        fontStyle: 'italic',
                        mt: 0.5
                      }}>
                        💡 Say "stop stop" to stop listening
                      </Typography>
                      
                      {/* Real-time audio waveform visualization */}
                      <WaveformVisualization 
                        voskRecognition={voskRecognition}
                        isListening={isListening}
                      />
                    </Box>
                    
                    {/* Detection Sensitivity Control */}
                    <Box sx={{ width: '100%', px: 1, pb: 1 }}>
                      <Box sx={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center',
                        mb: 1,
                        gap: 1
                      }}>
                        <Typography variant="caption" sx={{ 
                          fontSize: '0.75rem',
                          opacity: 0.8 
                        }}>
                          Detection Sensitivity: {detectionSensitivity}
                        </Typography>
                        <IconButton
                          size="small"
                          onClick={handleSetSensitivityTo100}
                          title="Reset detection sensitivity to optimal level (100)"
                          sx={{
                            color: 'white',
                            backgroundColor: 'rgba(255, 255, 255, 0.1)',
                            width: 20,
                            height: 20,
                            '&:hover': {
                              backgroundColor: 'rgba(255, 255, 255, 0.2)',
                              transform: 'scale(1.1)',
                            },
                            '&:active': {
                              transform: 'scale(0.95)',
                            },
                            transition: 'all 0.2s ease-in-out',
                          }}
                        >
                          <RefreshIcon sx={{ fontSize: 12 }} />
                        </IconButton>
                      </Box>
                      <Box sx={{ px: 1, pb: 1 }}>
                        <Slider
                          value={detectionSensitivity}
                          onChange={handleDetectionSensitivityChange}
                          min={0}
                          max={100}
                          step={1}
                          size="small"
                          sx={{
                            color: 'white',
                            '& .MuiSlider-thumb': {
                              backgroundColor: 'white',
                              border: '3px solid rgba(255, 255, 255, 0.9)',
                              width: 24,
                              height: 16,
                              borderRadius: '50px', // More oval/elliptical shape
                              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.1)',
                              transition: 'all 0.2s ease-in-out',
                              '&:hover': {
                                boxShadow: '0 0 0 12px rgba(255, 255, 255, 0.12), 0 4px 12px rgba(0, 0, 0, 0.4)',
                                transform: 'scale(1.1)',
                                border: '3px solid rgba(255, 255, 255, 1)',
                              },
                              '&:active': {
                                boxShadow: '0 0 0 16px rgba(255, 255, 255, 0.2), 0 2px 6px rgba(0, 0, 0, 0.5)',
                                transform: 'scale(1.05)',
                              },
                              '&::before': {
                                content: '""',
                                position: 'absolute',
                                top: '50%',
                                left: '50%',
                                transform: 'translate(-50%, -50%)',
                                width: '8px',
                                height: '4px',
                                backgroundColor: 'rgba(244, 67, 54, 0.8)',
                                borderRadius: '50px',
                                transition: 'all 0.2s ease-in-out',
                              },
                            },
                            '& .MuiSlider-track': {
                              backgroundColor: 'white',
                              border: 'none',
                              height: 16,
                              borderRadius: '1px 12px 12px 1px', // Very thin start, thick end
                              boxShadow: '0 3px 8px rgba(0, 0, 0, 0.4)',
                              background: 'linear-gradient(to right, white 0%, white 100%)',
                              clipPath: 'polygon(0% 45%, 100% 0%, 100% 100%, 0% 55%)', // Much thinner start
                            },
                            '& .MuiSlider-rail': {
                              backgroundColor: 'rgba(255, 255, 255, 0.25)',
                              height: 16,
                              borderRadius: '1px 12px 12px 1px', // Very thin start, thick end
                              boxShadow: 'inset 0 3px 6px rgba(0, 0, 0, 0.3)',
                              clipPath: 'polygon(0% 45%, 100% 0%, 100% 100%, 0% 55%)', // Much thinner start
                            },
                            '& .MuiSlider-mark': {
                              display: 'none', // Hide marks to prevent overflow
                            },
                            '& .MuiSlider-markLabel': {
                              display: 'none', // Hide mark labels to prevent overflow
                            },
                          }}
                        />
                      </Box>
                      {/* Custom labels row */}
                      <Box sx={{ 
                        display: 'flex', 
                        justifyContent: 'space-between', 
                        px: 2,
                        mt: -0.5
                      }}>
                        <Typography variant="caption" sx={{ fontSize: '0.6rem', opacity: 0.7 }}>0</Typography>
                        <Typography variant="caption" sx={{ fontSize: '0.6rem', opacity: 0.7 }}>25</Typography>
                        <Typography variant="caption" sx={{ fontSize: '0.6rem', opacity: 0.7 }}>50</Typography>
                        <Typography variant="caption" sx={{ fontSize: '0.6rem', opacity: 0.7 }}>75</Typography>
                        <Typography variant="caption" sx={{ fontSize: '0.6rem', opacity: 0.7 }}>100</Typography>
                      </Box>
                    </Box>
                    
                    {/* Separator line */}
                    <Box
                      sx={{
                        width: '100%',
                        height: '1px',
                        backgroundColor: 'rgba(255, 255, 255, 0.3)',
                        my: 1,
                      }}
                    />
                    
                    {/* Disable button at the bottom */}
                    <Button
                      onClick={async (e) => {
                        e.stopPropagation();
                        console.log('🔇 User clicked to disable full voice mode');
                        
                        // Start the turning off animation immediately
                        setIsTurningOff(true);
                        
                        // Disable full voice mode and stop mic immediately (but keep animation running)
                        ttsService.updateSettings({ fullVoiceMode: false });
                        ttsService.saveSettings();
                        
                        // Stop mic listening when disabling full voice mode
                        if (onMicStop && onMicStop.current) {
                          await onMicStop.current();
                        }
                        
                        // The turning off state will be reset when isListening becomes false
                        // This happens automatically when the mic stops
                      }}
                      variant="contained"
                      size="small"
                      sx={{
                        backgroundColor: 'rgba(255, 255, 255, 0.2)',
                        color: 'white',
                        borderRadius: '20px',
                        textTransform: 'none',
                        fontSize: '0.85rem',
                        fontWeight: 'bold',
                        px: 3,
                        py: 1,
                        border: '1px solid rgba(255, 255, 255, 0.3)',
                        '&:hover': {
                          backgroundColor: 'rgba(255, 255, 255, 0.3)',
                          transform: 'scale(1.05)',
                          transition: 'all 0.2s ease-in-out',
                        },
                        '&:active': {
                          transform: 'scale(0.95)',
                        },
                      }}
                    >
                      🔇 Turn Off
                    </Button>
                  </Box>
                );
              }
              
              return null;
            })()}
            
            
            {renderedCompletedMessages}
            {streamingMessage && renderMessage(streamingMessage, chat?.messages, loading)}
            
            {/* Loading Animation - appears after 3 seconds of loading */}
            {showLoadingAnimation && loading && (
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'flex-start',
                  mb: 2,
                  px: 2,
                }}
              >
                <Box
                  sx={{
                    maxWidth: '70%',
                    backgroundColor: 'background.paper',
                    borderRadius: '18px 18px 18px 4px',
                    p: 3,
                    boxShadow: '0 1px 2px rgba(0, 0, 0, 0.1)',
                    border: '1px solid',
                    borderColor: 'divider',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    animation: 'fadeInUp 0.3s ease-out',
                    '@keyframes fadeInUp': {
                      '0%': {
                        opacity: 0,
                        transform: 'translateY(10px)',
                      },
                      '100%': {
                        opacity: 1,
                        transform: 'translateY(0)',
                      },
                    },
                  }}
                >
                  {/* Animated thinking dots */}
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.5,
                    }}
                  >
                    {[0, 1, 2].map((index) => (
                      <Box
                        key={index}
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          backgroundColor: 'primary.main',
                          animation: `bounce 1.4s infinite ease-in-out`,
                          animationDelay: `${index * 0.16}s`,
                          '@keyframes bounce': {
                            '0%, 80%, 100%': {
                              transform: 'scale(0)',
                              opacity: 0.5,
                            },
                            '40%': {
                              transform: 'scale(1)',
                              opacity: 1,
                            },
                          },
                        }}
                      />
                    ))}
                  </Box>
                  
                  {/* Loading/Thinking message */}
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{
                      fontStyle: 'italic',
                      animation: 'pulse 2s infinite',
                      '@keyframes pulse': {
                        '0%': { opacity: 0.2 },
                        '50%': { opacity: 1 },
                        '100%': { opacity: 0.2 },
                      },
                    }}
                  >
                    {model?.name || 'AI'} is loading/thinking...
                  </Typography>
                </Box>
              </Box>
            )}
            
            <div ref={messagesEndRef} />
          </Box>

          {/* Jump to bottom button - shows when scrolled up, hides when at bottom */}
          {showJumpButton && (
            <Box
              sx={{
                position: 'fixed',
                bottom: '100px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 9999,
              }}
            >
              <IconButton
                onClick={() => jumpToLatest('smooth')}
                sx={(theme) => ({
                  backgroundColor: theme.palette.mode === 'dark' 
                    ? 'rgba(66, 66, 66, 0.95)' 
                    : 'primary.main',
                  color: 'white',
                  boxShadow: theme.palette.mode === 'dark'
                    ? '0 4px 8px rgba(0,0,0,0.6)'
                    : '0 4px 8px rgba(0,0,0,0.3)',
                  border: theme.palette.mode === 'dark' 
                    ? '1px solid rgba(255,255,255,0.1)'
                    : 'none',
                  '&:hover': {
                    backgroundColor: theme.palette.mode === 'dark'
                      ? 'rgba(88, 88, 88, 0.95)'
                      : 'primary.dark',
                    transform: 'scale(1.1)',
                  },
                  transition: 'all 0.2s',
                })}
                size="large"
              >
                <ArrowDownIcon />
              </IconButton>
            </Box>
          )}

          <InputArea
            loading={loading}
            onSendMessage={handleSendMessage}
            onStopResponse={onStopResponse}
            voskRecognition={voskRecognition}
            isListening={isListening}
            isProcessingMic={isProcessingMic}
            speechError={speechError}
            interimTranscript={interimTranscript}
            onToggleListening={toggleListening}
            initialMessage={message}
            chat={chat}
            voiceText={message}
            onClearInput={onClearInputAreaRef}
          />
        </>
      )}
      
      {/* Contributors Dialog */}
      <Dialog
        open={contributorsOpen}
        onClose={() => setContributorsOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <PeopleIcon color="primary" />
              <Typography variant="h6">Contributors</Typography>
            </Box>
            <IconButton
              edge="end"
              color="inherit"
              onClick={() => setContributorsOpen(false)}
              aria-label="close"
              sx={{ p: 1 }}
            >
              <CloseIcon />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 2 }}>
            This project was developed at{' '}
            <Typography
              component="a"
              href="https://cpace.pitt.edu/"
              target="_blank"
              rel="noopener noreferrer"
              sx={{
                color: 'primary.main',
                textDecoration: 'none',
                fontWeight: 'bold',
                '&:hover': {
                  textDecoration: 'underline',
                },
              }}
            >
              CPACE (Computational Pathology & AI Center of Excellence)
            </Typography>
            .
          </Typography>
          
          <Typography variant="body1" sx={{ mb: 3 }}>
            This project was made possible by the contributions of the following individuals:
          </Typography>
          
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {[
              'Prof. Hooman H. Rashidi',
              'Prof. Liron Pantanowitz',
              'Dr. Quincy Gu',
              'Dr. Matthew Hanna',
              'Dr. Yanshan Wang',
              'Parth Sanghani',
              'Mohammadreza Moradi'
            ].map((contributor, index) => (
              <Box
                key={index}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 2,
                  p: 2,
                  borderRadius: 2,
                  bgcolor: 'action.hover',
                  border: '1px solid',
                  borderColor: 'divider',
                }}
              >
                <Box
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    bgcolor: 'primary.main',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'white',
                    fontWeight: 'bold',
                    fontSize: '1.2rem',
                  }}
                >
                  {contributor.split(' ').map(name => name.charAt(0)).join('').slice(0, 2)}
                </Box>
                <Typography variant="body1" sx={{ fontWeight: 500 }}>
                  {contributor}
                </Typography>
              </Box>
            ))}
          </Box>
          
          <Typography variant="body2" color="text.secondary" sx={{ mt: 3, textAlign: 'center' }}>
            Thank you for your valuable contributions to this project!
          </Typography>
          
          <Typography variant="body2" sx={{ mt: 2, textAlign: 'center' }}>
            <Typography
              component="a"
              href="https://cpace.pitt.edu/"
              target="_blank"
              rel="noopener noreferrer"
              sx={{
                color: 'primary.main',
                textDecoration: 'none',
                '&:hover': {
                  textDecoration: 'underline',
                },
              }}
            >
              cpace.pitt.edu
            </Typography>
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setContributorsOpen(false)} color="primary">
            Close
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default ChatArea;
