export interface ModelType {
  id: string;
  name: string;
  description?: string;
  parameters?: Record<string, any>;
  size?: string;
  quantization?: string;
  isDefault?: boolean;
}

export interface FileAttachment {
  id: string;
  name: string;
  type: 'text' | 'image' | 'document' | 'pdf' | 'audio' | 'pdf-image' | 'pdf-text' | 'pdf-table' | 'pdf-chart'; // Enhanced types
  content?: string; // For backward compatibility and small text content
  fileId?: string; // Reference to file stored on server
  imageFileIds?: string[]; // Array of file IDs for PDF images stored on server
  hasImages?: boolean; // Flag to indicate if PDF contains images
  url?: string;     // For future use with other file types
  size: number;
  timestamp: string;
  metadata?: {      // Enhanced metadata for spatial and contextual information
    sourceFile?: string;
    pageNumber?: number;
    totalPages?: number;
    contentType?: string;
    processingMethod?: string;
    scale?: number;
    hasEmbeddedImages?: boolean;
    description?: string;
    textLength?: number;
    // Enhanced PDF processing metadata
    position?: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
    fontSize?: number;
    fontName?: string;
    color?: string;
    isTitle?: boolean;
    isHeader?: boolean;
    isFooter?: boolean;
    confidence?: number;
    extractionMethod?: string;
    // Table-specific metadata
    tableStructure?: {
      rows: number;
      columns: number;
      hasHeaders: boolean;
      headerRow?: string[];
    };
    // Chart-specific metadata
    chartData?: {
      type: 'bar' | 'line' | 'pie' | 'scatter' | 'unknown';
      title?: string;
      labels?: string[];
      values?: number[];
    };
    hasLegend?: boolean;
    hasAxes?: boolean;
    // Image-specific metadata
    dimensions?: {
      originalWidth: number;
      originalHeight: number;
      scaledWidth: number;
      scaledHeight: number;
    };
    format?: string;
    isChart?: boolean;
    isDiagram?: boolean;
    isPhoto?: boolean;
    [key: string]: any; // Allow additional metadata properties
  };
}

export interface MessageType {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  attachments?: FileAttachment[]; // Add support for file attachments
}

export interface ChatType {
  id: string;
  title: string;
  modelId: string;
  messages: MessageType[];
  createdAt: string;
  updatedAt?: string;
}

export interface SuggestedPrompt {
  title: string;
  prompt: string;
  description?: string;
}
