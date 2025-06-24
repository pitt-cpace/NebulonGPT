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
} from '@mui/icons-material';
import ReactMarkdown from 'react-markdown';
import { ModelType, ChatType, MessageType, FileAttachment } from '../types';
import { getSuggestedPrompts } from '../services/api';
import { VoskRecognitionService } from '../services/vosk';
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
  voskRecognition: VoskRecognitionService | null;
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
}) => {
  const [message, setMessage] = useState('');
  const [modelMenuAnchor, setModelMenuAnchor] = useState<null | HTMLElement>(null);
  const [attachMenuAnchor, setAttachMenuAnchor] = useState<null | HTMLElement>(null);
  const [isListening, setIsListening] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const finalTranscriptRef = useRef<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [voskServerAvailable, setVoskServerAvailable] = useState<boolean | null>(null);
  const [defaultModel, setDefaultModel] = useState<string | null>(null);
  const suggestedPrompts = getSuggestedPrompts();

  // Load default model from localStorage on component mount
  useEffect(() => {
    const savedDefaultModel = localStorage.getItem('defaultModel');
    setDefaultModel(savedDefaultModel);
  }, []);

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chat?.messages]);

  // Initialize Vosk speech recognition event handlers
  useEffect(() => {
    if (!voskRecognition) {
      setVoskServerAvailable(false);
      setSpeechError('Vosk speech recognition not available');
      return;
    }

    // Check server availability
    const checkAvailability = async () => {
      const isAvailable = voskRecognition.isConnected();
      setVoskServerAvailable(isAvailable);
      
      if (!isAvailable) {
        setSpeechError('Vosk server not available. Please ensure the server is running.');
        return;
      }
    };

    checkAvailability();

    // Set up event handlers for the VoskRecognitionService instance
    voskRecognition.onResult((result: { text?: string; partial?: string }) => {
      if (result.partial) {
        // Update interim transcript for real-time display
        setInterimTranscript(result.partial);
      }
      
      if (result.text) {
        // Final transcript received
        console.log('🟢 Final:', result.text);
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
      setIsListening(false);
      setInterimTranscript('');
    });

    // Clear any previous errors
    setSpeechError(null);

    // Note: VoskRecognitionService doesn't need manual cleanup of event handlers
  }, [voskRecognition]);

  // Toggle Vosk speech recognition
  const toggleListening = useCallback(async () => {
    console.log('🎤 MICROPHONE BUTTON CLICKED!');
    console.log('  - isListening:', isListening);
    console.log('  - voskRecognition available:', !!voskRecognition);
    console.log('  - speechError:', speechError);
    console.log('  - message:', message);
    
    if (!voskRecognition) {
      console.error('❌ Vosk recognition not available');
      setSpeechError('Vosk speech recognition not available');
      return;
    }

    // Check if models are available using centralized method
    const modelCheck = await voskRecognition.checkModelAvailability();
    if (!modelCheck.hasModels) {
      console.error('❌ No Vosk models available');
      setSpeechError(modelCheck.errorMessage || 'No speech recognition models available');
      return;
    }
    
    setSpeechError(null); // Clear any previous errors
    
    if (isListening) {
      console.log('🛑 STOPPING speech recognition...');
      console.log('  - Current isListening state:', isListening);
      try {
        voskRecognition.stop();
        console.log('✅ voskRecognition.stop() called successfully');
      } catch (error) {
        console.error('❌ Error stopping Vosk speech recognition:', error);
      }
      setIsListening(false);
      setInterimTranscript('');
      console.log('✅ UI state updated - isListening set to false');
    } else {
      console.log('🎙️ STARTING speech recognition...');
      console.log('  - Current isListening state:', isListening);
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
        console.log('✅ Speech recognition started successfully');
      } catch (error) {
        console.error('❌ Error starting Vosk speech recognition:', error);
        setSpeechError('Failed to start Vosk speech recognition');
        console.log('❌ UI state - speechError set to:', 'Failed to start Vosk speech recognition');
      }
    }
    
    console.log('🏁 toggleListening completed');
  }, [isListening, message, voskRecognition, speechError]);

  const handleSendMessage = () => {
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
      
      // Send message with any attachments
      onSendMessage(messageText, attachments.length > 0 ? attachments : undefined);
      
      // Clear message and attachments
      setMessage('');
      setAttachments([]);
    }
  };

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

  const handleSetAsDefault = () => {
    if (model) {
      localStorage.setItem('defaultModel', model.id);
      setDefaultModel(model.id);
    }
  };

  const handleSuggestedPrompt = (prompt: string) => {
    onSendMessage(prompt);
  };

  // Attachment menu handlers
  const handleOpenAttachMenu = (event: React.MouseEvent<HTMLElement>) => {
    setAttachMenuAnchor(event.currentTarget);
  };

  const handleCloseAttachMenu = () => {
    setAttachMenuAnchor(null);
  };

  // File selection handlers
  const handleFileSelect = () => {
    fileInputRef.current?.click();
    handleCloseAttachMenu();
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileAttachment: FileAttachment = {
        id: `file-${Date.now()}-${i}`,
        name: file.name,
        size: file.size,
        type: file.type.startsWith('image/') ? 'image' : 
              file.type === 'application/pdf' ? 'pdf' : 'document',
        timestamp: new Date().toISOString(),
      };

      // Handle different file types
      if (file.type.startsWith('image/')) {
        // Handle image files
        const reader = new FileReader();
        reader.onload = (e) => {
          fileAttachment.content = e.target?.result as string;
          setAttachments(prev => [...prev, fileAttachment]);
        };
        reader.readAsDataURL(file);
      } else if (file.type === 'application/pdf') {
        // Handle PDF files
        try {
          const arrayBuffer = await file.arrayBuffer();
          const pdf = await getDocument({ data: arrayBuffer }).promise;
          
          let fullText = '';
          const images: string[] = [];
          
          // Extract text and images from all pages
          for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            
            // Extract text
            const textContent = await page.getTextContent();
            const pageText = textContent.items
              .filter((item): item is TextItem => 'str' in item)
              .map(item => item.str)
              .join(' ');
            fullText += pageText + '\n';
            
            // Extract images (simplified - would need more complex logic for actual image extraction)
            // For now, we'll just note that the PDF may contain images
          }
          
          fileAttachment.content = fullText.trim();
          if (images.length > 0) {
            fileAttachment.images = images;
          }
          
          setAttachments(prev => [...prev, fileAttachment]);
        } catch (error) {
          console.error('Error processing PDF:', error);
          // Add as a basic file attachment if PDF processing fails
          fileAttachment.content = `PDF file: ${file.name}`;
          setAttachments(prev => [...prev, fileAttachment]);
        }
      } else {
        // Handle other file types as text if possible
        const reader = new FileReader();
        reader.onload = (e) => {
          fileAttachment.content = e.target?.result as string;
          setAttachments(prev => [...prev, fileAttachment]);
        };
        reader.readAsText(file);
      }
    }

    // Clear the input
    event.target.value = '';
  };

  // Handle attachment removal
  const handleRemoveAttachment = (attachmentId: string) => {
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
                  <ReactMarkdown>
                    {message.content}
                  </ReactMarkdown>
                  {loading && message.id === chat?.messages[chat.messages.length - 1]?.id && (
                    <span className="streaming-cursor"></span>
                  )}
                </>
              )}
            </Typography>
          </Box>
        </Box>
      </Box>
    );
  };

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
            sx={styles.modelSelector}
            disabled={models.length === 0}
          >
            {models.length === 0 ? 'No Models Available' : (model?.name || 'Select Model')}
          </Button>
          <Menu
            anchorEl={modelMenuAnchor}
            open={Boolean(modelMenuAnchor)}
            onClose={handleCloseModelMenu}
          >
            {models.length === 0 ? (
              <MenuItem disabled>
                No models found. Please ensure Ollama is running and has models installed.
              </MenuItem>
            ) : (
              models.map((m) => (
                <MenuItem
                  key={m.id}
                  selected={m.id === model?.id}
                  onClick={() => handleSelectModel(m)}
                >
                  {m.name}
                </MenuItem>
              ))
            )}
          </Menu>

          <Typography
            variant="body2"
            color={model?.id === defaultModel ? "primary.main" : "text.secondary"}
            sx={{ 
              ml: 1, 
              cursor: 'pointer',
              fontWeight: model?.id === defaultModel ? 'bold' : 'normal'
            }}
            onClick={handleSetAsDefault}
          >
            {model?.id === defaultModel ? 'Default model' : 'Set as default'}
          </Typography>

          <Box sx={{ flexGrow: 1 }} />
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
            sx={styles.messagesContainer}
          >
            {chat.messages.map(renderMessage)}
            <div ref={messagesEndRef} />
          </Box>

          <Box
            component={Paper}
            elevation={0}
            sx={styles.inputContainer}
          >
            {/* Attachments display */}
            {attachments.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                  Attachments ({attachments.length})
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {attachments.map((attachment) => (
                    <Box
                      key={attachment.id}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        p: 1,
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1,
                        bgcolor: 'background.paper',
                        maxWidth: 200,
                      }}
                    >
                      {attachment.type === 'image' ? (
                        <ImageIcon fontSize="small" color="primary" />
                      ) : attachment.type === 'pdf' ? (
                        <DescriptionIcon fontSize="small" color="error" />
                      ) : (
                        <InsertDriveFileIcon fontSize="small" color="action" />
                      )}
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="caption" sx={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {attachment.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {formatFileSize(attachment.size)}
                        </Typography>
                      </Box>
                      <IconButton
                        size="small"
                        onClick={() => handleRemoveAttachment(attachment.id)}
                        sx={{ p: 0.5 }}
                      >
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  ))}
                </Box>
              </Box>
            )}

            <Box sx={styles.inputBox}>
              <Box sx={{ position: 'relative' }}>
                <IconButton 
                  size="small" 
                  sx={isListening ? styles.micButtonActive : (speechError ? styles.micButtonError : styles.micButton)}
                  onClick={toggleListening}
                  disabled={loading || !voskRecognition}
                  title={speechError || (isListening ? 'Stop dictation (Vosk)' : 'Start dictation (Vosk)')}
                >
                  <MicIcon />
                </IconButton>
                {speechError && (
                  <Typography 
                    variant="caption" 
                    color="warning.main" 
                    sx={styles.micErrorText}
                  >
                    {speechError.includes('https://alphacephei.com/vosk/models') ? (
                      <Box component="span">
                        No speech recognition models found. Please download models from{' '}
                        <a 
                          href="https://alphacephei.com/vosk/models" 
                          target="_blank" 
                          rel="noopener noreferrer"
                          style={{ color: 'inherit', textDecoration: 'underline' }}
                        >
                          https://alphacephei.com/vosk/models
                        </a>
                        {' '}and unzip them into the "Vosk-Server/websocket/models" folder.
                      </Box>
                    ) : (
                      speechError
                    )}
                  </Typography>
                )}
              </Box>

              {/* Attachment button */}
              <Box sx={{ position: 'relative' }}>
                <IconButton
                  size="small"
                  onClick={handleOpenAttachMenu}
                  disabled={loading}
                  title="Attach files"
                  sx={{ ml: 1 }}
                >
                  <AddIcon />
                </IconButton>
                <Menu
                  anchorEl={attachMenuAnchor}
                  open={Boolean(attachMenuAnchor)}
                  onClose={handleCloseAttachMenu}
                  anchorOrigin={{
                    vertical: 'top',
                    horizontal: 'left',
                  }}
                  transformOrigin={{
                    vertical: 'bottom',
                    horizontal: 'left',
                  }}
                >
                  <MenuItem onClick={handleFileSelect}>
                    <InsertDriveFileIcon sx={{ mr: 1 }} />
                    Upload Files
                  </MenuItem>
                </Menu>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,.pdf,.txt,.doc,.docx"
                  style={{ display: 'none' }}
                  onChange={handleFileChange}
                />
              </Box>
              
              <Box sx={{ width: '100%', position: 'relative' }}>
                {/* Real-time speech recognition overlay */}
                {isListening && interimTranscript && (
                  <Box sx={styles.interimTranscript}>
                    🎤 {interimTranscript}
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
    </Box>
  );
};

export default ChatArea;
