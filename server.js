const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const multer = require('multer');
const StreamZip = require('node-stream-zip');
const mammoth = require('mammoth');
const XLSX = require('xlsx');

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, 'nebulon-gpt-data');
const CHATS_FILE = path.join(DATA_DIR, 'chats.json');
const FILES_DIR = path.join(DATA_DIR, 'files'); // Directory for chat file attachments
const MODELS_DIR = process.env.NODE_ENV === 'production' 
  ? '/app/vosk-models'  // Use Docker volume path in production
  : path.join(__dirname, 'Vosk-Server', 'websocket', 'models');  // Use local path in development

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Ensure files directory exists
if (!fs.existsSync(FILES_DIR)) {
  fs.mkdirSync(FILES_DIR, { recursive: true });
}

// Ensure models directory exists
if (!fs.existsSync(MODELS_DIR)) {
  fs.mkdirSync(MODELS_DIR, { recursive: true });
}

// Initialize chats file if it doesn't exist
if (!fs.existsSync(CHATS_FILE)) {
  fs.writeFileSync(CHATS_FILE, JSON.stringify([]));
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, MODELS_DIR);
  },
  filename: function (req, file, cb) {
    // Keep original filename
    cb(null, file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024 * 1024 // 5GB limit for large models
  },
  fileFilter: function (req, file, cb) {
    // Accept zip files and directories
    if (file.mimetype === 'application/zip' || 
        file.mimetype === 'application/x-zip-compressed' ||
        file.originalname.endsWith('.zip')) {
      cb(null, true);
    } else {
      cb(new Error('Only ZIP files are allowed for Vosk models'));
    }
  }
});


// Middleware
app.use(cors());
app.use(bodyParser.json({ limit: '100mb' })); // Increase limit for large attachments
app.use(bodyParser.urlencoded({ limit: '100mb', extended: true }));


// Debug middleware to log all requests
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});


// Health check endpoint for Docker
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Test endpoint to verify server is working
app.get('/api/test', (req, res) => {
  res.json({ message: 'Server is working', timestamp: new Date().toISOString() });
});


// API endpoints
app.get('/api/chats', (req, res) => {
  try {
    const chatsData = fs.readFileSync(CHATS_FILE, 'utf8');
    const chats = JSON.parse(chatsData);
    res.json(chats);
  } catch (error) {
    console.error('Error reading chats file:', error);
    res.status(500).json({ error: 'Failed to load chats' });
  }
});

app.post('/api/chats', (req, res) => {
  try {
    const chats = req.body;
    fs.writeFileSync(CHATS_FILE, JSON.stringify(chats, null, 2));
    res.json({ success: true });
  } catch (error) {
    console.error('Error writing chats file:', error);
    res.status(500).json({ error: 'Failed to save chats' });
  }
});

// Delete a specific chat and its associated files
app.delete('/api/chats/:chatId', (req, res) => {
  try {
    const chatId = req.params.chatId;
    console.log(`🗑️ Deleting chat: ${chatId}`);
    
    // Read current chats
    const chatsData = fs.readFileSync(CHATS_FILE, 'utf8');
    const chats = JSON.parse(chatsData);
    
    // Find the chat to delete
    const chatToDelete = chats.find(chat => chat.id === chatId);
    if (!chatToDelete) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    
    // Collect all file IDs from the chat's messages
    const fileIdsToDelete = new Set();
    
    if (chatToDelete.messages) {
      chatToDelete.messages.forEach(message => {
        if (message.attachments && Array.isArray(message.attachments)) {
          message.attachments.forEach(attachment => {
            // Add the main file ID if it exists
            if (attachment.fileId) {
              fileIdsToDelete.add(attachment.fileId);
            }
            
            // Add extracted content file ID for PDFs (stored in metadata)
            if (attachment.metadata && attachment.metadata.extractedContentFileId) {
              fileIdsToDelete.add(attachment.metadata.extractedContentFileId);
              console.log(`📄 Found extracted content file to delete: ${attachment.metadata.extractedContentFileId}`);
            }
            
            // Add image file IDs for PDFs
            if (attachment.imageFileIds && Array.isArray(attachment.imageFileIds)) {
              attachment.imageFileIds.forEach(imageId => {
                // Extract file ID from data URLs or direct IDs
                if (typeof imageId === 'string') {
                  if (imageId.startsWith('data:')) {
                    // This is a data URL, not a file ID - skip
                  } else {
                    fileIdsToDelete.add(imageId);
                  }
                }
              });
            }
          });
        }
      });
    }
    
    console.log(`📁 Found ${fileIdsToDelete.size} files to delete for chat ${chatId}`);
    
    // Delete associated files
    let deletedFiles = 0;
    let failedFiles = 0;
    
    fileIdsToDelete.forEach(fileId => {
      try {
        const filePath = path.join(FILES_DIR, fileId);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          deletedFiles++;
          console.log(`🗑️ Deleted file: ${fileId}`);
        }
      } catch (fileError) {
        console.error(`❌ Failed to delete file ${fileId}:`, fileError);
        failedFiles++;
      }
    });
    
    // Remove chat from the list
    const updatedChats = chats.filter(chat => chat.id !== chatId);
    
    // Save updated chats
    fs.writeFileSync(CHATS_FILE, JSON.stringify(updatedChats, null, 2));
    
    console.log(`✅ Chat deleted: ${chatId}`);
    console.log(`📊 Files deleted: ${deletedFiles}, Failed: ${failedFiles}`);
    
    res.json({ 
      success: true, 
      message: 'Chat and associated files deleted successfully',
      filesDeleted: deletedFiles,
      filesFailed: failedFiles
    });
    
  } catch (error) {
    console.error('Error deleting chat:', error);
    res.status(500).json({ error: 'Failed to delete chat' });
  }
});

// File Storage API for chat attachments
// Configure multer for chat file uploads
const chatFileStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, FILES_DIR);
  },
  filename: function (req, file, cb) {
    // Generate unique filename with timestamp and original extension
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, uniqueSuffix + ext);
  }
});

const chatFileUpload = multer({ 
  storage: chatFileStorage,
  limits: {
    fileSize: 100 * 1024 * 1024 // 100MB limit for chat files
  }
});

// Upload file and return file ID
app.post('/api/files/upload', chatFileUpload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const fileInfo = {
      id: req.file.filename, // Use the generated filename as ID
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      path: req.file.path,
      uploadedAt: new Date().toISOString()
    };
    
    console.log(`📁 File uploaded: ${fileInfo.originalName} -> ${fileInfo.id}`);
    res.json({ success: true, fileId: fileInfo.id, file: fileInfo });
  } catch (error) {
    console.error('Error uploading file:', error);
    res.status(500).json({ error: 'Failed to upload file' });
  }
});

// Get file by ID
app.get('/api/files/:fileId', (req, res) => {
  try {
    const fileId = req.params.fileId;
    const filePath = path.join(FILES_DIR, fileId);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Get file stats
    const stats = fs.statSync(filePath);
    const fileExtension = path.extname(fileId).toLowerCase();
    
    // Set appropriate content-type based on file extension
    let contentType = 'application/octet-stream'; // Default binary
    
    if (fileExtension === '.pdf') {
      contentType = 'application/pdf';
    } else if (fileExtension === '.jpg' || fileExtension === '.jpeg') {
      contentType = 'image/jpeg';
    } else if (fileExtension === '.png') {
      contentType = 'image/png';
    } else if (fileExtension === '.gif') {
      contentType = 'image/gif';
    } else if (fileExtension === '.txt') {
      contentType = 'text/plain';
    } else if (fileExtension === '.json') {
      contentType = 'application/json';
    }
    
    // Use original filename if provided in query parameter, otherwise use file ID
    let downloadFilename = fileId; // Default fallback
    
    // Check if original filename is provided as query parameter
    if (req.query.filename && typeof req.query.filename === 'string') {
      downloadFilename = req.query.filename;
      console.log(`📁 Using original filename for download: ${downloadFilename}`);
    } else {
      // Fallback: create a user-friendly name based on file extension
      if (fileExtension) {
        if (fileExtension === '.pdf') {
          downloadFilename = `document.pdf`;
        } else if (fileExtension === '.jpg' || fileExtension === '.jpeg') {
          downloadFilename = `image.jpg`;
        } else if (fileExtension === '.png') {
          downloadFilename = `image.png`;
        } else if (fileExtension === '.txt') {
          downloadFilename = `document.txt`;
        } else {
          downloadFilename = `document${fileExtension}`;
        }
      }
    }
    
    // Set proper headers for file download
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', stats.size);
    res.setHeader('Content-Disposition', `attachment; filename="${downloadFilename}"`);
    res.setHeader('Cache-Control', 'no-cache');
    
    console.log(`📁 Serving file: ${fileId} (${contentType}, ${stats.size} bytes)`);
    
    // Send file with proper headers
    res.sendFile(path.resolve(filePath), (err) => {
      if (err) {
        console.error(`❌ Error sending file ${fileId}:`, err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to serve file' });
        }
      } else {
        console.log(`✅ File served successfully: ${fileId}`);
      }
    });
    
  } catch (error) {
    console.error('Error serving file:', error);
    res.status(500).json({ error: 'Failed to serve file' });
  }
});

// Get file info by ID
app.get('/api/files/:fileId/info', (req, res) => {
  try {
    const fileId = req.params.fileId;
    const filePath = path.join(FILES_DIR, fileId);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    const stats = fs.statSync(filePath);
    const fileInfo = {
      id: fileId,
      size: stats.size,
      modified: stats.mtime,
      exists: true
    };
    
    res.json(fileInfo);
  } catch (error) {
    console.error('Error getting file info:', error);
    res.status(500).json({ error: 'Failed to get file info' });
  }
});

// Delete file by ID
app.delete('/api/files/:fileId', (req, res) => {
  try {
    const fileId = req.params.fileId;
    const filePath = path.join(FILES_DIR, fileId);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    fs.unlinkSync(filePath);
    console.log(`🗑️ File deleted: ${fileId}`);
    res.json({ success: true, message: 'File deleted successfully' });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({ error: 'Failed to delete file' });
  }
});


// Save file content (for processed files like PDF images)
app.post('/api/files/save', (req, res) => {
  try {
    const { content, originalName, mimetype } = req.body;
    
    if (!content || !originalName) {
      return res.status(400).json({ error: 'Content and originalName are required' });
    }
    
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(originalName);
    const fileId = uniqueSuffix + ext;
    const filePath = path.join(FILES_DIR, fileId);
    
    // Handle different content types
    if (content.startsWith('data:')) {
      // Base64 data URL - extract and save as binary
      const base64Data = content.split(',')[1];
      const buffer = Buffer.from(base64Data, 'base64');
      fs.writeFileSync(filePath, buffer);
    } else {
      // Text content
      fs.writeFileSync(filePath, content, 'utf8');
    }
    
    const stats = fs.statSync(filePath);
    const fileInfo = {
      id: fileId,
      originalName: originalName,
      size: stats.size,
      mimetype: mimetype || 'application/octet-stream',
      path: filePath,
      uploadedAt: new Date().toISOString()
    };
    
    console.log(`💾 File saved: ${originalName} -> ${fileId}`);
    res.json({ success: true, fileId: fileId, file: fileInfo });
  } catch (error) {
    console.error('Error saving file:', error);
    res.status(500).json({ error: 'Failed to save file' });
  }
});

// Office Document Processing API
app.post('/api/files/process-office', (req, res) => {
  try {
    const { fileId, fileName, options = {} } = req.body;
    
    if (!fileId || !fileName) {
      return res.status(400).json({ error: 'fileId and fileName are required' });
    }
    
    const filePath = path.join(FILES_DIR, fileId);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Determine file type from extension
    const ext = path.extname(fileName).toLowerCase();
    let fileType;
    
    switch (ext) {
      case '.docx':
        fileType = 'docx';
        break;
      case '.doc':
        fileType = 'doc';
        break;
      case '.xlsx':
        fileType = 'xlsx';
        break;
      case '.xls':
        fileType = 'xls';
        break;
      default:
        return res.status(400).json({ error: `Unsupported file type: ${ext}` });
    }
    
    console.log(`🔄 Processing Office document: ${fileName} (${fileType})`);
    
    // Process the file based on type
    processOfficeDocument(filePath, fileName, fileType, options)
      .then(result => {
        console.log(`✅ Office document processed successfully: ${fileName}`);
        res.json({
          success: true,
          data: result,
          fileType: fileType,
          fileName: fileName
        });
      })
      .catch(error => {
        console.error(`❌ Error processing Office document ${fileName}:`, error);
        res.status(500).json({ 
          error: 'Failed to process Office document',
          details: error.message 
        });
      });
      
  } catch (error) {
    console.error('Error in Office document processing endpoint:', error);
    res.status(500).json({ error: 'Failed to process Office document' });
  }
});

// Office Document Processing Functions
async function processOfficeDocument(filePath, fileName, fileType, options = {}) {
  const startTime = Date.now();
  
  try {
    const fileData = fs.readFileSync(filePath);
    let result;
    
    switch (fileType) {
      case 'docx':
        result = await processWordDocument(fileData, fileName, options);
        break;
      case 'doc':
        result = await processLegacyWordDocument(fileData, fileName);
        break;
      case 'xlsx':
      case 'xls':
        result = await processExcelDocument(fileData, fileName, fileType, options);
        break;
      default:
        throw new Error(`Unsupported file type: ${fileType}`);
    }
    
    result.metadata.processingTime = Date.now() - startTime;
    return result;
    
  } catch (error) {
    console.error(`Error processing ${fileType} document:`, error);
    throw error;
  }
}

async function processWordDocument(fileData, fileName, options = {}) {
  console.log(`📄 Processing Word document with comprehensive extraction: ${fileName}`);
  
  const result = {
    metadata: {
      fileName,
      fileType: 'docx',
      fileSize: fileData.length,
      processingTime: 0,
      extractionTimestamp: new Date(),
    },
    items: {
      text: [],
      tables: [],
      images: [],
    },
    statistics: {
      totalTextItems: 0,
      totalTables: 0,
      totalImages: 0,
      totalWords: 0,
    },
  };
  
  try {
    // Configure mammoth for comprehensive extraction
    const mammothOptions = {
      // Convert images to base64 data URLs
      convertImage: mammoth.images.imgElement(function(image) {
        return image.read("base64").then(function(imageBuffer) {
          // Create image item for our result
          const imageItem = {
            id: `image-${result.items.images.length}`,
            type: 'image',
            content: `data:${image.contentType || 'image/png'};base64,${imageBuffer}`,
            metadata: {
              sourceFile: fileName,
              contentType: 'docx',
              processingMethod: 'mammoth-image-extraction',
              confidence: 0.9,
              extractionTimestamp: new Date(),
              format: image.contentType || 'image/png',
              size: Math.round((imageBuffer.length * 3) / 4), // Approximate size from base64
              description: 'Image extracted from Word document',
            },
          };
          
          result.items.images.push(imageItem);
          console.log(`📸 Extracted image ${result.items.images.length}: ${imageItem.metadata.format} (${Math.round(imageItem.metadata.size / 1024)}KB)`);
          
          // Return the image element for HTML conversion
          return {
            src: imageItem.content
          };
        });
      }),
      
      // Style mapping for better text extraction
      styleMap: [
        "p[style-name='Heading 1'] => h1:fresh",
        "p[style-name='Heading 2'] => h2:fresh",
        "p[style-name='Heading 3'] => h3:fresh",
        "p[style-name='Title'] => h1.title:fresh",
        "r[style-name='Strong'] => strong",
        "r[style-name='Emphasis'] => em",
      ]
    };
    
    // Extract HTML content (which includes tables and better structure)
    console.log(`🔄 Extracting HTML content from ${fileName}...`);
    const htmlResult = await mammoth.convertToHtml({ buffer: fileData }, mammothOptions);
    
    // Also extract raw text for basic text processing
    console.log(`🔄 Extracting raw text from ${fileName}...`);
    const textResult = await mammoth.extractRawText({ buffer: fileData });
    
    // Process HTML content to extract tables and structured text
    if (htmlResult.value) {
      console.log(`📝 Processing HTML content (${htmlResult.value.length} characters)...`);
      
      // Extract tables from HTML
      const tableMatches = htmlResult.value.match(/<table[^>]*>[\s\S]*?<\/table>/gi);
      if (tableMatches) {
        console.log(`📊 Found ${tableMatches.length} tables in ${fileName}`);
        
        tableMatches.forEach((tableHtml, tableIndex) => {
          try {
            // Parse table HTML to extract rows and cells
            const tableContent = parseHtmlTable(tableHtml);
            
            if (tableContent.length > 0) {
              const tableItem = {
                id: `table-${tableIndex}`,
                type: 'table',
                content: tableContent,
                metadata: {
                  sourceFile: fileName,
                  contentType: 'docx',
                  processingMethod: 'mammoth-html-table-extraction',
                  confidence: 0.9,
                  extractionTimestamp: new Date(),
                  structure: {
                    rows: tableContent.length,
                    columns: Math.max(...tableContent.map(row => row.length)),
                    hasHeaders: detectTableHeaders(tableContent),
                    headerRow: detectTableHeaders(tableContent) ? tableContent[0] : undefined,
                  },
                  cellCount: tableContent.reduce((sum, row) => sum + row.length, 0),
                },
              };
              
              result.items.tables.push(tableItem);
              console.log(`✅ Extracted table ${tableIndex + 1}: ${tableItem.metadata.structure.rows} rows, ${tableItem.metadata.structure.columns} columns`);
            }
          } catch (tableError) {
            console.warn(`⚠️ Error parsing table ${tableIndex + 1}:`, tableError);
          }
        });
      }
      
      // Extract hyperlinks from HTML before processing text
      const linkMatches = htmlResult.value.match(/<a[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi);
      if (linkMatches) {
        console.log(`🔗 Found ${linkMatches.length} hyperlinks in ${fileName}`);
        
        linkMatches.forEach((linkHtml, linkIndex) => {
          try {
            const hrefMatch = linkHtml.match(/href=["']([^"']*)["']/i);
            const textMatch = linkHtml.match(/>([^<]*)</);
            
            if (hrefMatch && textMatch) {
              const url = hrefMatch[1];
              const linkText = textMatch[1].trim();
              
              const linkItem = {
                id: `link-${linkIndex}`,
                type: 'link',
                content: url,
                metadata: {
                  sourceFile: fileName,
                  contentType: 'docx',
                  processingMethod: 'mammoth-html-link-extraction',
                  confidence: 0.95,
                  extractionTimestamp: new Date(),
                  linkText: linkText,
                  url: url,
                  linkType: url.startsWith('http') ? 'external' : 'internal',
                },
              };
              
              // Add to a links array (we'll need to add this to the result structure)
              if (!result.items.links) {
                result.items.links = [];
              }
              result.items.links.push(linkItem);
              console.log(`✅ Extracted link ${linkIndex + 1}: "${linkText}" -> ${url}`);
            }
          } catch (linkError) {
            console.warn(`⚠️ Error parsing link ${linkIndex + 1}:`, linkError);
          }
        });
      }
      
      // Extract structured text from HTML (preserving headings and formatting)
      const cleanText = htmlResult.value
        .replace(/<table[^>]*>[\s\S]*?<\/table>/gi, '') // Remove tables (already processed)
        .replace(/<img[^>]*>/gi, '[IMAGE]') // Replace images with placeholder
        .replace(/<a[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi, '[$2]($1)') // Convert links to markdown format
        .replace(/<h([1-6])[^>]*>(.*?)<\/h[1-6]>/gi, (match, level, content) => {
          return `\n${'#'.repeat(parseInt(level))} ${content.replace(/<[^>]*>/g, '').trim()}\n`;
        })
        .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n')
        .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
        .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
        .replace(/<[^>]*>/g, '') // Remove remaining HTML tags
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .split('\n')
        .filter(line => line.trim().length > 0);
      
      cleanText.forEach((paragraph, index) => {
        if (paragraph.trim()) {
          const isHeading = paragraph.startsWith('#');
          const headingLevel = isHeading ? (paragraph.match(/^#+/) || [''])[0].length : 0;
          const content = isHeading ? paragraph.replace(/^#+\s*/, '') : paragraph;
          
          const textItem = {
            id: `text-${index}`,
            type: 'text',
            content: content.trim(),
            metadata: {
              sourceFile: fileName,
              contentType: 'docx',
              processingMethod: 'mammoth-html-extraction',
              textLength: content.length,
              wordCount: content.trim().split(/\s+/).length,
              confidence: 0.95,
              extractionTimestamp: new Date(),
              paragraphIndex: index,
              isHeading: isHeading,
              headingLevel: headingLevel,
              isBold: paragraph.includes('**'),
              isItalic: paragraph.includes('*') && !paragraph.includes('**'),
            },
          };
          result.items.text.push(textItem);
        }
      });
    }
    
    // Fallback to raw text if HTML processing fails
    if (result.items.text.length === 0 && textResult.value) {
      console.log(`⚠️ HTML processing yielded no text, falling back to raw text extraction`);
      const paragraphs = textResult.value.split('\n').filter(p => p.trim().length > 0);
      
      paragraphs.forEach((paragraph, index) => {
        const textItem = {
          id: `text-fallback-${index}`,
          type: 'text',
          content: paragraph.trim(),
          metadata: {
            sourceFile: fileName,
            contentType: 'docx',
            processingMethod: 'mammoth-raw-text-fallback',
            textLength: paragraph.length,
            wordCount: paragraph.trim().split(/\s+/).length,
            confidence: 0.8,
            extractionTimestamp: new Date(),
            paragraphIndex: index,
          },
        };
        result.items.text.push(textItem);
      });
    }
    
    // Process warnings from both extractions
    const allMessages = [...(htmlResult.messages || []), ...(textResult.messages || [])];
    if (allMessages.length > 0) {
      console.warn(`⚠️ Mammoth processing warnings for ${fileName}:`, allMessages);
    }
    
    // Calculate final statistics
    result.statistics = {
      totalTextItems: result.items.text.length,
      totalTables: result.items.tables.length,
      totalImages: result.items.images.length,
      totalLinks: result.items.links ? result.items.links.length : 0,
      totalWords: result.items.text.reduce((sum, item) => sum + item.metadata.wordCount, 0),
    };
    
    console.log(`✅ Word document comprehensively processed: ${fileName}`);
    console.log(`   📝 Text items: ${result.statistics.totalTextItems}`);
    console.log(`   📊 Tables: ${result.statistics.totalTables}`);
    console.log(`   📸 Images: ${result.statistics.totalImages}`);
    console.log(`   🔗 Links: ${result.statistics.totalLinks}`);
    console.log(`   📖 Total words: ${result.statistics.totalWords}`);
    
    return result;
    
  } catch (error) {
    console.error(`❌ Error processing Word document ${fileName}:`, error);
    throw error;
  }
}

// Helper function to parse HTML table into 2D array
function parseHtmlTable(tableHtml) {
  const rows = [];
  
  try {
    // Extract table rows
    const rowMatches = tableHtml.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi);
    if (!rowMatches) return rows;
    
    rowMatches.forEach(rowHtml => {
      const cells = [];
      
      // Extract table cells (both td and th)
      const cellMatches = rowHtml.match(/<(td|th)[^>]*>[\s\S]*?<\/(td|th)>/gi);
      if (cellMatches) {
        cellMatches.forEach(cellHtml => {
          // Clean cell content
          const cellContent = cellHtml
            .replace(/<(td|th)[^>]*>/i, '')
            .replace(/<\/(td|th)>/i, '')
            .replace(/<[^>]*>/g, '') // Remove HTML tags
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .trim();
          
          cells.push(cellContent);
        });
      }
      
      if (cells.length > 0) {
        rows.push(cells);
      }
    });
  } catch (error) {
    console.warn('Error parsing HTML table:', error);
  }
  
  return rows;
}

// Helper function to detect table headers
function detectTableHeaders(tableData) {
  if (tableData.length < 2) return false;
  
  const firstRow = tableData[0];
  const secondRow = tableData[1];
  
  // Check if first row looks like headers (text) and second row has different content
  const firstRowHasText = firstRow.some(cell => 
    cell && isNaN(Number(cell)) && cell.toString().trim().length > 0
  );
  
  const secondRowHasDifferentContent = secondRow.some(cell => 
    cell && cell.toString().trim() !== firstRow[secondRow.indexOf(cell)]
  );
  
  return firstRowHasText && secondRowHasDifferentContent;
}

async function processLegacyWordDocument(fileData, fileName) {
  console.log(`📄 Processing legacy Word document: ${fileName}`);
  
  const result = {
    metadata: {
      fileName,
      fileType: 'doc',
      fileSize: fileData.length,
      processingTime: 0,
      extractionTimestamp: new Date(),
    },
    items: {
      text: [],
      tables: [],
      images: [],
    },
    statistics: {
      totalTextItems: 0,
      totalTables: 0,
      totalImages: 0,
      totalWords: 0,
    },
  };
  
  // For legacy .doc files, provide a placeholder
  const textItem = {
    id: 'text-0',
    type: 'text',
    content: '[Legacy .doc file detected - content extraction requires server-side processing]',
    metadata: {
      sourceFile: fileName,
      contentType: 'doc',
      processingMethod: 'legacy-placeholder',
      textLength: 0,
      wordCount: 0,
      confidence: 0.1,
      extractionTimestamp: new Date(),
    },
  };
  
  result.items.text.push(textItem);
  result.statistics.totalTextItems = 1;
  
  console.log(`⚠️ Legacy Word document processed with limited support: ${fileName}`);
  return result;
}

async function processExcelDocument(fileData, fileName, fileType, options = {}) {
  console.log(`📊 Processing Excel document: ${fileName} (${fileType})`);
  
  const result = {
    metadata: {
      fileName,
      fileType,
      fileSize: fileData.length,
      processingTime: 0,
      extractionTimestamp: new Date(),
    },
    items: {
      text: [],
      tables: [],
      images: [],
    },
    statistics: {
      totalTextItems: 0,
      totalTables: 0,
      totalImages: 0,
      totalWords: 0,
      totalSheets: 0,
    },
  };
  
  try {
    // Read the Excel file
    const workbook = XLSX.read(fileData, { type: 'buffer' });
    
    // Extract metadata
    result.metadata.sheetCount = workbook.SheetNames.length;
    result.metadata.sheetNames = workbook.SheetNames;
    result.statistics.totalSheets = workbook.SheetNames.length;
    
    console.log(`📋 Excel file contains ${workbook.SheetNames.length} sheets: ${workbook.SheetNames.join(', ')}`);
    
    // Process each worksheet
    workbook.SheetNames.forEach((sheetName, sheetIndex) => {
      console.log(`📄 Processing sheet: ${sheetName} (${sheetIndex + 1}/${workbook.SheetNames.length})`);
      
      const worksheet = workbook.Sheets[sheetName];
      
      if (!worksheet) {
        console.warn(`⚠️ Sheet ${sheetName} is empty or could not be read`);
        return;
      }
      
      // Get the range of the worksheet
      const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
      console.log(`📐 Sheet ${sheetName} range: ${XLSX.utils.encode_range(range)}`);
      
      // Convert worksheet to array of arrays (table format)
      const sheetData = XLSX.utils.sheet_to_json(worksheet, { 
        header: 1, 
        defval: '', 
        raw: false 
      });
      
      if (sheetData.length > 0) {
        // Filter out completely empty rows
        const filteredData = sheetData.filter(row => 
          row.some(cell => cell && cell.toString().trim() !== '')
        );
        
        if (filteredData.length > 0) {
          // Detect if first row contains headers
          const hasHeaders = detectExcelHeaders(filteredData);
          
          const tableItem = {
            id: `table-${sheetIndex}`,
            type: 'table',
            content: filteredData,
            metadata: {
              sourceFile: fileName,
              contentType: fileType,
              processingMethod: 'xlsx-extraction',
              confidence: 0.95,
              extractionTimestamp: new Date(),
              sheetName,
              sheetIndex,
              range: XLSX.utils.encode_range(range),
              structure: {
                rows: filteredData.length,
                columns: Math.max(...filteredData.map(row => row.length)),
                hasHeaders,
                headerRow: hasHeaders ? filteredData[0] : undefined,
              },
              cellCount: filteredData.reduce((sum, row) => sum + row.length, 0),
            },
          };
          
          result.items.tables.push(tableItem);
          console.log(`✅ Extracted table from sheet ${sheetName}: ${tableItem.metadata.structure.rows} rows, ${tableItem.metadata.structure.columns} columns`);
        }
      }
      
      // Extract individual cell text and hyperlinks
      const cellTexts = [];
      for (let R = range.s.r; R <= range.e.r; ++R) {
        for (let C = range.s.c; C <= range.e.c; ++C) {
          const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
          const cell = worksheet[cellAddress];
          
          if (cell && cell.v) {
            const cellValue = cell.v.toString().trim();
            if (cellValue) {
              cellTexts.push(cellValue);
              
              // Check if cell contains a hyperlink
              if (cell.l && cell.l.Target) {
                // This cell has a hyperlink
                const linkUrl = cell.l.Target;
                const linkText = cellValue;
                
                const linkItem = {
                  id: `link-${sheetIndex}-${cellAddress}`,
                  type: 'link',
                  content: linkUrl,
                  metadata: {
                    sourceFile: fileName,
                    contentType: fileType,
                    processingMethod: 'xlsx-hyperlink-extraction',
                    confidence: 0.95,
                    extractionTimestamp: new Date(),
                    linkText: linkText,
                    url: linkUrl,
                    linkType: linkUrl.startsWith('http') ? 'external' : 'internal',
                    sheetName,
                    sheetIndex,
                    cellAddress,
                  },
                };
                
                // Add to links array
                if (!result.items.links) {
                  result.items.links = [];
                }
                result.items.links.push(linkItem);
                console.log(`✅ Extracted hyperlink from ${sheetName}!${cellAddress}: "${linkText}" -> ${linkUrl}`);
              }
              
              // Create individual text items for searchable content
              const textItem = {
                id: `text-${sheetIndex}-${cellAddress}`,
                type: 'text',
                content: cellValue,
                metadata: {
                  sourceFile: fileName,
                  contentType: fileType,
                  processingMethod: 'xlsx-cell-extraction',
                  textLength: cellValue.length,
                  wordCount: cellValue.split(/\s+/).length,
                  confidence: 0.9,
                  extractionTimestamp: new Date(),
                  sheetName,
                  sheetIndex,
                  cellAddress,
                  hasHyperlink: !!(cell.l && cell.l.Target),
                },
              };
              
              result.items.text.push(textItem);
            }
          }
        }
      }
      
      console.log(`📝 Extracted ${cellTexts.length} text items from sheet ${sheetName}`);
    });
    
    // Calculate final statistics
    result.statistics = {
      totalTextItems: result.items.text.length,
      totalTables: result.items.tables.length,
      totalImages: result.items.images.length,
      totalLinks: result.items.links ? result.items.links.length : 0,
      totalWords: result.items.text.reduce((sum, item) => sum + item.metadata.wordCount, 0),
      totalSheets: workbook.SheetNames.length,
    };
    
    console.log(`✅ Excel document processed: ${fileName}`);
    console.log(`   📝 Text items: ${result.statistics.totalTextItems}`);
    console.log(`   📊 Tables: ${result.statistics.totalTables}`);
    console.log(`   🔗 Links: ${result.statistics.totalLinks}`);
    console.log(`   📖 Total words: ${result.statistics.totalWords}`);
    console.log(`   📄 Total sheets: ${result.statistics.totalSheets}`);
    return result;
    
  } catch (error) {
    console.error(`❌ Error processing Excel document ${fileName}:`, error);
    throw error;
  }
}

function detectExcelHeaders(data) {
  if (data.length < 2) return false;
  
  const firstRow = data[0];
  const secondRow = data[1];
  
  // Check if first row looks like headers
  const firstRowHasText = firstRow.some(cell => 
    cell && isNaN(Number(cell)) && cell.toString().trim().length > 0
  );
  
  const secondRowHasNumbers = secondRow.some(cell => 
    cell && !isNaN(Number(cell))
  );
  
  // If first row has text and second row has numbers, likely headers
  return firstRowHasText && secondRowHasNumbers;
}

// Vosk Models Management API
app.get('/api/vosk/models', (req, res) => {
  try {
    const models = [];
    const files = fs.readdirSync(MODELS_DIR);
    
    files.forEach(file => {
      const filePath = path.join(MODELS_DIR, file);
      const stats = fs.statSync(filePath);
      
      if (stats.isDirectory()) {
        // Check if it's a valid Vosk model directory
        const amPath = path.join(filePath, 'am', 'final.mdl');
        const confPath = path.join(filePath, 'conf', 'model.conf');
        
        if (fs.existsSync(amPath) || fs.existsSync(confPath)) {
          models.push({
            name: file,
            type: 'directory',
            size: getDirSize(filePath),
            modified: stats.mtime,
            status: 'ready'
          });
        }
      } else if (file.endsWith('.zip')) {
        models.push({
          name: file,
          type: 'zip',
          size: stats.size,
          modified: stats.mtime,
          status: 'archived'
        });
      }
    });
    
    res.json({ models });
  } catch (error) {
    console.error('Error reading models directory:', error);
    res.status(500).json({ error: 'Failed to load models' });
  }
});

// Get ALL files and folders in models directory (not just Vosk models)
app.get('/api/vosk/models/all', (req, res) => {
  try {
    const models = [];
    const files = fs.readdirSync(MODELS_DIR);
    
    files.forEach(file => {
      // Skip placeholder files and hidden files
      if (file === '.placeholder' || file.startsWith('.placeholder') || file.startsWith('.git')) {
        return;
      }
      
      const filePath = path.join(MODELS_DIR, file);
      const stats = fs.statSync(filePath);
      
      if (stats.isDirectory()) {
        // Check if it's a valid Vosk model directory
        const amPath = path.join(filePath, 'am', 'final.mdl');
        const confPath = path.join(filePath, 'conf', 'model.conf');
        
        if (fs.existsSync(amPath) || fs.existsSync(confPath)) {
          models.push({
            name: file,
            type: 'directory',
            size: getDirSize(filePath),
            modified: stats.mtime,
            status: 'ready'
          });
        } else {
          // Regular directory (not a Vosk model)
          models.push({
            name: file,
            type: 'directory',
            size: getDirSize(filePath),
            modified: stats.mtime,
            status: 'other'
          });
        }
      } else if (file.endsWith('.zip')) {
        models.push({
          name: file,
          type: 'zip',
          size: stats.size,
          modified: stats.mtime,
          status: 'archived'
        });
      } else {
        // Any other file type
        models.push({
          name: file,
          type: 'file',
          size: stats.size,
          modified: stats.mtime,
          status: 'other'
        });
      }
    });
    
    res.json({ models });
  } catch (error) {
    console.error('Error reading models directory:', error);
    res.status(500).json({ error: 'Failed to load models' });
  }
});

app.post('/api/vosk/models/upload', upload.single('model'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const filePath = req.file.path;
    const fileName = req.file.filename;
    
    console.log(`Model uploaded: ${fileName}`);
    
    // If it's a zip file, extract it using cross-platform library
    if (fileName.endsWith('.zip')) {
      try {
        await extractZipFile(filePath, MODELS_DIR);
        console.log('Model extracted successfully');
        res.json({ 
          success: true, 
          message: 'Model uploaded and extracted successfully',
          filename: fileName,
          extracted: true
        });
      } catch (extractError) {
        console.error('Error extracting model:', extractError);
        res.status(500).json({ 
          error: 'Failed to extract model', 
          details: extractError.message 
        });
      }
    } else {
      res.json({ 
        success: true, 
        message: 'Model uploaded successfully',
        filename: fileName,
        extracted: false
      });
    }
  } catch (error) {
    console.error('Error uploading model:', error);
    res.status(500).json({ error: 'Failed to upload model' });
  }
});

app.delete('/api/vosk/models/:modelName', (req, res) => {
  try {
    const modelName = req.params.modelName;
    const modelPath = path.join(MODELS_DIR, modelName);
    
    if (!fs.existsSync(modelPath)) {
      return res.status(404).json({ error: 'Model not found' });
    }
    
    const stats = fs.statSync(modelPath);
    
    if (stats.isDirectory()) {
      // Remove directory recursively
      fs.rmSync(modelPath, { recursive: true, force: true });
    } else {
      // Remove file
      fs.unlinkSync(modelPath);
    }
    
    console.log(`Model deleted: ${modelName}`);
    res.json({ success: true, message: 'Model deleted successfully' });
  } catch (error) {
    console.error('Error deleting model:', error);
    res.status(500).json({ error: 'Failed to delete model' });
  }
});

app.post('/api/vosk/models/:modelName/extract', async (req, res) => {
  try {
    const modelName = req.params.modelName;
    const zipPath = path.join(MODELS_DIR, modelName);
    
    if (!fs.existsSync(zipPath) || !modelName.endsWith('.zip')) {
      return res.status(404).json({ error: 'ZIP file not found' });
    }
    
    // Extract the zip file using cross-platform library
    try {
      await extractZipFile(zipPath, MODELS_DIR);
      console.log('Model extracted successfully');
      res.json({ 
        success: true, 
        message: 'Model extracted successfully'
      });
    } catch (extractError) {
      console.error('Error extracting model:', extractError);
      res.status(500).json({ 
        error: 'Failed to extract model', 
        details: extractError.message 
      });
    }
  } catch (error) {
    console.error('Error extracting model:', error);
    res.status(500).json({ error: 'Failed to extract model' });
  }
});

// Cross-platform ZIP extraction function with force overwrite
async function extractZipFile(zipPath, extractToDir) {
  return new Promise(async (resolve, reject) => {
    const zip = new StreamZip.async({ file: zipPath });
    
    try {
      // Get list of entries to check for existing models
      const entries = await zip.entries();
      const modelDirs = new Set();
      
      // Find all model directories that will be created
      for (const entry of Object.values(entries)) {
        if (entry.isDirectory) {
          const topLevelDir = entry.name.split('/')[0];
          if (topLevelDir && topLevelDir.startsWith('vosk-model-')) {
            modelDirs.add(topLevelDir);
          }
        }
      }
      
      // Remove existing model directories to force overwrite
      for (const modelDir of modelDirs) {
        const existingPath = path.join(extractToDir, modelDir);
        if (fs.existsSync(existingPath)) {
          console.log(`🗑️ Removing existing model directory: ${existingPath}`);
          fs.rmSync(existingPath, { recursive: true, force: true });
        }
      }
      
      // Extract the ZIP file
      await zip.extract(null, extractToDir);
      zip.close();
      console.log(`✅ Successfully extracted ${zipPath} to ${extractToDir} (force overwrite enabled)`);
      resolve();
    } catch (error) {
      zip.close();
      console.error(`❌ Failed to extract ${zipPath}:`, error);
      reject(error);
    }
  });
}

// Helper function to get directory size
function getDirSize(dirPath) {
  let size = 0;
  try {
    const files = fs.readdirSync(dirPath);
    files.forEach(file => {
      const filePath = path.join(dirPath, file);
      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) {
        size += getDirSize(filePath);
      } else {
        size += stats.size;
      }
    });
  } catch (error) {
    console.error('Error calculating directory size:', error);
  }
  return size;
}

// Start the server
app.listen(PORT, () => {
  console.log(`Chat data server running on port ${PORT}`);
});
