import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import { TextItem } from 'pdfjs-dist/types/src/display/api';
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
import { useStickyAutoScroll } from '../hooks/useStickyAutoScroll';
import { getTextDirectionStyles, analyzeMixedContent } from '../services/rtlDetection';
import { OllamaStatus } from '../services/ollamaStatus';
import * as styles from '../styles/components/ChatArea.styles';
import WaveformVisualization from './WaveformVisualization';

// Set the worker source path
GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';

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
  const [isDragOver, setIsDragOver] = useState(false);
  const [detectionSensitivity, setDetectionSensitivity] = useState<number>(100); // Default sensitivity display value (inverse of internal 0)
  const [showLoadingAnimation, setShowLoadingAnimation] = useState(false);
  const [currentTokens, setCurrentTokens] = useState(0);
  const [isContextExceeded, setIsContextExceeded] = useState(false);
  const [contextWarning, setContextWarning] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const finalTranscriptRef = useRef<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const textFieldRef = useRef<HTMLInputElement>(null);
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

  // Initialize the battle-tested auto-scroll system
  const { isPinned, unread, onNewContent, jumpToLatest } = useStickyAutoScroll({
    containerRef: messagesContainerRef,
    endRef: messagesEndRef,
    bottomThreshold: 64,
    smoothBehavior: "smooth",
    generating: loading,
  });

  const handleSendMessage = useCallback(async () => {
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
    
    // Allow sending if there's a message OR attachments
    if ((message.trim() || attachments.length > 0) && !loading) {
      let messageText = message.trim();
      
      // Check if there are PDF attachments and add a special prompt
      const hasPdfAttachments = attachments.some(attachment => attachment.type === 'pdf');
      if (hasPdfAttachments) {
        // Count PDF attachments with text and images
        const pdfWithTextCount = attachments.filter(att => att.type === 'pdf' && att.content).length;
        const pdfWithImagesCount = attachments.filter(att => att.type === 'pdf' && att.images && att.images.length > 0).length;
        
        // Create a descriptive prefix for the message
        let pdfDescription = "I've attached PDF file(s)";
        if (pdfWithTextCount > 0 && pdfWithImagesCount > 0) {
          pdfDescription += " containing both text and images";
        } else if (pdfWithTextCount > 0) {
          pdfDescription += " containing text";
        } else if (pdfWithImagesCount > 0) {
          pdfDescription += " containing images";
        }
        
        // Add the PDF description to the message if there's no existing message
        if (!messageText) {
          messageText = messageText + pdfDescription + ".";
        } else {
          messageText = messageText + pdfDescription + ".";
        }
      }
      
      // First scroll to bottom smoothly, then send message
      jumpToLatest('smooth');
      
      // Wait for smooth scroll animation to complete
      await new Promise(resolve => setTimeout(resolve, 700));
      
      // Send message with any attachments
      onSendMessage(messageText, attachments.length > 0 ? attachments : undefined);
      
      // Clear message and attachments
      setMessage('');
      setAttachments([]);
    }
  }, [message, attachments, loading, onSendMessage, jumpToLatest]);

  // Trigger auto-scroll when new assistant messages arrive (not user messages)
  useEffect(() => {
    if (!chat?.messages || chat.messages.length === 0) return;
    
    const lastMessage = chat.messages[chat.messages.length - 1];
    // Only trigger auto-scroll for assistant messages (LLM responses)
    if (lastMessage.role === 'assistant') {
      onNewContent();
    }
  }, [chat?.messages, onNewContent]);

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
      const currentPromptTokens = tokenCountingService.countTokens(message) + 10; // +10 for overhead
      
      let currentAttachmentsTokens = 0;
      for (const attachment of attachments) {
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
      const hasUserInput = message.trim().length > 0 || attachments.length > 0;
      
      // ALWAYS update or clear warning to show fresh token counts
      if (isExceeded) {
        // CRITICAL: ALWAYS show red warning when exceeded with updated values
        setContextWarning(
          `Context limit exceeded! ~${totalTokens}/${contextLength} tokens ` +
          `(Current: ${currentPromptTokens + currentAttachmentsTokens}, Chat History Included: ${historyTokensUsed}, Safety Buffer: 500). ` +
          `You must remove text/attachments or increase context length from settings before sending.`
        );
      } else if (hasUserInput && totalTokens > maxAllowedTokens - 500) {
        // Show orange warning when approaching limit with updated values
        // Check if history is limited
        const totalHistoryTokens = previousMessages.length > 0 
          ? tokenCountingService.countTotalTokens(previousMessages)
          : 0;
        const isHistoryLimited = totalHistoryTokens > historyTokensUsed;
        
        const historyNote = isHistoryLimited 
          ? ` Previous chat history is being reduced to fit within limits.`
          : ``;
        
        const safeArea = maxAllowedTokens - totalTokens;
        
        setContextWarning(
          `Approaching context limit: ${totalTokens}/${contextLength} tokens ` +
          `(Current: ${currentPromptTokens + currentAttachmentsTokens}, Chat History Included: ${historyTokensUsed}, Safety Buffer: 500). ` +
          `${safeArea} tokens remaining. Consider keeping your message shorter or increase context length from settings.${historyNote}`
        );
      } else {
        // Clear warning in all other cases (safe zone or no input)
        setContextWarning(null);
      }
       
    } catch (error) {
      console.error('Error calculating real-time tokens:', error);
    }
  }, [message, attachments, chat]);

  // Real-time token calculation - recalculate when message or attachments change
  useEffect(() => {
    if (chat) {
      calculateCurrentTokens();
    }
  }, [message, attachments, chat, calculateCurrentTokens]);

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
          handleSendMessage();
          
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

  // Focus input field when LLM response finishes
  useEffect(() => {
    // When loading changes from true to false (LLM response finished)
    if (!loading && textFieldRef.current) {
      // Add a small delay to ensure the UI has updated
      setTimeout(() => {
        textFieldRef.current?.focus();
      }, 100);
    }
  }, [loading]);

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




  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // Don't allow sending if context is exceeded
      if (!isContextExceeded) {
        handleSendMessage();
      }
    }
  };

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

  // Handle PDF file selection
  const handlePdfSelect = async (file: File) => {
    try {
      // Read the file as ArrayBuffer
      const arrayBuffer = await file.arrayBuffer();
      
      // Load the PDF document
      const loadingTask = getDocument(arrayBuffer);
      const pdf = await loadingTask.promise;
      
      // Extract text from all pages
      let fullText = '';
      const numPages = pdf.numPages;
      const extractedImages: string[] = [];
      
      for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i);
        
        // Extract text content
        const textContent = await page.getTextContent();
        const pageText = textContent.items
          .filter(item => 'str' in item)
          .map(item => (item as TextItem).str)
          .join(' ');
        
        fullText += `[Page ${i}]\n${pageText}\n\n`;
        
        // Extract images from the page
        try {
          // Get the operator list which contains all drawing operations
          const opList = await page.getOperatorList();
          
          // Get all image IDs from the operator list
          const imageIds = new Set<string>();
          for (let j = 0; j < opList.fnArray.length; j++) {
            const fnId = opList.fnArray[j];
            if (fnId === 83) { // 83 is the ID for the "paintImageXObject" operation
              const imageId = opList.argsArray[j][0];
              if (typeof imageId === 'string') {
                imageIds.add(imageId);
              }
            }
          }
          
          // Extract each image
          for (const imageId of Array.from(imageIds)) {
            try {
              // Get the image data
              const img = await page.objs.get(imageId);
              if (img && img.src) {
                // If the image has a src property, it's likely a data URL or URL
                extractedImages.push(img.src);
              } else if (img && img.data && img.width && img.height) {
                // Create a canvas to draw the image
                const canvas = document.createElement('canvas');
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext('2d');
                
                if (ctx) {
                  // Create an ImageData object
                  const imageData = ctx.createImageData(img.width, img.height);
                  
                  // Copy the image data to the ImageData object
                  for (let i = 0; i < img.data.length; i++) {
                    imageData.data[i] = img.data[i];
                  }
                  
                  // Put the ImageData on the canvas
                  ctx.putImageData(imageData, 0, 0);
                  
                  // Convert the canvas to a data URL
                  const dataUrl = canvas.toDataURL('image/png');
                  extractedImages.push(dataUrl);
                }
              }
            } catch (imgError) {
              console.warn(`Error extracting image ${imageId}:`, imgError);
            }
          }
        } catch (pageError) {
          console.warn(`Error extracting images from page ${i}:`, pageError);
        }
      }
      
      // Create a new file attachment
      const newAttachment: FileAttachment = {
        id: `pdf-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: file.name,
        type: 'pdf',
        content: fullText, // Store the extracted text
        images: extractedImages.length > 0 ? extractedImages : undefined, // Store extracted images
        size: file.size,
        timestamp: new Date().toISOString(),
      };
      
      // Add the attachment to the state
      setAttachments(prevAttachments => [...prevAttachments, newAttachment]);
    } catch (error) {
      console.error('Error processing PDF:', error);
      alert(`Error processing PDF: ${file.name}`);
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
      // Process PDF files
      else if (file.name.endsWith('.pdf')) {
        handlePdfSelect(file);
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
        alert(`Only .txt, .docx, and image files are supported. Skipping ${file.name}`);
      }
    });
    
    // Reset the file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Handle file selection for all supported file types
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      processFiles(files);
    }
  };

  // Drag and drop event handlers
  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragOver(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) {
      setIsDragOver(false);
    }
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    dragCounterRef.current = 0;

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
      e.dataTransfer.clearData();
    }
  }, [processFiles]);
  
  // Handle attachment removal
  const handleRemoveAttachment = (attachmentId: string) => {
    // Simply filter out the attachment with the given ID
    const updatedAttachments = attachments.filter(
      (attachment) => attachment.id !== attachmentId
    );
    
    setAttachments(updatedAttachments);
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
      
      // Extract headers
      const headerCells = table.querySelectorAll('th');
      headerCells.forEach(th => headers.push(th.textContent?.trim() || ''));
      
      // Extract rows
      const tableRows = table.querySelectorAll('tr');
      tableRows.forEach(tr => {
        const cells = tr.querySelectorAll('td');
        if (cells.length > 0) {
          const rowData: string[] = [];
          cells.forEach(td => rowData.push(td.textContent?.trim() || ''));
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

  // State for copied table tracking
  const [copiedTableId, setCopiedTableId] = useState<string | null>(null);

  // Helper function to extract table data as plain text
  const tableToPlainText = (headers: string[], rows: string[][]): string => {
    // Create a plain text representation of the table
    let result = headers.join('\t') + '\n';
    rows.forEach(row => {
      result += row.join('\t') + '\n';
    });
    return result;
  };

  // Helper function to copy table to clipboard
  const handleCopyTable = useCallback(async (tableId: string, headers: string[], rows: string[][]) => {
    try {
      const plainText = tableToPlainText(headers, rows);
      
      // Try Electron clipboard API first
      if (window.electronAPI && window.electronAPI.copyToClipboard) {
        const result = await window.electronAPI.copyToClipboard(plainText);
        if (result.success) {
          setCopiedTableId(tableId);
        } else {
          throw new Error(result.error || 'Electron clipboard copy failed');
        }
      }
      // Try modern clipboard API
      else if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(plainText);
        setCopiedTableId(tableId);
      }
      // Fallback method
      else {
        const textArea = document.createElement('textarea');
        textArea.value = plainText;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        try {
          const successful = document.execCommand('copy');
          if (successful) {
            setCopiedTableId(tableId);
          } else {
            throw new Error('Copy command failed');
          }
        } finally {
          document.body.removeChild(textArea);
        }
      }
      
      // Reset copied state after 2 seconds
      setTimeout(() => {
        setCopiedTableId(null);
      }, 2000);
    } catch (error) {
      console.error('❌ Failed to copy table:', error);
    }
  }, []);

  // Helper component to wrap tables with copy functionality
  const TableWithCopy: React.FC<{
    tableId: string;
    headers: string[];
    rows: string[][];
    children: React.ReactNode;
  }> = ({ tableId, headers, rows, children }) => {
    const [isHovered, setIsHovered] = useState(false);
    const isCopied = copiedTableId === tableId;
    
    return (
      <Box
        sx={{ position: 'relative', mb: 2 }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {children}
        {(isHovered || isCopied) && (
          <IconButton
            size="small"
            onClick={() => handleCopyTable(tableId, headers, rows)}
            sx={{
              position: 'absolute',
              top: 8,
              right: 8,
              backgroundColor: 'rgba(255, 255, 255, 0.9)',
              backdropFilter: 'blur(10px)',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
              opacity: isCopied ? 1 : 0.8,
              transition: 'all 0.2s',
              '&:hover': {
                backgroundColor: 'rgba(255, 255, 255, 1)',
                opacity: 1,
                transform: 'scale(1.05)',
              },
            }}
            title={isCopied ? 'Copied!' : 'Copy table'}
          >
            {isCopied ? (
              <CheckCircleIcon sx={{ fontSize: 16, color: 'success.main' }} />
            ) : (
              <ContentCopyIcon sx={{ fontSize: 16 }} />
            )}
          </IconButton>
        )}
      </Box>
    );
  };

  // Helper function to render LaTeX formulas
  const renderLatex = (text: string): React.ReactNode[] => {
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    
    // Match multiple LaTeX notations (ordered by priority):
    // 1. Double dollar: $$ block $$
    // 2. Single dollar: $ inline $
    // 3. Standard: \( \) for inline, \[ \] for block
    // 4. Parentheses with LaTeX commands: ( ) for inline, [ ] for block
    const latexPattern = /\$\$([\s\S]+?)\$\$|\$(.+?)\$|\\\((.+?)\\\)|\\\[([\s\S]+?)\\\]|\(([^()]*(?:\\frac|\\beta|\\alpha|\\gamma|\\delta|\\epsilon|\\theta|\\lambda|\\mu|\\sigma|\\mid|\\sum|\\int|\\sqrt|\\log|\\ln|\\exp|\\sin|\\cos|\\tan|\\lim|\\infty|\\pm|\\times|\\div|\\cdot|\\leq|\\geq|\\neq|\\approx|\\equiv|\\in|\\subset|\\cup|\\cap|\\dots|\\ldots|\\partial|\\nabla)[^()]*)\)|\[([^\[\]]*(?:\\frac|\\beta|\\alpha|\\gamma|\\delta|\\epsilon|\\theta|\\lambda|\\mu|\\sigma|\\mid|\\sum|\\int|\\sqrt|\\log|\\ln|\\exp|\\sin|\\cos|\\tan|\\lim|\\infty|\\pm|\\times|\\div|\\cdot|\\leq|\\geq|\\neq|\\approx|\\equiv|\\in|\\subset|\\cup|\\cap|\\dots|\\ldots|\\partial|\\nabla)[^\[\]]*)\]/g;
    let match;
    
    while ((match = latexPattern.exec(text)) !== null) {
      // Add text before formula
      if (match.index > lastIndex) {
        parts.push(text.substring(lastIndex, match.index));
      }
      
      // Determine formula and type
      const formula = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];
      const isBlock = !!(match[1] || match[4] || match[6]); // $$ $$, \[ \], or [ ] with LaTeX commands
      
      try {
        const html = katex.renderToString(formula, {
          displayMode: isBlock,
          throwOnError: false,
          output: 'html'
        });
        
        parts.push(
          <span
            key={`latex-${match.index}`}
            dangerouslySetInnerHTML={{ __html: html }}
            style={{ 
              display: isBlock ? 'block' : 'inline',
              margin: isBlock ? '8px 0' : '0'
            }}
          />
        );
      } catch (error) {
        // If LaTeX parsing fails, show original text
        parts.push(match[0]);
      }
      
      lastIndex = match.index + match[0].length;
    }
    
    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }
    
    return parts.length > 0 ? parts : [text];
  };

  // Helper function to render markdown within table cells with LaTeX support
  const renderCellContent = (content: any): React.ReactNode => {
    // If content is already a React element, return it
    if (React.isValidElement(content)) {
      return content;
    }
    
    // Convert to string if needed
    let textContent = String(content);
    
    // Check for LaTeX patterns (all notations)
    const hasLatex = /\$\$([\s\S]+?)\$\$|\$(.+?)\$|\\\((.+?)\\\)|\\\[([\s\S]+?)\\\]|\((?:[^()]*(?:\\frac|\\beta|\\alpha|\\gamma|\\delta|\\epsilon|\\theta|\\lambda|\\mu|\\sigma|\\mid|\\sum|\\int|\\sqrt|\\log|\\ln|\\exp|\\sin|\\cos|\\tan|\\lim|\\infty|\\pm|\\times|\\div|\\cdot|\\leq|\\geq|\\neq|\\approx|\\equiv|\\in|\\subset|\\cup|\\cap|\\dots|\\ldots|\\partial|\\nabla)[^()]*)\)|\[(?:[^\[\]]*(?:\\frac|\\beta|\\alpha|\\gamma|\\delta|\\epsilon|\\theta|\\lambda|\\mu|\\sigma|\\mid|\\sum|\\int|\\sqrt|\\log|\\ln|\\exp|\\sin|\\cos|\\tan|\\lim|\\infty|\\pm|\\times|\\div|\\cdot|\\leq|\\geq|\\neq|\\approx|\\equiv|\\in|\\subset|\\cup|\\cap|\\dots|\\ldots|\\partial|\\nabla)[^\[\]]*)\]/.test(textContent);
    
    if (hasLatex) {
      return <>{renderLatex(textContent)}</>;
    }
    
    // Convert <br> tags to newlines for markdown processing
    const processedText = textContent.replace(/<br\s*\/?>/gi, '\n');
    
    // Render as markdown with custom components
    return (
      <ReactMarkdown
        components={{
          p: ({ children }) => <span>{children}</span>,
          strong: ({ children }) => <strong>{children}</strong>,
          em: ({ children }) => <em>{children}</em>,
          code: ({ children }) => {
            const text = String(children);
            // Check if the inline code contains LaTeX formulas
            if (/\\frac|\\int|\\sum|\\sqrt|\\pi|\\theta|\\alpha|\\beta|\^|_/.test(text)) {
              // Remove wrapping backticks if present and render as LaTeX
              try {
                const html = katex.renderToString(text, {
                  displayMode: false,
                  throwOnError: false,
                  output: 'html'
                });
                return <span dangerouslySetInnerHTML={{ __html: html }} />;
              } catch (error) {
                // Fall back to regular code
              }
            }
            return (
              <code style={{ 
                backgroundColor: 'rgba(0, 0, 0, 0.08)',
                padding: '2px 4px',
                borderRadius: '3px',
                fontSize: '0.9em'
              }}>
                {children}
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
        {processedText}
      </ReactMarkdown>
    );
  };

  // Custom renderers for ReactMarkdown
  const markdownComponents = {
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
    tr: ({ node, children, isHeader, ...props }: any) => {
      const isOdd = props.index % 2 === 1;
      return (
        <TableRow 
          sx={isOdd ? styles.tableRowOdd : styles.tableRowEven} 
          {...props}
        >
          {children}
        </TableRow>
      );
    },
    // Override the default th renderer with markdown support
    th: ({ node, children, ...props }: any) => (
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
    td: ({ node, children, ...props }: any) => (
      <TableCell 
        align="left"
        sx={styles.tableCell} 
        {...props}
      >
        {renderCellContent(children)}
      </TableCell>
    ),
    // Improve code blocks - extract and render formulas from code blocks
    code: ({ node, inline, className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || '');
      const content = String(children).replace(/\n$/, '');
      
      // For non-inline code blocks, check if they contain LaTeX formulas
      if (!inline) {
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
                  <Box
                    sx={{ my: 2, p: 2, bgcolor: 'action.hover', borderRadius: 1 }}
                    dangerouslySetInnerHTML={{ __html: html }}
                  />
                );
              } catch (error) {
                // Fall through to normal code block rendering
              }
            }
          }
        }
      }
      
      return !inline ? (
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

  // Function to preprocess content to fix Llama3-3 table format and single-line tables
  const preprocessLlama3TableFormat = (content: string): string => {
    // Look for the specific Llama3-3 table pattern
    const llama3TablePattern = /\| [^|]+ \| [^|]+ \| [^|]+ \| \| --- \| --- \| --- \|/;
    
    if (llama3TablePattern.test(content)) {
      // This is likely a Llama3-3 table format
      // Fix the format by adding line breaks and removing extra pipes
      return content.replace(/\| ([^|]+) \| ([^|]+) \| ([^|]+) \| \|/g, '| $1 | $2 | $3 |\n|')
                   .replace(/\| --- \| --- \| --- \| \|/g, '| --- | --- | --- |\n|');
    }
    
    // Fix single-line tables (all on one line)
    // Pattern: | header | header | ... | |----|----| ... | | data | data | ... |
    const singleLineTablePattern = /\|[^|\n]+\|[^|\n]+\|[^|\n]*\|\s*\|[-\s]+\|[-\s]+\|[-\s]*\|\s*\|[^|\n]+\|[^|\n]+\|/g;
    
    if (singleLineTablePattern.test(content)) {
      
      // Split table by separator pattern
      let processed = content.replace(
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
    
    return content;
  };

  // Function to detect and render tables from markdown
  const renderMarkdownWithTables = (content: string) => {
    // First, check if this is a full LaTeX document in plain text (not in code block)
    const hasDocumentCommands = /\\documentclass|\\begin\{document\}|\\usepackage/.test(content);
    
    if (hasDocumentCommands) {
      // Extract and render formulas from the LaTeX document
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
      
      // Extract $ $ inline formulas
      const dollarMatches = content.match(/\$([^\$]+)\$/g);
      if (dollarMatches) {
        dollarMatches.forEach(match => {
          const formula = match.replace(/^\$/, '').replace(/\$$/, '').trim();
          if (formula) formulas.push({ formula, isDisplay: false });
        });
      }
      
      // Extract \begin{align*} environments and split into individual equations
      const alignMatches = content.match(/\\begin\{align\*\}([\s\S]*?)\\end\{align\*\}/g);
      if (alignMatches) {
        alignMatches.forEach(match => {
          const innerContent = match.replace(/\\begin\{align\*\}/, '').replace(/\\end\{align\*\}/, '').trim();
          // Split by \\ to get individual equations
          const equations = innerContent.split('\\\\').filter(eq => eq.trim());
          equations.forEach(equation => {
            // Remove alignment markers (&) and clean up
            const cleanedEquation = equation.replace(/&/g, '').trim();
            if (cleanedEquation) {
              formulas.push({ formula: cleanedEquation, isDisplay: true });
            }
          });
        });
      }
      
      // If we found formulas, render them
      if (formulas.length > 0) {
        return (
          <Box>
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
                      my: item.isDisplay ? 2 : 0.5,
                      p: item.isDisplay ? 2 : 0.5,
                      bgcolor: item.isDisplay ? 'action.hover' : 'transparent',
                      borderRadius: 1
                    }}
                    dangerouslySetInnerHTML={{ __html: html }}
                  />
                );
              } catch (error) {
                return null; // Skip formulas that fail to render
              }
            })}
          </Box>
        );
      }
    }
    
    // Convert HTML sub/sup tags to LaTeX notation wrapped in $ delimiters
    let contentWithLatex = content
      .replace(/<sub>([^<]+)<\/sub>/g, '$_{$1}$')
      .replace(/<sup>([^<]+)<\/sup>/g, '$^{$1}$');
    
    // Preprocess content to fix Llama3-3 table format
    let processedContent = preprocessLlama3TableFormat(contentWithLatex);
    
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
    const markdownTableRegex = /\|[^\n]*\|\n\|[\s-:]*\|[\s-:]*(\|[\s-:]*)*\n(\|[^\n]*\|\n)+/g;
    
    // Detect if content contains a MediaWiki table
    const mediaWikiTableRegex = /\{\|[^\n]*\n[\s\S]*?\|\}/g;
    
    // Check if content contains any table patterns
    const hasLlama3Table = llama3TableRegex.test(processedContent);
    const hasTabTable = tabTableRegex.test(processedContent);
    const hasMarkdownTable = markdownTableRegex.test(processedContent);
    const hasMediaWikiTable = mediaWikiTableRegex.test(processedContent);
    const hasAnySpecialTable = htmlTableData.length > 0 || csvTableData.length > 0 || jsonTableData.length > 0 || textTableData.length > 0;
    
    // Reset regex states
    llama3TableRegex.lastIndex = 0;
    tabTableRegex.lastIndex = 0;
    markdownTableRegex.lastIndex = 0;
    mediaWikiTableRegex.lastIndex = 0;
    
    // Custom markdown components - just use standard components
    const customMarkdownComponents = markdownComponents;
    
    // If no tables detected, just render with ReactMarkdown with math plugins
    if (!hasLlama3Table && !hasTabTable && !hasMarkdownTable && !hasMediaWikiTable && !hasAnySpecialTable) {
      return (
        <ReactMarkdown 
          remarkPlugins={[remarkMath as any]}
          rehypePlugins={[rehypeRaw as any, rehypeKatex as any]}
          components={customMarkdownComponents}
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
            <ReactMarkdown 
              key={`text-${key++}`}
              remarkPlugins={[remarkMath as any]}
              rehypePlugins={[rehypeRaw as any, rehypeKatex as any]}
              components={customMarkdownComponents}
            >
              {beforeTable}
            </ReactMarkdown>
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
            <TableWithCopy
              key={`table-${key++}`}
              tableId={tableId}
              headers={tableData.headers}
              rows={tableData.rows}
            >
              <TableContainer 
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
            </TableWithCopy>
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
            <ReactMarkdown 
              key={`text-${key++}`}
              remarkPlugins={[remarkMath as any]}
              rehypePlugins={[rehypeRaw as any, rehypeKatex as any]}
              components={customMarkdownComponents}
            >
              {beforeTable}
            </ReactMarkdown>
          );
        }
        
        // Process the table
        const tableMatch = match[0];
        
        // Extract headers and rows
        const lines = tableMatch.trim().split('\n');
        const headerLine = lines[0];
        
        // Extract headers
        const headers = headerLine
          .split('|')
          .filter(cell => cell.trim() !== '')
          .map(cell => cell.trim());
        
        // Skip the separator line (line with |---|---|)
        const dataRows = lines.slice(2);
        
        // Extract rows
        const rows = dataRows.map(row => 
          row
            .split('|')
            .filter(cell => cell.trim() !== '')
            .map(cell => cell.trim())
        );
        
        // Render Material-UI table with markdown support in cells and copy button
        const tableId = `llama3-table-${key}`;
        result.push(
          <TableWithCopy
            key={`table-${key++}`}
            tableId={tableId}
            headers={headers}
            rows={rows}
          >
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
          </TableWithCopy>
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
            <ReactMarkdown 
              key={`text-${key++}`}
              remarkPlugins={[remarkMath as any]}
              rehypePlugins={[rehypeRaw as any, rehypeKatex as any]}
              components={customMarkdownComponents}
            >
              {beforeTable}
            </ReactMarkdown>
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
          <TableWithCopy
            key={`table-${key++}`}
            tableId={tableId}
            headers={headers}
            rows={rows}
          >
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
          </TableWithCopy>
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
        if (match.index < lastIndex) continue;
        
        // Add text before the table
        const beforeTable = processedContent.substring(lastIndex, match.index);
        if (beforeTable.trim()) {
          result.push(
            <ReactMarkdown 
              key={`text-${key++}`}
              remarkPlugins={[remarkMath as any]}
              rehypePlugins={[rehypeRaw as any, rehypeKatex as any]}
              components={customMarkdownComponents}
            >
              {beforeTable}
            </ReactMarkdown>
          );
        }
        
        // Process the table
        const tableMatch = match[0];
        
        // Extract headers and rows
        const lines = tableMatch.trim().split('\n');
        const headerLine = lines[0];
        
        // Extract headers
        const headers = headerLine
          .split('|')
          .filter(cell => cell.trim() !== '')
          .map(cell => cell.trim());
        
        // Skip the separator line (line with |---|---|)
        const dataRows = lines.slice(2);
        
        // Extract rows
        const rows = dataRows.map(row => 
          row
            .split('|')
            .filter(cell => cell.trim() !== '')
            .map(cell => cell.trim())
        );
        
        // Render Material-UI table with markdown support in cells and copy button
        const tableId = `markdown-table-${key}`;
        result.push(
          <TableWithCopy
            key={`table-${key++}`}
            tableId={tableId}
            headers={headers}
            rows={rows}
          >
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
          </TableWithCopy>
        );
        
        // Update lastIndex to after this table
        lastIndex = match.index + match[0].length;
      }
    }
    
    // Add any remaining content after the last table
    const afterLastTable = processedContent.substring(lastIndex);
    if (afterLastTable.trim()) {
      // Check for special table placeholders and render them
      let finalContent = afterLastTable;
      const specialTableMatches: Array<{ type: string, index: number, data: any }> = [];
      
      // Find all special table placeholders
      [...htmlTableData, ...csvTableData, ...jsonTableData, ...textTableData].forEach((tableInfo) => {
        const match = finalContent.match(/__(?:HTML|CSV|JSON|TEXT)_TABLE_\d+__/);
        if (match) {
          specialTableMatches.push({
            type: match[0],
            index: finalContent.indexOf(match[0]),
            data: tableInfo.data
          });
        }
      });
      
      // If there are special tables, process them
      if (specialTableMatches.length > 0) {
        let currentIndex = 0;
        
        specialTableMatches.forEach((tableMatch, idx) => {
          // Add text before this table
          const beforeTable = finalContent.substring(currentIndex, tableMatch.index);
          if (beforeTable.trim()) {
            result.push(
              <ReactMarkdown 
                key={`text-${key++}`}
                remarkPlugins={[remarkMath as any]}
                rehypePlugins={[rehypeRaw as any, rehypeKatex as any]}
                components={customMarkdownComponents}
              >
                {beforeTable}
              </ReactMarkdown>
            );
          }
          
          // Render the special table with markdown support in cells and copy button
          if (tableMatch.data) {
            const tableId = `special-table-${tableMatch.type}-${key}`;
            result.push(
              <TableWithCopy
                key={`table-${key++}`}
                tableId={tableId}
                headers={tableMatch.data.headers}
                rows={tableMatch.data.rows}
              >
                <TableContainer 
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
              </TableWithCopy>
            );
          }
          
          // Move past this table
          currentIndex = tableMatch.index + tableMatch.type.length;
        });
        
        // Add any remaining content
        const remaining = finalContent.substring(currentIndex);
        if (remaining.trim() && !remaining.match(/__(?:HTML|CSV|JSON|TEXT)_TABLE_\d+__/)) {
          result.push(
            <ReactMarkdown 
              key={`text-${key++}`}
              remarkPlugins={[remarkMath as any]}
              rehypePlugins={[rehypeRaw as any, rehypeKatex as any]}
              components={customMarkdownComponents}
            >
              {remaining}
            </ReactMarkdown>
          );
        }
      } else {
        result.push(
          <ReactMarkdown 
            key={`text-${key++}`}
            remarkPlugins={[remarkMath as any]}
            rehypePlugins={[rehypeRaw as any, rehypeKatex as any]}
            components={customMarkdownComponents}
          >
            {afterLastTable}
          </ReactMarkdown>
        );
      }
    }
    
    return <>{result}</>;
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
          setCopiedMessageId(messageId);
          console.log('✅ Message copied successfully using Electron clipboard API');
        } else {
          throw new Error(result.error || 'Electron clipboard copy failed');
        }
      }
      // Try modern clipboard API for browsers
      else if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(content);
        setCopiedMessageId(messageId);
        console.log('✅ Message copied successfully using browser clipboard API');
      }
      // Fallback for older browsers
      else {
        const textArea = document.createElement('textarea');
        textArea.value = content;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        
        try {
          const successful = document.execCommand('copy');
          if (successful) {
            setCopiedMessageId(messageId);
            console.log('✅ Message copied successfully using fallback method');
          } else {
            throw new Error('Copy command failed');
          }
        } finally {
          document.body.removeChild(textArea);
        }
      }
      
      // Reset copied state after 2 seconds
      setTimeout(() => {
        setCopiedMessageId(null);
      }, 2000);
    } catch (error) {
      console.error('❌ Failed to copy message:', error);
      // Silently fail - just log the error, don't show alert
    }
  }, []);

  const renderMessage = (message: MessageType) => {
    const isUser = message.role === 'user';
    const isCopied = copiedMessageId === message.id;
    
    // Auto-detect RTL/LTR for both user and assistant messages
    const textDirectionStyles = getTextDirectionStyles(message.content);
    const mixedContentAnalysis = analyzeMixedContent(message.content);
    
    
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
                message.content
              ) : (
                <>
                  {/* Try direct Llama3-3 table detection first */}
                  {detectAndRenderLlama3Table(message.content) || renderMarkdownWithTables(message.content)}
                  {loading && message.id === chat?.messages[chat.messages.length - 1]?.id && (
                    <span className="streaming-cursor"></span>
                  )}
                </>
              )}
            </Typography>

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
        
        {/* Copy button below the message */}
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'flex-start',
            mt: 0.5,
            ml: 1,
          }}
        >
          <IconButton
            size="small"
            onClick={() => handleCopyMessage(message.id, message.content)}
            sx={{
              opacity: 0.6,
              transition: 'opacity 0.2s, background-color 0.2s',
              '&:hover': {
                opacity: 1,
                backgroundColor: 'rgba(0, 0, 0, 0.05)',
              },
            }}
            title={isCopied ? 'Copied!' : 'Copy message'}
          >
            {isCopied ? (
              <CheckCircleIcon sx={{ fontSize: 18, color: 'success.main' }} />
            ) : (
              <ContentCopyIcon sx={{ fontSize: 18 }} />
            )}
          </IconButton>
        </Box>
      </Box>
    );
  };

  return (
    <Box
      component="main"
      sx={{
        ...styles.container(sidebarOpen),
        ...(isDragOver && {
          backgroundColor: 'rgba(25, 118, 210, 0.08)',
          border: '2px dashed rgba(25, 118, 210, 0.5)',
          borderRadius: 2,
        })
      }}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
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
            
            
            {chat.messages.map(renderMessage)}
            
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

          {/* Jump to latest button when not pinned and there are messages */}
          {!isPinned && chat && chat.messages && chat.messages.length > 0 && (
            <IconButton
              onClick={() => jumpToLatest('smooth')}
              sx={{
                position: 'absolute',
                bottom: '80px',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 1000,
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                color: 'white',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
                width: '48px',
                height: '48px',
                '&:hover': {
                  backgroundColor: 'rgba(0, 0, 0, 0.9)',
                  transform: 'translateX(-50%) scale(1.05)',
                },
                '&:active': {
                  transform: 'translateX(-50%) scale(0.95)',
                },
                transition: 'all 0.2s ease-in-out',
              }}
            >
              <ArrowDownIcon />
            </IconButton>
          )}

          <Box
            component={Paper}
            elevation={0}
            sx={styles.inputContainer}
          >
            <Box sx={styles.inputBox}>
              <Box sx={{ position: 'relative' }}>
                <IconButton 
                  size="small" 
                  sx={isListening ? styles.micButtonActive : (speechError ? styles.micButtonError : styles.micButton)}
                  onClick={toggleListening}
                  disabled={isProcessingMic || !voskRecognition || (loading && !ttsService.getSettings().fullVoiceMode)}
                  title={speechError || (isListening ? 'Stop dictation' : 'Start dictation')}
                >
                  <MicIcon />
                </IconButton>
                {speechError && (
                  <Typography 
                    variant="caption" 
                    color="warning.main" 
                    sx={styles.micErrorText}
                  >
                    {speechError}
                  </Typography>
                )}
              </Box>
              {/* Hidden unified file input */}
              <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                accept=".txt,.docx,.pdf,image/*"
                multiple
                onChange={handleFileSelect}
              />
              
              {/* Add attachment button - direct file browser */}
              <Box sx={{ position: 'relative' }}>
                <IconButton
                  size="small"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={loading}
                  title="Add attachment"
                  sx={styles.fileUploadButton}
                >
                  <AddIcon fontSize="small" />
                </IconButton>
              </Box>
              
              <Box sx={{ width: '100%' }}>
                {/* Context warning display */}
                {contextWarning && (
                  <Box 
                    sx={{ 
                      display: 'flex', 
                      alignItems: 'center',
                      gap: 1,
                      p: 1, 
                      mb: 1,
                      borderRadius: 1,
                      bgcolor: isContextExceeded ? 'rgba(244, 67, 54, 0.1)' : 'rgba(255, 152, 0, 0.1)',
                      border: `1px solid ${isContextExceeded ? 'rgba(244, 67, 54, 0.3)' : 'rgba(255, 152, 0, 0.3)'}`,
                      width: '100%'
                    }}
                  >
                    {isContextExceeded ? (
                      <ErrorIcon sx={{ fontSize: 16, color: 'error.main' }} />
                    ) : (
                      <WarningIcon sx={{ fontSize: 16, color: 'warning.main' }} />
                    )}
                    <Typography 
                      variant="caption" 
                      sx={{ 
                        color: isContextExceeded ? 'error.main' : 'warning.main',
                        fontWeight: 'bold'
                      }}
                    >
                      {contextWarning}
                    </Typography>
                  </Box>
                )}

                {/* File attachment chips displayed above the text field */}
                {attachments.length > 0 && (
                  <Box 
                    sx={{ 
                      display: 'flex', 
                      flexWrap: 'wrap', 
                      gap: 0.5, 
                      p: 1, 
                      mb: 1,
                      borderRadius: 1,
                      bgcolor: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      width: '100%'
                    }}
                  >
                    {attachments.map((attachment) => (
                      <Box 
                        key={attachment.id} 
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          bgcolor: 'action.hover',
                          borderRadius: 1,
                          p: 0.5,
                          maxWidth: '100%',
                          overflow: 'hidden'
                        }}
                      >
                        {attachment.type === 'image' ? (
                          <ImageIcon sx={{ fontSize: 16, mr: 0.5, color: 'text.secondary' }} />
                        ) : (
                          <DescriptionIcon sx={{ fontSize: 16, mr: 0.5, color: 'text.secondary' }} />
                        )}
                        <Typography 
                          variant="caption" 
                          sx={{ 
                            maxWidth: '150px', 
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap'
                          }}
                        >
                          {attachment.name}
                        </Typography>
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveAttachment(attachment.id);
                          }}
                          sx={{ 
                            ml: 0.5, 
                            p: 0.25,
                            '&:hover': { bgcolor: 'action.selected' }
                          }}
                        >
                          <CloseIcon sx={{ fontSize: 14 }} />
                        </IconButton>
                      </Box>
                    ))}
                  </Box>
                )}
                
                <TextField
                  fullWidth
                  placeholder="How can I help you today?"
                  multiline
                  maxRows={4}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  disabled={loading}
                  inputRef={textFieldRef}
                  InputProps={{
                    sx: {
                      ...styles.textField,
                      // Apply RTL detection to input field
                      ...(message && (() => {
                        const inputDirectionStyles = getTextDirectionStyles(message);
                        return {
                          direction: inputDirectionStyles.direction,
                          textAlign: inputDirectionStyles.textAlign,
                          unicodeBidi: inputDirectionStyles.unicodeBidi,
                        };
                      })()),
                    },
                    endAdornment: isListening && interimTranscript ? (
                      <Box sx={styles.interimTranscript}>
                        {interimTranscript}
                      </Box>
                    ) : null,
                  }}
                  variant="outlined"
                />
              </Box>
              {loading ? (
                <IconButton
                  color="error"
                  onClick={onStopResponse}
                  sx={{ ml: 1 }}
                >
                  <StopIcon />
                </IconButton>
              ) : (
                <IconButton
                  color={isContextExceeded ? "error" : "primary"}
                  onClick={handleSendMessage}
                  disabled={(!message.trim() && attachments.length === 0) || isContextExceeded}
                  title={isContextExceeded ? "Cannot send: Context limit exceeded" : "Send message"}
                  sx={{ 
                    ml: 1,
                    ...(isContextExceeded && {
                      backgroundColor: 'rgba(244, 67, 54, 0.1)',
                      '&:hover': {
                        backgroundColor: 'rgba(244, 67, 54, 0.2)',
                      },
                      '&.Mui-disabled': {
                        color: 'error.main',
                        opacity: 0.6,
                      },
                    })
                  }}
                >
                  <SendIcon />
                </IconButton>
              )}
            </Box>
          </Box>
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
