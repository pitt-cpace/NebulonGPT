import { PDFDocumentData, PDFTextItem, PDFImageItem, PDFTableItem, PDFChartItem } from './pdfProcessor';
import { ChartOutput } from './chartImageExtractor';

export interface LLMProcessingContext {
  documentOverview: string;
  pageDescriptions: Array<{
    pageNumber: number;
    description: string;
    images: Array<{
      imageData: string; // Base64 image data
      description: string;
      metadata: any;
    }>;
  }>;
  extractedCharts: Array<{
    imageData: string; // Base64 image data
    description: string;
    metadata: ChartOutput;
  }>;
  comprehensiveContext: string;
}

export class LLMDescriptionGenerator {
  private static instance: LLMDescriptionGenerator;

  private constructor() {}

  public static getInstance(): LLMDescriptionGenerator {
    if (!LLMDescriptionGenerator.instance) {
      LLMDescriptionGenerator.instance = new LLMDescriptionGenerator();
    }
    return LLMDescriptionGenerator.instance;
  }

  /**
   * Generate comprehensive LLM context from processed PDF data
   */
  public generateLLMContext(
    pdfData: PDFDocumentData,
    extractedCharts: ChartOutput[] = []
  ): LLMProcessingContext {
    console.log('🧠 Generating comprehensive LLM context for document processing');

    // Generate document overview
    const documentOverview = this.generateDocumentOverview(pdfData);

    // Generate page-by-page descriptions with images
    const pageDescriptions = this.generatePageDescriptions(pdfData);

    // Generate chart descriptions with images
    const chartDescriptions = this.generateChartDescriptions(extractedCharts);

    // Generate comprehensive context
    const comprehensiveContext = this.generateComprehensiveContext(
      pdfData,
      extractedCharts,
      documentOverview
    );

    return {
      documentOverview,
      pageDescriptions,
      extractedCharts: chartDescriptions,
      comprehensiveContext
    };
  }

  /**
   * Generate document overview for LLM context
   */
  private generateDocumentOverview(pdfData: PDFDocumentData): string {
    const { metadata, statistics } = pdfData;

    return `DOCUMENT OVERVIEW:
This is a ${metadata.totalPages}-page PDF document${metadata.title ? ` titled "${metadata.title}"` : ''}${metadata.author ? ` by ${metadata.author}` : ''}.

DOCUMENT STRUCTURE:
- Total Pages: ${metadata.totalPages}
- Text Elements: ${statistics.totalTextItems} items (${statistics.totalWords} words)
- Images: ${statistics.totalImages} visual elements
- Tables: ${statistics.totalTables} structured data tables
- Charts: ${statistics.totalCharts} data visualizations
- Average Content Density: ${statistics.averageItemsPerPage.toFixed(1)} items per page

CONTENT DISTRIBUTION:
${this.generateContentDistribution(pdfData)}

DOCUMENT METADATA:
${metadata.title ? `- Title: ${metadata.title}` : ''}
${metadata.author ? `- Author: ${metadata.author}` : ''}
${metadata.subject ? `- Subject: ${metadata.subject}` : ''}
${metadata.creator ? `- Created with: ${metadata.creator}` : ''}
${metadata.creationDate ? `- Created: ${metadata.creationDate.toDateString()}` : ''}

This document contains a mix of text, visual elements, and structured data that should be analyzed together for complete understanding.`;
  }

  /**
   * Generate content distribution analysis
   */
  private generateContentDistribution(pdfData: PDFDocumentData): string {
    const pageAnalysis = pdfData.pages.map(page => {
      const totalItems = page.itemCounts.text + page.itemCounts.images + page.itemCounts.tables + page.itemCounts.charts;
      const contentType = this.classifyPageContent(page.itemCounts);
      
      return `Page ${page.pageNumber}: ${contentType} (${totalItems} items)`;
    }).join('\n');

    return pageAnalysis;
  }

  /**
   * Classify page content type
   */
  private classifyPageContent(itemCounts: { text: number; images: number; tables: number; charts: number }): string {
    const { text, images, tables, charts } = itemCounts;
    const total = text + images + tables + charts;

    if (total === 0) return 'Empty page';
    
    if (charts > 0) return `Data visualization page (${charts} charts)`;
    if (tables > 0) return `Structured data page (${tables} tables)`;
    if (images > text * 0.5) return `Visual-heavy page (${images} images)`;
    if (text > total * 0.8) return `Text-heavy page (${text} text elements)`;
    
    return `Mixed content page`;
  }

  /**
   * Generate page-by-page descriptions with image context
   */
  private generatePageDescriptions(pdfData: PDFDocumentData): Array<{
    pageNumber: number;
    description: string;
    images: Array<{
      imageData: string;
      description: string;
      metadata: any;
    }>;
  }> {
    return pdfData.pages.map(pageMetadata => {
      const pageNumber = pageMetadata.pageNumber;
      
      // Get all items for this page
      const pageText = pdfData.items.text.filter(item => item.pageNumber === pageNumber);
      const pageImages = pdfData.items.images.filter(item => item.pageNumber === pageNumber);
      const pageTables = pdfData.items.tables.filter(item => item.pageNumber === pageNumber);
      const pageCharts = pdfData.items.charts.filter(item => item.pageNumber === pageNumber);

      // Generate page description
      const description = this.generatePageDescription(
        pageNumber,
        pageMetadata,
        pageText,
        pageImages,
        pageTables,
        pageCharts
      );

      // Generate image descriptions with metadata
      const images = pageImages.map(image => ({
        imageData: image.content,
        description: this.generateImageDescription(image, pageText),
        metadata: image
      }));

      return {
        pageNumber,
        description,
        images
      };
    });
  }

  /**
   * Generate detailed page description
   */
  private generatePageDescription(
    pageNumber: number,
    pageMetadata: any,
    textItems: PDFTextItem[],
    imageItems: PDFImageItem[],
    tableItems: PDFTableItem[],
    chartItems: PDFChartItem[]
  ): string {
    const contentSummary = this.generateContentSummary(textItems);
    const layoutInfo = this.generateLayoutInfo(pageMetadata.layout);
    const visualElements = this.generateVisualElementsSummary(imageItems, tableItems, chartItems);

    return `PAGE ${pageNumber} ANALYSIS:

LAYOUT STRUCTURE:
${layoutInfo}

CONTENT SUMMARY:
${contentSummary}

VISUAL ELEMENTS:
${visualElements}

PROCESSING INSTRUCTIONS:
- This page contains ${textItems.length} text elements, ${imageItems.length} images, ${tableItems.length} tables, and ${chartItems.length} charts
- Text and visual elements should be analyzed together for complete understanding
- Images may contain charts, diagrams, or other visual data that complements the text
- Tables and charts represent structured data that should be interpreted in context
- Consider the spatial relationship between text and visual elements for better comprehension

CONTEXT FOR LLM:
When processing this page, treat images as visual content that may contain:
- Charts and graphs with data visualizations
- Diagrams explaining concepts mentioned in text
- Screenshots or examples supporting the written content
- Tables or structured data in image format
Use the provided metadata to understand image positioning and relationship to surrounding text.`;
  }

  /**
   * Generate content summary from text items
   */
  private generateContentSummary(textItems: PDFTextItem[]): string {
    if (textItems.length === 0) return 'No text content detected';

    const titles = textItems.filter(item => item.metadata.isTitle);
    const headers = textItems.filter(item => item.metadata.isHeader);
    const totalWords = textItems.reduce((sum, item) => sum + item.metadata.wordCount, 0);

    let summary = `- Total text: ${totalWords} words in ${textItems.length} elements\n`;
    
    if (titles.length > 0) {
      summary += `- Titles detected: ${titles.map(t => `"${t.content}"`).join(', ')}\n`;
    }
    
    if (headers.length > 0) {
      summary += `- Headers found: ${headers.length} header elements\n`;
    }

    // Sample key text content
    const keyText = textItems
      .filter(item => item.content.length > 20)
      .slice(0, 3)
      .map(item => `"${item.content.substring(0, 100)}${item.content.length > 100 ? '...' : ''}"`)
      .join('\n  ');

    if (keyText) {
      summary += `- Key content preview:\n  ${keyText}`;
    }

    return summary;
  }

  /**
   * Generate layout information
   */
  private generateLayoutInfo(layout: any): string {
    return `- Page layout: ${layout.hasMultipleColumns ? `${layout.columnCount} columns` : 'Single column'}
- Header present: ${layout.hasHeader ? 'Yes' : 'No'}
- Footer present: ${layout.hasFooter ? 'Yes' : 'No'}`;
  }

  /**
   * Generate visual elements summary
   */
  private generateVisualElementsSummary(
    images: PDFImageItem[],
    tables: PDFTableItem[],
    charts: PDFChartItem[]
  ): string {
    let summary = '';

    if (images.length > 0) {
      summary += `- Images: ${images.length} visual elements\n`;
      images.forEach((img, index) => {
        summary += `  Image ${index + 1}: ${img.dimensions.scaledWidth}x${img.dimensions.scaledHeight}px, ${img.metadata.format} format`;
        if (img.metadata.isChart) summary += ' (contains chart data)';
        if (img.metadata.isDiagram) summary += ' (contains diagram)';
        summary += '\n';
      });
    }

    if (tables.length > 0) {
      summary += `- Tables: ${tables.length} structured data tables\n`;
      tables.forEach((table, index) => {
        summary += `  Table ${index + 1}: ${table.structure.rows}x${table.structure.columns} (${table.metadata.cellCount} cells)\n`;
      });
    }

    if (charts.length > 0) {
      summary += `- Charts: ${charts.length} data visualizations\n`;
      charts.forEach((chart, index) => {
        summary += `  Chart ${index + 1}: ${chart.chartData.type} chart`;
        if (chart.chartData.title) summary += ` - "${chart.chartData.title}"`;
        summary += '\n';
      });
    }

    return summary || '- No visual elements detected';
  }

  /**
   * Generate image description with context
   */
  private generateImageDescription(image: PDFImageItem, nearbyText: PDFTextItem[]): string {
    // Find text near the image
    const contextText = this.findNearbyText(image, nearbyText);
    
    return `IMAGE ANALYSIS:
Position: (${image.position.x}, ${image.position.y}) - ${image.dimensions.scaledWidth}x${image.dimensions.scaledHeight}px
Format: ${image.metadata.format} (${Math.round(image.metadata.size / 1024)}KB)
Content Type: ${this.classifyImageContent(image)}

CONTEXT CLUES:
${contextText.length > 0 ? contextText.map(text => `- "${text.content}"`).join('\n') : '- No nearby text context'}

PROCESSING INSTRUCTIONS:
This image should be analyzed as visual content that may contain:
${image.metadata.isChart ? '- Chart or graph data that should be interpreted numerically' : ''}
${image.metadata.isDiagram ? '- Diagram or schematic explaining concepts' : ''}
${image.metadata.isPhoto ? '- Photographic content for illustration' : ''}
- Visual information that complements the surrounding text
- Data or concepts that may not be fully described in text form

The image metadata indicates: confidence=${image.metadata.confidence}, extraction_method=${image.metadata.extractionMethod}`;
  }

  /**
   * Classify image content type
   */
  private classifyImageContent(image: PDFImageItem): string {
    if (image.metadata.isChart) return 'Data visualization (chart/graph)';
    if (image.metadata.isDiagram) return 'Diagram or schematic';
    if (image.metadata.isPhoto) return 'Photographic content';
    return 'General visual content';
  }

  /**
   * Find text near an image
   */
  private findNearbyText(image: PDFImageItem, textItems: PDFTextItem[]): PDFTextItem[] {
    const proximity = 100; // pixels
    
    return textItems.filter(text => {
      const distance = Math.min(
        Math.abs(text.position.x - image.position.x),
        Math.abs(text.position.x - (image.position.x + image.position.width)),
        Math.abs(text.position.y - image.position.y),
        Math.abs(text.position.y - (image.position.y + image.position.height))
      );
      return distance <= proximity && text.content.trim().length > 10;
    }).slice(0, 3); // Limit to 3 most relevant text items
  }

  /**
   * Generate chart descriptions with enhanced context
   */
  private generateChartDescriptions(charts: ChartOutput[]): Array<{
    imageData: string;
    description: string;
    metadata: ChartOutput;
  }> {
    return charts.map(chart => ({
      imageData: `data:image/png;base64,${chart.image_path}`, // Placeholder - would need actual base64 data
      description: this.generateChartDescription(chart),
      metadata: chart
    }));
  }

  /**
   * Generate detailed chart description
   */
  private generateChartDescription(chart: ChartOutput): string {
    return `CHART ANALYSIS:
Type: ${chart.chart_type.toUpperCase()} CHART
${chart.title ? `Title: "${chart.title}"` : 'Title: Not detected'}
Location: Page ${chart.page} at (${chart.bounding_box.x}, ${chart.bounding_box.y})
Confidence: ${(chart.confidence * 100).toFixed(1)}%

DATA STRUCTURE:
X-Axis: ${chart.x_axis.length > 0 ? chart.x_axis.join(', ') : 'No labels detected'}
Y-Axis Range: ${chart.y_axis.length > 0 ? `${Math.min(...chart.y_axis)} to ${Math.max(...chart.y_axis)}` : 'No values detected'}

SERIES DATA:
${chart.series.map((series, index) => 
  `Series ${index + 1} (${series.label}): [${series.values.join(', ')}]`
).join('\n')}

PROCESSING INSTRUCTIONS:
This is a ${chart.chart_type} chart that should be interpreted as:
- Quantitative data visualization showing relationships between variables
- X-axis represents: ${this.interpretXAxis(chart.x_axis, chart.chart_type)}
- Y-axis represents: ${this.interpretYAxis(chart.y_axis, chart.chart_type)}
- Data trends: ${this.analyzeTrends(chart)}

CONTEXT FOR LLM:
When analyzing this chart image, focus on:
- The numerical relationships shown in the data
- Trends, patterns, or significant changes in the values
- How this data relates to the surrounding document content
- The chart type indicates the nature of the data relationship
- Use the extracted metadata to understand precise values rather than estimating from the image

The chart was extracted using ${chart.extraction_method} with ${(chart.confidence * 100).toFixed(1)}% confidence.`;
  }

  /**
   * Interpret X-axis meaning
   */
  private interpretXAxis(xAxis: string[], chartType: string): string {
    if (xAxis.length === 0) return 'Categories or time periods (not detected)';
    
    // Check if it's time-based
    const timePattern = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|q1|q2|q3|q4|\d{4})/i;
    if (xAxis.some(label => timePattern.test(label))) {
      return 'Time periods or dates';
    }
    
    // Check if it's numeric
    if (xAxis.every(label => !isNaN(parseFloat(label)))) {
      return 'Numeric values or measurements';
    }
    
    return 'Categories or classifications';
  }

  /**
   * Interpret Y-axis meaning
   */
  private interpretYAxis(yAxis: number[], chartType: string): string {
    if (yAxis.length === 0) return 'Quantitative values (not detected)';
    
    if (chartType === 'pie') return 'Percentages or proportions';
    
    const range = Math.max(...yAxis) - Math.min(...yAxis);
    if (range > 1000) return 'Large-scale measurements or counts';
    if (range < 1) return 'Decimal values or percentages';
    
    return 'Quantitative measurements or counts';
  }

  /**
   * Analyze data trends
   */
  private analyzeTrends(chart: ChartOutput): string {
    if (chart.series.length === 0 || chart.series[0].values.length === 0) {
      return 'No trend data available';
    }
    
    const values = chart.series[0].values;
    if (values.length < 2) return 'Insufficient data for trend analysis';
    
    const increasing = values.every((val, i) => i === 0 || val >= values[i - 1]);
    const decreasing = values.every((val, i) => i === 0 || val <= values[i - 1]);
    
    if (increasing) return 'Consistently increasing trend';
    if (decreasing) return 'Consistently decreasing trend';
    
    const maxVal = Math.max(...values);
    const minVal = Math.min(...values);
    const maxIndex = values.indexOf(maxVal);
    const minIndex = values.indexOf(minVal);
    
    return `Variable trend (peak at position ${maxIndex + 1}, low at position ${minIndex + 1})`;
  }

  /**
   * Generate comprehensive context for LLM processing
   */
  private generateComprehensiveContext(
    pdfData: PDFDocumentData,
    charts: ChartOutput[],
    documentOverview: string
  ): string {
    return `COMPREHENSIVE DOCUMENT CONTEXT FOR LLM PROCESSING:

${documentOverview}

PROCESSING APPROACH:
This document should be analyzed as a multi-modal content containing both textual and visual information. The following approach should be used:

1. TEXT ANALYSIS:
   - Process ${pdfData.statistics.totalTextItems} text elements containing ${pdfData.statistics.totalWords} words
   - Consider text hierarchy (titles, headers, body text)
   - Maintain spatial relationships between text elements

2. VISUAL CONTENT ANALYSIS:
   - Analyze ${pdfData.statistics.totalImages} images as visual content that may contain:
     * Charts and data visualizations
     * Diagrams and schematics
     * Supporting illustrations
   - Use provided metadata to understand image context and positioning
   - Do not treat metadata as response content - use it to enhance understanding

3. STRUCTURED DATA PROCESSING:
   - Process ${pdfData.statistics.totalTables} tables as structured data
   - Analyze ${pdfData.statistics.totalCharts} charts for quantitative insights
   - Integrate tabular and chart data with textual content

4. INTEGRATED UNDERSTANDING:
   - Combine text, images, tables, and charts for comprehensive analysis
   - Use spatial positioning to understand content relationships
   - Consider visual elements as complementary to textual information
   - Extract insights that may only be apparent when combining multiple content types

METADATA USAGE INSTRUCTIONS:
- Metadata is provided to enhance your understanding of the content
- Do NOT include metadata details in your responses unless specifically relevant
- Use metadata to better interpret images, charts, and tables
- Focus on the actual content and insights, not the extraction process

RESPONSE GUIDELINES:
- Provide comprehensive analysis based on ALL content types
- Reference visual elements naturally when they support your analysis
- Integrate quantitative data from charts and tables with textual insights
- Maintain focus on content meaning rather than technical extraction details

This multi-modal approach ensures complete document understanding by leveraging both textual and visual information sources.`;
  }
}

// Export singleton instance
export const llmDescriptionGenerator = LLMDescriptionGenerator.getInstance();
