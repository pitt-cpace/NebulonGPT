export interface ModelType {
  id: string;
  name: string;
  description?: string;
  parameters?: Record<string, any>;
  size?: string;
  quantization?: string;
  isDefault?: boolean;
}

export interface MessageType {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
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
