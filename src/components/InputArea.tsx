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
  Block as BlockIcon,
} from '@mui/icons-material';
import { FileAttachment } from '../types';
import { getTextDirectionStyles } from '../services/rtlDetection';
import * as styles from '../styles/components/ChatArea.styles';

// ============================================================================
// VISION MODEL SUPPORT LISTS
// ============================================================================

// Models that SUPPORT vision/image input (lowercase for matching)
const VISION_SUPPORTED_MODELS: string[] = [
  // OpenAI
  'gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-4-vision', 'gpt-5',
  // Google
  'gemini-1.5-pro', 'gemini-1.5-flash', 'gemini-3-pro', 'gemini-3-flash',
  'gemma3', 'gemma3n',
  // Anthropic
  'claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku', 'claude-3.5',
  // Ollama Vision Models (from Ollama library "Vision" category)
  'llava', 'llava:7b', 'llava:13b', 'llava:34b',
  'bakllava',
  'qwen-vl', 'qwen2-vl', 'qwen2.5-vl', 'qwen2.5vl', 'qwen3-vl',
  'minicpm-v',
  'moondream',
  'deepseek-vl', 'deepseek-ocr',
  'cogvlm',
  'idefics', 'idefics2',
  'llava-llama3', 'llava-phi3',
  'llama3.2-vision', 'llama4',
  'granite3.2-vision',
  'mistral-small3.1', 'mistral-small3.2',
  'translategemma',
  'ministral-3',
  'devstral-small-2', 'devstral-2',
  'kimi-k2.5', // native multimodal
];

// Models that do NOT support vision (text-only) - will BLOCK image upload
const NON_VISION_MODELS: string[] = [
  // Llama series (non-vision)
  'llama2', 'llama3', 'llama3.1', 'llama3.3', 'llama2-uncensored', 'llama2-chinese',
  // Mistral/Mixtral (non-vision)
  'mistral', 'mixtral', 'mistral-nemo', 'mistral-large', 'mistral-small', 'mistral-openorca',
  // Phi series
  'phi', 'phi-2', 'phi3', 'phi3.5', 'phi4', 'phi4-mini', 'phi4-reasoning', 'phi4-mini-reasoning',
  // Gemma (non-vision)
  'gemma', 'gemma2',
  // DeepSeek (non-vision)
  'deepseek-r1', 'deepseek-coder', 'deepseek-v2', 'deepseek-v2.5', 'deepseek-v3', 'deepseek-v3.1', 'deepseek-v3.2', 'deepseek-llm', 'deepcoder',
  // GPT-OSS
  'gpt-oss', 'gpt-oss-20b', 'gpt-oss-120b', 'gpt-oss-safeguard',
  // Qwen (non-vision)
  'qwen', 'qwen2', 'qwen2.5', 'qwen3', 'qwen3-coder', 'qwen2.5-coder', 'qwen2-math', 'qwq',
  // Falcon, StarCoder, Granite (non-vision)
  'falcon', 'falcon2', 'falcon3', 'starcoder', 'starcoder2',
  'granite-code', 'granite3', 'granite3-dense', 'granite3-moe', 'granite3.1-dense', 'granite3.1-moe', 'granite3.2', 'granite3.3', 'granite4',
  // Yi, Vicuna, CodeLlama
  'yi', 'yi-coder', 'vicuna', 'wizard-vicuna', 'wizard-vicuna-uncensored', 'codellama',
  // Dolphin series
  'dolphin-phi', 'dolphin-llama3', 'dolphin-mistral', 'dolphin-mixtral', 'dolphin3', 'dolphincoder', 'megadolphin', 'tinydolphin',
  // Other text-only models
  'codestral', 'codegemma', 'codeqwen', 'codegeex4', 'opencoder',
  'command-r', 'command-r-plus', 'command-r7b', 'command-r7b-arabic', 'command-a',
  'olmo2', 'olmo-3', 'olmo-3.1', 'smollm', 'smollm2', 'smallthinker', 'tinyllama',
  'hermes3', 'nous-hermes', 'nous-hermes2', 'nous-hermes2-mixtral', 'openhermes', 'openchat', 'neural-chat',
  'stablelm2', 'stablelm-zephyr', 'stable-beluga', 'stable-code', 'zephyr', 'orca-mini', 'orca2',
  'wizardlm', 'wizardlm2', 'wizardlm-uncensored', 'wizardcoder', 'wizard-math',
  'solar', 'solar-pro', 'athene-v2', 'reflection', 'nemotron', 'nemotron-mini', 'nemotron-3-nano',
  'exaone-deep', 'exaone3.5', 'cogito', 'cogito-2.1', 'aya', 'aya-expanse',
  'glm4', 'glm-4.6', 'glm-4.7', 'glm-4.7-flash', 'internlm2', 'reader-lm', 'tulu3', 'dbrx', 'marco-o1',
  'samantha-mistral', 'xwinlm', 'yarn-llama2', 'yarn-mistral', 'mathstral',
  'llama-pro', 'llama-guard3', 'llama3-groq-tool-use', 'llama3-gradient', 'llama3-chatqa',
  'phind-codellama', 'nuextract', 'meditron', 'firefunction-v2', 'starling-lm', 'bespoke-minicheck',
  'sailor2', 'magistral', 'openthinker', 'devstral', 'r1-1776', 'deepscaler',
  'shieldgemma', 'functiongemma', 'embeddinggemma', 'lfm2.5-thinking', 'rnj-1',
  'minimax-m2', 'minimax-m2.1', 'kimi-k2', 'kimi-k2-thinking',
  'notus', 'codeup', 'mistrallite', 'everythinglm', 'codebooga', 'goliath', 'open-orca-platypus2', 'alfred',
  'magicoder', 'notux', 'duckdb-nsql', 'medllama2', 'nexusraven', 'sqlcoder',
];

// Helper function to check if a model supports vision
// Returns: 'supported' | 'not-supported' | 'unknown'
const checkVisionSupport = (modelName: string | undefined): 'supported' | 'not-supported' | 'unknown' => {
  if (!modelName) return 'unknown';
  
  const normalizedName = modelName.toLowerCase().trim();
  
  // Check if it's in the vision-supported list
  for (const visionModel of VISION_SUPPORTED_MODELS) {
    if (normalizedName === visionModel || 
        normalizedName.startsWith(visionModel + ':') ||
        normalizedName.startsWith(visionModel + '-') ||
        normalizedName.includes(visionModel)) {
      return 'supported';
    }
  }
  
  // Check if it's in the non-vision list (should block)
  for (const nonVisionModel of NON_VISION_MODELS) {
    if (normalizedName === nonVisionModel || 
        normalizedName.startsWith(nonVisionModel + ':') ||
        normalizedName.startsWith(nonVisionModel + '-') ||
        normalizedName.includes(nonVisionModel)) {
      return 'not-supported';
    }
  }
  
  // Additional heuristic: if name contains vision-related keywords, likely supports vision
  if (normalizedName.includes('vision') || 
      normalizedName.includes('-vl') || 
      normalizedName.includes('vl-') ||
      normalizedName.includes('multimodal') ||
      normalizedName.includes('llava')) {
    return 'supported';
  }
  
  return 'unknown';
};

interface InputAreaProps {
  loading: boolean;
  onSendMessage: (content: string, attachments?: FileAttachment[]) => void;
  onStopResponse: () => Promise<boolean>;
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
  isMobile: boolean;
  modelName?: string; // Current selected model name for vision support warning
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
  isMobile,
  modelName,
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
  const [imageWarning, setImageWarning] = useState<string | null>(null);
  const [imageBlocked, setImageBlocked] = useState<string | null>(null); // Blocked message for non-vision models
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

  // Update image warning/blocked state when attachments or model changes
  useEffect(() => {
    const hasImageAttachments = attachments.some(attachment => attachment.type === 'image');
    
    if (hasImageAttachments) {
      const visionSupport = checkVisionSupport(modelName);
      const currentModel = modelName || 'your selected model';
      
      if (visionSupport === 'supported') {
        // Model supports vision - no warning needed
        setImageWarning(null);
        setImageBlocked(null);
      } else if (visionSupport === 'not-supported') {
        // Model does NOT support vision - show blocking error
        setImageBlocked(
          `Image upload blocked: "${currentModel}" does NOT support vision/image processing. ` +
          `This is a text-only model. Please remove the image or switch to a vision-capable model ` +
          `(e.g., llava, qwen2.5-vl, minicpm-v, moondream, gemma3, llama3.2-vision).`
        );
        setImageWarning(null);
      } else {
        // Unknown model - show warning
        const searchQuery = modelName ? `"${modelName}" vision support` : '';
        setImageWarning(
          `⚠️ Image attached: Your model "${currentModel}" is not in our known list. ` +
          `It may or may not support images. Please verify it has vision capabilities ` +
          `(look for "vision", "llava", "-vl", or "multimodal" in the name). ` +
          `${searchQuery ? `🔍 Search: "${searchQuery}" to check. ` : ''}` +
          `Models without vision support may hallucinate or provide inaccurate descriptions.`
        );
        setImageBlocked(null);
      }
    } else {
      setImageWarning(null);
      setImageBlocked(null);
    }
  }, [attachments, modelName]);

  // Function to clear input and recalculate
  const clearInput = useCallback(() => {
    setMessage('');
    setAttachments([]);
    setImageWarning(null);
    setImageBlocked(null);
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

  // Single send function called by both button click and Enter key
  const handleSend = () => {
    // Block sending if context exceeded OR if image is blocked (non-vision model)
    if ((message.trim() || attachments.length > 0) && !loading && !isContextExceeded && !imageBlocked) {
      onSendMessage(message.trim(), attachments.length > 0 ? attachments : undefined);
      setMessage('');
      setAttachments([]);
      setContextWarning(null);
      setIsContextExceeded(false);
      setImageBlocked(null);
      setImageWarning(null);
    }
  };
  
  const handleKeyPress = (e: React.KeyboardEvent) => {
    // On mobile devices, allow Enter to create new line
    // On desktop, Enter sends the message (Shift+Enter for new line)
    if (e.key === 'Enter' && !e.shiftKey && !isMobile) {
      e.preventDefault();
      handleSend();
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
      // IMAGE UPLOAD DISABLED - Only text-based document files are allowed
      if (file.type.startsWith('image/')) {
        alert(`Image uploads are not supported. Only text-based document files are allowed (.txt, .doc, .docx).`);
        return;
        // const reader = new FileReader();
        // 
        // reader.onload = (event) => {
        //   if (!event.target || typeof event.target.result !== 'string') return;
        //   
        //   const dataUrl = event.target.result;
        //   const newAttachment: FileAttachment = {
        //     id: `image-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        //     name: file.name,
        //     type: 'image',
        //     content: dataUrl,
        //     size: file.size,
        //     timestamp: new Date().toISOString(),
        //   };
        //   
        //   setAttachments(prevAttachments => {
        //     const updated = [...prevAttachments, newAttachment];
        //     // Recalculate tokens with updated attachments
        //     calculateTokens(message, updated);
        //     return updated;
        //   });
        // };
        // 
        // reader.onerror = () => {
        //   alert(`Error reading image: ${file.name}`);
        // };
        // 
        // reader.readAsDataURL(file);
      } else if (file.name.endsWith('.pdf')) {
        alert(`PDF files are not supported. Please use text files (.txt) or Word documents (.doc, .docx) instead.`);
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
        alert(`Only text-based document files are supported (.txt, .doc, .docx). Skipping ${file.name}`);
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

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    dragCounterRef.current = 0;

    // First, check for files (dragging from file system or external sources)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFiles(e.dataTransfer.files);
      e.dataTransfer.clearData();
      return;
    }

    // IMAGE DRAG & DROP DISABLED - Only text-based document files are allowed
    // Second, check for image data (dragging images from within the page)
    const imageUrl = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/html');
    
    if (imageUrl) {
      // Check if it's an image and show alert
      let imgSrc = imageUrl;
      if (imageUrl.includes('<img')) {
        const match = imageUrl.match(/src=["']([^"']+)["']/);
        if (match && match[1]) {
          imgSrc = match[1];
        }
      }
      if (imgSrc.startsWith('data:image/') || imgSrc.includes('image')) {
        alert(`Image uploads are not supported. Only text-based document files are allowed (.txt, .doc, .docx).`);
      }
      // try {
      //   // Extract image URL if it's wrapped in HTML
      //   let imgSrc = imageUrl;
      //   if (imageUrl.includes('<img')) {
      //     const match = imageUrl.match(/src=["']([^"']+)["']/);
      //     if (match && match[1]) {
      //       imgSrc = match[1];
      //     }
      //   }

      //   // If it's a data URL (base64 image)
      //   if (imgSrc.startsWith('data:image/')) {
      //     const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      //     const newAttachment: FileAttachment = {
      //       id: `image-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      //       name: `dragged-image-${timestamp}.png`,
      //       type: 'image',
      //       content: imgSrc,
      //       size: Math.round((imgSrc.length * 3) / 4), // Approximate size from base64
      //       timestamp: new Date().toISOString(),
      //     };
      //     
      //     setAttachments(prevAttachments => {
      //       const updated = [...prevAttachments, newAttachment];
      //       calculateTokens(message, updated);
      //       return updated;
      //     });
      //   }
      //   // If it's a regular URL, fetch and convert
      //   else if (imgSrc.startsWith('http://') || imgSrc.startsWith('https://') || imgSrc.startsWith('/')) {
      //     const response = await fetch(imgSrc);
      //     const blob = await response.blob();
      //     const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      //     
      //     const reader = new FileReader();
      //     reader.onload = (event) => {
      //       if (!event.target || typeof event.target.result !== 'string') return;
      //       
      //       const newAttachment: FileAttachment = {
      //         id: `image-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      //         name: `dragged-image-${timestamp}.png`,
      //         type: 'image',
      //         content: event.target.result,
      //         size: blob.size,
      //         timestamp: new Date().toISOString(),
      //       };
      //       
      //       setAttachments(prevAttachments => {
      //         const updated = [...prevAttachments, newAttachment];
      //         calculateTokens(message, updated);
      //         return updated;
      //       });
      //     };
      //     reader.readAsDataURL(blob);
      //   }
      // } catch (error) {
      //   console.error('Error processing dragged image:', error);
      //   alert('Failed to process the dragged image. Please try copying and pasting instead.');
      // }
    }

    e.dataTransfer.clearData();
  }, [processFiles, message, calculateTokens]);

  // Paste event handler
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    // Check for files in clipboard
    const items = clipboardData.items;
    const files: File[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      
      // IMAGE PASTE DISABLED - Only text-based document files are allowed
      // Handle images - block with alert message
      if (item.type.startsWith('image/')) {
        e.preventDefault(); // Prevent default paste behavior for images
        alert(`Image uploads are not supported. Only text-based document files are allowed (.txt, .doc, .docx).`);
        return;
        // const file = item.getAsFile();
        // if (file) {
        //   // Generate a meaningful filename for pasted images
        //   const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        //   const extension = item.type.split('/')[1] || 'png';
        //   const renamedFile = new File([file], `pasted-image-${timestamp}.${extension}`, { type: file.type });
        //   files.push(renamedFile);
        // }
      }
      // Handle files (if browser supports it) - only text files allowed
      else if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file && (file.name.endsWith('.txt') || file.name.endsWith('.docx') || file.name.endsWith('.doc'))) {
          e.preventDefault();
          files.push(file);
        }
        // Block image files from file paste
        // if (file && (file.type.startsWith('image/') || file.name.endsWith('.txt') || file.name.endsWith('.docx'))) {
        //   e.preventDefault();
        //   files.push(file);
        // }
      }
    }

    // Process any files found in clipboard
    if (files.length > 0) {
      processFiles(files);
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

        {/* Hidden unified file input - only text-based files */}
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept=".txt,.docx,.doc"
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

          {/* Image blocked error display (for non-vision models) */}
          {imageBlocked && (
            <Box 
              sx={{ 
                display: 'flex', 
                alignItems: 'flex-start',
                gap: 1,
                p: 1, 
                mb: 1,
                borderRadius: 1,
                bgcolor: 'rgba(244, 67, 54, 0.1)',
                border: '1px solid rgba(244, 67, 54, 0.3)',
                width: '100%'
              }}
            >
              <BlockIcon sx={{ fontSize: 16, color: 'error.main', mt: 0.25, flexShrink: 0 }} />
              <Typography 
                variant="caption" 
                sx={{ 
                  color: 'error.main',
                  lineHeight: 1.4,
                  fontWeight: 'bold'
                }}
              >
                {imageBlocked}
              </Typography>
            </Box>
          )}

          {/* Image vision warning display (for unknown models) */}
          {imageWarning && !imageBlocked && (
            <Box 
              sx={{ 
                display: 'flex', 
                alignItems: 'flex-start',
                gap: 1,
                p: 1, 
                mb: 1,
                borderRadius: 1,
                bgcolor: 'rgba(255, 152, 0, 0.1)',
                border: '1px solid rgba(255, 152, 0, 0.3)',
                width: '100%'
              }}
            >
              <WarningIcon sx={{ fontSize: 16, color: 'warning.main', mt: 0.25, flexShrink: 0 }} />
              <Typography 
                variant="caption" 
                sx={{ 
                  color: 'warning.main',
                  lineHeight: 1.4
                }}
              >
                {imageWarning}
              </Typography>
            </Box>
          )}

          {/* File attachment chips */}
          {attachments.length > 0 && (
            <Box 
              sx={{ 
                display: 'flex', 
                flexWrap: 'wrap', 
                gap: 1, 
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
                    position: 'relative',
                    display: 'inline-block',
                  }}
                >
                  {attachment.type === 'image' ? (
                    // Image thumbnail display
                    <Box
                      sx={{
                        position: 'relative',
                        width: 80,
                        height: 80,
                        borderRadius: 1.5,
                        overflow: 'hidden',
                        border: '1px solid rgba(255, 255, 255, 0.1)',
                        '&:hover .attachment-actions': {
                          opacity: 1,
                        }
                      }}
                    >
                      <Box
                        component="img"
                        src={attachment.content}
                        alt={attachment.name}
                        sx={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                        }}
                      />
                      {/* Hover overlay with close button */}
                      <Box
                        className="attachment-actions"
                        sx={{
                          position: 'absolute',
                          top: 0,
                          right: 0,
                          bottom: 0,
                          left: 0,
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'flex-end',
                          background: 'linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, transparent 50%)',
                          opacity: 0,
                          transition: 'opacity 0.2s ease',
                          p: 0.5,
                        }}
                      >
                        <IconButton
                          size="small"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRemoveAttachment(attachment.id);
                          }}
                          sx={{
                            bgcolor: 'rgba(0, 0, 0, 0.6)',
                            color: 'white',
                            width: 24,
                            height: 24,
                            '&:hover': {
                              bgcolor: 'rgba(0, 0, 0, 0.8)',
                            }
                          }}
                        >
                          <CloseIcon sx={{ fontSize: 16 }} />
                        </IconButton>
                      </Box>
                    </Box>
                  ) : (
                    // Text file chip display
                    <Box 
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
                      <DescriptionIcon sx={{ fontSize: 16, mr: 0.5, color: 'text.secondary' }} />
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
                  )}
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
            onPaste={handlePaste}
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
            color={(isContextExceeded || imageBlocked) ? "error" : "primary"}
            onClick={handleSend}
            disabled={(!message.trim() && attachments.length === 0) || isContextExceeded || !!imageBlocked}
            title={
              imageBlocked 
                ? "Cannot send: Model does not support images" 
                : isContextExceeded 
                  ? "Cannot send: Context limit exceeded" 
                  : "Send message"
            }
            sx={{ 
              ml: 1,
              ...((isContextExceeded || imageBlocked) && {
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
