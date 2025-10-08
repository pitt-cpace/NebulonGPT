import { encodingForModel } from 'js-tiktoken';
import { MessageType, FileAttachment } from '../types';

/**
 * Token counting and context management service
 * Uses JavaScript-based tokenization (js-tiktoken) - no Python dependencies
 * Implements correct OpenAI vision token calculation using tile-based rule
 */
class TokenCountingService {
  private encoder: any;

  constructor() {
    try {
      // Use cl100k_base encoding which is used by most modern LLMs (GPT-3.5, GPT-4, etc.)
      this.encoder = encodingForModel('gpt-3.5-turbo');
    } catch (error) {
      console.error('Error initializing tokenizer:', error);
      this.encoder = null;
    }
  }

  /**
   * Count tokens in a text string using JavaScript tokenizer
   */
  countTokens(text: string): number {
    if (!text || text.length === 0) {
      return 0;
    }

    try {
      if (this.encoder) {
        return this.encoder.encode(text).length;
      } else {
        // Fallback: rough estimation (4 chars per token on average for English)
        return Math.ceil(text.length / 4);
      }
    } catch (error) {
      console.error('Error counting tokens:', error);
      // Fallback estimation
      return Math.ceil(text.length / 4);
    }
  }

  /**
   * Count tokens in a file attachment (SYNC for sending prompts - context management)
   * MUST be sync because we need immediate token count for context truncation before sending
   */
  countAttachmentTokens(attachment: FileAttachment): number {
    let tokenCount = 0;
    
    // Count tokens for the filename (this gets included in the message)
    tokenCount += this.countTokens(attachment.name);
    
    // Count tokens for the content if it's a text-based attachment
    if ((attachment.type === 'text' || attachment.type === 'pdf') && attachment.content) {
      tokenCount += this.countTokens(attachment.content);
      // Add some overhead for formatting (file headers, etc.)
      tokenCount += 20;
    }
    
    // For images, use quick fallback for immediate context management
    if (attachment.type === 'image' && attachment.content) {
      tokenCount += 255; // Standard vision token estimate (85 base + 170*1 tile) - SYNC fallback
    }
    
    return tokenCount;
  }

  /**
   * Count tokens in a file attachment (ASYNC for receiving responses - accuracy)
   * Can be async because receiving tokens don't affect context limits, only for display
   */
  async countAttachmentTokensAsync(attachment: FileAttachment): Promise<number> {
    let tokenCount = 0;
    
    // Count tokens for the filename (this gets included in the message)
    tokenCount += this.countTokens(attachment.name);
    
    // Count tokens for the content if it's a text-based attachment
    if ((attachment.type === 'text' || attachment.type === 'pdf') && attachment.content) {
      tokenCount += this.countTokens(attachment.content);
      // Add some overhead for formatting (file headers, etc.)
      tokenCount += 20;
    }
    
    // For images, use REAL accurate OpenAI vision calculation
    if (attachment.type === 'image' && attachment.content) {
      tokenCount += await this.calculateVisionImageTokens(attachment.content);
    }
    
    return tokenCount;
  }

  /**
   * Calculate REAL vision image tokens using official OpenAI tile-based rule
   */
  private async calculateVisionImageTokens(imageContent: string): Promise<number> {
    try {
      const base64Data = imageContent.split(',')[1];
      if (!base64Data) {
        return 85; // Minimum tokens for any image
      }

      // Convert base64 to blob to get actual image dimensions
      const binaryString = atob(base64Data);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      const blob = new Blob([bytes]);
      
      // Get real image dimensions
      const imageBitmap = await createImageBitmap(blob);
      const width = imageBitmap.width;
      const height = imageBitmap.height;
      
      // Clean up
      imageBitmap.close();
      
      // Use official OpenAI vision token calculation (tile-based, NOT tiktoken)
      const tokens = this.estimateVisionImageTokens(width, height, "high", "gpt-4o");
      
      console.log(`🖼️ REAL vision token calculation: ${width}×${height} → ${tokens} actual vision tokens (OpenAI tile-based)`);
      
      return tokens;
      
    } catch (error) {
      console.error('Error in real vision token calculation:', error);
      return 85; // Default minimum for any image
    }
  }

  /**
   * Estimate image tokens per OpenAI o-series rule.
   * detail: "low" = flat 85 tokens
   * detail: "high" = 85 + 170 × tiles(512×512) after:
   *   1) fit inside 2048×2048
   *   2) downscale so the short side is 768 (never upscale)
   */
  private estimateVisionImageTokens(
    width: number,
    height: number,
    detail: "low" | "high" = "high",
    model: "gpt-4o" | "gpt-4.1" | "gpt-4.1-mini" | "o4-mini" = "gpt-4o"
  ): number {
    // Model constants (adjust if your provider specifies different numbers)
    const base = 85;
    const perTile = 170;

    if (detail === "low") return base;

    // Step 1: fit within 2048×2048
    const s1 = Math.min(1, 2048 / Math.max(width, height));
    let w = Math.round(width * s1);
    let h = Math.round(height * s1);

    // Step 2: ensure short side = 768 (downscale only)
    const short = Math.min(w, h);
    if (short > 768) {
      const s2 = 768 / short;
      w = Math.round(w * s2);
      h = Math.round(h * s2);
    }

    // Step 3: count 512×512 tiles
    const tiles = Math.ceil(w / 512) * Math.ceil(h / 512);
    return base + perTile * tiles;
  }

  /**
   * Count tokens in a single message including all attachments (sync version)
   */
  countMessageTokens(message: MessageType): number {
    let tokenCount = 0;
    
    // Count tokens in the message content
    tokenCount += this.countTokens(message.content);
    
    // Count tokens for attachments (sync)
    if (message.attachments && message.attachments.length > 0) {
      for (const attachment of message.attachments) {
        tokenCount += this.countAttachmentTokens(attachment);
      }
    }
    
    // Add some overhead for message structure (role, timestamp, etc.)
    tokenCount += 10;
    
    return tokenCount;
  }

  /**
   * Count tokens in a single message including all attachments (async with real vision calculation)
   */
  async countMessageTokensAsync(message: MessageType): Promise<number> {
    let tokenCount = 0;
    
    // Count tokens in the message content
    tokenCount += this.countTokens(message.content);
    
    // Count tokens for attachments (async for accurate vision calculation)
    if (message.attachments && message.attachments.length > 0) {
      for (const attachment of message.attachments) {
        tokenCount += await this.countAttachmentTokensAsync(attachment);
      }
    }
    
    // Add some overhead for message structure (role, timestamp, etc.)
    tokenCount += 10;
    
    return tokenCount;
  }

  /**
   * Count total tokens in an array of messages (sync version)
   */
  countTotalTokens(messages: MessageType[]): number {
    return messages.reduce((total, message) => total + this.countMessageTokens(message), 0);
  }

  /**
   * Count total tokens in an array of messages (async version)
   */
  async countTotalTokensAsync(messages: MessageType[]): Promise<number> {
    let total = 0;
    for (const message of messages) {
      total += await this.countMessageTokensAsync(message);
    }
    return total;
  }

  /**
   * Truncate messages to fit within the specified context length
   * Priority: 1) Current prompt, 2) Attachments, 3) Previous chats and attachments
   */
  truncateMessagesToFitContext(
    messages: MessageType[], 
    maxContextLength: number,
    systemMessageTokens: number = 0
  ): MessageType[] {
    if (messages.length === 0) {
      return messages;
    }

    // Reserve some tokens for the system message and response generation
    const availableTokens = maxContextLength - systemMessageTokens - 500; // Reserve 500 tokens for response
    
    if (availableTokens <= 0) {
      console.warn('Context length is too small for meaningful conversation');
      return [];
    }

    console.log(`🔧 Token Management: Truncating ${messages.length} messages to fit ${availableTokens} available tokens`);
    console.log(`🎯 Priority: 1) Current prompt, 2) Attachments, 3) Previous chats and attachments`);

    // PRIORITY 1: Always preserve the most recent message (current prompt)
    const mostRecentMessage = messages[messages.length - 1];
    let currentTokenCount = 0;
    const result: MessageType[] = [];

    if (mostRecentMessage) {
      const recentMessageTokens = this.countMessageTokens(mostRecentMessage);
      console.log(`🔥 Priority 1 - Preserving current prompt: ${recentMessageTokens} tokens`);
      
      if (recentMessageTokens > availableTokens) {
        console.warn('⚠️ Current prompt exceeds context length, truncating prompt content');
        const truncatedPrompt = this.truncateMessage(mostRecentMessage, availableTokens);
        if (truncatedPrompt) {
          result.push(truncatedPrompt);
          currentTokenCount = this.countMessageTokens(truncatedPrompt);
        }
        return result;
      }
      
      result.push(mostRecentMessage);
      currentTokenCount = recentMessageTokens;
    }

    // Separate messages by priority: messages with attachments vs without
    const previousMessages = messages.slice(0, -1).reverse(); // Exclude most recent, work backwards
    const messagesWithAttachments = previousMessages.filter(msg => msg.attachments && msg.attachments.length > 0);
    const messagesWithoutAttachments = previousMessages.filter(msg => !msg.attachments || msg.attachments.length === 0);

    // PRIORITY 2: Add messages with attachments first
    console.log(`📎 Priority 2 - Processing ${messagesWithAttachments.length} messages with attachments`);
    for (const message of messagesWithAttachments) {
      const messageTokens = this.countMessageTokens(message);
      
      if (currentTokenCount + messageTokens > availableTokens) {
        console.log(`📎 Message with attachments (${messageTokens} tokens) exceeds remaining space`);
        continue;
      }
      
      result.unshift(message);
      currentTokenCount += messageTokens;
      console.log(`✅ Added ${message.role} message with ${message.attachments!.length} attachments: ${messageTokens} tokens`);
    }

    // PRIORITY 3: Add messages without attachments (previous chats)
    console.log(`💬 Priority 3 - Processing ${messagesWithoutAttachments.length} previous chat messages`);
    for (const message of messagesWithoutAttachments) {
      const messageTokens = this.countMessageTokens(message);
      
      if (currentTokenCount + messageTokens > availableTokens) {
        console.log(`💬 Previous chat message (${messageTokens} tokens) exceeds remaining space, stopping`);
        break;
      }
      
      result.unshift(message);
      currentTokenCount += messageTokens;
      console.log(`✅ Added ${message.role} previous chat: ${messageTokens} tokens`);
    }

    // Ensure conversation flow - if we start with an assistant message, try to include preceding user message
    if (result.length > 1 && result[0].role === 'assistant') {
      const originalIndex = messages.findIndex(msg => msg.id === result[0].id);
      if (originalIndex > 0) {
        const precedingMessage = messages[originalIndex - 1];
        if (precedingMessage.role === 'user') {
          const precedingTokens = this.countMessageTokens(precedingMessage);
          const precedingMessageInResult = result.find(msg => msg.id === precedingMessage.id);
          
          if (!precedingMessageInResult && currentTokenCount + precedingTokens <= availableTokens) {
            result.unshift(precedingMessage);
            currentTokenCount += precedingTokens;
            console.log(`🔗 Added preceding user message for conversation flow: ${precedingTokens} tokens`);
          }
        }
      }
    }

    const finalTokenCount = this.countTotalTokens(result);
    console.log(`✅ Final result: ${messages.length} → ${result.length} messages`);
    console.log(`📊 Total tokens: ${finalTokenCount} / ${availableTokens} available (${Math.round((finalTokenCount/availableTokens)*100)}%)`);
    
    return result;
  }

  /**
   * Truncate a single message if it's too large
   * Prioritizes keeping attachments and truncating text content
   */
  private truncateMessage(message: MessageType, maxTokens: number): MessageType | null {
    if (maxTokens <= 50) { // Need minimum tokens for a meaningful message
      return null;
    }

    // Calculate tokens used by attachments
    let attachmentTokens = 0;
    if (message.attachments && message.attachments.length > 0) {
      for (const attachment of message.attachments) {
        attachmentTokens += this.countAttachmentTokens(attachment);
      }
    }

    // Reserve tokens for message overhead
    const overhead = 10;
    const availableForContent = maxTokens - attachmentTokens - overhead;

    if (availableForContent <= 20) {
      // If we can't fit meaningful content, remove attachments and keep text
      console.warn('🗑️ Removing attachments to fit message in context');
      return this.truncateMessageContent(message, maxTokens - overhead);
    }

    // Truncate the text content to fit
    return this.truncateMessageContent(message, availableForContent);
  }

  /**
   * Truncate message content while preserving message structure
   */
  private truncateMessageContent(message: MessageType, maxTokens: number): MessageType | null {
    if (maxTokens <= 20) {
      return null;
    }

    const originalContent = message.content;
    const originalTokens = this.countTokens(originalContent);

    if (originalTokens <= maxTokens) {
      return message; // No truncation needed
    }

    // Estimate how many characters we can keep
    const ratio = maxTokens / originalTokens;
    const estimatedChars = Math.floor(originalContent.length * ratio * 0.9); // 10% buffer

    // Try to truncate at a sentence or word boundary
    let truncatedContent = originalContent.substring(0, estimatedChars);
    
    // Find the last sentence boundary
    const sentenceEnd = truncatedContent.lastIndexOf('. ');
    if (sentenceEnd > estimatedChars * 0.5) { // If we found a sentence boundary in the latter half
      truncatedContent = truncatedContent.substring(0, sentenceEnd + 1);
    } else {
      // Find the last word boundary
      const lastSpace = truncatedContent.lastIndexOf(' ');
      if (lastSpace > 0) {
        truncatedContent = truncatedContent.substring(0, lastSpace);
      }
    }

    truncatedContent += '... [truncated due to context length limit]';

    // Verify the truncation worked
    if (this.countTokens(truncatedContent) > maxTokens) {
      // If still too long, do a more aggressive truncation
      const targetChars = Math.floor(estimatedChars * 0.7);
      truncatedContent = originalContent.substring(0, targetChars) + '... [truncated]';
    }

    return {
      ...message,
      content: truncatedContent,
      // Remove attachments if we had to truncate the content significantly
      attachments: ratio > 0.3 ? message.attachments : undefined
    };
  }

  /**
   * Get a summary of token usage for debugging
   */
  getTokenUsageSummary(messages: MessageType[], contextLength: number): string {
    const totalTokens = this.countTotalTokens(messages);
    const breakdown = messages.map((msg, index) => ({
      index,
      role: msg.role,
      tokens: this.countMessageTokens(msg),
      hasAttachments: (msg.attachments && msg.attachments.length > 0) ? msg.attachments.length : 0
    }));

    return `Token Usage Summary:
Total: ${totalTokens}/${contextLength} tokens (${Math.round((totalTokens/contextLength)*100)}%)
Messages: ${messages.length}
Breakdown: ${breakdown.map(b => `${b.index}:${b.role}(${b.tokens}t,${b.hasAttachments}a)`).join(', ')}`;
  }

  /**
   * Check if messages exceed context length
   */
  exceedsContextLength(messages: MessageType[], contextLength: number): boolean {
    const totalTokens = this.countTotalTokens(messages);
    return totalTokens > contextLength - 500; // Reserve 500 tokens for response
  }

  /**
   * Cleanup method to free encoder resources
   */
  cleanup(): void {
    if (this.encoder) {
      try {
        this.encoder.free?.();
      } catch (error) {
        console.error('Error freeing encoder:', error);
      }
    }
  }
}

// Export singleton instance
export const tokenCountingService = new TokenCountingService();
