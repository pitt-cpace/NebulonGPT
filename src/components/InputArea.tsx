import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Box,
  TextField,
  IconButton,
  Paper,
  Typography,
} from '@mui/material';
import {
  Send as SendIcon,
  Stop as StopIcon,
  Mic as MicIcon,
  Add as AddIcon,
  Close as CloseIcon,
  InsertDriveFile as InsertDriveFileIcon,
  Image as ImageIcon,
  Description as DescriptionIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
} from '@mui/icons-material';
import { FileAttachment } from '../types';
import { getTextDirectionStyles } from '../services/rtlDetection';
import * as styles from '../styles/components/ChatArea.styles';

interface InputAreaProps {
  loading: boolean;
  onSendMessage: (content: string, attachments?: FileAttachment[]) => void;
  onStopResponse: () => Promise<void>;
  voskRecognition?: any;
  isListening: boolean;
  isProcessingMic: boolean;
  speechError: string | null;
  interimTranscript: string;
  onToggleListening: () => Promise<void>;
  initialMessage?: string;
  chat: any;
  voiceText?: string;
  onClearInput?: React.MutableRefObject<(() => void) | null>; // Ref callback to clear input
  onGetAttachments?: React.MutableRefObject<(() => FileAttachment[]) | null>; // Ref callback to get current attachments
}

const InputArea: React.FC<InputAreaProps> = ({
  loading,
  onSendMessage,
  onStopResponse,
  voskRecognition,
  isListening,
  isProcessingMic,
  speechError,
  interimTranscript,
  onToggleListening,
  initialMessage,
  chat,
  voiceText,
  onClearInput,
  onGetAttachments,
}) => {
  const [message, setMessage] = useState(initialMessage || '');
  
  // Update message when voice text comes in (including clearing)
  useEffect(() => {
    if (voiceText !== undefined) {
      setMessage(voiceText);
      
      // Also update text direction
      if (voiceText) {
        const directionStyles = getTextDirectionStyles(voiceText);
        setTextDirection({
          direction: directionStyles.direction,
          textAlign: directionStyles.textAlign,
          unicodeBidi: directionStyles.unicodeBidi,
        });
      } else {
        // Reset to LTR when empty
        setTextDirection({
          direction: 'ltr',
          textAlign: 'left',
          unicodeBidi: 'normal',
        });
      }
    }
  }, [voiceText]);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [contextWarning, setContextWarning] = useState<string | null>(null);
  const [isContextExceeded, setIsContextExceeded] = useState(false);
  const [textDirection, setTextDirection] = useState<{
    direction: 'ltr' | 'rtl';
    textAlign: 'left' | 'right';
    unicodeBidi: string;
  }>({
    direction: 'ltr',
    textAlign: 'left',
    unicodeBidi: 'normal',
  });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textFieldRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const dragCounterRef = useRef(0);
  const [isDragOver, setIsDragOver] = useState(false);

  // Real-time token calculation function
  const calculateTokens = useCallback(async (currentMessage: string, currentAttachments: FileAttachment[]) => {
    try {
      const { tokenCountingService } = await import('../services/tokenCountingService');
      
      let contextLength = 4096;
      try {
        const savedContextLength = localStorage.getItem('contextLength');
        if (savedContextLength) {
          const parsed = parseInt(savedContextLength, 10);
          if (!isNaN(parsed) && parsed >= 2000) {
            contextLength = parsed;
          }
        }
      } catch (error) {
        console.error('Error reading context length:', error);
      }
      
      const currentPromptTokens = tokenCountingService.countTokens(currentMessage) + 10;
      
      let currentAttachmentsTokens = 0;
      for (const attachment of currentAttachments) {
        currentAttachmentsTokens += tokenCountingService.countAttachmentTokens(attachment);
      }
      
      const historyAllowance = tokenCountingService.calculateHistoryAllowance(
        currentPromptTokens,
        currentAttachmentsTokens,
        contextLength
      );
      
      const previousMessages = chat?.messages || [];
      
      let historyTokensUsed = 0;
      if (previousMessages.length > 0 && historyAllowance.historyTokens > 0) {
        for (let i = previousMessages.length - 1; i >= 0 && historyTokensUsed < historyAllowance.historyTokens; i--) {
          const msgTokens = tokenCountingService.countMessageTokens(previousMessages[i]);
          if (historyTokensUsed + msgTokens <= historyAllowance.historyTokens) {
            historyTokensUsed += msgTokens;
          } else {
            break;
          }
        }
      }
      
      const totalTokens = currentPromptTokens + currentAttachmentsTokens + historyTokensUsed;
      const reservedForResponse = 500;
      const maxAllowedTokens = contextLength - reservedForResponse;
      const isExceeded = totalTokens > maxAllowedTokens;
      
      setIsContextExceeded(isExceeded);
      
      const hasUserInput = currentMessage.trim().length > 0 || currentAttachments.length > 0;
      const totalHistoryTokens = previousMessages.length > 0 
        ? tokenCountingService.countTotalTokens(previousMessages)
        : 0;
      const hasNoHistory = totalHistoryTokens === 0;
      const isHistoryFullyReduced = historyTokensUsed === 0 && totalHistoryTokens > 0;
      
      if (isExceeded) {
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
          setContextWarning(null);
        }
      } else if (hasUserInput && totalTokens > maxAllowedTokens - 500) {
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
          setContextWarning(null);
        }
      } else {
        setContextWarning(null);
      }
    } catch (error) {
      console.error('Error calculating tokens:', error);
    }
  }, [chat]);

  // Function to clear input and recalculate
  const clearInput = useCallback(() => {
    setMessage('');
    setAttachments([]);
    setContextWarning(null);
    setIsContextExceeded(false);
    setTextDirection({
      direction: 'ltr',
      textAlign: 'left',
      unicodeBidi: 'normal',
    });
    // Recalculate with empty values
    calculateTokens('', []);
  }, [calculateTokens]);

  // Function to get current attachments
  const getAttachments = useCallback(() => {
    return attachments;
  }, [attachments]);

  // Expose clearInput and getAttachments functions to parent
  useEffect(() => {
    if (onClearInput) {
      onClearInput.current = clearInput;
    }
    if (onGetAttachments) {
      onGetAttachments.current = getAttachments;
    }
  }, [onClearInput, clearInput, onGetAttachments, getAttachments]);

  // Clear typing timeout and recalculate tokens when chat changes (keep input text)
  const prevChatIdRef = useRef(chat?.id);
  const messageRef = useRef(message);
  const attachmentsRef = useRef(attachments);
  
  // Keep refs in sync
  useEffect(() => {
    messageRef.current = message;
    attachmentsRef.current = attachments;
  }, [message, attachments]);
  
  useEffect(() => {
    // Only run when chat ID actually changes
    if (prevChatIdRef.current !== chat?.id) {
      prevChatIdRef.current = chat?.id;
      
      // Clear any pending typing timeout
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
      }
      
      // Clear warning states temporarily
      setContextWarning(null);
      setIsContextExceeded(false);
      
      // Recalculate tokens for new chat if there's input (use refs to get current values)
      if (messageRef.current.trim() || attachmentsRef.current.length > 0) {
        calculateTokens(messageRef.current, attachmentsRef.current);
      }
    }
  }, [chat?.id, calculateTokens]);

  // Listen for context length changes from settings
  useEffect(() => {
    const handleContextLengthChanged = () => {
      // Recalculate tokens when context length setting changes
      calculateTokens(messageRef.current, attachmentsRef.current);
    };

    window.addEventListener('contextLengthChanged', handleContextLengthChanged);

    return () => {
      window.removeEventListener('contextLengthChanged', handleContextLengthChanged);
    };
  }, [calculateTokens]);

  const handleSendMessage = async () => {
    if ((message.trim() || attachments.length > 0) && !loading && !isContextExceeded) {
      let messageText = message.trim();
      
      // Check if there are PDF attachments and add a special prompt
      const hasPdfAttachments = attachments.some(attachment => attachment.type === 'pdf');
      if (hasPdfAttachments) {
        const pdfWithTextCount = attachments.filter(att => att.type === 'pdf' && att.content).length;
        const pdfWithImagesCount = attachments.filter(att => att.type === 'pdf' && att.images && att.images.length > 0).length;
        
        let pdfDescription = "I've attached PDF file(s)";
        if (pdfWithTextCount > 0 && pdfWithImagesCount > 0) {
          pdfDescription += " containing both text and images";
        } else if (pdfWithTextCount > 0) {
          pdfDescription += " containing text";
        } else if (pdfWithImagesCount > 0) {
          pdfDescription += " containing images";
        }
        
        if (!messageText) {
          messageText = pdfDescription + ".";
        } else {
          messageText = messageText + " " + pdfDescription + ".";
        }
      }
      
      onSendMessage(messageText, attachments.length > 0 ? attachments : undefined);
      
      // Clear message, attachments, and warnings
      setMessage('');
      setAttachments([]);
      setContextWarning(null);
      setIsContextExceeded(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (!isContextExceeded) {
        handleSendMessage();
      }
    }
  };

  const handleRemoveAttachment = (attachmentId: string) => {
    setAttachments(prevAttachments => {
      const updated = prevAttachments.filter(attachment => attachment.id !== attachmentId);
      // Recalculate tokens with updated attachments
      calculateTokens(message, updated);
      return updated;
    });
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };


  // Process files from either file input or drag and drop
  const processFiles = useCallback((files: FileList | File[]) => {
    if (!files || files.length === 0) return;
    
    const fileArray = Array.from(files);
    
    fileArray.forEach(file => {
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        
        reader.onload = (event) => {
          if (!event.target || typeof event.target.result !== 'string') return;
          
          const dataUrl = event.target.result;
          const newAttachment: FileAttachment = {
            id: `image-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: file.name,
            type: 'image',
            content: dataUrl,
            size: file.size,
            timestamp: new Date().toISOString(),
          };
          
          setAttachments(prevAttachments => {
            const updated = [...prevAttachments, newAttachment];
            // Recalculate tokens with updated attachments
            calculateTokens(message, updated);
            return updated;
          });
        };
        
        reader.onerror = () => {
          alert(`Error reading image: ${file.name}`);
        };
        
        reader.readAsDataURL(file);
      } else if (file.name.endsWith('.pdf')) {
        alert(`PDF files are not supported. Please use text (.txt), Word (.docx), or image files instead.`);
      } else if (file.name.endsWith('.txt')) {
        const reader = new FileReader();
        
        reader.onload = (event) => {
          if (!event.target || typeof event.target.result !== 'string') return;
          
          const content = event.target.result;
          const newAttachment: FileAttachment = {
            id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            name: file.name,
            type: 'text',
            content: content,
            size: file.size,
            timestamp: new Date().toISOString(),
          };
          
          setAttachments(prevAttachments => {
            const updated = [...prevAttachments, newAttachment];
            // Recalculate tokens with updated attachments
            calculateTokens(message, updated);
            return updated;
          });
        };
        
        reader.onerror = () => {
          alert(`Error reading file: ${file.name}`);
        };
        
        reader.readAsText(file);
      } else if (file.name.endsWith('.docx')) {
        const reader = new FileReader();
        
        reader.onload = async (event) => {
          if (!event.target || !event.target.result) return;
          
          try {
            const mammoth = await import('mammoth');
            const arrayBuffer = event.target.result as ArrayBuffer;
            const result = await mammoth.extractRawText({ arrayBuffer });
            const content = result.value;
            
            const newAttachment: FileAttachment = {
              id: `file-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              name: file.name,
              type: 'text',
              content: content,
              size: file.size,
              timestamp: new Date().toISOString(),
            };
            
            setAttachments(prevAttachments => {
              const updated = [...prevAttachments, newAttachment];
              // Recalculate tokens with updated attachments
              calculateTokens(message, updated);
              return updated;
            });
          } catch (error) {
            console.error('Error extracting text from Word file:', error);
            alert(`Error processing Word file: ${file.name}`);
          }
        };
        
        reader.onerror = () => {
          alert(`Error reading file: ${file.name}`);
        };
        
        reader.readAsArrayBuffer(file);
      } else {
        alert(`Only .txt, .docx, and image files are supported. Skipping ${file.name}`);
      }
    });
    
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [calculateTokens, message]);

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

  return (
    <Box
      component={Paper}
      elevation={0}
      sx={{
        ...styles.inputContainer,
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
      <Box sx={styles.inputBox}>
        <Box sx={{ position: 'relative' }}>
          <IconButton 
            size="small" 
            sx={isListening ? styles.micButtonActive : (speechError ? styles.micButtonError : styles.micButton)}
            onClick={onToggleListening}
            disabled={isProcessingMic || !voskRecognition}
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
          accept=".txt,.docx,image/*"
          multiple
          onChange={handleFileSelect}
        />
        
        {/* Add attachment button */}
        <Box sx={{ position: 'relative' }}>
          <IconButton
            size="small"
            onClick={() => fileInputRef.current?.click()}
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

          {/* File attachment chips */}
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
            onChange={(e) => {
              const newValue = e.target.value;
              setMessage(newValue);
              
              // Notify parent for token calculation (debounced)
              if (typingTimeoutRef.current) {
                clearTimeout(typingTimeoutRef.current);
              }
              
              typingTimeoutRef.current = setTimeout(() => {
                // Update text direction detection
                if (newValue) {
                  const directionStyles = getTextDirectionStyles(newValue);
                  setTextDirection({
                    direction: directionStyles.direction,
                    textAlign: directionStyles.textAlign,
                    unicodeBidi: directionStyles.unicodeBidi,
                  });
                }
                
                // Calculate tokens
                calculateTokens(newValue, attachments);
              }, 50);
            }}
            onKeyPress={handleKeyPress}
            inputRef={textFieldRef}
            InputProps={{
              sx: {
                ...styles.textField,
                // Apply debounced RTL/LTR detection to input field
                direction: textDirection.direction,
                textAlign: textDirection.textAlign,
                unicodeBidi: textDirection.unicodeBidi,
              } as any,
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
  );
};

export default InputArea;
