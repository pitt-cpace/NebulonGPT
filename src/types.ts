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
  type: 'text' | 'image' | 'document' | 'pdf' | 'audio'; // Added 'pdf' type
  content?: string; // For text files, we'll store the content directly
  images?: string[]; // Array of image data URLs for PDFs with images
  url?: string;     // For future use with other file types
  size: number;
  timestamp: string;
}

export interface MessageType {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  attachments?: FileAttachment[]; // Add support for file attachments
  tokenCount?: number; // Track individual message tokens
  contextTokensUsed?: number; // Track total context tokens sent to LLM for this message
}

export interface ChatType {
  id: string;
  title: string;
  modelId: string;
  messages: MessageType[];
  createdAt: string;
  updatedAt?: string;
  tokenStats?: {
    totalTokensSent: number;
    totalTokensReceived: number;
    contextLength: number;
    lastUpdated: string;
  };
}

export interface SuggestedPrompt {
  title: string;
  prompt: string;
  description?: string;
}
