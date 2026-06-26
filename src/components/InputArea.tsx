import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Box,
  TextField,
  IconButton,
  Paper,
  Typography,
  CircularProgress,
} from '@mui/material';
import {
  Send as SendIcon,
  Stop as StopIcon,
  Mic as MicIcon,
  Add as AddIcon,
  Close as CloseIcon,
  Description as DescriptionIcon,
  Error as ErrorIcon,
  Warning as WarningIcon,
  Block as BlockIcon,
  InfoOutlined as InfoIcon,
} from '@mui/icons-material';

import { FileAttachment, PdfImageMeta } from '../types';
import { getTextDirectionStyles } from '../services/rtlDetection';
import * as styles from '../styles/components/ChatArea.styles';


// Vision/image support is determined dynamically from Ollama's /api/show
// `capabilities` array (e.g. ["completion","vision"]). The boolean is fetched
// in App.tsx via fetchModelDetails() and flows down here as the
// `modelSupportsVision` prop — making any local hardcoded model list redundant.


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
  modelName?: string; // Current selected model name (used only for user-facing messages)
  /**
   * Whether the currently loaded model supports vision/image input.
   * Determined exclusively from Ollama's /api/show "capabilities" array
   * (e.g. ["completion","vision"]). When true, image uploads via file picker,
   * drag-drop, and paste are enabled. When false/undefined, all image input
   * paths are blocked and the user is prompted to switch to a vision model.
   */
  modelSupportsVision?: boolean;

  /**
   * The current model's maximum native context window (tokens), detected from
   * Ollama's /api/show. Used to advise the user how high they can raise the
   * configured context length when a token-heavy PDF is attached.
   */
  maxContextLength?: number;

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
  modelSupportsVision = false,
  maxContextLength = 32768,
}) => {
  // Vision support is sourced entirely from Ollama's /api/show "capabilities" array,
  // resolved in App.tsx and passed down as `modelSupportsVision`. On model switch the
  // parent pessimistically resets this to false until the next /api/show resolves,
  // so a stale "true" from a previous vision model can't leak through.
  const visionEnabled = modelSupportsVision;



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
  // Non-blocking advisory shown when a PDF carries visual content (images / charts / tables)
  // that the current text-only model won't be able to "see". The user can still send, we
  // just warn that visuals will be ignored / poorly summarized.
  const [pdfVisualWarning, setPdfVisualWarning] = useState<string | null>(null);
  // Per-attachment metadata captured at PDF-extraction time so we can decide whether to
  // show the visual-content warning without depending on the backend response shape
  // being available later. Keyed by attachment id.
  const pdfVisualStatsRef = useRef<Record<string, { images: number; charts: number; tables: number }>>({});
  const [contextWarning, setContextWarning] = useState<string | null>(null);
  const [isContextExceeded, setIsContextExceeded] = useState(false);
  // Non-blocking informational tip shown when a token-heavy PDF is attached and the
  // configured context length is below the model's native maximum. PDFs consume a lot
  // of tokens, so we nudge the user to raise their context length (in Settings) toward
  // the model's max so the full document — and more chat history — actually fits.
  const [pdfContextTip, setPdfContextTip] = useState<string | null>(null);
  // Key (sorted PDF attachment ids) the tip currently describes, and the key
  // the user has dismissed it for. A dismissal sticks for that PDF set but the
  // tip reappears when a different PDF is attached.
  const [pdfContextTipKey, setPdfContextTipKey] = useState<string | null>(null);
  const [pdfTipDismissedKey, setPdfTipDismissedKey] = useState<string | null>(null);
  // Remaining-time progress (100 → 0) for the auto-dismiss countdown ring
  // drawn around the tip's close button.
  const [pdfTipProgress, setPdfTipProgress] = useState(100);
  // Mirror of the persisted `contextLength` setting, kept in state so the PDF context
  // tip recomputes when the user changes it in Settings (via the contextLengthChanged event).
  const [contextLengthSetting, setContextLengthSetting] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('contextLength');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 2000) return parsed;
      }
    } catch (error) {
      console.error('Error reading context length:', error);
    }
    return 4096;
  });

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
            `(Current: ${currentPromptTokens + currentAttachmentsTokens}, Chat History Included: ${historyTokensUsed}, Safety Buffer: 2000). ` +
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

  // Show the red blocked banner whenever there's an image attached AND the
  // current model does not advertise vision capability via Ollama /api/show.
  // Re-runs on attachment change, model name change, or capability flag change —
  // which catches the case where the user attaches an image under a vision model
  // and then switches to a non-vision model before sending.
  useEffect(() => {
    const hasImageAttachments = attachments.some(attachment => attachment.type === 'image');

    if (hasImageAttachments && !modelSupportsVision) {
      const currentModel = modelName || 'your selected model';
      setImageBlocked(
        `Image upload blocked: "${currentModel}" does NOT support vision/image processing. ` +
        `This is a text-only model. Please remove the image or switch to a vision-capable model ` +
        `(e.g., llava, qwen2.5-vl, minicpm-v, moondream, gemma3, llama3.2-vision).`
      );
      setImageWarning(null);
    } else {
      setImageBlocked(null);
      setImageWarning(null);
    }
  }, [attachments, modelName, modelSupportsVision]);

  // Non-blocking advisory: when one or more attached PDFs contain visual
  // content (embedded images, vector chart regions, or tables) AND the
  // currently loaded model does NOT advertise vision capability via Ollama
  // /api/show, the user should know that those visuals will NOT be
  // analyzed — only the extracted plain text will reach the model.
  //
  // This is intentionally informational (yellow banner), not blocking,
  // because the text portion of the PDF is still useful on its own.
  useEffect(() => {
    if (modelSupportsVision) {
      setPdfVisualWarning(null);
      return;
    }

    const pdfAttachments = attachments.filter(a => a.type === 'pdf');
    if (pdfAttachments.length === 0) {
      setPdfVisualWarning(null);
      return;
    }

    // Aggregate visual stats across all PDF attachments using the cached
    // extraction metadata. We also fall back to attachment.images.length
    // in case the cache was lost (e.g. attachment loaded from disk).
    let totalImages = 0;
    let totalCharts = 0;
    let totalTables = 0;
    const pdfNamesWithVisuals: string[] = [];

    for (const att of pdfAttachments) {
      const stats = pdfVisualStatsRef.current[att.id];
      const imgsFromStats = stats?.images ?? (att.images?.length ?? 0);
      const chartsFromStats = stats?.charts ?? 0;
      const tablesFromStats = stats?.tables ?? 0;

      if (imgsFromStats > 0 || chartsFromStats > 0 || tablesFromStats > 0) {
        pdfNamesWithVisuals.push(att.name);
      }
      totalImages += imgsFromStats;
      totalCharts += chartsFromStats;
      totalTables += tablesFromStats;
    }

    if (totalImages === 0 && totalCharts === 0 && totalTables === 0) {
      setPdfVisualWarning(null);
      return;
    }

    const parts: string[] = [];
    if (totalImages > 0) parts.push(`${totalImages} image${totalImages !== 1 ? 's' : ''}`);
    if (totalCharts > 0) parts.push(`${totalCharts} chart/diagram region${totalCharts !== 1 ? 's' : ''}`);
    if (totalTables > 0) parts.push(`${totalTables} table${totalTables !== 1 ? 's' : ''}`);

    const modelLabel = modelName || 'the current model';
    const namesPreview =
      pdfNamesWithVisuals.length === 1
        ? `"${pdfNamesWithVisuals[0]}"`
        : `${pdfNamesWithVisuals.length} attached PDFs`;

    setPdfVisualWarning(
      `Heads up: ${namesPreview} contains ${parts.join(', ')}, but "${modelLabel}" is a text-only model ` +
      `and cannot analyze visual content. Only the extracted text will be sent. ` +
      `For accurate answers about charts/figures/images, switch to a vision-capable model ` +
      `(e.g. gemma4:12b-it-bf16, llava, qwen2.5-vl, llama3.2-vision, gemma3, minicpm-v).`,
    );
  }, [attachments, modelName, modelSupportsVision]);

  // Clean up cached PDF stats for attachments that are no longer present
  // (e.g. removed by the user) so the ref doesn't grow forever.
  useEffect(() => {
    const liveIds = new Set(attachments.map(a => a.id));
    for (const id of Object.keys(pdfVisualStatsRef.current)) {
      if (!liveIds.has(id)) delete pdfVisualStatsRef.current[id];
    }
  }, [attachments]);

  // PDFs are token-heavy. Whenever a PDF is attached (and finished extracting)
  // and the user's configured context length is below the model's native max,
  // surface a non-blocking, dismissible tip showing how many tokens the PDF(s)
  // add and nudging them to raise the context length toward the max so the full
  // document — and more chat history — fits.
  // Skipped for trivially small PDFs and for any PDF set the user has dismissed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const extractedPdfs = attachments.filter(
        a => a.type === 'pdf' && !!a.content && a.content.trim().length > 0,
      );

      if (extractedPdfs.length === 0 || contextLengthSetting >= maxContextLength) {
        setPdfContextTip(null);
        return;
      }

      // Stable key for this PDF set so a dismissal sticks until the set changes.
      const tipKey = extractedPdfs.map(a => a.id).sort().join('|');
      if (tipKey === pdfTipDismissedKey) {
        if (!cancelled) setPdfContextTip(null);
        return;
      }

      try {
        const { tokenCountingService } = await import('../services/tokenCountingService');

        // PDF-only token cost — used purely to decide whether the PDF is big
        // enough to bother warning about.
        let pdfTokens = 0;
        for (const att of extractedPdfs) {
          pdfTokens += tokenCountingService.countAttachmentTokens(att);
        }

        // Don't nag for tiny PDFs that comfortably fit the current window.
        if (pdfTokens < 1000) {
          if (!cancelled) setPdfContextTip(null);
          return;
        }

        // Display the SAME "current prompt" total the context-limit banner uses
        // (prompt text + base overhead + all attachments) so the two banners
        // never show conflicting numbers. Mirrors calculateTokens().
        const promptTokens = tokenCountingService.countTokens(message) + 10;
        let attachmentsTokens = 0;
        for (const att of attachments) {
          attachmentsTokens += tokenCountingService.countAttachmentTokens(att);
        }
        const currentTokens = promptTokens + attachmentsTokens;

        const label = extractedPdfs.length === 1 ? 'This PDF' : `These ${extractedPdfs.length} PDFs`;
        if (!cancelled) {
          setPdfContextTipKey(tipKey);
          setPdfContextTip(
            `${label} make your prompt ~${currentTokens.toLocaleString()} tokens. Your context length is set to ` +
            `${contextLengthSetting.toLocaleString()} (model max ${maxContextLength.toLocaleString()}). ` +
            `For best results, raise it toward ${maxContextLength.toLocaleString()} in Settings so the full ` +
            `document and more chat history fit in context. If you run into issues like incomplete answers or ` +
            `hallucinations, increase the context length as much as your hardware can handle.`,
          );
        }
      } catch (error) {
        console.error('Error computing PDF context tip:', error);
        if (!cancelled) setPdfContextTip(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [attachments, message, contextLengthSetting, maxContextLength, pdfTipDismissedKey]);

  // Auto-dismiss the PDF context tip after 1 minute so it doesn't linger, and
  // drive the countdown ring around its close button. Keyed on visibility +
  // the PDF set (not the tip text) so the live token count updating as the
  // user types doesn't keep resetting the timer.
  const pdfContextTipVisible = pdfContextTip !== null;
  useEffect(() => {
    if (!pdfContextTipVisible || !pdfContextTipKey) return;
    const DURATION = 60000;
    const start = Date.now();
    setPdfTipProgress(100);
    const interval = setInterval(() => {
      const remaining = DURATION - (Date.now() - start);
      if (remaining <= 0) {
        clearInterval(interval);
        setPdfTipProgress(0);
        setPdfTipDismissedKey(pdfContextTipKey);
        setPdfContextTip(null);
      } else {
        setPdfTipProgress((remaining / DURATION) * 100);
      }
    }, 200);
    return () => clearInterval(interval);
  }, [pdfContextTipVisible, pdfContextTipKey]);




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
      // Keep the mirrored setting in sync so the PDF context tip recomputes.
      try {
        const saved = localStorage.getItem('contextLength');
        if (saved) {
          const parsed = parseInt(saved, 10);
          if (!isNaN(parsed) && parsed >= 2000) setContextLengthSetting(parsed);
        }
      } catch (error) {
        console.error('Error reading context length:', error);
      }
    };

    window.addEventListener('contextLengthChanged', handleContextLengthChanged);

    return () => {
      window.removeEventListener('contextLengthChanged', handleContextLengthChanged);
    };
  }, [calculateTokens]);

  // True while at least one attachment is still in the HARD-BLOCKING phase
  // of background processing: initial PDF extraction. In this state the
  // attachment's `content` is still empty and sending would feed the LLM
  // a blank document — there is no useful prompt the user could write that
  // we could honor. So Send is disabled and the blue "extracting…" banner
  // is shown.
  const isExtracting = attachments.some(
    (a) =>
      a.content === '' ||
      /\(extracting…\)$/.test(a.name),
  );

  // SOFT-blocking phase: per-figure visual description is still in progress
  // but the document text + raw image payloads are already on the
  // attachment, so a prompt sent right now WILL reach the model in a usable
  // form (it will see the PDF text and, if vision-capable, the raw figure
  // images). The only thing missing is the AI-generated `description`
  // strings on `imageMeta[i]`, which are an OPTIONAL enrichment for future
  // turns / model switches.
  //
  // We therefore allow sending in this state but show an advisory banner
  // explaining the tradeoff so the user makes an informed choice.
  const isDescribingFigures = attachments.some((a) =>
    /\(describing figures \d+\/\d+…\)$/.test(a.name),
  );

  // Aggregate progress counter for the advisory banner. Each PDF attachment
  // currently being described carries a "(describing figures N/M…)" suffix
  // on its name; we sum the N's and M's across all such attachments so the
  // banner can show "3 / 9 figures described" in real time.
  //
  // We intentionally read this from the attachment NAME (rather than from
  // imageMeta[i].description counts) because the name is updated
  // synchronously inside the describe loop on every iteration — so the
  // counter advances visibly even on slow machines where the actual
  // setAttachments for imageMeta is still in flight.
  const describeProgress = (() => {
    let done = 0;
    let total = 0;
    for (const a of attachments) {
      const m = a.name.match(/\(describing figures (\d+)\/(\d+)…\)$/);
      if (m) {
        // The N in "N/M" reflects "currently working on figure N" — i.e.
        // figures 1..N-1 are already finished. We report N-1 as "done" so
        // the counter doesn't pre-emptively claim the in-flight figure
        // is complete.
        done  += Math.max(0, parseInt(m[1], 10) - 1);
        total += parseInt(m[2], 10);
      }
    }
    return { done, total };
  })();




  // Single send function called by both button click and Enter key
  const handleSend = () => {
    // Block sending if context exceeded, image is blocked (non-vision model),
    // OR any attachment is still being processed in the background.
    if (
      (message.trim() || attachments.length > 0) &&
      !loading &&
      !isContextExceeded &&
      !imageBlocked &&
      !isExtracting
    ) {
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
      // Images are only allowed when the current model supports vision (per Ollama /api/show capabilities).
      // Otherwise we block with a clear alert so the user knows to switch models.
      if (file.type.startsWith('image/')) {
        if (!visionEnabled) {
          const modelLabel = modelName || 'the current model';
          alert(`Image uploads are not supported by "${modelLabel}". Please switch to a vision-capable model (e.g. llava, qwen2.5-vl, llama3.2-vision, gemma3) to attach images.`);
          return;
        }

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
      } else if (file.name.toLowerCase().endsWith('.pdf')) {
        // PDFs are processed server-side by the unified Python backend.
        //
        // NOTE (2025): PDF support has been REDUCED to TEXT-ONLY extraction.
        // The backend no longer extracts tables, figures, embedded images, or
        // vector charts — only the plain text content of each page (plus
        // metadata, TOC and links) is forwarded to the LLM. This was done
        // because visual-element extraction was unreliable on diverse PDF
        // layouts and occasionally introduced noisy / incorrect data.
        //
        // We show the user an advisory EVERY time a PDF is uploaded so they
        // understand the limitations on every upload: PDFs do work, but the
        // result may not be 100% accurate and some information (figures,
        // tables, charts, complex layout) may be lost. The notice is shown
        // unconditionally — no sessionStorage gate — per the product
        // requirement that the user be reminded on each PDF upload.
        // DISABLED — this advisory is no longer accurate now that figures,
        // charts, tables and images ARE extracted. Kept (commented) for
        // reference.
        // eslint-disable-next-line no-alert
        // alert(
        //   `Heads up about PDF uploads:\n\n` +
        //   `PDF files are supported, but only their TEXT is extracted and ` +
        //   `sent to the model. Tables, figures, charts, images and complex ` +
        //   `page layouts are NOT extracted, so the result may not be 100% ` +
        //   `accurate and some information from the document may be lost.`,
        // );

        // PDFs are processed server-side by the unified Python backend
        // (PyMuPDF). The backend returns extracted text, metadata, TOC and
        // links in one structured payload. Table/figure/image extraction is
        // currently disabled server-side (see backend/main.py TEXT_ONLY_MODE).
        (async () => {
          // Placeholder attachment while extracting (gives the user feedback)
          const placeholderId = `pdf-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          const placeholder: FileAttachment = {
            id: placeholderId,
            name: `${file.name} (extracting…)`,
            type: 'pdf',
            content: '',
            size: file.size,
            timestamp: new Date().toISOString(),
          };
          setAttachments(prev => {
            const updated = [...prev, placeholder];
            calculateTokens(message, updated);
            return updated;
          });

          try {
            const { extractPdf } = await import('../services/backendApi');
            // IMPORTANT: we ALWAYS request image extraction (include_images=true)
            // so the backend reports accurate `stats.total_images` even when the
            // current model is text-only. This is what lets us show the
            // "PDF contains images that this model can't analyze" warning.
            // We still only RENDER full page previews for vision-capable models
            // (those are heavy), and we strip the image payloads from the
            // FileAttachment below when vision isn't supported so nothing
            // image-related is ever sent to the LLM.
            // No image-count cap is passed: the backend returns EVERY visual
            // element present in the document (embedded images, vector figure
            // crops when renderPages=true, and tables) along with rich
            // per-element metadata (page, bbox, caption, dimensions). Even when
            // the model is text-only, that metadata gets inlined into the
            // document digest so the LLM still understands where figures /
            // tables live in the paper.
            // Always request render_pages=true. The new caption-anchored
            // extractor produces ONE clean composite image per figure (not
            // 40+ tiny sprite thumbnails like the old extractor), so even
            // for non-vision models we want the backend to compute proper
            // figure regions with labels/captions. Image payloads are still
            // stripped below for non-vision models — only the rich text
            // markers ("[Figure 1 — page 2, caption: …]") are forwarded to
            // the LLM in that case.
            const result = await extractPdf(
              file,
              /* includeImages */ true,
              /* renderPages   */ true,
            );




            // Build the textual content fed into the LLM message
            const textContent = result.llm_summary_prompt || result.combined_text || '';

            // Walk each page's images and build BOTH:
            //   • `imageList`  — base64 data URIs forwarded to the LLM as
            //                    image payloads (only used when the current
            //                    model is vision-capable; stripped otherwise).
            //   • `imageMeta`  — language-agnostic per-figure metadata
            //                    (page, bbox, caption, label, dimensions).
            //                    This is ALWAYS persisted on the attachment,
            //                    even for text-only models, because we'll
            //                    soon enrich each entry with an AI-generated
            //                    `description` of the figure so future turns
            //                    have rich textual context for every visual.
            //
            // The two arrays are kept aligned by index so a downstream
            // consumer can pair `imageList[i]` with `imageMeta[i]`.
            const imageList: string[] = [];
            const imageMeta: PdfImageMeta[] = [];
            for (const page of result.pages) {
              for (const img of page.images || []) {
                if (!img.data) continue;
                // Defensive: if data already has the prefix (unexpected),
                // keep it as-is; otherwise add it.
                const fmt = (img.format || 'jpeg').toLowerCase();
                const mime = fmt === 'png' ? 'image/png' : 'image/jpeg';
                const dataUri = img.data.startsWith('data:')
                  ? img.data
                  : `data:${mime};base64,${img.data}`;
                imageList.push(dataUri);
                imageMeta.push({
                  index: (img as any).index ?? imageMeta.length + 1,
                  page: (img as any).page ?? page.page,
                  label: (img as any).label ?? null,
                  caption: (img as any).caption ?? null,
                  bbox: (img as any).bbox ?? null,
                  width: (img as any).width,
                  height: (img as any).height,
                  format: fmt,
                });
              }
            }

            // ---- Commit the attachment.
            // Background per-figure description is DISABLED: we extract the
            // figures/charts/tables and attach the raw figure images (for
            // vision models) plus their caption/label metadata, but we do NOT
            // ask the model to pre-describe each figure. The images are sent
            // as-is when the user submits their prompt.
            //
            // DISABLED — kept (commented) for reference. When the background
            // describe loop below is re-enabled, restore this name-stamping so
            // the Send button is disabled (via the isExtracting regex) until
            // the first describe iteration runs, and use `initialName` for the
            // attachment `name` instead of `file.name`:
            //
            // const willDescribe =
            //   visionEnabled &&
            //   !!modelName &&
            //   imageMeta.length > 0 &&
            //   imageList.length === imageMeta.length;
            // const initialName = willDescribe
            //   ? `${file.name} (describing figures 0/${imageMeta.length}…)`
            //   : file.name;
            const finalAttachment: FileAttachment = {
              id: placeholderId,
              name: file.name,
              type: 'pdf',
              content: textContent,
              images: visionEnabled && imageList.length > 0 ? imageList : undefined,
              imageMeta: imageMeta.length > 0 ? imageMeta : undefined,
              size: file.size,
              timestamp: new Date().toISOString(),
            };


            // Remember the visual-content stats for this attachment so we
            // can render a warning if the user's current model is text-only.
            // We don't depend on `attachment.images` being populated because
            // that field is intentionally stripped for non-vision models above.
            pdfVisualStatsRef.current[placeholderId] = {
              images: result.stats.total_images || 0,
              charts: result.stats.total_charts_detected || 0,
              tables: result.stats.total_tables || 0,
            };

            setAttachments(prev => {
              const updated = prev.map(a => a.id === placeholderId ? finalAttachment : a);
              calculateTokens(message, updated);
              return updated;
            });

            console.log(
              `📄 PDF '${file.name}' extracted: ${result.page_count} pages, ` +
              `${result.stats.total_chars} chars, ${result.stats.total_tables} tables, ` +
              `${result.stats.total_images} images, ` +
              `${result.stats.total_charts_detected} chart regions`,
            );

            // Background per-figure description is intentionally DISABLED.
            // We keep the extracted figure images + caption/label metadata on
            // the attachment, but we never send figures to the model for a
            // pre-description pass. Vision models receive the raw images at
            // prompt time instead.
            console.info(
              `[PDF] Figure pre-description disabled — ` +
              `extracted ${imageMeta.length} figure(s), ` +
              `${imageList.length} image payload(s) attached ` +
              `(visionEnabled=${visionEnabled}, model=${modelName || '(none)'}).`,
            );

            // ---------------------------------------------------------------
            // DISABLED — background per-figure description loop.
            // Kept (commented) for reference so it can be re-enabled later.
            // To restore: import `describePdfImage` from '../services/api',
            // stamp the attachment name with "(describing figures 0/N…)" via
            // the `willDescribe`/`initialName` logic above, and uncomment.
            // ---------------------------------------------------------------
            /*
            // ---- BACKGROUND: generate per-figure descriptions ---------------
            // We send each extracted figure to the user's CURRENT vision-
            // capable model and ask it for a short factual description, then
            // patch that description onto the corresponding `imageMeta[i]`
            // entry of the attachment in state. Future turns (handled in
            // src/services/api.ts → formatPdfImageMetaForLlm) will then
            // inline those descriptions into the LLM's view of the PDF — so
            // even after the user switches to a text-only model, the model
            // still "knows" what every figure shows.
            //
            // Concurrency is intentionally SERIAL (one at a time). Most
            // Ollama setups run a single GPU context per model, so parallel
            // requests just serialize at the engine level while filling the
            // queue with timeouts. Serial keeps the UI honest: we update the
            // placeholder name "(describing figures 3/8…)" as we go.
            //
            // If the user removes the attachment, switches the chat, or the
            // request stalls, the AbortController halts the whole batch.
            console.info(
              `[PDF describe] visionEnabled=${visionEnabled} ` +
              `modelName=${modelName || '(none)'} ` +
              `figures=${imageMeta.length} ` +
              `imagesPayload=${imageList.length}`,
            );

            if (
              visionEnabled &&
              modelName &&
              imageMeta.length > 0 &&
              imageList.length === imageMeta.length
            ) {
              const total = imageMeta.length;
              const abortController = new AbortController();
              console.info(
                `[PDF describe] starting loop for ${total} figure(s) using model "${modelName}"`,
              );


              // Tag describer model and timestamp on every entry up front so
              // the digest header makes sense even before the first reply
              // arrives.
              const describer = modelName;
              const describedAt = new Date().toISOString();

              (async () => {
                for (let i = 0; i < total; i++) {
                  // Detect removal/replacement: if the attachment no longer
                  // exists with our placeholderId, abort.
                  //
                  // IMPORTANT — do NOT use the
                  // `setAttachments(prev => { stillThere = ...; return prev; })`
                  // trick here. React 18 batches functional updaters, so the
                  // closure runs AFTER the synchronous `if (!stillThere)`
                  // check on the very next line, which means `stillThere`
                  // is always read as its initial `false` value and the loop
                  // aborts on iteration 0 — that was the original bug where
                  // the console showed "starting loop" but no
                  // POST /generate ever followed and neither GPU nor CPU lit up.
                  //
                  // `attachmentsRef.current` is kept in sync by a top-level
                  // useEffect on [message, attachments], so reading it here
                  // is both synchronous and safe.
                  const stillThere = attachmentsRef.current.some(
                    a => a.id === placeholderId,
                  );
                  if (!stillThere) {
                    console.info(
                      `[PDF describe] attachment ${placeholderId} no longer present at iteration ${i}/${total} — aborting describe loop.`,
                    );
                    abortController.abort();
                    return;
                  }


                  // Surface progress in the attachment name. We keep the
                  // file name as a prefix so the chip still reads naturally.
                  setAttachments(prev => prev.map(a =>
                    a.id === placeholderId
                      ? { ...a, name: `${file.name} (describing figures ${i + 1}/${total}…)` }
                      : a
                  ));

                  const meta = imageMeta[i];
                  const dataUri = imageList[i];
                  const desc = await describePdfImage(describer, dataUri, {
                    page: meta.page,
                    label: meta.label || undefined,
                    caption: meta.caption || undefined,
                    signal: abortController.signal,
                  });

                  if (abortController.signal.aborted) return;

                  // Patch the description back onto the imageMeta of the
                  // attachment in state. Use the functional updater so we
                  // never race with another setAttachments call elsewhere.
                  setAttachments(prev => prev.map(a => {
                    if (a.id !== placeholderId) return a;
                    const nextMeta = (a.imageMeta || []).map((m, idx) =>
                      idx === i
                        ? {
                            ...m,
                            description: desc || undefined,
                            describedBy: desc ? describer : undefined,
                            describedAt: desc ? describedAt : undefined,
                          }
                        : m
                    );
                    return { ...a, imageMeta: nextMeta };
                  }));
                }

                // All done — restore the clean file name and recalculate tokens
                // (descriptions add a few hundred tokens we should account for).
                setAttachments(prev => {
                  const updated = prev.map(a =>
                    a.id === placeholderId ? { ...a, name: file.name } : a,
                  );
                  calculateTokens(messageRef.current, updated);
                  return updated;
                });
              })().catch(err => {
                console.warn('PDF figure description loop failed:', err);
                // Restore name even on failure so the user isn't stuck with
                // a "(describing figures …)" suffix forever.
                setAttachments(prev => prev.map(a =>
                  a.id === placeholderId ? { ...a, name: file.name } : a,
                ));
              });
            } else if (!visionEnabled && imageMeta.length > 0) {
              // Text-only current model: we cannot auto-describe figures.
              // The figures' captions & labels are still on imageMeta and
              // will be inlined into the LLM digest by formatPdfImageMetaForLlm
              // (just without the rich AI-generated `description`).
              console.info(
                `[PDF] Current model "${modelName || 'unknown'}" is text-only — ` +
                `skipping per-figure visual descriptions. ` +
                `Figure captions/labels will still be sent to the LLM.`,
              );
            }
            */


          } catch (err: any) {
            console.error('PDF extraction failed:', err);
            const detail = err?.response?.data?.detail || err?.message || 'unknown error';
            alert(`Failed to extract PDF "${file.name}": ${detail}`);
            // Remove placeholder
            setAttachments(prev => {
              const updated = prev.filter(a => a.id !== placeholderId);
              calculateTokens(message, updated);
              return updated;
            });
          }
        })();
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
    // visionEnabled & modelName MUST be in deps — otherwise after the user
    // switches models, this useCallback retains a stale closure with the OLD
    // visionEnabled value and incorrectly blocks (or allows) image uploads.
  }, [calculateTokens, message, visionEnabled, modelName]);


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

    // Second, check for image data (dragging images from within the page).
    // We only accept these when the current model supports vision; otherwise we alert.
    const imageUrl = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/html');

    if (imageUrl) {
      // Extract image URL if wrapped in HTML
      let imgSrc = imageUrl;
      if (imageUrl.includes('<img')) {
        const match = imageUrl.match(/src=["']([^"']+)["']/);
        if (match && match[1]) {
          imgSrc = match[1];
        }
      }

      const looksLikeImage = imgSrc.startsWith('data:image/') || imgSrc.includes('image');
      if (looksLikeImage) {
        if (!visionEnabled) {
          const modelLabel = modelName || 'the current model';
          alert(`Image uploads are not supported by "${modelLabel}". Please switch to a vision-capable model (e.g. llava, qwen2.5-vl, llama3.2-vision, gemma3) to drop images.`);
          e.dataTransfer.clearData();
          return;
        }

        try {
          // Data URL: attach directly
          if (imgSrc.startsWith('data:image/')) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
            const newAttachment: FileAttachment = {
              id: `image-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              name: `dragged-image-${timestamp}.png`,
              type: 'image',
              content: imgSrc,
              size: Math.round((imgSrc.length * 3) / 4),
              timestamp: new Date().toISOString(),
            };
            setAttachments(prev => {
              const updated = [...prev, newAttachment];
              calculateTokens(message, updated);
              return updated;
            });
          }
          // Remote URL: fetch + convert to data URL
          else if (imgSrc.startsWith('http://') || imgSrc.startsWith('https://') || imgSrc.startsWith('/')) {
            const response = await fetch(imgSrc);
            const blob = await response.blob();
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);

            const reader = new FileReader();
            reader.onload = (event) => {
              if (!event.target || typeof event.target.result !== 'string') return;
              const newAttachment: FileAttachment = {
                id: `image-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                name: `dragged-image-${timestamp}.png`,
                type: 'image',
                content: event.target.result,
                size: blob.size,
                timestamp: new Date().toISOString(),
              };
              setAttachments(prev => {
                const updated = [...prev, newAttachment];
                calculateTokens(message, updated);
                return updated;
              });
            };
            reader.readAsDataURL(blob);
          }
        } catch (err) {
          console.error('Error processing dragged image:', err);
          alert('Failed to process the dragged image. Please try copying and pasting instead.');
        }
      }
    }

    e.dataTransfer.clearData();

    // visionEnabled & modelName must be in deps for the same stale-closure
    // reason as processFiles above (dragged-image branch reads visionEnabled).
  }, [processFiles, message, calculateTokens, visionEnabled, modelName]);


  // Paste event handler
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const clipboardData = e.clipboardData;
    if (!clipboardData) return;

    // Check for files in clipboard
    const items = clipboardData.items;
    const files: File[] = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      
      // Image paste: allowed only when the current model supports vision.
      // visionEnabled comes from the dynamic Ollama /api/show capabilities flag.

      if (item.type.startsWith('image/')) {
        e.preventDefault(); // Always prevent default text-of-image paste behavior
        if (!visionEnabled) {
          const modelLabel = modelName || 'the current model';
          alert(`Image uploads are not supported by "${modelLabel}". Please switch to a vision-capable model (e.g. llava, qwen2.5-vl, llama3.2-vision, gemma3) to paste images.`);
          return;
        }
        const file = item.getAsFile();
        if (file) {
          // Generate a meaningful filename for pasted images
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
          const extension = item.type.split('/')[1] || 'png';
          const renamedFile = new File([file], `pasted-image-${timestamp}.${extension}`, { type: file.type });
          files.push(renamedFile);
        }
      }

      // Handle non-image files (text/word documents). Image files are processed
      // in the branch above; here we accept only .txt/.doc/.docx pastes.
      else if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file && (file.name.endsWith('.txt') || file.name.endsWith('.docx') || file.name.endsWith('.doc'))) {
          e.preventDefault();
          files.push(file);
        }
      }

    }

    // Process any files found in clipboard
    if (files.length > 0) {
      processFiles(files);
    }
    // visionEnabled & modelName must be in deps — the pasted-image branch
    // reads visionEnabled to decide whether to allow or alert.
  }, [processFiles, visionEnabled, modelName]);


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

        {/* Hidden unified file input.
            Accept attribute is dynamic: images are only offered when the current model
            advertises vision capability via Ollama /api/show. */}

        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept={visionEnabled ? '.txt,.docx,.doc,.pdf,image/*' : '.txt,.docx,.doc,.pdf'}
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

          {/* Hard-blocking extraction banner: shown while a PDF is still
              being parsed by the backend. In this state the attachment's
              `content` is empty, so sending now would feed the LLM a blank
              document. Send is disabled. */}
          {isExtracting && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                p: 1,
                mb: 1,
                borderRadius: 1,
                bgcolor: 'rgba(33, 150, 243, 0.1)',
                border: '1px solid rgba(33, 150, 243, 0.3)',
                width: '100%',
              }}
            >
              <Box
                sx={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  border: '2px solid rgba(33, 150, 243, 0.3)',
                  borderTopColor: 'info.main',
                  animation: 'spin 1s linear infinite',
                  flexShrink: 0,
                  '@keyframes spin': {
                    '0%':   { transform: 'rotate(0deg)' },
                    '100%': { transform: 'rotate(360deg)' },
                  },
                }}
              />
              <Typography
                variant="caption"
                sx={{ color: 'info.main', lineHeight: 1.4 }}
              >
                Extracting attachment content… Please wait — sending is disabled
                until extraction completes (otherwise the model would receive an
                empty document).
              </Typography>
            </Box>
          )}

          {/* Soft-advisory "describing figures" banner: extraction has
              finished and the PDF text + raw figure images are already on
              the attachment, but we're still asking the vision model to
              generate a short textual description of each figure (so those
              descriptions can be saved with the chat and reused later, even
              if the user switches to a text-only model).

              Sending IS allowed in this state — the model will still see
              every page and every figure image. The only thing being filled
              in by the background work is the OPTIONAL `description`
              strings on `imageMeta[*]`, which improve later turns / model
              switches but are not required for the current turn to work.
              We just inform the user so they can make an informed choice. */}
          {isDescribingFigures && !isExtracting && (
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 0.75,
                p: 1,
                mb: 1,
                borderRadius: 1,
                // Warning (amber) palette — this is an advisory, not a
                // hard block. Sending now is allowed but discouraged
                // because the in-flight figure descriptions wouldn't be
                // saved with the chat.
                bgcolor: 'rgba(255, 152, 0, 0.10)',
                border: '1px solid rgba(255, 152, 0, 0.35)',
                width: '100%',
              }}
            >
              {/* Top row: spinner + counter pill + advisory text */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Box
                  sx={{
                    width: 12,
                    height: 12,
                    borderRadius: '50%',
                    border: '2px solid rgba(255, 152, 0, 0.35)',
                    borderTopColor: 'warning.main',
                    animation: 'spin 1s linear infinite',
                    flexShrink: 0,
                    '@keyframes spin': {
                      '0%':   { transform: 'rotate(0deg)' },
                      '100%': { transform: 'rotate(360deg)' },
                    },
                  }}
                />

                {/* Counter "pill" — sourced from the synchronously-updated
                    attachment name suffix, so it advances visibly with every
                    figure even on slow machines. Shows N/total where N is
                    the number of figures FULLY described so far. */}
                {describeProgress.total > 0 && (
                  <Box
                    sx={{
                      px: 0.75,
                      py: 0.125,
                      borderRadius: 0.75,
                      bgcolor: 'rgba(255, 152, 0, 0.20)',
                      border: '1px solid rgba(255, 152, 0, 0.45)',
                      color: 'warning.main',
                      fontSize: '0.72rem',
                      fontWeight: 700,
                      lineHeight: 1.4,
                      flexShrink: 0,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {`${describeProgress.done} / ${describeProgress.total} figures described`}
                  </Box>
                )}

                <Typography
                  variant="caption"
                  sx={{ color: 'warning.main', lineHeight: 1.4 }}
                >
                  {`${modelName || 'The model'} is still writing a short description for each PDF figure in the background. You can send your prompt now — the PDF text and all figure images are already attached — but waiting a few more seconds means those AI-generated descriptions will be saved with the document and remain available later, even if you switch to a text-only model.`}
                </Typography>
              </Box>

              {/* Bottom row: thin determinate progress bar so the user
                  gets a continuous visual sense of how close we are to
                  completion (the pill is discrete; the bar is continuous). */}
              {describeProgress.total > 0 && (
                <Box
                  sx={{
                    position: 'relative',
                    height: 4,
                    borderRadius: 2,
                    bgcolor: 'rgba(255, 152, 0, 0.15)',
                    overflow: 'hidden',
                    ml: 2.5, // align under the text (past the spinner)
                  }}
                >
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      bottom: 0,
                      width: `${Math.min(
                        100,
                        Math.max(
                          0,
                          (describeProgress.done / describeProgress.total) * 100,
                        ),
                      )}%`,
                      bgcolor: 'warning.main',
                      transition: 'width 200ms ease-out',
                    }}
                  />
                </Box>
              )}
            </Box>
          )}




          {/* PDF visual-content advisory: shown when an attached PDF contains
              images / charts / tables but the current model is text-only.
              Sending is still allowed — this is purely informational. */}
          {pdfVisualWarning && !imageBlocked && (

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
                {pdfVisualWarning}
              </Typography>
            </Box>
          )}


          {/* PDF context-length tip: PDFs are token-heavy, so when one is
              attached and the configured context length is below the model's
              max, nudge the user to raise it for better results. Suppressed
              while the context-limit warning (which already advises increasing
              context) or the image-blocked banner is showing, to avoid clutter. */}
          {pdfContextTip && !contextWarning && !imageBlocked && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 1,
                p: 1,
                mb: 1,
                borderRadius: 1,
                bgcolor: 'rgba(33, 150, 243, 0.1)',
                border: '1px solid rgba(33, 150, 243, 0.3)',
                width: '100%'
              }}
            >
              <InfoIcon sx={{ fontSize: 16, color: 'info.main', mt: 0.25, flexShrink: 0 }} />
              <Typography
                variant="caption"
                sx={{
                  color: 'info.main',
                  lineHeight: 1.4,
                  flex: 1
                }}
              >
                {pdfContextTip}
              </Typography>
              <Box
                sx={{
                  position: 'relative',
                  width: 26,
                  height: 26,
                  flexShrink: 0,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {/* Countdown ring showing time left before the tip auto-dismisses */}
                <CircularProgress
                  variant="determinate"
                  value={pdfTipProgress}
                  size={26}
                  thickness={2.5}
                  sx={{
                    color: 'info.main',
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    pointerEvents: 'none',
                  }}
                />
                <IconButton
                  size="small"
                  aria-label="Dismiss tip"
                  onClick={() => {
                    // Remember the dismissed PDF set so the tip stays closed for
                    // it, then hide the banner immediately.
                    setPdfTipDismissedKey(pdfContextTipKey);
                    setPdfContextTip(null);
                  }}
                  sx={{ p: 0, color: 'info.main' }}
                >
                  <CloseIcon sx={{ fontSize: 16 }} />
                </IconButton>
              </Box>
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
            color="primary"
            onClick={onStopResponse}
            sx={{ ml: 1 }}
          >
            <StopIcon />
          </IconButton>
        ) : (
          <IconButton
            color={(isContextExceeded || imageBlocked) ? "error" : "primary"}
            onClick={handleSend}
            // Send is disabled when: nothing to send, context limit exceeded,
            // an image is blocked by a non-vision model, OR any attachment is
            // still being asynchronously extracted (otherwise the model would
            // receive an empty document).
            disabled={
              (!message.trim() && attachments.length === 0) ||
              isContextExceeded ||
              !!imageBlocked ||
              isExtracting
            }
            title={
              imageBlocked
                ? "Cannot send: Model does not support images"
                : isContextExceeded
                  ? "Cannot send: Context limit exceeded"
                  : isExtracting
                    ? "Cannot send: Attachment is still being extracted. Please wait…"
                    : isDescribingFigures
                      ? "You can send now — but waiting for figure descriptions to finish will save richer context with the chat."
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
