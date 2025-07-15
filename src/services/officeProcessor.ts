import * as mammoth from 'mammoth';
import * as XLSX from 'xlsx';

// Enhanced metadata interfaces for comprehensive Office document processing
export interface OfficeTextItem {
  id: string;
  type: 'text';
  content: string;
  metadata: {
    sourceFile: string;
    contentType: 'docx' | 'doc' | 'xlsx' | 'xls';
    processingMethod: string;
    textLength: number;
    wordCount: number;
    confidence: number;
    extractionTimestamp: Date;
    // Word-specific metadata
    paragraphIndex?: number;
    isHeading?: boolean;
    headingLevel?: number;
    isBold?: boolean;
    isItalic?: boolean;
    fontSize?: number;
    fontFamily?: string;
    // Excel-specific metadata
    sheetName?: string;
    sheetIndex?: number;
    cellAddress?: string;
    [key: string]: any;
  };
}

export interface OfficeTableItem {
  id: string;
  type: 'table';
  content: string[][]; // 2D array of cell contents
  metadata: {
    sourceFile: string;
    contentType: 'docx' | 'doc' | 'xlsx' | 'xls';
    processingMethod: string;
    confidence: number;
    extractionTimestamp: Date;
    // Excel-specific metadata
    sheetName?: string;
    sheetIndex?: number;
    range?: string;
    structure: {
      rows: number;
      columns: number;
      hasHeaders: boolean;
      headerRow?: string[];
    };
    cellCount: number;
    // Cell formatting information
    cellFormats?: {
      [cellAddress: string]: {
        type?: string;
        format?: string;
        value?: any;
      };
    };
    [key: string]: any;
  };
}

export interface OfficeImageItem {
  id: string;
  type: 'image';
  content: string; // Base64 data URL
  metadata: {
    sourceFile: string;
    contentType: 'docx' | 'doc' | 'xlsx' | 'xls';
    processingMethod: string;
    confidence: number;
    extractionTimestamp: Date;
    format: string;
    size: number;
    dimensions?: {
      width: number;
      height: number;
    };
    description?: string;
    [key: string]: any;
  };
}

export interface OfficeDocumentData {
  metadata: {
    fileName: string;
    fileType: 'docx' | 'doc' | 'xlsx' | 'xls';
    fileSize: number;
    processingTime: number;
    extractionTimestamp: Date;
    // Document-specific metadata
    title?: string;
    author?: string;
    subject?: string;
    creator?: string;
    lastModifiedBy?: string;
    creationDate?: Date;
    modificationDate?: Date;
    // Excel-specific metadata
    sheetCount?: number;
    sheetNames?: string[];
  };
  items: {
    text: OfficeTextItem[];
    tables: OfficeTableItem[];
    images: OfficeImageItem[];
  };
  statistics: {
    totalTextItems: number;
    totalTables: number;
    totalImages: number;
    totalWords: number;
    totalSheets?: number; // For Excel files
  };
}

export class EnhancedOfficeProcessor {
  private static instance: EnhancedOfficeProcessor;
  private processedDocuments: Map<string, OfficeDocumentData> = new Map();

  private constructor() {}

  public static getInstance(): EnhancedOfficeProcessor {
    if (!EnhancedOfficeProcessor.instance) {
      EnhancedOfficeProcessor.instance = new EnhancedOfficeProcessor();
    }
    return EnhancedOfficeProcessor.instance;
  }

  /**
   * Process an Office file and extract all content with comprehensive metadata
   */
  public async processOfficeFile(
    fileData: ArrayBuffer,
    fileName: string,
    fileType: 'docx' | 'doc' | 'xlsx' | 'xls',
    options: {
      extractImages?: boolean;
      extractTables?: boolean;
      includeFormatting?: boolean;
    } = {}
  ): Promise<OfficeDocumentData> {
    const startTime = Date.now();
    console.log(`🔄 Starting comprehensive Office document processing: ${fileName} (${fileType})`);

    const {
      extractImages = true,
      extractTables = true,
      includeFormatting = true,
    } = options;

    try {
      let documentData: OfficeDocumentData;

      switch (fileType) {
        case 'docx':
          documentData = await this.processWordDocument(fileData, fileName, {
            extractImages,
            includeFormatting,
          });
          break;
        case 'doc':
          // For legacy .doc files, we'll use a simplified approach
          documentData = await this.processLegacyWordDocument(fileData, fileName);
          break;
        case 'xlsx':
        case 'xls':
          documentData = await this.processExcelDocument(fileData, fileName, fileType, {
            extractTables,
          });
          break;
        default:
          throw new Error(`Unsupported file type: ${fileType}`);
      }

      // Record processing time
      documentData.metadata.processingTime = Date.now() - startTime;

      // Cache the processed document
      const cacheKey = `${fileName}-${fileData.byteLength}-${startTime}`;
      this.processedDocuments.set(cacheKey, documentData);

      console.log(`✅ Office document processing completed: ${fileName}`);
      console.log(`📊 Statistics:`, documentData.statistics);

      return documentData;

    } catch (error) {
      console.error(`❌ Error processing Office document ${fileName}:`, error);
      throw new Error(`Failed to process Office document: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Process Word document (.docx) using mammoth
   */
  private async processWordDocument(
    fileData: ArrayBuffer,
    fileName: string,
    options: {
      extractImages: boolean;
      includeFormatting: boolean;
    }
  ): Promise<OfficeDocumentData> {
    console.log(`📄 Processing Word document: ${fileName}`);

    const documentData: OfficeDocumentData = {
      metadata: {
        fileName,
        fileType: 'docx',
        fileSize: fileData.byteLength,
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
      // Configure mammoth options
      const mammothOptions: any = {
        convertImage: options.extractImages ? mammoth.images.imgElement((image: any) => {
          return image.read("base64").then((imageBuffer: string) => {
            // Store image data for later processing
            const imageItem: OfficeImageItem = {
              id: `image-${documentData.items.images.length}`,
              type: 'image',
              content: `data:${image.contentType};base64,${imageBuffer}`,
              metadata: {
                sourceFile: fileName,
                contentType: 'docx',
                processingMethod: 'mammoth-extraction',
                confidence: 0.9,
                extractionTimestamp: new Date(),
                format: image.contentType || 'unknown',
                size: Math.round((imageBuffer.length * 3) / 4), // Approximate size from base64
              },
            };
            documentData.items.images.push(imageItem);
            return { src: imageItem.content };
          });
        }) : undefined,
      };

      // Extract text content
      const result = await mammoth.extractRawText({ arrayBuffer: fileData });
      
      if (result.value) {
        // Split text into paragraphs and process each one
        const paragraphs = result.value.split('\n').filter(p => p.trim().length > 0);
        
        paragraphs.forEach((paragraph, index) => {
          const textItem: OfficeTextItem = {
            id: `text-${index}`,
            type: 'text',
            content: paragraph.trim(),
            metadata: {
              sourceFile: fileName,
              contentType: 'docx',
              processingMethod: 'mammoth-extraction',
              textLength: paragraph.length,
              wordCount: paragraph.trim().split(/\s+/).length,
              confidence: 0.95,
              extractionTimestamp: new Date(),
              paragraphIndex: index,
              isHeading: this.detectHeading(paragraph),
              headingLevel: this.detectHeadingLevel(paragraph),
            },
          };
          documentData.items.text.push(textItem);
        });
      }

      // Process warnings if any
      if (result.messages && result.messages.length > 0) {
        console.warn(`⚠️ Mammoth processing warnings for ${fileName}:`, result.messages);
      }

      // Try to extract document properties if available
      try {
        // Note: mammoth doesn't directly expose document properties
        // This is a placeholder for future enhancement
        console.log(`📋 Document properties extraction not yet implemented for ${fileName}`);
      } catch (propError) {
        console.warn(`Could not extract document properties from ${fileName}:`, propError);
      }

      // Calculate statistics
      documentData.statistics = {
        totalTextItems: documentData.items.text.length,
        totalTables: documentData.items.tables.length,
        totalImages: documentData.items.images.length,
        totalWords: documentData.items.text.reduce((sum, item) => sum + item.metadata.wordCount, 0),
      };

      console.log(`✅ Word document processed: ${fileName}`);
      return documentData;

    } catch (error) {
      console.error(`❌ Error processing Word document ${fileName}:`, error);
      throw error;
    }
  }

  /**
   * Process legacy Word document (.doc) - simplified approach
   */
  private async processLegacyWordDocument(
    fileData: ArrayBuffer,
    fileName: string
  ): Promise<OfficeDocumentData> {
    console.log(`📄 Processing legacy Word document: ${fileName}`);

    const documentData: OfficeDocumentData = {
      metadata: {
        fileName,
        fileType: 'doc',
        fileSize: fileData.byteLength,
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
      // For legacy .doc files, we'll provide a basic text extraction
      // Note: Full .doc support would require additional libraries like node-word-extractor
      const textItem: OfficeTextItem = {
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

      documentData.items.text.push(textItem);

      // Calculate statistics
      documentData.statistics = {
        totalTextItems: 1,
        totalTables: 0,
        totalImages: 0,
        totalWords: 0,
      };

      console.log(`⚠️ Legacy Word document processed with limited support: ${fileName}`);
      return documentData;

    } catch (error) {
      console.error(`❌ Error processing legacy Word document ${fileName}:`, error);
      throw error;
    }
  }

  /**
   * Process Excel document (.xlsx/.xls) using xlsx library
   */
  private async processExcelDocument(
    fileData: ArrayBuffer,
    fileName: string,
    fileType: 'xlsx' | 'xls',
    options: {
      extractTables: boolean;
    }
  ): Promise<OfficeDocumentData> {
    console.log(`📊 Processing Excel document: ${fileName} (${fileType})`);

    const documentData: OfficeDocumentData = {
      metadata: {
        fileName,
        fileType,
        fileSize: fileData.byteLength,
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
      const workbook = XLSX.read(fileData, { type: 'array' });
      
      // Extract metadata
      documentData.metadata.sheetCount = workbook.SheetNames.length;
      documentData.metadata.sheetNames = workbook.SheetNames;
      documentData.statistics.totalSheets = workbook.SheetNames.length;

      console.log(`📋 Excel file contains ${workbook.SheetNames.length} sheets: ${workbook.SheetNames.join(', ')}`);

      // Process each worksheet
      workbook.SheetNames.forEach((sheetName: string, sheetIndex: number) => {
        console.log(`📄 Processing sheet: ${sheetName} (${sheetIndex + 1}/${workbook.SheetNames.length})`);
        
        const worksheet = workbook.Sheets[sheetName];
        
        if (!worksheet) {
          console.warn(`⚠️ Sheet ${sheetName} is empty or could not be read`);
          return;
        }

        // Get the range of the worksheet
        const range = XLSX.utils.decode_range(worksheet['!ref'] || 'A1:A1');
        console.log(`📐 Sheet ${sheetName} range: ${XLSX.utils.encode_range(range)}`);

        if (options.extractTables) {
          // Convert worksheet to array of arrays (table format)
          const sheetData = XLSX.utils.sheet_to_json(worksheet, { 
            header: 1, 
            defval: '', 
            raw: false 
          }) as string[][];

          if (sheetData.length > 0) {
            // Filter out completely empty rows
            const filteredData = sheetData.filter(row => 
              row.some(cell => cell && cell.toString().trim() !== '')
            );

            if (filteredData.length > 0) {
              // Detect if first row contains headers
              const hasHeaders = this.detectExcelHeaders(filteredData);
              
              const tableItem: OfficeTableItem = {
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

              documentData.items.tables.push(tableItem);
              console.log(`✅ Extracted table from sheet ${sheetName}: ${tableItem.metadata.structure.rows} rows, ${tableItem.metadata.structure.columns} columns`);
            }
          }
        }

        // Extract individual cell text for text search
        const cellTexts: string[] = [];
        for (let R = range.s.r; R <= range.e.r; ++R) {
          for (let C = range.s.c; C <= range.e.c; ++C) {
            const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
            const cell = worksheet[cellAddress];
            
            if (cell && cell.v) {
              const cellValue = cell.v.toString().trim();
              if (cellValue) {
                cellTexts.push(cellValue);
                
                // Create individual text items for searchable content
                const textItem: OfficeTextItem = {
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
                  },
                };
                
                documentData.items.text.push(textItem);
              }
            }
          }
        }

        console.log(`📝 Extracted ${cellTexts.length} text items from sheet ${sheetName}`);
      });

      // Calculate final statistics
      documentData.statistics = {
        totalTextItems: documentData.items.text.length,
        totalTables: documentData.items.tables.length,
        totalImages: documentData.items.images.length,
        totalWords: documentData.items.text.reduce((sum, item) => sum + item.metadata.wordCount, 0),
        totalSheets: workbook.SheetNames.length,
      };

      console.log(`✅ Excel document processed: ${fileName}`);
      return documentData;

    } catch (error) {
      console.error(`❌ Error processing Excel document ${fileName}:`, error);
      throw error;
    }
  }

  /**
   * Helper methods for content analysis
   */
  private detectHeading(text: string): boolean {
    // Simple heuristics to detect headings
    const headingPatterns = [
      /^(Chapter|Section|Part)\s+\d+/i,
      /^[A-Z][A-Z\s]{2,}$/,  // ALL CAPS
      /^\d+\.\s+[A-Z]/,      // Numbered headings
      /^[A-Z][^.!?]*$/,      // Sentence case without punctuation
    ];
    
    return headingPatterns.some(pattern => pattern.test(text.trim())) && text.length < 100;
  }

  private detectHeadingLevel(text: string): number {
    // Simple heading level detection
    if (/^(Chapter|Part)/i.test(text)) return 1;
    if (/^Section/i.test(text)) return 2;
    if (/^\d+\.\s+/.test(text)) return 3;
    if (/^[A-Z][A-Z\s]{2,}$/.test(text)) return 2;
    return 0; // Not a heading
  }

  private detectExcelHeaders(data: string[][]): boolean {
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

  /**
   * Get processed document from cache
   */
  public getProcessedDocument(cacheKey: string): OfficeDocumentData | null {
    return this.processedDocuments.get(cacheKey) || null;
  }

  /**
   * Clear document cache
   */
  public clearCache(): void {
    this.processedDocuments.clear();
  }

  /**
   * Get cache statistics
   */
  public getCacheStats(): {
    documentsInCache: number;
    totalMemoryUsage: number;
  } {
    let totalMemoryUsage = 0;
    
    this.processedDocuments.forEach(doc => {
      // Estimate memory usage
      totalMemoryUsage += JSON.stringify(doc).length * 2; // Rough estimate
    });

    return {
      documentsInCache: this.processedDocuments.size,
      totalMemoryUsage,
    };
  }
}

// Export singleton instance
export const officeProcessor = EnhancedOfficeProcessor.getInstance();
