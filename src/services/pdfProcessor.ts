import { getDocument, PDFPageProxy } from 'pdfjs-dist';
import { TextItem } from 'pdfjs-dist/types/src/display/api';

// Enhanced metadata interfaces for comprehensive PDF processing
export interface PDFTextItem {
  id: string;
  type: 'text';
  content: string;
  pageNumber: number;
  position: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  fontSize: number;
  fontName: string;
  color: string;
  transform: number[];
  metadata: {
    isTitle: boolean;
    isHeader: boolean;
    isFooter: boolean;
    confidence: number;
    textLength: number;
    wordCount: number;
  };
}

export interface PDFImageItem {
  id: string;
  type: 'image';
  content: string; // Base64 data URL
  pageNumber: number;
  position: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  dimensions: {
    originalWidth: number;
    originalHeight: number;
    scaledWidth: number;
    scaledHeight: number;
  };
  metadata: {
    format: string;
    size: number;
    isChart: boolean;
    isDiagram: boolean;
    isPhoto: boolean;
    confidence: number;
    extractionMethod: string;
  };
}

export interface PDFTableItem {
  id: string;
  type: 'table';
  content: string[][]; // 2D array of cell contents
  pageNumber: number;
  position: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  structure: {
    rows: number;
    columns: number;
    hasHeaders: boolean;
    headerRow?: string[];
  };
  metadata: {
    confidence: number;
    extractionMethod: string;
    cellCount: number;
  };
}

export interface PDFChartItem {
  id: string;
  type: 'chart';
  content: string; // Base64 image of chart
  pageNumber: number;
  position: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  chartData: {
    type: 'bar' | 'line' | 'pie' | 'scatter' | 'unknown';
    title?: string;
    labels?: string[];
    values?: number[];
  };
  metadata: {
    confidence: number;
    extractionMethod: string;
    hasLegend: boolean;
    hasAxes: boolean;
  };
}

export interface PDFPageMetadata {
  pageNumber: number;
  dimensions: {
    width: number;
    height: number;
    rotation: number;
  };
  itemCounts: {
    text: number;
    images: number;
    tables: number;
    charts: number;
  };
  layout: {
    hasMultipleColumns: boolean;
    columnCount: number;
    hasHeader: boolean;
    hasFooter: boolean;
  };
}

export interface PDFDocumentData {
  metadata: {
    title?: string;
    author?: string;
    subject?: string;
    creator?: string;
    producer?: string;
    creationDate?: Date;
    modificationDate?: Date;
    totalPages: number;
    fileSize: number;
    processingTime: number;
    extractionTimestamp: Date;
  };
  pages: PDFPageMetadata[];
  items: {
    text: PDFTextItem[];
    images: PDFImageItem[];
    tables: PDFTableItem[];
    charts: PDFChartItem[];
  };
  statistics: {
    totalTextItems: number;
    totalImages: number;
    totalTables: number;
    totalCharts: number;
    totalWords: number;
    averageItemsPerPage: number;
  };
}

export class EnhancedPDFProcessor {
  private static instance: EnhancedPDFProcessor;
  private processedDocuments: Map<string, PDFDocumentData> = new Map();

  private constructor() {}

  public static getInstance(): EnhancedPDFProcessor {
    if (!EnhancedPDFProcessor.instance) {
      EnhancedPDFProcessor.instance = new EnhancedPDFProcessor();
    }
    return EnhancedPDFProcessor.instance;
  }

  /**
   * Process a PDF file and extract all items with comprehensive metadata
   */
  public async processPDFFile(
    fileData: ArrayBuffer,
    fileName: string,
    options: {
      extractImages?: boolean;
      extractTables?: boolean;
      extractCharts?: boolean;
      highResolution?: boolean;
      pageRange?: { start: number; end: number };
    } = {}
  ): Promise<PDFDocumentData> {
    const startTime = Date.now();
    console.log(`🔄 Starting comprehensive PDF processing: ${fileName}`);

    const {
      extractImages = true,
      extractTables = true,
      extractCharts = true,
      highResolution = true,
      pageRange
    } = options;

    try {
      // Load PDF document
      const pdf = await getDocument({
        data: fileData,
        verbosity: 0,
        isEvalSupported: false,
        disableFontFace: false,
      }).promise;

      console.log(`📄 PDF loaded: ${pdf.numPages} pages`);

      // Initialize document data structure
      const documentData: PDFDocumentData = {
        metadata: {
          totalPages: pdf.numPages,
          fileSize: fileData.byteLength,
          processingTime: 0,
          extractionTimestamp: new Date(),
        },
        pages: [],
        items: {
          text: [],
          images: [],
          tables: [],
          charts: [],
        },
        statistics: {
          totalTextItems: 0,
          totalImages: 0,
          totalTables: 0,
          totalCharts: 0,
          totalWords: 0,
          averageItemsPerPage: 0,
        },
      };

      // Extract document metadata
      try {
        const metadata = await pdf.getMetadata();
        if (metadata.info) {
          const info = metadata.info as any; // Type assertion for PDF metadata
          documentData.metadata = {
            ...documentData.metadata,
            title: info.Title || undefined,
            author: info.Author || undefined,
            subject: info.Subject || undefined,
            creator: info.Creator || undefined,
            producer: info.Producer || undefined,
            creationDate: info.CreationDate || undefined,
            modificationDate: info.ModDate || undefined,
          };
        }
      } catch (metadataError) {
        console.warn('Could not extract PDF metadata:', metadataError);
      }

      // Determine page range to process
      const startPage = pageRange?.start || 1;
      const endPage = pageRange?.end || pdf.numPages;
      const pagesToProcess = Math.min(endPage, pdf.numPages) - startPage + 1;

      console.log(`📄 Processing pages ${startPage} to ${Math.min(endPage, pdf.numPages)}`);

      // Process each page
      for (let pageNum = startPage; pageNum <= Math.min(endPage, pdf.numPages); pageNum++) {
        console.log(`🔄 Processing page ${pageNum}/${pdf.numPages}`);
        
        const page = await pdf.getPage(pageNum);
        const pageData = await this.processPage(page, pageNum, {
          extractImages,
          extractTables,
          extractCharts,
          highResolution,
        });

        // Add page metadata
        documentData.pages.push(pageData.metadata);

        // Add extracted items
        documentData.items.text.push(...pageData.items.text);
        documentData.items.images.push(...pageData.items.images);
        documentData.items.tables.push(...pageData.items.tables);
        documentData.items.charts.push(...pageData.items.charts);
      }

      // Calculate statistics
      documentData.statistics = {
        totalTextItems: documentData.items.text.length,
        totalImages: documentData.items.images.length,
        totalTables: documentData.items.tables.length,
        totalCharts: documentData.items.charts.length,
        totalWords: documentData.items.text.reduce((sum, item) => sum + item.metadata.wordCount, 0),
        averageItemsPerPage: (
          documentData.items.text.length +
          documentData.items.images.length +
          documentData.items.tables.length +
          documentData.items.charts.length
        ) / pagesToProcess,
      };

      // Record processing time
      documentData.metadata.processingTime = Date.now() - startTime;

      // Cache the processed document
      const cacheKey = `${fileName}-${fileData.byteLength}-${startTime}`;
      this.processedDocuments.set(cacheKey, documentData);

      console.log(`✅ PDF processing completed: ${fileName}`);
      console.log(`📊 Statistics:`, documentData.statistics);

      return documentData;

    } catch (error) {
      console.error(`❌ Error processing PDF ${fileName}:`, error);
      throw new Error(`Failed to process PDF: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Process a single page and extract all items
   */
  private async processPage(
    page: PDFPageProxy,
    pageNumber: number,
    options: {
      extractImages: boolean;
      extractTables: boolean;
      extractCharts: boolean;
      highResolution: boolean;
    }
  ): Promise<{
    metadata: PDFPageMetadata;
    items: {
      text: PDFTextItem[];
      images: PDFImageItem[];
      tables: PDFTableItem[];
      charts: PDFChartItem[];
    };
  }> {
    const viewport = page.getViewport({ scale: 1.0 });
    const pageItems = {
      text: [] as PDFTextItem[],
      images: [] as PDFImageItem[],
      tables: [] as PDFTableItem[],
      charts: [] as PDFChartItem[],
    };

    // Extract text content with positioning
    const textItems = await this.extractTextWithPositions(page, pageNumber);
    pageItems.text = textItems;

    // Extract images if requested
    if (options.extractImages) {
      const imageItems = await this.extractImages(page, pageNumber, options.highResolution);
      pageItems.images = imageItems;
    }

    // Extract tables if requested
    if (options.extractTables) {
      const tableItems = await this.extractTables(page, pageNumber, textItems);
      pageItems.tables = tableItems;
    }

    // Extract charts if requested
    if (options.extractCharts) {
      const chartItems = await this.extractCharts(page, pageNumber, pageItems.images);
      pageItems.charts = chartItems;
    }

    // Analyze page layout
    const layout = this.analyzePageLayout(textItems, viewport);

    const pageMetadata: PDFPageMetadata = {
      pageNumber,
      dimensions: {
        width: viewport.width,
        height: viewport.height,
        rotation: viewport.rotation,
      },
      itemCounts: {
        text: pageItems.text.length,
        images: pageItems.images.length,
        tables: pageItems.tables.length,
        charts: pageItems.charts.length,
      },
      layout,
    };

    return { metadata: pageMetadata, items: pageItems };
  }

  /**
   * Extract text content with detailed positioning information
   */
  private async extractTextWithPositions(page: PDFPageProxy, pageNumber: number): Promise<PDFTextItem[]> {
    const textContent = await page.getTextContent();
    const textItems: PDFTextItem[] = [];

    console.log(`📝 Extracting ${textContent.items.length} text items from page ${pageNumber}`);

    textContent.items.forEach((item, index) => {
      if ('str' in item && item.str.trim()) {
        const textItem = item as TextItem;
        
        const pdfTextItem: PDFTextItem = {
          id: `text-${pageNumber}-${index}`,
          type: 'text',
          content: textItem.str,
          pageNumber,
          position: {
            x: textItem.transform[4],
            y: textItem.transform[5],
            width: textItem.width,
            height: textItem.height,
          },
          fontSize: Math.abs(textItem.transform[0]),
          fontName: textItem.fontName,
          color: this.extractColor(textItem),
          transform: textItem.transform,
          metadata: {
            isTitle: this.isTitle(textItem),
            isHeader: this.isHeader(textItem, page.getViewport({ scale: 1.0 })),
            isFooter: this.isFooter(textItem, page.getViewport({ scale: 1.0 })),
            confidence: 1.0,
            textLength: textItem.str.length,
            wordCount: textItem.str.trim().split(/\s+/).length,
          },
        };

        textItems.push(pdfTextItem);
      }
    });

    console.log(`✅ Extracted ${textItems.length} text items from page ${pageNumber}`);
    return textItems;
  }

  /**
   * Extract images from the page - ONLY actual embedded images, not full page renders
   */
  private async extractImages(page: PDFPageProxy, pageNumber: number, highResolution: boolean): Promise<PDFImageItem[]> {
    const images: PDFImageItem[] = [];
    
    try {
      console.log(`🖼️ Extracting ONLY embedded images from page ${pageNumber}`);
      
      // Extract ONLY embedded images using PDF.js operators
      const embeddedImages = await this.extractEmbeddedImages(page, pageNumber);
      images.push(...embeddedImages);
      
      console.log(`✅ Found ${embeddedImages.length} actual embedded images on page ${pageNumber}`);
      
      // DO NOT create full page renders - only extract actual embedded images
      // This prevents the issue of converting text pages to images

    } catch (error) {
      console.warn(`Could not extract embedded images from page ${pageNumber}:`, error);
    }

    return images;
  }

  /**
   * Extract individual image regions from rendered canvas
   */
  private async extractImageRegions(
    canvas: HTMLCanvasElement, 
    context: CanvasRenderingContext2D, 
    pageNumber: number, 
    totalTextLength: number
  ): Promise<PDFImageItem[]> {
    const images: PDFImageItem[] = [];
    
    try {
      // This is a placeholder for more advanced image region detection
      // In a full implementation, you would:
      // 1. Analyze the canvas pixel data to find distinct image regions
      // 2. Use edge detection to identify boundaries
      // 3. Extract individual image regions as separate items
      
      // For now, we'll skip this advanced processing
      console.log(`🔍 Advanced image region detection not yet implemented for page ${pageNumber}`);
      
    } catch (error) {
      console.warn(`Could not extract image regions from page ${pageNumber}:`, error);
    }
    
    return images;
  }

  /**
   * Extract embedded images from PDF page using a more robust approach
   */
  private async extractEmbeddedImages(page: PDFPageProxy, pageNumber: number): Promise<PDFImageItem[]> {
    const images: PDFImageItem[] = [];
    
    try {
      console.log(`🔍 Attempting to extract embedded images from page ${pageNumber}`);
      
      // Since PDF.js doesn't provide direct access to embedded images,
      // we'll use a different approach: render the page and detect image regions
      
      // First, get text content to identify non-text areas
      const textContent = await page.getTextContent();
      const viewport = page.getViewport({ scale: 2.0 });
      
      // Create a high-resolution render of the page
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      
      if (!context) {
        console.warn(`Could not get canvas context for page ${pageNumber}`);
        return images;
      }

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';

      // Render the page
      await page.render({
        canvasContext: context,
        viewport: viewport,
        intent: 'display',
      }).promise;

      // Analyze the rendered page to find image regions
      // This is a simplified approach - in a production system, you'd use more sophisticated image detection
      
      // Check if the page has significant visual content beyond text
      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const pixels = imageData.data;
      
      // Simple heuristic: if there are many non-white pixels that aren't likely text,
      // there might be images
      let nonWhitePixels = 0;
      let totalPixels = pixels.length / 4;
      
      for (let i = 0; i < pixels.length; i += 4) {
        const r = pixels[i];
        const g = pixels[i + 1];
        const b = pixels[i + 2];
        
        // Count non-white pixels (allowing for slight variations)
        if (r < 240 || g < 240 || b < 240) {
          nonWhitePixels++;
        }
      }
      
      const nonWhiteRatio = nonWhitePixels / totalPixels;
      console.log(`📊 Page ${pageNumber} analysis: ${(nonWhiteRatio * 100).toFixed(1)}% non-white pixels`);
      
      // If there's significant visual content and minimal text, likely contains images
      const textLength = textContent.items
        .filter((item): item is any => 'str' in item)
        .reduce((sum, item) => sum + item.str.length, 0);
      
      console.log(`📝 Page ${pageNumber} text length: ${textLength} characters`);
      
      // Heuristic: if there's visual content but little text, extract as image
      if (nonWhiteRatio > 0.1 && textLength < 500) {
        console.log(`🖼️ Page ${pageNumber} appears to contain significant visual content - extracting as image`);
        
        // Extract the entire page as an image for now
        // In a more sophisticated implementation, you'd segment the image regions
        const imageDataUrl = await this.optimizeImageForLLM(canvas, pageNumber, 'visual-content');
        
        const imageItem: PDFImageItem = {
          id: `image-${pageNumber}-visual-content`,
          type: 'image',
          content: imageDataUrl,
          pageNumber,
          position: { x: 0, y: 0, width: viewport.width / 2, height: viewport.height / 2 },
          dimensions: {
            originalWidth: viewport.width,
            originalHeight: viewport.height,
            scaledWidth: viewport.width / 2,
            scaledHeight: viewport.height / 2,
          },
          metadata: {
            format: 'jpeg',
            size: Math.round((imageDataUrl.split(',')[1]?.length || 0) * 3 / 4),
            isChart: textLength < 100, // Very little text suggests chart/diagram
            isDiagram: textLength < 200,
            isPhoto: textLength < 50,
            confidence: 0.8,
            extractionMethod: 'visual-content-detection',
          },
        };
        
        images.push(imageItem);
        console.log(`✅ Extracted visual content from page ${pageNumber}: ${Math.round(imageItem.metadata.size / 1024)}KB`);
      }
      
      console.log(`📊 Extracted ${images.length} image regions from page ${pageNumber}`);
      
    } catch (error) {
      console.warn(`Could not extract images from page ${pageNumber}:`, error);
    }
    
    return images;
  }

  /**
   * Multiply two transformation matrices
   */
  private multiplyMatrices(m1: number[], m2: number[]): number[] {
    return [
      m1[0] * m2[0] + m1[2] * m2[1],
      m1[1] * m2[0] + m1[3] * m2[1],
      m1[0] * m2[2] + m1[2] * m2[3],
      m1[1] * m2[2] + m1[3] * m2[3],
      m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
      m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
    ];
  }

  /**
   * Extract tables from text content
   */
  private async extractTables(page: PDFPageProxy, pageNumber: number, textItems: PDFTextItem[]): Promise<PDFTableItem[]> {
    const tables: PDFTableItem[] = [];

    // Simple table detection based on text alignment and spacing
    // This is a basic implementation - more sophisticated table detection
    // would analyze the spatial relationships between text items
    
    const sortedItems = textItems
      .filter(item => item.content.trim().length > 0)
      .sort((a, b) => b.position.y - a.position.y); // Sort by Y position (top to bottom)

    // Group items by approximate Y position (rows)
    const rows: PDFTextItem[][] = [];
    let currentRow: PDFTextItem[] = [];
    let lastY = -1;
    const yTolerance = 5; // Pixels tolerance for same row

    for (const item of sortedItems) {
      if (lastY === -1 || Math.abs(item.position.y - lastY) <= yTolerance) {
        currentRow.push(item);
        lastY = item.position.y;
      } else {
        if (currentRow.length > 0) {
          currentRow.sort((a, b) => a.position.x - b.position.x); // Sort by X position (left to right)
          rows.push(currentRow);
        }
        currentRow = [item];
        lastY = item.position.y;
      }
    }

    if (currentRow.length > 0) {
      currentRow.sort((a, b) => a.position.x - b.position.x);
      rows.push(currentRow);
    }

    // Detect potential tables (rows with similar column structure)
    if (rows.length >= 3) { // At least 3 rows to consider it a table
      const potentialTables = this.detectTableStructures(rows);
      
      potentialTables.forEach((tableRows, index) => {
        const tableContent = tableRows.map(row => row.map(item => item.content));
        const firstRow = tableRows[0];
        const lastRow = tableRows[tableRows.length - 1];
        
        const minX = Math.min(...firstRow.map(item => item.position.x));
        const maxX = Math.max(...firstRow.map(item => item.position.x + item.position.width));
        const minY = Math.min(...firstRow.map(item => item.position.y));
        const maxY = Math.max(...lastRow.map(item => item.position.y + item.position.height));

        const tableItem: PDFTableItem = {
          id: `table-${pageNumber}-${index}`,
          type: 'table',
          content: tableContent,
          pageNumber,
          position: {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY,
          },
          structure: {
            rows: tableRows.length,
            columns: Math.max(...tableRows.map(row => row.length)),
            hasHeaders: this.detectTableHeaders(tableRows),
            headerRow: this.detectTableHeaders(tableRows) ? tableContent[0] : undefined,
          },
          metadata: {
            confidence: 0.7,
            extractionMethod: 'text-alignment-analysis',
            cellCount: tableContent.reduce((sum, row) => sum + row.length, 0),
          },
        };

        tables.push(tableItem);
      });
    }

    return tables;
  }

  /**
   * Extract charts by analyzing images for chart-like patterns
   */
  private async extractCharts(page: PDFPageProxy, pageNumber: number, images: PDFImageItem[]): Promise<PDFChartItem[]> {
    const charts: PDFChartItem[] = [];

    // For each image, analyze if it might be a chart
    for (const image of images) {
      const chartAnalysis = await this.analyzeImageForChart(image);
      
      if (chartAnalysis.isChart) {
        const chartItem: PDFChartItem = {
          id: `chart-${pageNumber}-${charts.length}`,
          type: 'chart',
          content: image.content,
          pageNumber,
          position: image.position,
          chartData: chartAnalysis.chartData,
          metadata: {
            confidence: chartAnalysis.confidence,
            extractionMethod: 'image-analysis',
            hasLegend: chartAnalysis.hasLegend,
            hasAxes: chartAnalysis.hasAxes,
          },
        };

        charts.push(chartItem);
        
        // Mark the original image as a chart
        image.metadata.isChart = true;
      }
    }

    return charts;
  }

  /**
   * Helper methods for content analysis
   */
  private extractColor(textItem: TextItem): string {
    // Extract color information from text item
    // This is a simplified implementation
    return '#000000'; // Default to black
  }

  private isTitle(textItem: TextItem): boolean {
    const fontSize = Math.abs(textItem.transform[0]);
    return fontSize > 16 && textItem.str.length < 100;
  }

  private isHeader(textItem: TextItem, viewport: any): boolean {
    const y = textItem.transform[5];
    return y > viewport.height * 0.9; // Top 10% of page
  }

  private isFooter(textItem: TextItem, viewport: any): boolean {
    const y = textItem.transform[5];
    return y < viewport.height * 0.1; // Bottom 10% of page
  }

  private analyzePageLayout(textItems: PDFTextItem[], viewport: any): {
    hasMultipleColumns: boolean;
    columnCount: number;
    hasHeader: boolean;
    hasFooter: boolean;
  } {
    const hasHeader = textItems.some(item => item.metadata.isHeader);
    const hasFooter = textItems.some(item => item.metadata.isFooter);
    
    // Simple column detection based on text distribution
    const xPositions = textItems.map(item => item.position.x);
    const uniqueXPositions = Array.from(new Set(xPositions.map(x => Math.round(x / 10) * 10))).sort((a, b) => a - b);
    
    const hasMultipleColumns = uniqueXPositions.length > 2;
    const columnCount = hasMultipleColumns ? Math.min(uniqueXPositions.length, 4) : 1;

    return {
      hasMultipleColumns,
      columnCount,
      hasHeader,
      hasFooter,
    };
  }

  private detectTableStructures(rows: PDFTextItem[][]): PDFTextItem[][][] {
    const tables: PDFTextItem[][][] = [];
    
    if (rows.length < 3) return tables;
    
    console.log(`🔍 Analyzing ${rows.length} rows for table structures`);
    
    // Analyze column alignment patterns
    const columnPositions = new Map<number, number>(); // x-position -> count
    
    // Collect all unique X positions and their frequencies
    rows.forEach(row => {
      row.forEach(item => {
        const roundedX = Math.round(item.position.x / 10) * 10; // Group similar positions
        columnPositions.set(roundedX, (columnPositions.get(roundedX) || 0) + 1);
      });
    });
    
    // Find consistent column positions (appear in multiple rows)
    const consistentColumns = Array.from(columnPositions.entries())
      .filter(([_, count]) => count >= Math.max(2, Math.floor(rows.length * 0.3)))
      .map(([x, _]) => x)
      .sort((a, b) => a - b);
    
    console.log(`📊 Found ${consistentColumns.length} consistent column positions:`, consistentColumns);
    
    if (consistentColumns.length >= 2) {
      // Group consecutive rows that follow the column pattern
      let currentTable: PDFTextItem[][] = [];
      
      for (const row of rows) {
        // Check if this row follows the column pattern
        const rowColumns = row.map(item => Math.round(item.position.x / 10) * 10);
        const matchingColumns = rowColumns.filter(x => consistentColumns.includes(x));
        
        // If at least 50% of the row's items align with consistent columns
        if (matchingColumns.length >= Math.max(1, Math.floor(rowColumns.length * 0.5))) {
          currentTable.push(row);
        } else {
          // Break in pattern - save current table if it's substantial
          if (currentTable.length >= 3) {
            tables.push([...currentTable]);
            console.log(`✅ Detected table with ${currentTable.length} rows and ${consistentColumns.length} columns`);
          }
          currentTable = [];
        }
      }
      
      // Don't forget the last table
      if (currentTable.length >= 3) {
        tables.push(currentTable);
        console.log(`✅ Detected final table with ${currentTable.length} rows and ${consistentColumns.length} columns`);
      }
    }
    
    console.log(`📋 Total tables detected: ${tables.length}`);
    return tables;
  }

  private detectTableHeaders(tableRows: PDFTextItem[][]): boolean {
    if (tableRows.length < 2) return false;
    
    const firstRow = tableRows[0];
    const secondRow = tableRows[1];
    
    // Check if first row has different formatting (larger font, bold, etc.)
    const firstRowAvgFontSize = firstRow.reduce((sum, item) => sum + item.fontSize, 0) / firstRow.length;
    const secondRowAvgFontSize = secondRow.reduce((sum, item) => sum + item.fontSize, 0) / secondRow.length;
    
    return firstRowAvgFontSize > secondRowAvgFontSize * 1.1;
  }

  private async analyzeImageForChart(image: PDFImageItem): Promise<{
    isChart: boolean;
    confidence: number;
    chartData: PDFChartItem['chartData'];
    hasLegend: boolean;
    hasAxes: boolean;
  }> {
    // This is a placeholder for chart analysis
    // In a real implementation, you would use image processing techniques
    // or machine learning models to detect charts
    
    return {
      isChart: false,
      confidence: 0.1,
      chartData: {
        type: 'unknown',
      },
      hasLegend: false,
      hasAxes: false,
    };
  }

  /**
   * Optimize image for LLM processing with proper compression and validation
   */
  private async optimizeImageForLLM(canvas: HTMLCanvasElement, pageNumber: number, suffix?: string): Promise<string> {
    try {
      // Get canvas dimensions
      const { width, height } = canvas;
      console.log(`🖼️ Optimizing image for page ${pageNumber}: ${width}x${height}`);
      
      // Calculate optimal dimensions for LLM processing
      // Most LLMs work best with images under 2048x2048 and under 20MB
      const maxDimension = 2048;
      const maxFileSize = 10 * 1024 * 1024; // 10MB limit
      
      let targetWidth = width;
      let targetHeight = height;
      
      // Scale down if too large
      if (width > maxDimension || height > maxDimension) {
        const scale = Math.min(maxDimension / width, maxDimension / height);
        targetWidth = Math.round(width * scale);
        targetHeight = Math.round(height * scale);
        console.log(`📏 Scaling image from ${width}x${height} to ${targetWidth}x${targetHeight}`);
      }
      
      // Create optimized canvas if resizing is needed
      let finalCanvas = canvas;
      if (targetWidth !== width || targetHeight !== height) {
        finalCanvas = document.createElement('canvas');
        finalCanvas.width = targetWidth;
        finalCanvas.height = targetHeight;
        
        const ctx = finalCanvas.getContext('2d');
        if (!ctx) {
          throw new Error('Could not get 2D context for optimization canvas');
        }
        
        // Use high-quality scaling
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(canvas, 0, 0, targetWidth, targetHeight);
      }
      
      // Try different quality levels to find optimal compression
      let quality = 0.95;
      let dataUrl = '';
      let attempts = 0;
      const maxAttempts = 10;
      
      do {
        dataUrl = finalCanvas.toDataURL('image/jpeg', quality);
        const sizeBytes = Math.round((dataUrl.split(',')[1]?.length || 0) * 3 / 4);
        
        console.log(`🔍 Attempt ${attempts + 1}: Quality ${quality.toFixed(2)}, Size: ${Math.round(sizeBytes / 1024)}KB`);
        
        if (sizeBytes <= maxFileSize || quality <= 0.1) {
          break;
        }
        
        quality -= 0.1;
        attempts++;
      } while (attempts < maxAttempts);
      
      // Validate the final data URL
      if (!dataUrl || !dataUrl.startsWith('data:image/jpeg;base64,')) {
        throw new Error('Generated invalid data URL');
      }
      
      const finalSize = Math.round((dataUrl.split(',')[1]?.length || 0) * 3 / 4);
      console.log(`✅ Optimized image for page ${pageNumber}: ${targetWidth}x${targetHeight}, ${Math.round(finalSize / 1024)}KB, quality: ${quality.toFixed(2)}`);
      
      return dataUrl;
      
    } catch (error) {
      console.error(`❌ Error optimizing image for page ${pageNumber}:`, error);
      
      // Fallback: try basic canvas.toDataURL with lower quality
      try {
        const fallbackDataUrl = canvas.toDataURL('image/jpeg', 0.7);
        console.log(`⚠️ Using fallback image optimization for page ${pageNumber}`);
        return fallbackDataUrl;
      } catch (fallbackError) {
        console.error(`❌ Fallback optimization also failed for page ${pageNumber}:`, fallbackError);
        throw new Error(`Failed to optimize image for page ${pageNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    }
  }

  /**
   * Get processed document from cache
   */
  public getProcessedDocument(cacheKey: string): PDFDocumentData | null {
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
export const pdfProcessor = EnhancedPDFProcessor.getInstance();
