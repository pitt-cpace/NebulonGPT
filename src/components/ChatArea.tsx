import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GlobalWorkerOptions } from 'pdfjs-dist';
import { pdfProcessor } from '../services/pdfProcessor';
import {
  Box,
  Typography,
  TextField,
  IconButton,
  Paper,
  AppBar,
  Toolbar,
  Menu,
  MenuItem,
  Button,
  Grid,
  Card,
  CardContent,
  CardActionArea,
} from '@mui/material';
import {
  Send as SendIcon,
  Stop as StopIcon,
  Menu as MenuIcon,
  Mic as MicIcon,
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

// Set the worker source path with fallback
try {
  // Use CDN worker as primary since local worker has module import issues
  GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
} catch (error) {
  console.warn('Failed to set PDF.js worker source:', error);
}

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
  micStoppedTrigger: number;
  onMicStart?: React.MutableRefObject<(() => Promise<void>) | null>;
  onMicStop?: React.MutableRefObject<(() => Promise<void>) | null>;
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
}) => {
  const [message, setMessage] = useState('');
  const [modelMenuAnchor, setModelMenuAnchor] = useState<null | HTMLElement>(null);
  const [attachMenuAnchor, setAttachMenuAnchor] = useState<null | HTMLElement>(null);
  const [isListening, setIsListening] = useState(false);
  const [isProcessingMic, setIsProcessingMic] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [fileProcessingError, setFileProcessingError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const finalTranscriptRef = useRef<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Remove unused variable - voskServerAvailable is set but never used
  // const [voskServerAvailable, setVoskServerAvailable] = useState<boolean | null>(null);
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
      setSpeechError('Vosk speech recognition not available');
      return;
    }

    // Check server availability
    const checkAvailability = async () => {
      const isAvailable = voskRecognition.isConnected();
      
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

  // Handle mic stopped from settings - listen for the trigger
  useEffect(() => {
    // This effect will run when the micStoppedTrigger changes
    // which happens when VoskModelSelector stops the mic
    if (micStoppedTrigger > 0 && voskRecognition && !voskRecognition.isCurrentlyRecording() && isListening) {
      console.log('🔄 Mic stopped from settings, updating ChatArea UI state...');
      setIsListening(false);
      setInterimTranscript('');
    }
  }, [micStoppedTrigger, voskRecognition, isListening]);

  // Dedicated function to start mic listening
  const startMicListening = useCallback(async () => {
    console.log('🎙️ STARTING speech recognition...');
    console.log('  - Current isListening state:', isListening);
    console.log('  - voskRecognition available:', !!voskRecognition);
    console.log('  - message:', message);
    
    if (!voskRecognition) {
      console.error('❌ Vosk recognition not available');
      setSpeechError('Vosk speech recognition not available');
      throw new Error('Vosk recognition not available');
    }

    if (isListening) {
      console.log('⚠️ Already listening, skipping start');
      return;
    }

    // Use centralized error detection for consistent messaging
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
      console.log('✅ Speech recognition started successfully');
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
    console.log('  - Current isListening state:', isListening);
    console.log('  - voskRecognition available:', !!voskRecognition);
    
    if (!voskRecognition) {
      console.log('⚠️ voskRecognition not available');
      return;
    }

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
    
    // Update all UI states
    setIsListening(false);
    setInterimTranscript('');
    console.log('✅ UI state updated - isListening set to false, interimTranscript cleared');
  }, [voskRecognition, isListening]);

  // Toggle Vosk speech recognition with debounce protection
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

  // Expose mic functions to parent components
  useEffect(() => {
    if (onMicStart) {
      // Replace the passed function with our internal function
      onMicStart.current = startMicListening;
    }
    if (onMicStop) {
      // Replace the passed function with our internal function
      onMicStop.current = stopMicListening;
    }
  }, [startMicListening, stopMicListening, onMicStart, onMicStop]);

  const handleSendMessage = async () => {
    // Allow sending if there's a message OR attachments
    if ((message.trim() || attachments.length > 0) && !loading) {
      let messageText = message.trim();
      
      // Don't automatically add PDF descriptions - let user write their own message
      // The AI will see the attachments and their content automatically
      
      // Stop listening when user sends message
      if (isListening && voskRecognition) {
        console.log('🛑 Stopping speech recognition after send button clicked...');
        try {
          await stopMicListening();
          console.log('✅ Speech recognition stopped after send');
        } catch (error) {
          console.error('❌ Error stopping speech recognition after send:', error);
          // Don't throw error, just log it - the message should still be sent
        }
      }
      
      // Send message with any attachments
      onSendMessage(messageText, attachments.length > 0 ? attachments : undefined);
      
      // Clear message and attachments
      setMessage('');
      setAttachments([]);
      setFileProcessingError(null);
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

    setFileProcessingError(null);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      console.log(`Processing file: ${file.name}, type: ${file.type}, size: ${file.size}`);
      
      const fileAttachment: FileAttachment = {
        id: `file-${Date.now()}-${i}`,
        name: file.name,
        size: file.size,
        type: file.type.startsWith('image/') ? 'image' : 
              file.type === 'application/pdf' ? 'pdf' : 'document',
        timestamp: new Date().toISOString(),
      };

      try {
        // Handle different file types
        if (file.type.startsWith('image/')) {
          // Handle image files - upload to server
          console.log(`Processing image: ${file.name}`);
          try {
            const formData = new FormData();
            formData.append('file', file);
            
            const response = await fetch('http://localhost:3001/api/files/upload', {
              method: 'POST',
              body: formData,
            });
            
            if (!response.ok) {
              throw new Error(`Upload failed: ${response.status}`);
            }
            
            const result = await response.json();
            
            if (result.success) {
              // Store ONLY file reference - no content in JSON
              fileAttachment.fileId = result.fileId;
              // No content stored locally - will be fetched from server when needed
              setAttachments(prev => [...prev, fileAttachment]);
              console.log(`✅ Image uploaded and stored on server: ${file.name} -> ${result.fileId}`);
            } else {
              throw new Error('Upload failed');
            }
          } catch (uploadError) {
            console.error(`❌ Error uploading image ${file.name}:`, uploadError);
            setFileProcessingError(`Failed to upload image: ${file.name}`);
          }
        } else if (file.type === 'application/pdf') {
          // Handle PDF files with enhanced processing
          console.log(`Processing PDF: ${file.name}`);
          try {
            // First, upload the original PDF file to server
            const formData = new FormData();
            formData.append('file', file);
            
            const uploadResponse = await fetch('http://localhost:3001/api/files/upload', {
              method: 'POST',
              body: formData,
            });
            
            if (!uploadResponse.ok) {
              throw new Error(`PDF upload failed: ${uploadResponse.status}`);
            }
            
            const uploadResult = await uploadResponse.json();
            console.log(`✅ Original PDF uploaded: ${file.name} -> ${uploadResult.fileId}`);
            
            // Store the original PDF file ID
            fileAttachment.fileId = uploadResult.fileId;
            
            // Now process the PDF for content extraction
            const arrayBuffer = await file.arrayBuffer();
            console.log(`PDF arrayBuffer size: ${arrayBuffer.byteLength} bytes`);
            
            // Use the enhanced PDF processor
            const pdfData = await pdfProcessor.processPDFFile(arrayBuffer, file.name, {
              extractImages: true,
              extractTables: true,
              extractCharts: true,
              highResolution: true,
            });
            
            console.log(`✅ PDF processed successfully with enhanced processor:`, pdfData.statistics);
            
            // Create comprehensive content from all extracted items
            let fullContent = '';
            
            // Add document metadata
            if (pdfData.metadata.title) {
              fullContent += `Title: ${pdfData.metadata.title}\n`;
            }
            if (pdfData.metadata.author) {
              fullContent += `Author: ${pdfData.metadata.author}\n`;
            }
            fullContent += `Pages: ${pdfData.metadata.totalPages}\n\n`;
            
            // Add text content organized by page
            const textByPage = new Map<number, string[]>();
            pdfData.items.text.forEach(textItem => {
              if (!textByPage.has(textItem.pageNumber)) {
                textByPage.set(textItem.pageNumber, []);
              }
              textByPage.get(textItem.pageNumber)!.push(textItem.content);
            });
            
            // Add text content page by page
            for (let pageNum = 1; pageNum <= pdfData.metadata.totalPages; pageNum++) {
              const pageTexts = textByPage.get(pageNum);
              if (pageTexts && pageTexts.length > 0) {
                fullContent += `=== Page ${pageNum} ===\n`;
                fullContent += pageTexts.join(' ') + '\n\n';
              }
            }
            
            // Add table information
            if (pdfData.items.tables.length > 0) {
              fullContent += `=== Tables Found (${pdfData.items.tables.length}) ===\n`;
              pdfData.items.tables.forEach((table, index) => {
                fullContent += `Table ${index + 1} (Page ${table.pageNumber}):\n`;
                table.content.forEach(row => {
                  fullContent += row.join(' | ') + '\n';
                });
                fullContent += '\n';
              });
            }
            
            // Add chart information
            if (pdfData.items.charts.length > 0) {
              fullContent += `=== Charts Found (${pdfData.items.charts.length}) ===\n`;
              pdfData.items.charts.forEach((chart, index) => {
                fullContent += `Chart ${index + 1} (Page ${chart.pageNumber}): ${chart.chartData.type}\n`;
                if (chart.chartData.title) {
                  fullContent += `Title: ${chart.chartData.title}\n`;
                }
                fullContent += '\n';
              });
            }
            
                    // Save PDF content as structured JSON instead of plain text
                    try {
                      const structuredContent: any = {
                        document: {
                          type: "pdf",
                          name: file.name,
                          metadata: {
                            title: pdfData.metadata.title || null,
                            author: pdfData.metadata.author || null,
                            totalPages: pdfData.metadata.totalPages,
                            processingDate: new Date().toISOString(),
                            extractionMethod: "enhanced-pdf-processor"
                          },
                          statistics: pdfData.statistics
                        },
                        content: {
                          pages: [] as any[],
                          tables: [] as any[],
                          charts: [] as any[],
                          images: [] as any[],
                          links: [] as any[]
                        }
                      };

                      // Organize text content by pages
                      const textByPage = new Map<number, any[]>();
                      pdfData.items.text.forEach(textItem => {
                        if (!textByPage.has(textItem.pageNumber)) {
                          textByPage.set(textItem.pageNumber, []);
                        }
                        textByPage.get(textItem.pageNumber)!.push({
                          id: textItem.id,
                          content: textItem.content,
                          position: textItem.position,
                          metadata: {
                            fontSize: (textItem.metadata as any).fontSize || null,
                            fontName: (textItem.metadata as any).fontName || null,
                            isTitle: textItem.metadata.isTitle || false,
                            isHeader: textItem.metadata.isHeader || false,
                            confidence: textItem.metadata.confidence || 0.9
                          }
                        });
                      });

                      // Add pages to structured content
                      for (let pageNum = 1; pageNum <= pdfData.metadata.totalPages; pageNum++) {
                        const pageTexts = textByPage.get(pageNum) || [];
                        structuredContent.content.pages.push({
                          pageNumber: pageNum,
                          textElements: pageTexts,
                          fullText: pageTexts.map((t: any) => t.content).join(' ')
                        });
                      }

                      // Add tables
                      structuredContent.content.tables = pdfData.items.tables.map(table => ({
                        id: table.id,
                        pageNumber: table.pageNumber,
                        data: table.content,
                        structure: table.structure,
                        position: table.position,
                        metadata: {
                          hasHeaders: table.structure.hasHeaders,
                          rowCount: table.structure.rows,
                          columnCount: table.structure.columns
                        }
                      }));

                      // Add charts
                      structuredContent.content.charts = pdfData.items.charts.map(chart => ({
                        id: chart.id,
                        pageNumber: chart.pageNumber,
                        type: chart.chartData.type,
                        title: chart.chartData.title || null,
                        data: {
                          labels: chart.chartData.labels || [],
                          values: chart.chartData.values || []
                        },
                        position: chart.position,
                        hasImage: !!chart.content
                      }));

                      // Add images
                      structuredContent.content.images = pdfData.items.images.map((image, index) => ({
                        id: image.id,
                        pageNumber: image.pageNumber,
                        description: `Image ${index + 1} from ${file.name}`,
                        metadata: {
                          format: image.metadata.format,
                          size: image.metadata.size,
                          isChart: image.metadata.isChart || false,
                          isDiagram: image.metadata.isDiagram || false
                        }
                      }));

                      const contentToSave = JSON.stringify(structuredContent, null, 2);
                      
                      const saveResponse = await fetch('http://localhost:3001/api/files/save', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                          content: contentToSave,
                          originalName: `${file.name}_extracted_content.json`,
                          mimetype: 'application/json'
                        }),
                      });
              
              if (saveResponse.ok) {
                const saveResult = await saveResponse.json();
                if (saveResult.success) {
                  // Store extracted content file ID separately for AI processing
                  fileAttachment.metadata = {
                    ...fileAttachment.metadata,
                    extractedContentFileId: saveResult.fileId
                  };
                  console.log(`✅ PDF content saved to server: ${saveResult.fileId}`);
                }
              }
            } catch (saveError) {
              console.warn(`⚠️ Could not save PDF content to server, storing locally:`, saveError);
              // Fallback: store content locally if server save fails
              fileAttachment.content = fullContent.trim() || `PDF file: ${file.name} (${pdfData.metadata.totalPages} pages)`;
            }
            
            // IMPORTANT: Keep the original PDF fileId for downloads
            // fileAttachment.fileId should remain the original PDF file ID (uploadResult.fileId)
            // The extracted content is stored separately in metadata.extractedContentFileId
            
            // Set image information - save images to server
            if (pdfData.items.images.length > 0) {
              fileAttachment.hasImages = true;
              const savedImageIds: string[] = [];
              
              // Save each image to server
              for (let imgIndex = 0; imgIndex < pdfData.items.images.length; imgIndex++) {
                const imageData = pdfData.items.images[imgIndex];
                try {
                  const imageSaveResponse = await fetch('http://localhost:3001/api/files/save', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                      content: imageData.content,
                      originalName: `${file.name}_page_${imageData.pageNumber}_image_${imgIndex + 1}.jpg`,
                      mimetype: 'image/jpeg'
                    }),
                  });
                  
                  if (imageSaveResponse.ok) {
                    const imageSaveResult = await imageSaveResponse.json();
                    if (imageSaveResult.success) {
                      savedImageIds.push(imageSaveResult.fileId);
                      console.log(`✅ PDF image saved to server: ${imageSaveResult.fileId}`);
                    }
                  }
                } catch (imageSaveError) {
                  console.warn(`⚠️ Could not save PDF image to server:`, imageSaveError);
                  // Fallback: store data URL if server save fails
                  savedImageIds.push(imageData.content);
                }
              }
              
              fileAttachment.imageFileIds = savedImageIds;
            }
            
            // Store table information
            if (pdfData.items.tables.length > 0) {
              fileAttachment.metadata = {
                ...fileAttachment.metadata,
                tables: pdfData.items.tables.map(table => ({
                  id: table.id,
                  pageNumber: table.pageNumber,
                  content: table.content,
                  structure: table.structure,
                  position: table.position
                }))
              };
            }
            
            // Store chart information
            if (pdfData.items.charts.length > 0) {
              fileAttachment.metadata = {
                ...fileAttachment.metadata,
                charts: pdfData.items.charts.map(chart => ({
                  id: chart.id,
                  pageNumber: chart.pageNumber,
                  chartData: chart.chartData,
                  position: chart.position,
                  content: chart.content // This contains the chart image
                }))
              };
            }
            
            // Add comprehensive metadata
            fileAttachment.metadata = {
              ...fileAttachment.metadata,
              totalPages: pdfData.metadata.totalPages,
              hasEmbeddedImages: pdfData.items.images.length > 0,
              textLength: pdfData.statistics.totalWords,
              processingMethod: 'enhanced-pdf-processor',
              extractionMethod: 'comprehensive',
              // Enhanced statistics
              totalTextItems: pdfData.statistics.totalTextItems,
              totalImages: pdfData.statistics.totalImages,
              totalTables: pdfData.statistics.totalTables,
              totalCharts: pdfData.statistics.totalCharts,
              totalWords: pdfData.statistics.totalWords,
            };
            
            setAttachments(prev => [...prev, fileAttachment]);
            console.log(`✅ Enhanced PDF processing completed: ${file.name}`);
            console.log(`   - Text items: ${pdfData.statistics.totalTextItems}`);
            console.log(`   - Images: ${pdfData.statistics.totalImages}`);
            console.log(`   - Tables: ${pdfData.statistics.totalTables}`);
            console.log(`   - Charts: ${pdfData.statistics.totalCharts}`);
            console.log(`   - Total words: ${pdfData.statistics.totalWords}`);
            
            // Debug: Show extracted content info
            if (pdfData.items.images.length > 0) {
              console.log('📸 Extracted images:');
              pdfData.items.images.forEach((img, idx) => {
                console.log(`   ${idx + 1}. ${img.id} (${img.metadata.extractionMethod}): ${Math.round(img.metadata.size / 1024)}KB`);
              });
            }
            
            if (pdfData.items.tables.length > 0) {
              console.log('📊 Extracted tables:');
              pdfData.items.tables.forEach((table, idx) => {
                console.log(`   ${idx + 1}. ${table.id} (Page ${table.pageNumber}): ${table.structure.rows}x${table.structure.columns} table`);
              });
            }
            
            if (pdfData.items.charts.length > 0) {
              console.log('📈 Extracted charts:');
              pdfData.items.charts.forEach((chart, idx) => {
                console.log(`   ${idx + 1}. ${chart.id} (Page ${chart.pageNumber}): ${chart.chartData.type} chart`);
              });
            }
            
          } catch (pdfError) {
            console.error(`❌ Error processing PDF ${file.name}:`, pdfError);
            // Fallback to basic file attachment
            fileAttachment.content = `PDF file: ${file.name} (enhanced processing failed - ${pdfError instanceof Error ? pdfError.message : 'unknown error'})`;
            setAttachments(prev => [...prev, fileAttachment]);
            setFileProcessingError(`Enhanced PDF processing failed for ${file.name}: ${pdfError instanceof Error ? pdfError.message : 'unknown error'}`);
          }
        } else {
          // Handle other file types - check if it's an Office document
          const fileExtension = file.name.toLowerCase().split('.').pop();
          const isOfficeDocument = ['docx', 'doc', 'xlsx', 'xls'].includes(fileExtension || '');
          
          if (isOfficeDocument) {
            // Handle Office documents with enhanced processing
            console.log(`Processing Office document: ${file.name} (${fileExtension})`);
            try {
              // First, upload the original Office file to server
              const formData = new FormData();
              formData.append('file', file);
              
              const uploadResponse = await fetch('http://localhost:3001/api/files/upload', {
                method: 'POST',
                body: formData,
              });
              
              if (!uploadResponse.ok) {
                throw new Error(`Office document upload failed: ${uploadResponse.status}`);
              }
              
              const uploadResult = await uploadResponse.json();
              console.log(`✅ Original Office document uploaded: ${file.name} -> ${uploadResult.fileId}`);
              
              // Store the original Office file ID
              fileAttachment.fileId = uploadResult.fileId;
              
              // Set the correct file type based on extension
              if (fileExtension === 'docx') {
                fileAttachment.type = 'docx';
              } else if (fileExtension === 'doc') {
                fileAttachment.type = 'doc';
              } else if (fileExtension === 'xlsx') {
                fileAttachment.type = 'xlsx';
              } else if (fileExtension === 'xls') {
                fileAttachment.type = 'xls';
              }
              
              // Now process the Office document for content extraction
              try {
                const processResponse = await fetch('http://localhost:3001/api/files/process-office', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                  },
                  body: JSON.stringify({
                    fileId: uploadResult.fileId,
                    fileName: file.name,
                    options: {
                      extractImages: true,
                      extractTables: true,
                      includeFormatting: true,
                    }
                  }),
                });
                
                if (processResponse.ok) {
                  const processResult = await processResponse.json();
                  
                  if (processResult.success) {
                    const officeData = processResult.data;
                    console.log(`✅ Office document processed successfully:`, officeData.statistics);
                    
                    // Create comprehensive content from all extracted items
                    let fullContent = '';
                    
                    // Add document metadata
                    if (officeData.metadata.title) {
                      fullContent += `Title: ${officeData.metadata.title}\n`;
                    }
                    if (officeData.metadata.author) {
                      fullContent += `Author: ${officeData.metadata.author}\n`;
                    }
                    if (officeData.metadata.sheetCount) {
                      fullContent += `Sheets: ${officeData.metadata.sheetCount} (${officeData.metadata.sheetNames?.join(', ')})\n`;
                    }
                    fullContent += '\n';
                    
                    // Add text content
                    if (officeData.items.text.length > 0) {
                      if (fileExtension === 'xlsx' || fileExtension === 'xls') {
                        // For Excel files, organize by sheet
                        const textBySheet = new Map<string, string[]>();
                        officeData.items.text.forEach((textItem: any) => {
                          const sheetName = textItem.metadata.sheetName || 'Sheet1';
                          if (!textBySheet.has(sheetName)) {
                            textBySheet.set(sheetName, []);
                          }
                          textBySheet.get(sheetName)!.push(`${textItem.metadata.cellAddress}: ${textItem.content}`);
                        });
                        
                        textBySheet.forEach((texts, sheetName) => {
                          fullContent += `=== ${sheetName} ===\n`;
                          fullContent += texts.join('\n') + '\n\n';
                        });
                      } else {
                        // For Word documents, organize by paragraph
                        fullContent += '=== Document Content ===\n';
                        officeData.items.text.forEach((textItem: any) => {
                          fullContent += textItem.content + '\n';
                        });
                        fullContent += '\n';
                      }
                    }
                    
                    // Add table information
                    if (officeData.items.tables.length > 0) {
                      fullContent += `=== Tables Found (${officeData.items.tables.length}) ===\n`;
                      officeData.items.tables.forEach((table: any, index: number) => {
                        if (table.metadata.sheetName) {
                          fullContent += `Table ${index + 1} (${table.metadata.sheetName}):\n`;
                        } else {
                          fullContent += `Table ${index + 1}:\n`;
                        }
                        table.content.forEach((row: string[]) => {
                          fullContent += row.join(' | ') + '\n';
                        });
                        fullContent += '\n';
                      });
                    }
                    
                    // Handle Office document images - save to server like PDF images
                    if (officeData.items.images.length > 0) {
                      fileAttachment.hasImages = true;
                      const savedImageIds: string[] = [];
                      
                      // Save each image to server
                      for (let imgIndex = 0; imgIndex < officeData.items.images.length; imgIndex++) {
                        const imageData = officeData.items.images[imgIndex];
                        try {
                          const imageSaveResponse = await fetch('http://localhost:3001/api/files/save', {
                            method: 'POST',
                            headers: {
                              'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({
                              content: imageData.content,
                              originalName: `${file.name}_image_${imgIndex + 1}.${imageData.metadata.format.replace('image/', '')}`,
                              mimetype: imageData.metadata.format
                            }),
                          });
                          
                          if (imageSaveResponse.ok) {
                            const imageSaveResult = await imageSaveResponse.json();
                            if (imageSaveResult.success) {
                              savedImageIds.push(imageSaveResult.fileId);
                              console.log(`✅ Office image saved to server: ${imageSaveResult.fileId}`);
                            }
                          }
                        } catch (imageSaveError) {
                          console.warn(`⚠️ Could not save Office image to server:`, imageSaveError);
                          // Fallback: store data URL if server save fails
                          savedImageIds.push(imageData.content);
                        }
                      }
                      
                      fileAttachment.imageFileIds = savedImageIds;
                      
                    // Add image information to content
                    fullContent += `=== Images Found (${officeData.items.images.length}) ===\n`;
                    officeData.items.images.forEach((image: any, index: number) => {
                      fullContent += `Image ${index + 1}: ${image.metadata.format} (${Math.round(image.metadata.size / 1024)}KB)\n`;
                    });
                    fullContent += '\n';
                  }
                  
                  // Add hyperlinks information
                  if (officeData.items.links && officeData.items.links.length > 0) {
                    fullContent += `=== Hyperlinks Found (${officeData.items.links.length}) ===\n`;
                    officeData.items.links.forEach((link: any, index: number) => {
                      fullContent += `Link ${index + 1}: "${link.metadata.linkText}" -> ${link.content} (${link.metadata.linkType})\n`;
                    });
                    fullContent += '\n';
                  }
                    
                    // Save Office content as structured JSON instead of plain text
                    try {
                      const structuredOfficeContent: any = {
                        document: {
                          type: fileExtension,
                          name: file.name,
                          metadata: {
                            title: officeData.metadata.title || null,
                            author: officeData.metadata.author || null,
                            sheetCount: officeData.metadata.sheetCount || null,
                            sheetNames: officeData.metadata.sheetNames || null,
                            processingDate: new Date().toISOString(),
                            extractionMethod: "enhanced-office-processor"
                          },
                          statistics: officeData.statistics
                        },
                        content: {
                          text: [] as any[],
                          tables: [] as any[],
                          images: [] as any[],
                          links: [] as any[]
                        }
                      };

                      // Add text content with structure
                      structuredOfficeContent.content.text = officeData.items.text.map((textItem: any) => ({
                        id: textItem.id,
                        content: textItem.content,
                        metadata: {
                          sheetName: textItem.metadata.sheetName || null,
                          cellAddress: textItem.metadata.cellAddress || null,
                          paragraphIndex: textItem.metadata.paragraphIndex || null,
                          isHeading: textItem.metadata.isHeading || false,
                          headingLevel: textItem.metadata.headingLevel || 0,
                          wordCount: textItem.metadata.wordCount || 0,
                          confidence: textItem.metadata.confidence || 0.9
                        }
                      }));

                      // Add tables with structure
                      structuredOfficeContent.content.tables = officeData.items.tables.map((table: any) => ({
                        id: table.id,
                        data: table.content,
                        metadata: {
                          sheetName: table.metadata.sheetName || null,
                          sheetIndex: table.metadata.sheetIndex || null,
                          structure: table.metadata.structure,
                          cellCount: table.metadata.cellCount || 0,
                          hasHeaders: table.metadata.structure?.hasHeaders || false
                        }
                      }));

                      // Add images with metadata
                      structuredOfficeContent.content.images = officeData.items.images.map((image: any, index: number) => ({
                        id: image.id,
                        description: `Image ${index + 1} from ${file.name}`,
                        metadata: {
                          format: image.metadata.format,
                          size: image.metadata.size,
                          confidence: image.metadata.confidence || 0.9
                        }
                      }));

                      // Add links with metadata
                      if (officeData.items.links) {
                        structuredOfficeContent.content.links = officeData.items.links.map((link: any) => ({
                          id: link.id,
                          url: link.content,
                          text: link.metadata.linkText,
                          type: link.metadata.linkType,
                          metadata: {
                            sheetName: link.metadata.sheetName || null,
                            cellAddress: link.metadata.cellAddress || null,
                            confidence: link.metadata.confidence || 0.95
                          }
                        }));
                      }

                      const contentToSave = JSON.stringify(structuredOfficeContent, null, 2);
                      
                      const saveResponse = await fetch('http://localhost:3001/api/files/save', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                          content: contentToSave,
                          originalName: `${file.name}_extracted_content.json`,
                          mimetype: 'application/json'
                        }),
                      });
                      
                      if (saveResponse.ok) {
                        const saveResult = await saveResponse.json();
                        if (saveResult.success) {
                          // Store extracted content file ID separately for AI processing
                          fileAttachment.metadata = {
                            ...fileAttachment.metadata,
                            extractedContentFileId: saveResult.fileId
                          };
                          console.log(`✅ Office content saved to server: ${saveResult.fileId}`);
                        }
                      }
                    } catch (saveError) {
                      console.warn(`⚠️ Could not save Office content to server, storing locally:`, saveError);
                      // Fallback: store content locally if server save fails
                      fileAttachment.content = fullContent.trim() || `Office document: ${file.name}`;
                    }
                    
                    // IMPORTANT: Keep the original Office fileId for downloads
                    // fileAttachment.fileId should remain the original Office file ID (uploadResult.fileId)
                    // The extracted content is stored separately in metadata.extractedContentFileId
                    
                    // Add comprehensive metadata
                    fileAttachment.metadata = {
                      ...fileAttachment.metadata,
                      textLength: officeData.statistics.totalWords,
                      processingMethod: 'enhanced-office-processor',
                      extractionMethod: 'comprehensive',
                      // Enhanced statistics
                      totalTextItems: officeData.statistics.totalTextItems,
                      totalImages: officeData.statistics.totalImages,
                      totalTables: officeData.statistics.totalTables,
                      totalWords: officeData.statistics.totalWords,
                      totalSheets: officeData.statistics.totalSheets,
                      // Office-specific metadata
                      sheetCount: officeData.metadata.sheetCount,
                      sheetNames: officeData.metadata.sheetNames,
                    };
                    
                    console.log(`✅ Enhanced Office processing completed: ${file.name}`);
                    console.log(`   - Text items: ${officeData.statistics.totalTextItems}`);
                    console.log(`   - Images: ${officeData.statistics.totalImages}`);
                    console.log(`   - Tables: ${officeData.statistics.totalTables}`);
                    console.log(`   - Total words: ${officeData.statistics.totalWords}`);
                    if (officeData.statistics.totalSheets) {
                      console.log(`   - Total sheets: ${officeData.statistics.totalSheets}`);
                    }
                  } else {
                    throw new Error('Office document processing failed');
                  }
                } else {
                  throw new Error(`Office processing failed: ${processResponse.status}`);
                }
              } catch (processError) {
                console.warn(`⚠️ Office document processing failed, using basic upload:`, processError);
                // Fallback: use basic file attachment
                fileAttachment.content = `Office document: ${file.name} (enhanced processing failed - ${processError instanceof Error ? processError.message : 'unknown error'})`;
                setFileProcessingError(`Enhanced Office processing failed for ${file.name}: ${processError instanceof Error ? processError.message : 'unknown error'}`);
              }
              
              setAttachments(prev => [...prev, fileAttachment]);
              console.log(`✅ Office document upload completed: ${file.name}`);
              
            } catch (officeError) {
              console.error(`❌ Error processing Office document ${file.name}:`, officeError);
              setFileProcessingError(`Failed to process Office document: ${file.name}`);
            }
          } else {
            // Handle other document types - upload to server
            console.log(`Processing document file: ${file.name}`);
            try {
              const formData = new FormData();
              formData.append('file', file);
              
              const response = await fetch('http://localhost:3001/api/files/upload', {
                method: 'POST',
                body: formData,
              });
              
              if (!response.ok) {
                throw new Error(`Upload failed: ${response.status}`);
              }
              
              const result = await response.json();
              
              if (result.success) {
                // Store file reference instead of content
                fileAttachment.fileId = result.fileId;
                
                // Store ONLY file reference - no content in JSON
                // Content will be fetched from server when needed for AI processing
                setAttachments(prev => [...prev, fileAttachment]);
                console.log(`✅ Document file uploaded and stored on server: ${file.name} -> ${result.fileId}`);
              } else {
                throw new Error('Upload failed');
              }
            } catch (uploadError) {
              console.error(`❌ Error uploading document ${file.name}:`, uploadError);
              setFileProcessingError(`Failed to upload document: ${file.name}`);
            }
          }
        }
      } catch (error) {
        console.error(`❌ Error processing file ${file.name}:`, error);
        setFileProcessingError(`Failed to process file: ${file.name}`);
      }
    }

    // Clear the input
    event.target.value = '';
  };

  // Handle attachment removal
  const handleRemoveAttachment = async (attachmentId: string) => {
    // Find the attachment to be removed
    const attachmentToRemove = attachments.find(att => att.id === attachmentId);
    
    if (attachmentToRemove) {
      console.log(`🗑️ Removing attachment: ${attachmentToRemove.name}`);
      
      // Collect all file IDs that need to be deleted from server
      const fileIdsToDelete: string[] = [];
      
      // Add main file ID if it exists
      if (attachmentToRemove.fileId) {
        fileIdsToDelete.push(attachmentToRemove.fileId);
      }
      
      // Add extracted content file ID if it exists (for PDFs and Office docs)
      if (attachmentToRemove.metadata?.extractedContentFileId) {
        fileIdsToDelete.push(attachmentToRemove.metadata.extractedContentFileId);
      }
      
      // Add image file IDs if they exist (for PDFs and Office docs with images)
      if (attachmentToRemove.imageFileIds && attachmentToRemove.imageFileIds.length > 0) {
        attachmentToRemove.imageFileIds.forEach(imageId => {
          if (typeof imageId === 'string' && !imageId.startsWith('data:')) {
            // Only delete server file IDs, not data URLs
            fileIdsToDelete.push(imageId);
          }
        });
      }
      
      // Delete files from server
      for (const fileId of fileIdsToDelete) {
        try {
          const deleteResponse = await fetch(`http://localhost:3001/api/files/${fileId}`, {
            method: 'DELETE',
          });
          
          if (deleteResponse.ok) {
            console.log(`✅ Deleted file from server: ${fileId}`);
          } else {
            console.warn(`⚠️ Failed to delete file from server: ${fileId} (${deleteResponse.status})`);
          }
        } catch (deleteError) {
          console.error(`❌ Error deleting file ${fileId}:`, deleteError);
        }
      }
      
      console.log(`🧹 Cleaned up ${fileIdsToDelete.length} files for attachment: ${attachmentToRemove.name}`);
    }
    
    // Update the attachments list
    const updatedAttachments = attachments.filter(
      (attachment) => attachment.id !== attachmentId
    );
    setAttachments(updatedAttachments);
    
    // Clear error if no attachments left
    if (updatedAttachments.length === 0) {
      setFileProcessingError(null);
    }
  };
  
  // Format file size for display
  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Handle attachment download
  const handleDownloadAttachment = async (attachment: FileAttachment) => {
    try {
      let downloadData: string;

      if (attachment.type === 'image' && attachment.content) {
        // For images, use the data URL directly
        downloadData = attachment.content;
      } else if (attachment.type === 'pdf') {
        // For PDFs, download the original PDF file from server with original filename
        if (attachment.fileId) {
          try {
            // Add original filename as query parameter for server to use
            const downloadUrl = `http://localhost:3001/api/files/${attachment.fileId}?filename=${encodeURIComponent(attachment.name)}`;
            const response = await fetch(downloadUrl);
            if (response.ok) {
              const blob = await response.blob();
              downloadData = URL.createObjectURL(blob);
              
              // Create download link with original filename
              const link = document.createElement('a');
              link.href = downloadData;
              link.download = attachment.name; // Use original filename
              document.body.appendChild(link);
              link.click();
              document.body.removeChild(link);
              URL.revokeObjectURL(downloadData);
              console.log(`✅ Downloaded original file: ${attachment.name}`);
              return;
            }
          } catch (fetchError) {
            console.warn(`⚠️ Could not download original file, falling back to extracted content:`, fetchError);
          }
        }
        
        // Fallback: create a text file with the extracted content
        const textContent = attachment.content || `PDF file: ${attachment.name}`;
        const blob = new Blob([textContent], { type: 'text/plain' });
        downloadData = URL.createObjectURL(blob);
        
        // Create download link
        const link = document.createElement('a');
        link.href = downloadData;
        link.download = `${attachment.name.replace('.pdf', '')}_extracted_content.txt`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(downloadData);
        return;
      } else {
        // For other file types, create a text file with the content
        const textContent = attachment.content || `File: ${attachment.name}`;
        const blob = new Blob([textContent], { type: 'text/plain' });
        downloadData = URL.createObjectURL(blob);
        
        // Create download link
        const link = document.createElement('a');
        link.href = downloadData;
        link.download = attachment.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(downloadData);
        return;
      }

      // For images with data URLs
      if (attachment.type === 'image' && downloadData.startsWith('data:')) {
        const link = document.createElement('a');
        link.href = downloadData;
        link.download = attachment.name;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }

      console.log(`✅ Downloaded attachment: ${attachment.name}`);
    } catch (error) {
      console.error(`❌ Error downloading attachment ${attachment.name}:`, error);
      // Show user-friendly error message
      alert(`Failed to download ${attachment.name}. Please try again.`);
    }
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
            {/* Show attachments for user messages */}
            {isUser && message.attachments && message.attachments.length > 0 && (
              <Box sx={{ mb: 1 }}>
                <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
                  Attachments ({message.attachments.length})
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                  {message.attachments.map((attachment, index) => (
                    <Box
                      key={index}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        p: 1,
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1,
                        bgcolor: 'rgba(255, 255, 255, 0.05)',
                        maxWidth: 200,
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        '&:hover': {
                          bgcolor: 'rgba(255, 255, 255, 0.1)',
                          borderColor: 'primary.main',
                        }
                      }}
                      onClick={() => handleDownloadAttachment(attachment)}
                      title={`Download ${attachment.name}`}
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
                      <Box sx={{ 
                        display: 'flex', 
                        alignItems: 'center', 
                        justifyContent: 'center',
                        width: 16,
                        height: 16,
                        opacity: 0.7,
                        '&:hover': { opacity: 1 }
                      }}>
                        <Typography variant="caption" sx={{ fontSize: '12px' }}>
                          ⬇️
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </Box>
              </Box>
            )}
            
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
            {/* File processing error display */}
            {fileProcessingError && (
              <Box sx={{ mb: 2, p: 1, bgcolor: 'warning.light', borderRadius: 1 }}>
                <Typography variant="caption" color="warning.dark">
                  ⚠️ {fileProcessingError}
                </Typography>
              </Box>
            )}

            {/* Attachments display - compact style like original */}
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
                  disabled={loading || !voskRecognition || isProcessingMic}
                  title={speechError || (isProcessingMic ? 'Processing...' : (isListening ? 'Stop dictation (Vosk)' : 'Start dictation (Vosk)'))}
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
                        {' '}and upload them using the "Manage Models" button in Settings.
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
                  accept="image/*,.pdf,.txt,.doc,.docx,.xls,.xlsx"
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
