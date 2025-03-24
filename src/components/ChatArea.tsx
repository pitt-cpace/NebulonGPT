import React, { useState, useRef, useEffect, useCallback } from 'react';
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
} from '@mui/icons-material';
import ReactMarkdown from 'react-markdown';
import { ModelType, ChatType, MessageType } from '../types';
import { getSuggestedPrompts } from '../services/api';

interface ChatAreaProps {
  chat: ChatType | null;
  model: ModelType | null;
  models: ModelType[];
  loading: boolean;
  onSendMessage: (content: string) => void;
  onStopResponse: () => void;
  onToggleSidebar: () => void;
  onSelectModel: (model: ModelType) => void;
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
}) => {
  const [message, setMessage] = useState('');
  const [modelMenuAnchor, setModelMenuAnchor] = useState<null | HTMLElement>(null);
  const [isListening, setIsListening] = useState(false);
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [interimTranscript, setInterimTranscript] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const finalTranscriptRef = useRef<string>('');
  const suggestedPrompts = getSuggestedPrompts();

  // Scroll to bottom when messages change
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chat?.messages]);

  // Initialize speech recognition - using browser's built-in local speech recognition
  useEffect(() => {
    // Check if the browser supports the Web Speech API
    // Note: This uses the browser's built-in speech recognition which is processed locally
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      console.warn('Local speech recognition is not supported in this browser.');
      setSpeechError('Local speech recognition not supported in this browser');
      return;
    }

    try {
      // Create a speech recognition instance
      const recognition = new SpeechRecognition();
      
      // Configure speech recognition to use local processing
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'en-US';
      
      // Set up event handlers
      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let interimTranscript = '';
        let finalTranscript = '';
        
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;
          if (event.results[i].isFinal) {
            finalTranscript += transcript;
          } else {
            interimTranscript += transcript;
          }
        }
        
        // Update the interim transcript for display
        setInterimTranscript(interimTranscript);
        
        // If we have a final transcript, update the message
        if (finalTranscript) {
          finalTranscriptRef.current += finalTranscript;
          setMessage(finalTranscriptRef.current);
        }
      };
      
      recognition.onend = () => {
        setIsListening(false);
        setInterimTranscript('');
      };
      
      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.error('Speech recognition error', event.error);
        setSpeechError(`Error: ${event.error}`);
        setIsListening(false);
      };
      
      // Store the recognition instance in the ref
      recognitionRef.current = recognition;
    } catch (error) {
      console.error('Error initializing speech recognition:', error);
      setSpeechError('Failed to initialize local speech recognition');
    }
    
    // Clean up on component unmount
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.onresult = null;
          recognitionRef.current.onend = null;
          recognitionRef.current.onerror = null;
          recognitionRef.current.abort();
        } catch (error) {
          console.error('Error cleaning up speech recognition:', error);
        }
      }
    };
  }, []);

  // Toggle speech recognition
  const toggleListening = useCallback(() => {
    if (!recognitionRef.current) {
      setSpeechError('Speech recognition not available');
      return;
    }
    
    setSpeechError(null); // Clear any previous errors
    
    if (isListening) {
      try {
        recognitionRef.current.stop();
      } catch (error) {
        console.error('Error stopping speech recognition:', error);
      }
      setIsListening(false);
      setInterimTranscript('');
    } else {
      try {
        // Reset the final transcript when starting a new recognition session
        finalTranscriptRef.current = message;
        recognitionRef.current.start();
        setIsListening(true);
      } catch (error) {
        console.error('Error starting speech recognition:', error);
        setSpeechError('Failed to start speech recognition');
      }
    }
  }, [isListening, message]);

  const handleSendMessage = () => {
    if (message.trim() && !loading) {
      onSendMessage(message);
      setMessage('');
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

  const handleSuggestedPrompt = (prompt: string) => {
    onSendMessage(prompt);
  };

  // Custom renderers for ReactMarkdown
  const markdownComponents = {
    // Override the default table renderer
    table: ({ node, children, ...props }: any) => (
      <TableContainer 
        component={Paper} 
        sx={{ 
          my: 3,
          backgroundColor: 'rgba(255, 255, 255, 0.05)',
          borderRadius: 2,
          overflow: 'hidden',
          boxShadow: '0 4px 8px rgba(0, 0, 0, 0.15)',
          width: '100%',
          maxWidth: '100%',
        }}
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
        sx={{ 
          backgroundColor: 'rgba(144, 202, 249, 0.1)',
        }} 
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
    tr: ({ node, children, isHeader, ...props }: any) => (
      <TableRow 
        sx={{ 
          '&:nth-of-type(odd)': { 
            backgroundColor: 'rgba(255, 255, 255, 0.02)' 
          },
          '&:hover': { 
            backgroundColor: 'rgba(255, 255, 255, 0.05)' 
          },
          transition: 'background-color 0.2s',
        }} 
        {...props}
      >
        {children}
      </TableRow>
    ),
    // Override the default th renderer
    th: ({ node, children, ...props }: any) => (
      <TableCell 
        component="th"
        align="left"
        sx={{ 
          fontWeight: 'bold', 
          borderBottom: '2px solid rgba(144, 202, 249, 0.3)',
          color: '#90caf9',
          py: 2,
          px: 2,
          whiteSpace: 'nowrap',
        }} 
        {...props}
      >
        {children}
      </TableCell>
    ),
    // Override the default td renderer
    td: ({ node, children, ...props }: any) => (
      <TableCell 
        align="left"
        sx={{ 
          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
          py: 1.5,
          px: 2,
        }} 
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
          sx={{
            backgroundColor: 'rgba(0, 0, 0, 0.3)',
            borderRadius: 2,
            p: 2,
            overflowX: 'auto',
            my: 2,
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
          }}
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
          sx={{
            backgroundColor: 'rgba(0, 0, 0, 0.2)',
            borderRadius: 1,
            px: 0.5,
            py: 0.25,
            fontFamily: 'monospace',
          }}
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
            sx={{ 
              my: 3,
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              borderRadius: 2,
              overflow: 'hidden',
              boxShadow: '0 4px 8px rgba(0, 0, 0, 0.15)',
              width: '100%',
            }}
          >
            <Table>
              <TableHead sx={{ backgroundColor: 'rgba(144, 202, 249, 0.1)' }}>
                <TableRow>
                  {headers.map((header, idx) => (
                    <TableCell 
                      key={idx}
                      sx={{ 
                        fontWeight: 'bold', 
                        borderBottom: '2px solid rgba(144, 202, 249, 0.3)',
                        color: '#90caf9',
                        py: 2,
                        px: 2,
                      }}
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
                    sx={{ 
                      '&:nth-of-type(odd)': { backgroundColor: 'rgba(0, 0, 0, 0.1)' },
                      '&:nth-of-type(even)': { backgroundColor: 'rgba(255, 255, 255, 0.02)' },
                      '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.05)' },
                    }}
                  >
                    {row.map((cell, cellIdx) => (
                      <TableCell 
                        key={cellIdx}
                        sx={{ 
                          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                          py: 1.5,
                          px: 2,
                        }}
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
            sx={{ 
              my: 3,
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              borderRadius: 2,
              overflow: 'hidden',
              boxShadow: '0 4px 8px rgba(0, 0, 0, 0.15)',
              width: '100%',
            }}
          >
            <Table>
              <TableHead sx={{ backgroundColor: 'rgba(144, 202, 249, 0.1)' }}>
                <TableRow>
                  {headers.map((header, idx) => (
                    <TableCell 
                      key={idx}
                      sx={{ 
                        fontWeight: 'bold', 
                        borderBottom: '2px solid rgba(144, 202, 249, 0.3)',
                        color: '#90caf9',
                        py: 2,
                        px: 2,
                      }}
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
                    sx={{ 
                      '&:nth-of-type(odd)': { backgroundColor: 'rgba(0, 0, 0, 0.1)' },
                      '&:nth-of-type(even)': { backgroundColor: 'rgba(255, 255, 255, 0.02)' },
                      '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.05)' },
                    }}
                  >
                    {row.map((cell, cellIdx) => (
                      <TableCell 
                        key={cellIdx}
                        sx={{ 
                          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                          py: 1.5,
                          px: 2,
                        }}
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
            sx={{ 
              my: 3,
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              borderRadius: 2,
              overflow: 'hidden',
              boxShadow: '0 4px 8px rgba(0, 0, 0, 0.15)',
              width: '100%',
            }}
          >
            <Table>
              <TableHead sx={{ backgroundColor: 'rgba(144, 202, 249, 0.1)' }}>
                <TableRow>
                  {headers.map((header, idx) => (
                    <TableCell 
                      key={idx}
                      sx={{ 
                        fontWeight: 'bold', 
                        borderBottom: '2px solid rgba(144, 202, 249, 0.3)',
                        color: '#90caf9',
                        py: 2,
                        px: 2,
                      }}
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
                    sx={{ 
                      '&:nth-of-type(odd)': { backgroundColor: 'rgba(0, 0, 0, 0.1)' },
                      '&:nth-of-type(even)': { backgroundColor: 'rgba(255, 255, 255, 0.02)' },
                      '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.05)' },
                    }}
                  >
                    {row.map((cell, cellIdx) => (
                      <TableCell 
                        key={cellIdx}
                        sx={{ 
                          borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                          py: 1.5,
                          px: 2,
                        }}
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
        sx={{ 
          my: 3,
          backgroundColor: 'rgba(255, 255, 255, 0.05)',
          borderRadius: 2,
          overflow: 'hidden',
          boxShadow: '0 4px 8px rgba(0, 0, 0, 0.15)',
          width: '100%',
        }}
      >
        <Table>
          <TableHead sx={{ backgroundColor: 'rgba(144, 202, 249, 0.1)' }}>
            <TableRow>
              {headers.map((header, idx) => (
                <TableCell 
                  key={idx}
                  sx={{ 
                    fontWeight: 'bold', 
                    borderBottom: '2px solid rgba(144, 202, 249, 0.3)',
                    color: '#90caf9',
                    py: 2,
                    px: 2,
                  }}
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
                sx={{ 
                  '&:nth-of-type(odd)': { backgroundColor: 'rgba(0, 0, 0, 0.1)' },
                  '&:nth-of-type(even)': { backgroundColor: 'rgba(255, 255, 255, 0.02)' },
                  '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.05)' },
                }}
              >
                {row.map((cell, cellIdx) => (
                  <TableCell 
                    key={cellIdx}
                    sx={{ 
                      borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                      py: 1.5,
                      px: 2,
                    }}
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
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          mb: 2,
          maxWidth: '100%',
        }}
      >
        <Box
          sx={{
            display: 'flex',
            p: 2,
            borderRadius: 2,
            backgroundColor: isUser ? 'rgba(144, 202, 249, 0.08)' : 'rgba(255, 255, 255, 0.05)',
            maxWidth: '100%',
            width: '100%',
          }}
        >
          <Box sx={{ width: '100%' }}>
            <Typography
              variant="body1"
              component="div"
              className="markdown-content"
              sx={{ wordBreak: 'break-word' }}
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
          </Box>
        </Box>
      </Box>
    );
  };

  return (
    <Box
      component="main"
      sx={{
        flexGrow: 1,
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
      }}
    >
      <AppBar
        position="static"
        color="transparent"
        elevation={0}
        sx={{ borderBottom: '1px solid #333' }}
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
              textTransform: 'none',
              color: 'white',
              fontWeight: 'normal',
            }}
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
          >
            Set as default
          </Typography>

          <Box sx={{ flexGrow: 1 }} />
        </Toolbar>
      </AppBar>

      {!chat ? (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            flexGrow: 1,
            p: 3,
          }}
        >
          <Box sx={{ textAlign: 'center', mb: 4 }}>
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

          <Typography variant="h6" gutterBottom sx={{ alignSelf: 'flex-start', mb: 2 }}>
            <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Box component="span" sx={{ opacity: 0.6 }}>✨</Box> Suggested
            </Box>
          </Typography>

          <Grid container spacing={2}>
            {suggestedPrompts.map((prompt, index) => (
              <Grid item xs={12} key={index}>
                <Card 
                  variant="outlined" 
                  sx={{ 
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                  }}
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
            sx={{
              flexGrow: 1,
              p: 3,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            {chat.messages.map(renderMessage)}
            <div ref={messagesEndRef} />
          </Box>

          <Box
            component={Paper}
            elevation={0}
            sx={{
              p: 2,
              borderTop: '1px solid #333',
              backgroundColor: 'background.paper',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center' }}>
              <Box sx={{ position: 'relative' }}>
                <IconButton 
                  size="small" 
                  sx={{ 
                    mr: 1,
                    color: isListening ? 'error.main' : (speechError ? 'warning.main' : 'inherit'),
                    animation: isListening ? 'pulse 1.5s infinite' : 'none',
                    '@keyframes pulse': {
                      '0%': { opacity: 1 },
                      '50%': { opacity: 0.5 },
                      '100%': { opacity: 1 },
                    },
                  }}
                  onClick={toggleListening}
                  disabled={loading || !recognitionRef.current}
                  title={speechError || (isListening ? 'Stop dictation' : 'Start dictation')}
                >
                  <MicIcon />
                </IconButton>
                {speechError && (
                  <Typography 
                    variant="caption" 
                    color="warning.main" 
                    sx={{ 
                      position: 'absolute', 
                      bottom: -20, 
                      left: 0, 
                      whiteSpace: 'nowrap',
                      fontSize: '0.7rem'
                    }}
                  >
                    {speechError}
                  </Typography>
                )}
              </Box>
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
                  sx: {
                    borderRadius: 4,
                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                    '&:hover': {
                      backgroundColor: 'rgba(255, 255, 255, 0.08)',
                    },
                  },
                  endAdornment: isListening && interimTranscript ? (
                    <Box 
                      sx={{ 
                        position: 'absolute',
                        bottom: '100%',
                        left: 0,
                        right: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.7)',
                        color: 'rgba(255, 255, 255, 0.7)',
                        padding: '8px 12px',
                        borderRadius: '4px',
                        fontSize: '0.85rem',
                        maxWidth: '100%',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        zIndex: 10,
                      }}
                    >
                      {interimTranscript}
                    </Box>
                  ) : null,
                }}
                variant="outlined"
              />
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
                  disabled={!message.trim()}
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
