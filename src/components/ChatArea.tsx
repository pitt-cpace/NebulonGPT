import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist';
import { TextItem } from 'pdfjs-dist/types/src/display/api';
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
      handleSendMessage();
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
    // Override the default th renderer
    th: ({ node, children, ...props }: any) => (
      <TableCell 
        component="th"
        align="left"
        sx={styles.tableHeaderCell} 
        {...props}
      >
        {children}
      </TableCell>
    ),
    // Override the default td renderer
    td: ({ node, children, ...props }: any) => (
      <TableCell 
        align="left"
        sx={styles.tableCell} 
        {...props}
      >
        {children}
      </TableCell>
    ),
    // Improve code blocks
    code: ({ node, inline, className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || '');
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

  // Function to preprocess content to fix Llama3-3 table format
  const preprocessLlama3TableFormat = (content: string): string => {
    // Look for the specific Llama3-3 table pattern
    const llama3TablePattern = /\| [^|]+ \| [^|]+ \| [^|]+ \| \| --- \| --- \| --- \|/;
    
    if (llama3TablePattern.test(content)) {
      // This is likely a Llama3-3 table format
      // Fix the format by adding line breaks and removing extra pipes
      return content.replace(/\| ([^|]+) \| ([^|]+) \| ([^|]+) \| \|/g, '| $1 | $2 | $3 |\n|')
                   .replace(/\| --- \| --- \| --- \| \|/g, '| --- | --- | --- |\n|');
    }
    
    return content;
  };

  // Function to detect and render tables from markdown
  const renderMarkdownWithTables = (content: string) => {
    // Preprocess content to fix Llama3-3 table format
    const processedContent = preprocessLlama3TableFormat(content);
    
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
    
    // Reset regex states
    llama3TableRegex.lastIndex = 0;
    tabTableRegex.lastIndex = 0;
    markdownTableRegex.lastIndex = 0;
    mediaWikiTableRegex.lastIndex = 0;
    
    // If no tables detected, just render with ReactMarkdown
    if (!hasLlama3Table && !hasTabTable && !hasMarkdownTable && !hasMediaWikiTable) {
      return (
        <ReactMarkdown components={markdownComponents}>
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
            <ReactMarkdown key={`text-${key++}`} components={markdownComponents}>
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
          // Render Material-UI table
          result.push(
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
                        {header}
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
                          {cell}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
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
            <ReactMarkdown key={`text-${key++}`} components={markdownComponents}>
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
        
        // Render Material-UI table
        result.push(
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
                      {header}
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
                        {cell}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
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
            <ReactMarkdown key={`text-${key++}`} components={markdownComponents}>
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
        
        // Render Material-UI table
        result.push(
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
                      {header.replace(/^\*\*(.*)\*\*$/, '$1')} {/* Remove markdown bold formatting */}
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
                        {cell}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
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
            <ReactMarkdown key={`text-${key++}`} components={markdownComponents}>
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
            .map(cell => cell.trim().replace(/^\*\*(.*)\*\*$/, '$1')) // Remove markdown bold formatting
        );
        
        // Render Material-UI table
        result.push(
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
                      {header.replace(/^\*\*(.*)\*\*$/, '$1')} {/* Remove markdown bold formatting */}
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
                        {cell}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        );
        
        // Update lastIndex to after this table
        lastIndex = match.index + match[0].length;
      }
    }
    
    // Add any remaining content after the last table
    const afterLastTable = processedContent.substring(lastIndex);
    if (afterLastTable.trim()) {
      result.push(
        <ReactMarkdown key={`text-${key++}`} components={markdownComponents}>
          {afterLastTable}
        </ReactMarkdown>
      );
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

  const renderMessage = (message: MessageType) => {
    const isUser = message.role === 'user';
    
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

      {!chat ? (
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
                  color="primary"
                  onClick={handleSendMessage}
                  disabled={!message.trim() && attachments.length === 0}
                  sx={{ ml: 1 }}
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
