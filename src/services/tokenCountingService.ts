import { encodingForModel } from 'js-tiktoken';
import { MessageType, FileAttachment } from '../types';

/**
 * Token counting and context management service
 * Uses JavaScript-based tokenization (js-tiktoken) - no Python dependencies
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
   * Count tokens in a file attachment
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
    
    // For images, calculate actual token cost based on image data
    if (attachment.type === 'image' && attachment.content) {
      tokenCount += this.countImageTokens(attachment.content);
    }
    
    return tokenCount;
  }

  /**
   * Calculate actual tokens for image attachments based on image data
   */
  private countImageTokens(imageContent: string): number {
    try {
      // Remove data URL prefix (e.g., "data:image/jpeg;base64,")
      const base64Data = imageContent.split(',')[1];
      if (!base64Data) {
        return 100; // Minimal fallback if no valid base64 data
      }

      // Calculate the actual size of the base64 encoded image
      const base64Length = base64Data.length;
      
      // Base64 encoding increases size by ~33%, so get approximate original file size
      const approximateFileSize = Math.floor(base64Length * 0.75);
      
      // For vision models, token cost typically depends on image dimensions and complexity
      // Since we can't decode the image here, we use file size as a proxy
      // Rough calculation: ~1 token per 750 bytes (based on OpenAI's vision model pricing)
      const estimatedTokens = Math.ceil(approximateFileSize / 750);
      
      // Set reasonable bounds: minimum 50 tokens, maximum 2000 tokens per image
      const minTokens = 50;
      const maxTokens = 2000;
      
      const actualTokens = Math.max(minTokens, Math.min(maxTokens, estimatedTokens));
      
      console.log(`🖼️ Image token calculation: ${base64Length} base64 chars → ~${approximateFileSize} bytes → ${actualTokens} tokens`);
      
      return actualTokens;
      
    } catch (error) {
      console.error('Error calculating image tokens:', error);
      // Fallback to a reasonable estimate if calculation fails
      return 500;
    }
  }

  /**
   * Count tokens in a single message including all attachments
   */
  countMessageTokens(message: MessageType): number {
    let tokenCount = 0;
    
    // Count tokens in the message content
    tokenCount += this.countTokens(message.content);
    
    // Count tokens for attachments
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
   * Count total tokens in an array of messages
   */
  countTotalTokens(messages: MessageType[]): number {
    return messages.reduce((total, message) => total + this.countMessageTokens(message), 0);
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
