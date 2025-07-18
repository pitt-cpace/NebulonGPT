import axios from 'axios';
import { ModelType, MessageType } from '../types';

// Helper function to format file sizes
const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

// Universal JSON search function - like "Find in Page" for JSON objects
const searchJsonObjects = (jsonArray: any[], keywords: string): any[] => {
  const results: any[] = [];
  const searchTerms = keywords.toLowerCase().split(/\s+/).filter(term => term.length > 0);
  
  const objectContainsKeywords = (obj: any): boolean => {
    if (typeof obj === 'string') {
      const lowerStr = obj.toLowerCase();
      return searchTerms.some(term => lowerStr.includes(term));
    } else if (typeof obj === 'number') {
      const numStr = obj.toString();
      return searchTerms.some(term => numStr.includes(term));
    } else if (Array.isArray(obj)) {
      return obj.some(item => objectContainsKeywords(item));
    } else if (typeof obj === 'object' && obj !== null) {
      return Object.values(obj).some(value => objectContainsKeywords(value));
    }
    return false;
  };

  for (const item of jsonArray) {
    if (objectContainsKeywords(item)) {
      results.push(item);
    }
  }

  return results;
};

// Extract search keywords from user message
const extractSearchKeywords = (message: string): string | null => {
  // Remove common words AND generic document terms, keep meaningful search terms
  const cleanMessage = message
    .toLowerCase()
    .replace(/\b(?:explain|show|tell|me|about|the|only|just|specifically|please|can|you|what|is|are|this|that|these|those|chart|table|document|pdf|file)\b/g, '')
    .replace(/[^\w\s]/g, ' ')
    .trim();
  
  if (cleanMessage.length > 0) {
    return cleanMessage;
  }
  
  return null;
};


// Configure axios with base URL for Ollama API
const baseURL = 'http://localhost:11434/api';

const api = axios.create({
  baseURL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Helper function to get the correct API base URL for file operations
const getFileApiBaseUrl = (): string => {
  // In both development and production, use relative URLs
  // Development: React dev server proxy will forward to localhost:3001
  // Production: nginx will proxy to the backend
  return '/api';
};

// Fetch available models
export const fetchModels = async (): Promise<ModelType[]> => {
  try {
    const endpoint = '/tags';
    const response = await api.get(endpoint);
    
    if (response.data && response.data.models && response.data.models.length > 0) {
      const models = response.data.models.map((model: any) => ({
        id: model.name,
        name: model.name,
        size: model.size,
        quantization: model.name.includes('q') ? model.name.split('-').pop() : undefined,
        isDefault: false,
      }));
      return models;
    }
    
    // If no models are available, return empty array
    console.warn('No models found in Ollama API response');
    console.warn('Response data:', response.data);
    return [];
  } catch (error: any) {
    console.error('Error fetching models from Ollama API:', error);
    console.error('Base URL:', baseURL);
    console.error('Full URL:', `${baseURL}/tags`);
    
    // Check if it's a connection error
    if (error.code === 'ECONNREFUSED' || error.message?.includes('Network Error')) {
      console.error('Cannot connect to Ollama API. Please ensure Ollama is running and accessible.');
    }
    
    // Log more details about the error
    if (error.response) {
      console.error('Error response status:', error.response.status);
      console.error('Error response data:', error.response.data);
    }
    
    // Return empty array instead of mock data
    return [];
  }
};

// Variable to store the current reader for cancellation
let currentReader: ReadableStreamDefaultReader<Uint8Array> | null = null;

// Function to cancel the current stream
export const cancelStream = async (): Promise<void> => {
  if (currentReader) {
    try {
      await currentReader.cancel('User cancelled the response');
      currentReader = null;
    } catch (error) {
      console.error('Error cancelling stream:', error);
    }
  }
};

// Send a message to the model and get a response
export const sendMessage = async (
  modelId: string,
  messages: MessageType[],
  options?: Record<string, any>,
  onStreamUpdate?: (chunk: string) => void
): Promise<string> => {
  try {
    // Collect all attachments from the conversation for context
    const allAttachments = new Map<string, any>();
    
    // First pass: collect all attachments from all messages in the conversation
    messages.forEach(msg => {
      if (msg.attachments && msg.attachments.length > 0) {
        msg.attachments.forEach(attachment => {
          allAttachments.set(attachment.id, {
            ...attachment,
            messageId: msg.id,
            messageRole: msg.role,
            messageTimestamp: msg.timestamp
          });
        });
      }
    });
    
    // Process messages to include file attachments with full conversation context
    const formattedMessages = await Promise.all(messages.map(async (msg, index) => {
      let enhancedContent = msg.content;
      const messageImages: string[] = [];
      
      // If this is the first message in the conversation and there are attachments anywhere,
      // include a context summary of all available files
      if (index === 0 && allAttachments.size > 0) {
        const attachmentSummary = Array.from(allAttachments.values())
          .map(att => `- ${att.name} (${att.type}, ${formatFileSize(att.size)}, uploaded ${new Date(att.timestamp).toLocaleString()})`)
          .join('\n');
        
        enhancedContent = `[CONTEXT: Files available in this conversation:\n${attachmentSummary}]\n\n${enhancedContent}`;
      }
      
      // If the current message has attachments, handle them appropriately
      if (msg.attachments && msg.attachments.length > 0) {
        // Process each attachment in the current message
        for (const attachment of msg.attachments) {
          // Handle text, document, and PDF attachments by including their content in the message
          if ((attachment.type === 'text' || attachment.type === 'document' || attachment.type === 'pdf') && attachment.content) {
            enhancedContent += `\n\n--- File: ${attachment.name} (Size: ${formatFileSize(attachment.size)}, Type: ${attachment.type}) ---\n${attachment.content}\n--- End of ${attachment.name} ---\n`;
          }
          
          // Handle file references - fetch content from server if needed
          if (attachment.type !== 'image') {
            let contentFileId = attachment.fileId;
            
            // For PDFs, use the extracted content file ID if available
            if (attachment.type === 'pdf' && attachment.metadata?.extractedContentFileId) {
              contentFileId = attachment.metadata.extractedContentFileId;
              console.log(`📁 PDF found: ${attachment.name} - using extracted content file: ${contentFileId}`);
            }
            
            // For Office documents, use the extracted content file ID if available
            if (['docx', 'doc', 'xlsx', 'xls'].includes(attachment.type) && attachment.metadata?.extractedContentFileId) {
              contentFileId = attachment.metadata.extractedContentFileId;
              console.log(`📁 Office document found: ${attachment.name} - using extracted content file: ${contentFileId}`);
            }
            
            if (contentFileId && !attachment.content) {
              console.log(`📁 File reference found: ${attachment.name} (${contentFileId}) - fetching content from server`);
              try {
                const response = await fetch(`${getFileApiBaseUrl()}/files/${contentFileId}`);
                if (response.ok) {
                  const fileContent = await response.text();
                  console.log(`✅ File content fetched from server: ${attachment.name} (${fileContent.length} characters)`);
                  enhancedContent += `\n\n--- File: ${attachment.name} (Size: ${formatFileSize(attachment.size)}, Type: ${attachment.type}) ---\n${fileContent}\n--- End of ${attachment.name} ---\n`;
                } else {
                  console.warn(`⚠️ Could not fetch file content from server: ${response.status}`);
                  enhancedContent += `\n\n--- File Reference: ${attachment.name} (Size: ${formatFileSize(attachment.size)}, Type: ${attachment.type}, ID: ${contentFileId}) ---\n[File content could not be retrieved from server]\n--- End of ${attachment.name} ---\n`;
                }
              } catch (fetchError) {
                console.error(`❌ Error fetching file content:`, fetchError);
                enhancedContent += `\n\n--- File Reference: ${attachment.name} (Size: ${formatFileSize(attachment.size)}, Type: ${attachment.type}, ID: ${contentFileId}) ---\n[Error retrieving file content from server]\n--- End of ${attachment.name} ---\n`;
              }
            }
          }
          
          // Collect image attachments for this message
          if (attachment.type === 'image') {
            if (attachment.content) {
              // Image has base64 content stored locally - use it directly
              const base64Data = attachment.content.split(',')[1];
              if (base64Data) {
                messageImages.push(base64Data);
                console.log(`✅ Using stored image content: ${attachment.name} (${Math.round(base64Data.length * 3 / 4 / 1024)}KB)`);
              }
            } else if (attachment.fileId) {
              // Image only has file ID - fetch from server
              console.log(`📁 Fetching image from server: ${attachment.fileId}`);
              try {
                const response = await fetch(`${getFileApiBaseUrl()}/files/${attachment.fileId}`);
                if (response.ok) {
                  const blob = await response.blob();
                  
                  // Convert blob to base64
                  const reader = new FileReader();
                  const base64Promise = new Promise<string>((resolve, reject) => {
                    reader.onload = () => {
                      const result = reader.result as string;
                      const base64Data = result.split(',')[1];
                      resolve(base64Data);
                    };
                    reader.onerror = reject;
                  });
                  
                  reader.readAsDataURL(blob);
                  const base64Data = await base64Promise;
                  
                  messageImages.push(base64Data);
                  console.log(`✅ Fetched image from server: ${attachment.name} (${Math.round(base64Data.length * 3 / 4 / 1024)}KB)`);
                } else {
                  console.warn(`⚠️ Could not fetch image from server: ${response.status} for ${attachment.fileId}`);
                }
              } catch (fetchError) {
                console.error(`❌ Error fetching image ${attachment.fileId}:`, fetchError);
              }
            }
          }
          
          // Handle PDF images - extract images from PDF attachments
          if (attachment.type === 'pdf' && attachment.imageFileIds && attachment.imageFileIds.length > 0) {
            console.log(`📸 Processing ${attachment.imageFileIds.length} images from PDF: ${attachment.name}`);
            
            for (let imgIndex = 0; imgIndex < attachment.imageFileIds.length; imgIndex++) {
              const imageRef = attachment.imageFileIds[imgIndex];
              
              if (imageRef) {
                if (typeof imageRef === 'string') {
                  // Legacy format: string (either data URL or file ID)
                  if (imageRef.startsWith('data:image/')) {
                    // Handle data URL (legacy format)
                    const base64Data = imageRef.split(',')[1];
                    if (base64Data) {
                      messageImages.push(base64Data);
                      console.log(`✅ Added PDF image ${imgIndex + 1} from ${attachment.name} (legacy data URL, ${Math.round(base64Data.length * 3 / 4 / 1024)}KB)`);
                    }
                  } else {
                    // Handle file ID - fetch from server
                    console.log(`📁 Fetching PDF image ${imgIndex + 1} from server: ${imageRef}`);
                    try {
                      const response = await fetch(`${getFileApiBaseUrl()}/files/${imageRef}`);
                      if (response.ok) {
                        const blob = await response.blob();
                        
                        // Convert blob to base64
                        const reader = new FileReader();
                        const base64Promise = new Promise<string>((resolve, reject) => {
                          reader.onload = () => {
                            const result = reader.result as string;
                            const base64Data = result.split(',')[1];
                            resolve(base64Data);
                          };
                          reader.onerror = reject;
                        });
                        
                        reader.readAsDataURL(blob);
                        const base64Data = await base64Promise;
                        
                        messageImages.push(base64Data);
                        console.log(`✅ Added PDF image ${imgIndex + 1} from ${attachment.name} (legacy server file, ${Math.round(base64Data.length * 3 / 4 / 1024)}KB)`);
                      } else {
                        console.warn(`⚠️ Could not fetch PDF image from server: ${response.status} for ${imageRef}`);
                      }
                    } catch (fetchError) {
                      console.error(`❌ Error fetching PDF image ${imageRef}:`, fetchError);
                    }
                  }
                } else if (typeof imageRef === 'object') {
                  // New format: object with fileId and/or content
                  if (imageRef.content) {
                    // Use stored base64 content directly
                    const base64Data = imageRef.content.split(',')[1];
                    if (base64Data) {
                      messageImages.push(base64Data);
                      console.log(`✅ Added PDF image ${imgIndex + 1} from ${attachment.name} (stored content, ${Math.round(base64Data.length * 3 / 4 / 1024)}KB)`);
                    }
                  } else if (imageRef.fileId) {
                    // Fallback to server fetch
                    console.log(`📁 Fetching PDF image ${imgIndex + 1} from server: ${imageRef.fileId}`);
                    try {
                      const response = await fetch(`${getFileApiBaseUrl()}/files/${imageRef.fileId}`);
                      if (response.ok) {
                        const blob = await response.blob();
                        
                        // Convert blob to base64
                        const reader = new FileReader();
                        const base64Promise = new Promise<string>((resolve, reject) => {
                          reader.onload = () => {
                            const result = reader.result as string;
                            const base64Data = result.split(',')[1];
                            resolve(base64Data);
                          };
                          reader.onerror = reject;
                        });
                        
                        reader.readAsDataURL(blob);
                        const base64Data = await base64Promise;
                        
                        messageImages.push(base64Data);
                        console.log(`✅ Added PDF image ${imgIndex + 1} from ${attachment.name} (server file, ${Math.round(base64Data.length * 3 / 4 / 1024)}KB)`);
                      } else {
                        console.warn(`⚠️ Could not fetch PDF image from server: ${response.status} for ${imageRef.fileId}`);
                      }
                    } catch (fetchError) {
                      console.error(`❌ Error fetching PDF image ${imageRef.fileId}:`, fetchError);
                    }
                  }
                }
              }
            }
          }
          
          // Handle Office document images - extract images from Office attachments
          if (['docx', 'doc', 'xlsx', 'xls'].includes(attachment.type) && attachment.imageFileIds && attachment.imageFileIds.length > 0) {
            console.log(`📸 Processing ${attachment.imageFileIds.length} images from Office document: ${attachment.name}`);
            
            for (let imgIndex = 0; imgIndex < attachment.imageFileIds.length; imgIndex++) {
              const imageRef = attachment.imageFileIds[imgIndex];
              
              if (imageRef) {
                if (typeof imageRef === 'string') {
                  // Legacy format: string (either data URL or file ID)
                  if (imageRef.startsWith('data:image/')) {
                    // Handle data URL (legacy format)
                    const base64Data = imageRef.split(',')[1];
                    if (base64Data) {
                      messageImages.push(base64Data);
                      console.log(`✅ Added Office image ${imgIndex + 1} from ${attachment.name} (legacy data URL, ${Math.round(base64Data.length * 3 / 4 / 1024)}KB)`);
                    }
                  } else {
                    // Handle file ID - fetch from server
                    console.log(`📁 Fetching Office image ${imgIndex + 1} from server: ${imageRef}`);
                    try {
                    const response = await fetch(`${getFileApiBaseUrl()}/files/${imageRef}`);
                      if (response.ok) {
                        const blob = await response.blob();
                        
                        // Convert blob to base64
                        const reader = new FileReader();
                        const base64Promise = new Promise<string>((resolve, reject) => {
                          reader.onload = () => {
                            const result = reader.result as string;
                            const base64Data = result.split(',')[1];
                            resolve(base64Data);
                          };
                          reader.onerror = reject;
                        });
                        
                        reader.readAsDataURL(blob);
                        const base64Data = await base64Promise;
                        
                        messageImages.push(base64Data);
                        console.log(`✅ Added Office image ${imgIndex + 1} from ${attachment.name} (legacy server file, ${Math.round(base64Data.length * 3 / 4 / 1024)}KB)`);
                      } else {
                        console.warn(`⚠️ Could not fetch Office image from server: ${response.status} for ${imageRef}`);
                      }
                    } catch (fetchError) {
                      console.error(`❌ Error fetching Office image ${imageRef}:`, fetchError);
                    }
                  }
                } else if (typeof imageRef === 'object') {
                  // New format: object with fileId and/or content
                  if (imageRef.content) {
                    // Use stored base64 content directly
                    const base64Data = imageRef.content.split(',')[1];
                    if (base64Data) {
                      messageImages.push(base64Data);
                      console.log(`✅ Added Office image ${imgIndex + 1} from ${attachment.name} (stored content, ${Math.round(base64Data.length * 3 / 4 / 1024)}KB)`);
                    }
                  } else if (imageRef.fileId) {
                    // Fallback to server fetch
                    console.log(`📁 Fetching Office image ${imgIndex + 1} from server: ${imageRef.fileId}`);
                    try {
                      const response = await fetch(`${getFileApiBaseUrl()}/files/${imageRef.fileId}`);
                      if (response.ok) {
                        const blob = await response.blob();
                        
                        // Convert blob to base64
                        const reader = new FileReader();
                        const base64Promise = new Promise<string>((resolve, reject) => {
                          reader.onload = () => {
                            const result = reader.result as string;
                            const base64Data = result.split(',')[1];
                            resolve(base64Data);
                          };
                          reader.onerror = reject;
                        });
                        
                        reader.readAsDataURL(blob);
                        const base64Data = await base64Promise;
                        
                        messageImages.push(base64Data);
                        console.log(`✅ Added Office image ${imgIndex + 1} from ${attachment.name} (server file, ${Math.round(base64Data.length * 3 / 4 / 1024)}KB)`);
                      } else {
                        console.warn(`⚠️ Could not fetch Office image from server: ${response.status} for ${imageRef.fileId}`);
                      }
                    } catch (fetchError) {
                      console.error(`❌ Error fetching Office image ${imageRef.fileId}:`, fetchError);
                    }
                  }
                }
              }
            }
          }
          
          // Handle PDF tables - add table information to content (LLM will handle filtering)
          if (attachment.type === 'pdf' && attachment.metadata?.tables && attachment.metadata.tables.length > 0) {
            console.log(`📊 Processing ${attachment.metadata.tables.length} tables from PDF: ${attachment.name}`);
            let tableContent = `\n\n=== Tables from ${attachment.name} ===\n`;
            attachment.metadata.tables.forEach((table: any, tableIndex: number) => {
              tableContent += `Table ${tableIndex + 1} (Page ${table.pageNumber}):\n`;
              if (table.structure?.hasHeaders && table.content.length > 0) {
                // Format with headers
                const headers = table.content[0];
                const rows = table.content.slice(1);
                tableContent += `Headers: ${headers.join(' | ')}\n`;
                rows.forEach((row: string[], rowIndex: number) => {
                  tableContent += `Row ${rowIndex + 1}: ${row.join(' | ')}\n`;
                });
              } else {
                // Format without headers
                table.content.forEach((row: string[], rowIndex: number) => {
                  tableContent += `Row ${rowIndex + 1}: ${row.join(' | ')}\n`;
                });
              }
              tableContent += `Position: x=${table.position.x}, y=${table.position.y}, w=${table.position.width}, h=${table.position.height}\n\n`;
            });
            enhancedContent += tableContent;
            console.log(`✅ Added ${attachment.metadata.tables.length} tables from ${attachment.name}`);
          }
          
          // UNIVERSAL JSON SEARCH: "Find in Page" style search across all document data
          if (attachment.type === 'pdf' && attachment.metadata?.charts && attachment.metadata.charts.length > 0) {
            
            // Extract search keywords from user message
            const searchKeywords = extractSearchKeywords(msg.content);
            
            if (searchKeywords) {
              console.log(`🔍 Universal JSON search detected for: "${searchKeywords}"`);
              
              // Create structured JSON for searching
              const allCharts = attachment.metadata.charts.map((chart: any, index: number) => ({
                id: `chart-${index + 1}`,
                figureNumber: index + 1,
                title: chart.chartData.title || `Chart ${index + 1}`,
                type: chart.chartData.type,
                pageNumber: chart.pageNumber,
                labels: chart.chartData.labels || [],
                values: chart.chartData.values || [],
                position: chart.position,
                hasImage: !!chart.content,
                content: chart.content,
                // Include all chart metadata for deep search
                chartData: chart.chartData
              }));
              
              const allTables = (attachment.metadata.tables || []).map((table: any, index: number) => ({
                id: `table-${index + 1}`,
                tableNumber: index + 1,
                pageNumber: table.pageNumber,
                headers: table.structure?.hasHeaders ? table.content[0] : [],
                rows: table.structure?.hasHeaders ? table.content.slice(1) : table.content,
                position: table.position,
                // Include all table data for deep search
                content: table.content,
                structure: table.structure
              }));
              
              // Search through charts and tables
              const matchingCharts = searchJsonObjects(allCharts, searchKeywords);
              const matchingTables = searchJsonObjects(allTables, searchKeywords);
              
              if (matchingCharts.length > 0 || matchingTables.length > 0) {
                console.log(`🎯 Found ${matchingCharts.length} matching charts and ${matchingTables.length} matching tables`);
                
                // Create focused content with only matching items
                let searchContent = `\n\n=== SEARCH RESULTS FOR: "${searchKeywords}" ===\n`;
                searchContent += `User Request: "${msg.content}"\n\n`;
                searchContent += `SEARCH INSTRUCTIONS:\n`;
                searchContent += `- Below are the ONLY items that match your search criteria\n`;
                searchContent += `- Focus EXCLUSIVELY on these matching items\n`;
                searchContent += `- Do NOT reference any other charts, tables, or content\n`;
                searchContent += `- Provide detailed analysis of the matching content only\n\n`;
                
                // Add matching charts
                if (matchingCharts.length > 0) {
                  searchContent += `MATCHING CHARTS (${matchingCharts.length} found):\n`;
                  searchContent += `${JSON.stringify(matchingCharts, null, 2)}\n\n`;
                  
                  // Add images for matching charts
                  for (const matchingChart of matchingCharts) {
                    if (matchingChart.content && typeof matchingChart.content === 'string') {
                      if (matchingChart.content.startsWith('data:image/')) {
                        const base64Data = matchingChart.content.split(',')[1];
                        if (base64Data) {
                          messageImages.push(base64Data);
                          console.log(`🔍 Added matching chart image ${matchingChart.figureNumber} (${Math.round(base64Data.length * 3 / 4 / 1024)}KB)`);
                        }
                      } else {
                        try {
                          const response = await fetch(`${getFileApiBaseUrl()}/files/${matchingChart.content}`);
                          if (response.ok) {
                            const blob = await response.blob();
                            const reader = new FileReader();
                            const base64Promise = new Promise<string>((resolve, reject) => {
                              reader.onload = () => {
                                const result = reader.result as string;
                                const base64Data = result.split(',')[1];
                                resolve(base64Data);
                              };
                              reader.onerror = reject;
                            });
                            
                            reader.readAsDataURL(blob);
                            const base64Data = await base64Promise;
                            
                            messageImages.push(base64Data);
                            console.log(`🔍 Added matching chart image ${matchingChart.figureNumber} (server file, ${Math.round(base64Data.length * 3 / 4 / 1024)}KB)`);
                          }
                        } catch (fetchError) {
                          console.error(`❌ Error fetching matching chart image:`, fetchError);
                        }
                      }
                    }
                  }
                }
                
                // Add matching tables
                if (matchingTables.length > 0) {
                  searchContent += `MATCHING TABLES (${matchingTables.length} found):\n`;
                  searchContent += `${JSON.stringify(matchingTables, null, 2)}\n\n`;
                }
                
                searchContent += `=== END SEARCH RESULTS ===\n\n`;
                enhancedContent += searchContent;
                
                console.log(`🔍 Universal search completed: ${matchingCharts.length} charts + ${matchingTables.length} tables matched "${searchKeywords}"`);
                
              } else {
                // No matches found
                let noMatchContent = `\n\n=== NO SEARCH RESULTS FOUND ===\n`;
                noMatchContent += `Search Query: "${searchKeywords}"\n`;
                noMatchContent += `User Request: "${msg.content}"\n\n`;
                noMatchContent += `No charts or tables found matching your search criteria.\n`;
                noMatchContent += `Available content:\n`;
                noMatchContent += `- Total Charts: ${attachment.metadata.charts.length}\n`;
                noMatchContent += `- Total Tables: ${attachment.metadata.tables?.length || 0}\n\n`;
                noMatchContent += `Try searching for different keywords or ask about the document in general.\n`;
                noMatchContent += `=== END NO RESULTS ===\n\n`;
                
                enhancedContent += noMatchContent;
                console.log(`🔍 No matches found for "${searchKeywords}" in ${attachment.metadata.charts.length} charts and ${attachment.metadata.tables?.length || 0} tables`);
              }
              
            } else {
              // NORMAL PROCESSING: Include all charts with structured format
              console.log(`📈 Processing ${attachment.metadata.charts.length} charts from PDF: ${attachment.name}`);
              let chartContent = `\n\n=== Charts from ${attachment.name} ===\n`;
              
              for (let chartIndex = 0; chartIndex < attachment.metadata.charts.length; chartIndex++) {
                const chart = attachment.metadata.charts[chartIndex];
                chartContent += `Chart ${chartIndex + 1} (Page ${chart.pageNumber}):\n`;
                chartContent += `Type: ${chart.chartData.type}\n`;
                if (chart.chartData.title) {
                  chartContent += `Title: ${chart.chartData.title}\n`;
                }
                if (chart.chartData.labels && chart.chartData.labels.length > 0) {
                  chartContent += `Labels: ${chart.chartData.labels.join(', ')}\n`;
                }
                if (chart.chartData.values && chart.chartData.values.length > 0) {
                  chartContent += `Values: ${chart.chartData.values.join(', ')}\n`;
                }
                chartContent += `Position: x=${chart.position.x}, y=${chart.position.y}, w=${chart.position.width}, h=${chart.position.height}\n`;
                
                // Add chart image if available
                if (chart.content && typeof chart.content === 'string') {
                  if (chart.content.startsWith('data:image/')) {
                    const base64Data = chart.content.split(',')[1];
                    if (base64Data) {
                      messageImages.push(base64Data);
                      console.log(`✅ Added chart image ${chartIndex + 1} from ${attachment.name} (data URL, ${Math.round(base64Data.length * 3 / 4 / 1024)}KB)`);
                      chartContent += `[Chart image included in visual analysis]\n`;
                    }
                  } else {
                    console.log(`📁 Fetching chart image ${chartIndex + 1} from server: ${chart.content}`);
                    try {
                      const response = await fetch(`${getFileApiBaseUrl()}/files/${chart.content}`);
                      if (response.ok) {
                        const blob = await response.blob();
                        
                        const reader = new FileReader();
                        const base64Promise = new Promise<string>((resolve, reject) => {
                          reader.onload = () => {
                            const result = reader.result as string;
                            const base64Data = result.split(',')[1];
                            resolve(base64Data);
                          };
                          reader.onerror = reject;
                        });
                        
                        reader.readAsDataURL(blob);
                        const base64Data = await base64Promise;
                        
                        messageImages.push(base64Data);
                        console.log(`✅ Added chart image ${chartIndex + 1} from ${attachment.name} (server file, ${Math.round(base64Data.length * 3 / 4 / 1024)}KB)`);
                        chartContent += `[Chart image included in visual analysis]\n`;
                      } else {
                        console.warn(`⚠️ Could not fetch chart image from server: ${response.status} for ${chart.content}`);
                      }
                    } catch (fetchError) {
                      console.error(`❌ Error fetching chart image ${chart.content}:`, fetchError);
                    }
                  }
                }
                chartContent += '\n';
              }
              
              enhancedContent += chartContent;
              console.log(`✅ Added ${attachment.metadata.charts.length} charts from ${attachment.name}`);
            }
          }
        }
      }
      
      // ALWAYS include ALL previously uploaded files in EVERY user message (follow-up or not)
      if (msg.role === 'user' && 
          allAttachments.size > 0 && 
          index > 0) {
        
        console.log(`📁 Follow-up message detected - including all ${allAttachments.size} files from conversation`);
        
        // Include ALL file contents from the conversation in follow-up messages
        for (const attachment of Array.from(allAttachments.values())) {
          // Skip if this attachment was already processed in current message
          if (msg.attachments?.some(att => att.id === attachment.id)) {
            continue;
          }
          
          // Handle file content inclusion
          if (attachment.type !== 'image') {
            let contentFileId = attachment.fileId;
            
            // For PDFs, use the extracted content file ID if available
            if (attachment.type === 'pdf' && attachment.metadata?.extractedContentFileId) {
              contentFileId = attachment.metadata.extractedContentFileId;
              console.log(`📁 Including PDF content: ${attachment.name} - using extracted content file: ${contentFileId}`);
            }
            
            // For Office documents, use the extracted content file ID if available
            if (['docx', 'doc', 'xlsx', 'xls'].includes(attachment.type) && attachment.metadata?.extractedContentFileId) {
              contentFileId = attachment.metadata.extractedContentFileId;
              console.log(`📁 Including Office document content: ${attachment.name} - using extracted content file: ${contentFileId}`);
            }
            
            // Fetch and include file content
            if (contentFileId) {
              try {
                const response = await fetch(`${getFileApiBaseUrl()}/files/${contentFileId}`);
                if (response.ok) {
                  const fileContent = await response.text();
                  console.log(`✅ Included file content in follow-up: ${attachment.name} (${fileContent.length} characters)`);
                  enhancedContent += `\n\n--- File: ${attachment.name} (Size: ${formatFileSize(attachment.size)}, Type: ${attachment.type}) ---\n${fileContent}\n--- End of ${attachment.name} ---\n`;
                } else {
                  console.warn(`⚠️ Could not fetch file content for follow-up: ${response.status}`);
                  enhancedContent += `\n\n--- File Reference: ${attachment.name} (Size: ${formatFileSize(attachment.size)}, Type: ${attachment.type}) ---\n[File content could not be retrieved]\n--- End of ${attachment.name} ---\n`;
                }
              } catch (fetchError) {
                console.error(`❌ Error fetching file content for follow-up:`, fetchError);
                enhancedContent += `\n\n--- File Reference: ${attachment.name} (Size: ${formatFileSize(attachment.size)}, Type: ${attachment.type}) ---\n[Error retrieving file content]\n--- End of ${attachment.name} ---\n`;
              }
            } else if (attachment.content) {
              // Use stored content if available
              console.log(`✅ Using stored content for follow-up: ${attachment.name}`);
              enhancedContent += `\n\n--- File: ${attachment.name} (Size: ${formatFileSize(attachment.size)}, Type: ${attachment.type}) ---\n${attachment.content}\n--- End of ${attachment.name} ---\n`;
            }
          }
          
          // Handle images from previous messages
          if (attachment.type === 'image' && attachment.content) {
            const base64Data = attachment.content.split(',')[1];
            if (base64Data) {
              messageImages.push(base64Data);
              console.log(`✅ Included image in follow-up: ${attachment.name}`);
            }
          }
          
          // Handle PDF images from previous messages
          if (attachment.type === 'pdf' && attachment.imageFileIds && attachment.imageFileIds.length > 0) {
            console.log(`📸 Including ${attachment.imageFileIds.length} PDF images in follow-up: ${attachment.name}`);
            
            for (let imgIndex = 0; imgIndex < attachment.imageFileIds.length; imgIndex++) {
              const imageRef = attachment.imageFileIds[imgIndex];
              
              if (imageRef && typeof imageRef === 'string') {
                if (imageRef.startsWith('data:image/')) {
                  const base64Data = imageRef.split(',')[1];
                  if (base64Data) {
                    messageImages.push(base64Data);
                    console.log(`✅ Included PDF image ${imgIndex + 1} in follow-up (data URL)`);
                  }
                } else {
                  try {
                    const response = await fetch(`${getFileApiBaseUrl()}/files/${imageRef}`);
                    if (response.ok) {
                      const blob = await response.blob();
                      const reader = new FileReader();
                      const base64Promise = new Promise<string>((resolve, reject) => {
                        reader.onload = () => {
                          const result = reader.result as string;
                          const base64Data = result.split(',')[1];
                          resolve(base64Data);
                        };
                        reader.onerror = reject;
                      });
                      
                      reader.readAsDataURL(blob);
                      const base64Data = await base64Promise;
                      
                      messageImages.push(base64Data);
                      console.log(`✅ Included PDF image ${imgIndex + 1} in follow-up (server file)`);
                    }
                  } catch (fetchError) {
                    console.error(`❌ Error fetching PDF image for follow-up:`, fetchError);
                  }
                }
              }
            }
          }
          
          // Handle Office document images from previous messages
          if (['docx', 'doc', 'xlsx', 'xls'].includes(attachment.type) && attachment.imageFileIds && attachment.imageFileIds.length > 0) {
            console.log(`📸 Including ${attachment.imageFileIds.length} Office images in follow-up: ${attachment.name}`);
            
            for (let imgIndex = 0; imgIndex < attachment.imageFileIds.length; imgIndex++) {
              const imageRef = attachment.imageFileIds[imgIndex];
              
              if (imageRef && typeof imageRef === 'string') {
                if (imageRef.startsWith('data:image/')) {
                  const base64Data = imageRef.split(',')[1];
                  if (base64Data) {
                    messageImages.push(base64Data);
                    console.log(`✅ Included Office image ${imgIndex + 1} in follow-up (data URL)`);
                  }
                } else {
                  try {
                    const response = await fetch(`http://localhost:3001/api/files/${imageRef}`);
                    if (response.ok) {
                      const blob = await response.blob();
                      const reader = new FileReader();
                      const base64Promise = new Promise<string>((resolve, reject) => {
                        reader.onload = () => {
                          const result = reader.result as string;
                          const base64Data = result.split(',')[1];
                          resolve(base64Data);
                        };
                        reader.onerror = reject;
                      });
                      
                      reader.readAsDataURL(blob);
                      const base64Data = await base64Promise;
                      
                      messageImages.push(base64Data);
                      console.log(`✅ Included Office image ${imgIndex + 1} in follow-up (server file)`);
                    }
                  } catch (fetchError) {
                    console.error(`❌ Error fetching Office image for follow-up:`, fetchError);
                  }
                }
              }
            }
          }
        }
        
        console.log(`✅ Follow-up message enhanced with ${allAttachments.size} files and ${messageImages.length} images`);
      }
      
      // Debug logging for images being sent to AI
      if (messageImages.length > 0) {
        console.log(`🖼️ Sending ${messageImages.length} images to AI model for message ${index + 1}`);
        messageImages.forEach((img, imgIdx) => {
          const sizeKB = Math.round(img.length * 3 / 4 / 1024);
          console.log(`   Image ${imgIdx + 1}: ${sizeKB}KB (base64 length: ${img.length})`);
        });
      }
      
      // Return message with images included in the message object per Ollama API docs
      return {
        role: msg.role,
        content: enhancedContent,
        // Only include images field if there are images
        ...(messageImages.length > 0 && { images: messageImages })
      };
    }));
    
    const endpoint = '/chat';
    
    // LOG THE COMPLETE PROMPT BEING SENT TO LLM
    console.log('\n' + '='.repeat(80));
    console.log('📤 COMPLETE PROMPT BEING SENT TO LLM');
    console.log('='.repeat(80));
    console.log(`🤖 Model: ${modelId}`);
    console.log(`📊 Total Messages: ${formattedMessages.length}`);
    
    // Calculate total images being sent
    const totalImages = formattedMessages.reduce((sum, msg) => sum + (msg.images?.length || 0), 0);
    if (totalImages > 0) {
      console.log(`🖼️ Total Images Being Sent to LLM: ${totalImages}`);
      
      // Detailed breakdown by source
      let directImages = 0;
      let pdfImages = 0;
      let officeImages = 0;
      let storedContentImages = 0;
      let serverFetchedImages = 0;
      
      // Count images by source (this is approximate based on our logging)
      formattedMessages.forEach((message, index) => {
        if (message.images && message.images.length > 0) {
          console.log(`\n📸 MESSAGE ${index + 1} IMAGES BREAKDOWN:`);
          message.images.forEach((img, imgIdx) => {
            const sizeKB = Math.round(img.length * 3 / 4 / 1024);
            console.log(`   Image ${imgIdx + 1}: ${sizeKB}KB (base64 length: ${img.length})`);
          });
        }
      });
      
      console.log(`\n📊 IMAGE PROCESSING SUMMARY:`);
      console.log(`   • Images processed with stored content: More reliable, faster processing`);
      console.log(`   • Images fetched from server: Fallback method when content not stored`);
      console.log(`   • All images converted to base64 for LLM compatibility`);
    }
    
    formattedMessages.forEach((message, index) => {
      console.log(`\n--- MESSAGE ${index + 1} (${message.role.toUpperCase()}) ---`);
      console.log(`📝 Content Length: ${message.content.length} characters`);
      if (message.images && message.images.length > 0) {
        console.log(`🖼️ Images: ${message.images.length} attached`);
        message.images.forEach((img, imgIdx) => {
          const sizeKB = Math.round(img.length * 3 / 4 / 1024);
          console.log(`   📸 Image ${imgIdx + 1}: ${sizeKB}KB (ready for LLM analysis)`);
        });
      }
      console.log('\n📄 CONTENT:');
      console.log(message.content);
      
      // Show image data being sent (first 100 chars of each base64 for verification)
      if (message.images && message.images.length > 0) {
        console.log('\n🖼️ IMAGE DATA BEING SENT TO LLM:');
        message.images.forEach((img, imgIdx) => {
          const preview = img.substring(0, 100) + '...';
          console.log(`   📸 Image ${imgIdx + 1} base64 data: ${preview}`);
          console.log(`   📸 Image ${imgIdx + 1} full length: ${img.length} characters`);
        });
      }
      
      console.log('\n' + '-'.repeat(60));
    });
    
    console.log('\n' + '='.repeat(80));
    console.log('🚀 SENDING TO LLM...');
    console.log('='.repeat(80) + '\n');
    
    // If streaming is enabled and callback is provided
    if (onStreamUpdate) {
      // Prepare the request payload
      const payload: any = {
        model: modelId,
        messages: formattedMessages,
        stream: true,
        options: options || {
          num_ctx: 4096,
          temperature: 0.8,
        },
      };
      
      console.log('📦 PAYLOAD STRUCTURE:');
      console.log(`   Model: ${payload.model}`);
      console.log(`   Stream: ${payload.stream}`);
      console.log(`   Messages: ${payload.messages.length}`);
      console.log(`   Options: ${JSON.stringify(payload.options)}`);
      console.log('');
      
      // LOG THE COMPLETE JSON PAYLOAD BEING SENT TO LLM
      console.log('🔥 COMPLETE JSON PAYLOAD BEING SENT TO OLLAMA LLM:');
      console.log('='.repeat(80));
      console.log(JSON.stringify(payload, null, 2));
      console.log('='.repeat(80));
      console.log('');
      
      // Use fetch for streaming
      const response = await fetch(`${baseURL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      if (!response.body) {
        throw new Error('Response body is null');
      }
      
      // Store the reader globally so it can be cancelled
      currentReader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullResponse = '';
      
      try {
        while (true) {
          const { done, value } = await currentReader.read();
          
          if (done) {
            break;
          }
          
          // Decode the chunk
          const chunk = decoder.decode(value, { stream: true });
          
          // Process each line (each line is a JSON object)
          const lines = chunk.split('\n').filter(line => line.trim() !== '');
          
          for (const line of lines) {
            try {
              const data = JSON.parse(line);
              
              if (data.message && data.message.content) {
                // For streaming, we get partial content
                const content = data.message.content;
                onStreamUpdate(content);
                fullResponse += content;
              }
            } catch (e) {
              console.error('Error parsing JSON from stream:', e, line);
            }
          }
        }
      } catch (error: any) {
        // Check if this is a cancellation error
        if (error.message === 'User cancelled the response') {
          console.log('Stream was cancelled by user');
          return fullResponse;
        }
        console.error('Error reading stream:', error);
        throw error;
      } finally {
        currentReader = null;
      }
      
      return fullResponse;
    } else {
      // Non-streaming mode (fallback)
      // Prepare the request payload
      const payload: any = {
        model: modelId,
        messages: formattedMessages,
        stream: false,
        options: options || {
          num_ctx: 4096,
          temperature: 0.8,
        },
      };
      
      const response = await api.post(endpoint, payload);
      
      if (response.data && response.data.message) {
        return response.data.message.content;
      }
    }
    
    return 'No response from the model. Please check the Ollama API is running correctly.';
  } catch (error: any) {
    console.error('Error sending message to Ollama API:', error);
    
    // Provide more detailed error information
    let errorMessage = 'Error: Failed to get a response from the model.';
    
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      errorMessage += ` Server responded with status ${error.response.status}: ${JSON.stringify(error.response.data)}`;
      console.error('Error response data:', error.response.data);
      console.error('Error response status:', error.response.status);
      console.error('Error response headers:', error.response.headers);
    } else if (error.request) {
      // The request was made but no response was received
      errorMessage += ' No response received from server. Check if Ollama is running.';
      console.error('Error request:', error.request);
    } else {
      // Something happened in setting up the request that triggered an Error
      errorMessage += ` ${error.message}`;
      console.error('Error message:', error.message);
    }
    
    return errorMessage;
  }
};

// Get suggested prompts
export const getSuggestedPrompts = () => {
  return [
    {
      title: 'Tell me a fun fact',
      prompt: 'Tell me a fun fact about the Roman Empire',
      description: 'about the Roman Empire',
    },
    {
      title: 'Explain options trading',
      prompt: 'Explain options trading if I\'m familiar with buying and selling stocks',
      description: 'if I\'m familiar with buying and selling stocks',
    },
    {
      title: 'Give me ideas',
      prompt: 'Give me ideas for what to do with my kids\' art',
      description: 'for what to do with my kids\' art',
    },
  ];
};

// Get detailed information about a specific model
export const fetchModelDetails = async (modelName: string): Promise<any> => {
  try {
    const endpoint = '/show';
    const response = await api.post(endpoint, {
      name: modelName
    });
    
    if (response.data) {
      return response.data;
    }
    
    return null;
  } catch (error) {
    console.error(`Error fetching details for model ${modelName}:`, error);
    return null;
  }
};

// Delete a chat and its associated files
export const deleteChat = async (chatId: string): Promise<{ success: boolean; filesDeleted: number; filesFailed: number }> => {
  try {
    const response = await fetch(`${getFileApiBaseUrl()}/chats/${chatId}`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      // Handle 404 errors silently - chat doesn't exist on server
      if (response.status === 404) {
        return {
          success: true,
          filesDeleted: 0,
          filesFailed: 0
        };
      }
      // For other errors, still return success to avoid breaking the UI
      return {
        success: true,
        filesDeleted: 0,
        filesFailed: 0
      };
    }

    const result = await response.json();
    
    return {
      success: result.success,
      filesDeleted: result.filesDeleted || 0,
      filesFailed: result.filesFailed || 0
    };
  } catch (error) {
    // Even if there's a network error, return success to keep UI working
    return {
      success: true,
      filesDeleted: 0,
      filesFailed: 0
    };
  }
};

export default api;
