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
} from '@mui/icons-material';
import ReactMarkdown from 'react-markdown';
import { ModelType, ChatType, MessageType, FileAttachment } from '../types';
import { getSuggestedPrompts } from '../services/api';
import { VoskRecognitionService } from '../services/vosk';
import { ttsService } from '../services/ttsService';
import * as styles from '../styles/components/ChatArea.styles';

// Set the worker source path
GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';

interface ChatAreaProps {
  chat: ChatType | null;
  model: ModelType | null;
  models: ModelType[];
  loading: boolean;
  onSendMessage: (content: string, attachments?: FileAttachment[]) => void;
  onStopResponse: () => void;
  onToggleSidebar: () => void;
  onSelectModel: (model: ModelType) => void;
  sidebarOpen: boolean;
  voskRecognition?: VoskRecognitionService | null;
  micStoppedTrigger?: number;
  onMicStart?: React.MutableRefObject<(() => Promise<void>) | null>;
  onMicStop?: React.MutableRefObject<(() => Promise<void>) | null>;
  onListeningStateChange?: (listening: boolean) => void;
  onClearChatInput?: React.MutableRefObject<(() => void) | null>;
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
  const [userHasScrolledUp, setUserHasScrolledUp] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const finalTranscriptRef = useRef<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef(0);
  const suggestedPrompts = getSuggestedPrompts();

  const handleSendMessage = useCallback(() => {
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
          messageText = pdfDescription + ".";
        } else {
          messageText = messageText + pdfDescription + ".";
        }
      }
      
      // Reset scroll state when sending a new message to ensure auto-scroll to the new message
      setUserHasScrolledUp(false);
      
      // Send message with any attachments
      onSendMessage(messageText, attachments.length > 0 ? attachments : undefined);
      
      // Clear message and attachments
      setMessage('');
      setAttachments([]);
    }
  }, [message, attachments, loading, onSendMessage]);

  // Load default model ID from localStorage on component mount
  useEffect(() => {
    try {
      const savedDefaultModelId = localStorage.getItem('defaultModelId');
      setDefaultModelId(savedDefaultModelId);
    } catch (error) {
      console.error('Failed to load default model ID from localStorage:', error);
    }
  }, []);

  // Scroll to bottom when messages change, but only if user hasn't scrolled up
  useEffect(() => {
    console.log('🔄 Auto-scroll effect triggered:', {
      hasMessagesEndRef: !!messagesEndRef.current,
      userHasScrolledUp,
      messagesCount: chat?.messages?.length || 0
    });
    
    if (messagesEndRef.current && !userHasScrolledUp) {
      console.log('✅ Auto-scrolling to bottom');
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    } else {
      console.log('❌ Auto-scroll blocked:', {
        noRef: !messagesEndRef.current,
        userScrolledUp: userHasScrolledUp
      });
    }
  }, [chat?.messages, userHasScrolledUp]);

  // Handle scroll events to detect when user scrolls up
  useEffect(() => {
    // Only set up scroll listener when we have a chat (messages container is rendered)
    if (!chat) {
      console.log('⏳ No chat yet, waiting for messages container...');
      return;
    }

    const messagesContainer = messagesContainerRef.current;
    if (!messagesContainer) {
      console.log('❌ Messages container ref not found, retrying...');
      return;
    }

    console.log('✅ Setting up scroll listener on messages container:', messagesContainer);
    console.log('✅ Container scroll properties:', {
      scrollHeight: messagesContainer.scrollHeight,
      clientHeight: messagesContainer.clientHeight,
      scrollTop: messagesContainer.scrollTop,
      overflowY: getComputedStyle(messagesContainer).overflowY
    });

    const handleScroll = (event: Event) => {
      console.log('🔥 SCROLL EVENT TRIGGERED!', event);
      
      const { scrollTop, scrollHeight, clientHeight } = messagesContainer;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 10; // 10px threshold
      
      console.log('📜 Scroll event details:', {
        scrollTop,
        scrollHeight,
        clientHeight,
        difference: scrollHeight - scrollTop - clientHeight,
        isAtBottom,
        currentUserHasScrolledUp: userHasScrolledUp
      });
      
      // If user is at the bottom, reset the scroll state
      if (isAtBottom) {
        if (userHasScrolledUp) {
          console.log('🔄 User scrolled back to bottom - resuming auto-scroll');
          setUserHasScrolledUp(false);
        }
      } else {
        // If user is not at the bottom, they have scrolled up
        if (!userHasScrolledUp) {
          console.log('⬆️ User scrolled up - pausing auto-scroll');
          setUserHasScrolledUp(true);
        }
      }
    };

    // Add both scroll and wheel events for better detection
    messagesContainer.addEventListener('scroll', handleScroll, { passive: true });
    messagesContainer.addEventListener('wheel', handleScroll, { passive: true });
    
    // Test if the element is actually scrollable
    console.log('🧪 Testing scroll capability:', {
      canScroll: messagesContainer.scrollHeight > messagesContainer.clientHeight,
      hasScrollbar: messagesContainer.scrollHeight > messagesContainer.clientHeight
    });

    return () => {
      console.log('🧹 Cleaning up scroll listeners');
      messagesContainer.removeEventListener('scroll', handleScroll);
      messagesContainer.removeEventListener('wheel', handleScroll);
    };
  }, [chat, userHasScrolledUp]); // Add chat as dependency so it runs when chat is available

  // Initialize Vosk speech recognition event handlers
  useEffect(() => {
    if (!voskRecognition) {
      console.warn('Vosk speech recognition is not available.');
      setSpeechError('Speech recognition not available');
      return;
    }

    // Set up event handlers for the VoskRecognitionService instance
    voskRecognition.onResult((result: { text?: string; partial?: string }) => {
      if (result.partial) {
        // Update interim transcript for real-time display
        setInterimTranscript(result.partial);
        
        // In full voice mode: if user starts speaking while LLM is generating, stop the LLM and TTS
        const ttsSettings = ttsService.getSettings();
        const isFullVoiceMode = ttsSettings.fullVoiceMode;
        
        if (isFullVoiceMode && loading && result.partial.trim().length > 0) {
          console.log('🛑 User started speaking while LLM is generating - stopping LLM response and clearing TTS');
          onStopResponse(); // This will stop LLM and also clear TTS (handled in App.tsx)
          
          // Also directly clear TTS to ensure immediate stopping
          ttsService.stop();
          ttsService.clear();
        }
      }
      
      if (result.text) {
        // Final transcript received
        console.log('🟢 Vosk Final:', result.text);
        finalTranscriptRef.current += result.text + ' ';
        setMessage(finalTranscriptRef.current);
        setInterimTranscript(''); // Clear interim transcript
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
  }, [voskRecognition, message, handleSendMessage]);

  // Handle mic stopped from settings - listen for the trigger
  useEffect(() => {
    if (micStoppedTrigger && micStoppedTrigger > 0 && voskRecognition && !voskRecognition.isCurrentlyRecording() && isListening) {
      console.log('🔄 Mic stopped from settings, updating ChatArea UI state...');
      setIsListening(false);
      setInterimTranscript('');
    }
  }, [micStoppedTrigger, voskRecognition, isListening]);

  // Dedicated function to start mic listening
  const startMicListening = useCallback(async () => {
    console.log('🎙️ STARTING speech recognition...');
    
    if (!voskRecognition) {
      setSpeechError('Speech recognition not available');
      return;
    }

    if (isListening) {
      console.log('⚠️ Already listening, skipping start');
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
        console.log('🎤 No model loaded, auto-selecting default model for microphone usage...');
        
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
        
        console.log(`🎤 Auto-loading default model for microphone: ${defaultModel}`);
        await voskRecognition.selectModel(defaultModel);
        console.log(`✅ Default model loaded successfully: ${defaultModel}`);
      } else {
        console.log(`✅ Using currently running model for speech recognition: ${currentModel}`);
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
      console.log('  - finalTranscriptRef reset to:', finalTranscriptRef.current);
      
      // Start recognition
      console.log('  - Calling voskRecognition.start()...');
      await voskRecognition.start();
      console.log('✅ voskRecognition.start() completed successfully');
      
      setIsListening(true);
      console.log('✅ UI state updated - isListening set to true');
      console.log('✅ Vosk speech recognition started successfully');
    } catch (error) {
      console.error('❌ Error starting Vosk speech recognition:', error);
      setSpeechError('Failed to start Vosk speech recognition');
      console.log('❌ UI state - speechError set to:', 'Failed to start Vosk speech recognition');
      throw error;
    }
  }, [isListening, message, voskRecognition]);

  // Dedicated function to stop mic listening
  const stopMicListening = useCallback(async () => {
    console.log('🛑 STOPPING speech recognition...');
    
    if (voskRecognition) {
      if (!isListening) {
        console.log('⚠️ Not currently listening, skipping stop');
        return;
      }
      
      try {
        await voskRecognition.stop();
        console.log('✅ voskRecognition.stop() called successfully');
      } catch (error) {
        console.error('❌ Error stopping Vosk speech recognition:', error);
        // Don't throw here, we still want to update UI state
      }
    }
    
    // FORCEFULLY STOP AND DESTROY ALL TTS THREADS AND PROCESSES
    const ttsSettings = ttsService.getSettings();
    console.log('💥 FORCEFULLY STOPPING AND DESTROYING ALL TTS THREADS due to mic stop...');
    
    // Stop LLM generation if it's currently running
    if (loading) {
      console.log('🛑 Stopping LLM generation due to manual mic stop');
      onStopResponse();
    }
    
    // Use the enhanced forceful TTS destruction methods with DESTROY_ALL mode
    try {
      // PERSISTENT LOOP - Keep trying until everything is destroyed (minimum 5 seconds)
      console.log('💥 Starting persistent TTS clearing loop (minimum 5 seconds)...');
      let clearAttempt = 0;
      const maxClearAttempts = 10; // Maximum 10 attempts
      let allCleared = false;
      const startTime = Date.now(); // Track start time
      const minimumDuration = 5000; // Minimum 5 seconds
      
      while (!allCleared && clearAttempt < maxClearAttempts) {
        clearAttempt++;
        console.log(`💥 TTS clearing attempt ${clearAttempt}/${maxClearAttempts}...`);
        
        try {
          // Enhanced TTS stop inside the loop
          await ttsService.clear();
          await ttsService.speak('', null); // Pass null to trigger DESTROY_ALL mode
          await ttsService.stop(); // This includes the 500ms delay and aggressive cleanup
          
          const cleared = await ttsService.clear(); // This includes server + client clearing with verification
          
          if (cleared) {
            console.log(`✅ TTS clearing attempt ${clearAttempt} SUCCESSFUL - All threads and buffers destroyed`);
            
            // Check if we've been running for at least 5 seconds
            const elapsedTime = Date.now() - startTime;
            if (elapsedTime >= minimumDuration) {
              console.log(`⏰ Minimum 5 seconds elapsed (${elapsedTime}ms) - stopping loop`);
              allCleared = true;
              break;
            } else {
              const remainingTime = minimumDuration - elapsedTime;
              console.log(`⏰ Only ${elapsedTime}ms elapsed, continuing for ${remainingTime}ms more...`);
              // Continue the loop even though clearing was successful
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          } else {
            console.warn(`⚠️ TTS clearing attempt ${clearAttempt} verification timeout - retrying...`);
            
            // Wait 500ms before next attempt
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (clearError) {
          console.error(`❌ Error in TTS clearing attempt ${clearAttempt}:`, clearError);
          
          // Wait 500ms before next attempt even on error
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Additional check: if we've reached minimum time and had at least one successful clear
        const elapsedTime = Date.now() - startTime;
        if (elapsedTime >= minimumDuration && clearAttempt > 0) {
          console.log(`⏰ Minimum 5 seconds completed (${elapsedTime}ms) after ${clearAttempt} attempts - finishing`);
          allCleared = true;
          break;
        }
      }
      
      if (allCleared) {
        console.log('🎉 PERSISTENT TTS CLEARING SUCCESSFUL - All threads completely destroyed');
      } else {
        console.warn(`⚠️ PERSISTENT TTS CLEARING TIMEOUT after ${maxClearAttempts} attempts - forcing completion`);
        
        // Force one final aggressive cleanup attempt
        console.log('💥 Final aggressive TTS cleanup attempt...');
        try {
          await ttsService.stop(); // One more aggressive stop
          console.log('💥 Final aggressive cleanup completed');
        } catch (finalError) {
          console.error('❌ Error in final aggressive cleanup:', finalError);
        }
      }
      
      // STEP 3: Additional safety - wait a bit more for complete cleanup
      console.log('⏳ Additional 1000ms wait for complete TTS cleanup...');
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      console.error('❌ Error during forceful TTS destruction:', error);
      // Continue with UI updates even if TTS cleanup fails
    }
    
    // Update all UI states
    setIsListening(false);
    setInterimTranscript('');
    console.log('✅ UI state updated - isListening set to false, interimTranscript cleared');
    console.log('🏁 MIC STOP COMPLETED - All TTS threads destroyed, ready for next interaction');
  }, [voskRecognition, isListening, loading, onStopResponse]);

  // Toggle speech recognition with debounce protection
  const toggleListening = useCallback(async () => {
    console.log('🎤 MICROPHONE BUTTON CLICKED!');
    console.log('  - isListening:', isListening);
    console.log('  - isProcessingMic:', isProcessingMic);
    
    // Prevent rapid clicks - debounce protection
    if (isProcessingMic) {
      console.log('⏳ Mic operation already in progress, ignoring click');
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
          console.log('🔇 Stopping mic in Full Voice Mode - changing indicator color');
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
      console.log('🏁 toggleListening completed - processing state cleared');
    }
  }, [isListening, isProcessingMic, startMicListening, stopMicListening]);

  // Function to clear chat input
  const clearChatInput = useCallback(() => {
    console.log('🧹 Clearing chat input box...');
    setMessage('');
    setAttachments([]);
    setInterimTranscript('');
    finalTranscriptRef.current = '';
    console.log('✅ Chat input box cleared');
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
  }, [startMicListening, stopMicListening, clearChatInput, onMicStart, onMicStop, onClearChatInput]);

  // Notify parent component when listening state changes
  useEffect(() => {
    if (onListeningStateChange) {
      onListeningStateChange(isListening);
    }
  }, [isListening, onListeningStateChange]);

  // Reset turning off state when microphone actually stops (with gradual fade)
  useEffect(() => {
    if (!isListening && isTurningOff) {
      console.log('🎙️ Microphone stopped - starting gradual fade out...');
      // Add a delay for gradual disappearance when mic stops
      setTimeout(() => {
        console.log('🎙️ Gradual fade completed - resetting turning off state');
        setIsTurningOff(false);
      }, 2000); // 2 seconds gradual fade when mic stops
    }
  }, [isListening, isTurningOff]);



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

  const handleSuggestedPrompt = (prompt: string) => {
    onSendMessage(prompt);
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
      console.log(`✅ Set ${model.name} as default model`);
      
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
    
    // Check if content contains any table patterns
    const hasLlama3Table = llama3TableRegex.test(processedContent);
    const hasTabTable = tabTableRegex.test(processedContent);
    const hasMarkdownTable = markdownTableRegex.test(processedContent);
    
    // Reset regex states
    llama3TableRegex.lastIndex = 0;
    tabTableRegex.lastIndex = 0;
    markdownTableRegex.lastIndex = 0;
    
    // If no tables detected, just render with ReactMarkdown
    if (!hasLlama3Table && !hasTabTable && !hasMarkdownTable) {
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
    
    return (
      <Box
        key={message.id}
        sx={styles.messageBox}
      >
        <Box
          sx={isUser ? styles.userMessage : styles.assistantMessage}
        >
          <Box sx={{ width: '100%' }}>
            {/* Render message content */}
            <Typography
              variant="body1"
              component="div"
              className="markdown-content"
              sx={styles.messageContent}
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
            sx={styles.modelSelector}
          >
            {model?.name || 'Select Model'}
          </Button>
          <Menu
            anchorEl={modelMenuAnchor}
            open={Boolean(modelMenuAnchor)}
            onClose={handleCloseModelMenu}
          >
            {models.map((m) => (
              <MenuItem
                key={m.id}
                selected={m.id === model?.id}
                onClick={() => handleSelectModel(m)}
              >
                {m.name}
              </MenuItem>
            ))}
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
                      
                      {/* Status text */}
                      <Typography variant="body2" sx={{ fontSize: '0.9rem', opacity: 0.9, textAlign: 'center' }}>
                        🎙️ Listening for your voice...
                      </Typography>
                      
                      {/* Large animated sound waves */}
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1 }}>
                        {[1, 2, 3, 4, 5].map((i) => (
                          <Box
                            key={i}
                            sx={{
                              width: '4px',
                              backgroundColor: 'white',
                              borderRadius: '2px',
                              animation: `waveRed${i} 1.8s infinite`,
                              [`@keyframes waveRed${i}`]: {
                                '0%, 100%': {
                                  height: '12px',
                                  opacity: 0.4,
                                },
                                '50%': {
                                  height: '24px',
                                  opacity: 1,
                                },
                              },
                              animationDelay: `${i * 0.15}s`,
                            }}
                          />
                        ))}
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
            <div ref={messagesEndRef} />
          </Box>

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
                  InputProps={{
                    sx: styles.textField,
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
          <Typography variant="body1" sx={{ mb: 3 }}>
            This project was made possible by the contributions of the following individuals:
          </Typography>
          
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {[
              'Dr. Hooman H. Rashidi',
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
