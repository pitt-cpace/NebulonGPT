import { sendMessage } from './api';
import { MessageType } from '../types';

/**
 * Independent async function to generate a chat title based on the user message
 * @param userMessage - The user message to generate title from
 * @param modelId - The model ID to use for title generation
 * @returns Promise<string> - Generated title or fallback title
 */
/**
 * Pre-process user message for better title generation
 */
const preprocessMessage = (message: string): string => {
  return message
    .replace(/https?:\/\/[^\s]+/g, '') // Remove URLs
    .replace(/[^\w\s\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g, ' ') // Keep alphanumeric, spaces, and Persian/Arabic characters
    .replace(/\s+/g, ' ') // Compress multiple spaces
    .trim()
    .substring(0, 200); // Keep only first 200 characters for focus
};

/**
 * Detect if text is primarily Persian/Arabic
 */
const isPersianText = (text: string): boolean => {
  const persianChars = text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g);
  const totalChars = text.replace(/\s/g, '').length;
  return persianChars ? (persianChars.length / totalChars) > 0.3 : false;
};

/**
 * Score a title candidate based on quality criteria
 */
const scoreTitle = (title: string, originalMessage: string): number => {
  let score = 0;
  const words = title.trim().split(/\s+/);
  const wordCount = words.length;
  
  // Length scoring (3-6 words is ideal)
  if (wordCount >= 3 && wordCount <= 6) {
    score += 10;
  } else if (wordCount === 2 || wordCount === 7) {
    score += 5;
  } else {
    score -= 5;
  }
  
  // Character length scoring (15-50 chars is good)
  const charCount = title.length;
  if (charCount >= 15 && charCount <= 50) {
    score += 8;
  } else if (charCount >= 10 && charCount <= 60) {
    score += 4;
  }
  
  // Language consistency
  const titleIsPersian = isPersianText(title);
  const messageIsPersian = isPersianText(originalMessage);
  if (titleIsPersian === messageIsPersian) {
    score += 15; // High bonus for language consistency
  } else {
    score -= 10; // Penalty for language mismatch
  }
  
  // Avoid generic terms
  const genericTerms = ['help', 'question', 'issue', 'problem', 'discussion', 'chat', 'conversation', 'سوال', 'مشکل', 'کمک', 'گفتگو'];
  const hasGeneric = genericTerms.some(term => title.toLowerCase().includes(term.toLowerCase()));
  if (hasGeneric) {
    score -= 3;
  }
  
  // Bonus for technical/domain terms
  const technicalTerms = ['mac', 'windows', 'docker', 'api', 'server', 'database', 'code', 'programming', 'javascript', 'python', 'react', 'node', 'git', 'linux', 'ios', 'android'];
  const hasTechnical = technicalTerms.some(term => title.toLowerCase().includes(term.toLowerCase()));
  if (hasTechnical) {
    score += 5;
  }
  
  // Penalty for trailing punctuation
  if (/[.!?:;]$/.test(title)) {
    score -= 2;
  }
  
  // Penalty for starting with articles/prepositions
  const startsWithArticle = /^(the|a|an|in|on|at|for|with|by)\s/i.test(title);
  if (startsWithArticle) {
    score -= 2;
  }
  
  // Bonus for key terms from original message
  const messageWords = originalMessage.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const titleWords = title.toLowerCase().split(/\s+/);
  const keyTermMatches = messageWords.filter(word => titleWords.some(tw => tw.includes(word) || word.includes(tw))).length;
  score += Math.min(keyTermMatches * 2, 8); // Max 8 bonus points
  
  return score;
};

/**
 * Clean and format a title
 */
const cleanTitle = (title: string): string => {
  let cleaned = title
    .trim()
    .replace(/^["']|["']$/g, '') // Remove surrounding quotes
    .replace(/^(title|عنوان):\s*/i, '') // Remove "Title:" or "عنوان:" prefix
    .replace(/[.!?:;]+$/, '') // Remove trailing punctuation
    .replace(/\s+/g, ' ') // Normalize spaces
    .substring(0, 60); // Limit length
  
  // Apply title case for English text
  if (!isPersianText(cleaned)) {
    const minorWords = ['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'if', 'in', 'nor', 'of', 'on', 'or', 'so', 'the', 'to', 'up', 'yet'];
    cleaned = cleaned.split(' ').map((word, index) => {
      const lowerWord = word.toLowerCase();
      if (index === 0 || !minorWords.includes(lowerWord)) {
        return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
      }
      return lowerWord;
    }).join(' ');
  }
  
  // Remove duplicate words
  const words = cleaned.split(' ');
  const uniqueWords = words.filter((word, index) => 
    words.findIndex(w => w.toLowerCase() === word.toLowerCase()) === index
  );
  
  return uniqueWords.join(' ');
};

/**
 * Parse JSON array from LLM response
 */
const parseJsonTitles = (response: string): string[] => {
  try {
    // Try to find JSON array in the response (using multiline matching)
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed.filter(item => typeof item === 'string' && item.trim().length > 0);
      }
    }
  } catch (error) {
    console.log('Failed to parse JSON, falling back to line splitting');
  }
  
  // Fallback: split by lines and clean
  return response
    .split('\n')
    .map(line => line.trim().replace(/^[-*]\s*/, '').replace(/^\d+\.\s*/, ''))
    .filter(line => line.length > 0 && !line.toLowerCase().includes('title'))
    .slice(0, 5);
};

export const generateChatTitle = async (
  userMessage: string,
  modelId: string
): Promise<string> => {
  try {
    console.log('🏷️ Generating chat title candidates from user message...');
    
    // Pre-process the message
    const processedMessage = preprocessMessage(userMessage);
    const isMessagePersian = isPersianText(processedMessage);
    
    // Create messages array with enhanced system role
    const messages: MessageType[] = [
      {
        id: 'title-gen-system',
        role: 'system',
        content: `You are a professional chat title generator. Generate 5 different title candidates for the user's message.

CRITICAL RULES:
1. Output ONLY a JSON array: ["title1", "title2", "title3", "title4", "title5"]
2. Each title must be 3-6 words long
3. Use the SAME LANGUAGE as the user's message (${isMessagePersian ? 'Persian' : 'English'})
4. Use NATURAL WORD ORDER for the language - titles must sound natural and grammatically correct
5. Be specific and descriptive, not generic
6. Focus on the main topic/subject
7. NO greetings, filler words, or trailing punctuation
8. Include technical terms if present in the message

LANGUAGE-SPECIFIC GUIDELINES:
- For Persian/Arabic: Use proper Persian grammar and word order (e.g., "توضیح هواپیمای بویینگ" not "بویینگ هواپیمای توضیح")
- For English: Use natural English word order (e.g., "Boeing Aircraft Explanation" not "Aircraft Boeing Explanation")
- For all languages: Ensure the title flows naturally and sounds like a native speaker would say it

EXAMPLES:
English input: ["Mac Cut Option Help", "Enable Cut Feature Mac", "Fix Missing Cut Mac", "Add Cut to Mac", "Mac Cut Menu Issue"]
Persian input: ["مقایسه گارانتی تویوتا", "تفاوت گلد و سیلور", "سطوح گارانتی تویوتا", "خدمات گارانتی خودرو", "انواع گارانتی تویوتا"]`,
        timestamp: new Date().toISOString()
      },
      {
        id: 'title-gen-user',
        role: 'user',
        content: `Generate 5 title candidates for: "${processedMessage}"`,
        timestamp: new Date().toISOString()
      }
    ];

    // Use configuration optimized for title generation
    const options = {
      num_ctx: 2048,
      temperature: 0.4, // Slightly higher for variety
      max_tokens: 100 // More tokens for multiple candidates
    };

    // Call the API without streaming for title generation
    const generatedResponse = await sendMessage(
      modelId,
      messages,
      options
    );

    // Parse candidates from response
    const candidates = parseJsonTitles(generatedResponse);
    
    if (candidates.length === 0) {
      throw new Error('No valid candidates generated');
    }

    console.log('🏷️ Generated candidates:', candidates);

    // Score and rank candidates
    const scoredCandidates = candidates
      .map(candidate => ({
        title: cleanTitle(candidate),
        score: scoreTitle(candidate, processedMessage)
      }))
      .filter(item => item.title.length >= 3) // Filter out too short titles
      .sort((a, b) => b.score - a.score); // Sort by score descending

    console.log('🏷️ Scored candidates:', scoredCandidates);

    if (scoredCandidates.length === 0) {
      throw new Error('No valid candidates after scoring');
    }

    const bestTitle = scoredCandidates[0].title;
    console.log('✅ Best title selected:', bestTitle, 'Score:', scoredCandidates[0].score);
    
    return bestTitle;

  } catch (error) {
    console.error('❌ Error generating chat title:', error);
    
    // Enhanced fallback: create a title from the first few words of user message
    const processedMessage = preprocessMessage(userMessage);
    const fallbackTitle = processedMessage
      .split(' ')
      .filter(word => word.length > 2)
      .slice(0, 4)
      .join(' ')
      .substring(0, 30);
    
    return cleanTitle(fallbackTitle) || 'New Chat';
  }
};

// Track ongoing title generation to prevent duplicates
const titleGenerationInProgress = new Set<string>();

/**
 * Check if a chat needs a title and generate one if necessary
 * @param chatTitle - Current chat title
 * @param userMessage - User message content to generate title from
 * @param modelId - Model ID to use for generation
 * @param updateTitleCallback - Callback function to update the chat title
 * @param chatId - Chat ID to prevent duplicate generation
 */
export const checkAndGenerateTitle = async (
  chatTitle: string,
  userMessage: string,
  modelId: string,
  updateTitleCallback: (newTitle: string) => Promise<void>,
  chatId?: string
): Promise<void> => {
  try {
    // Check if chat needs a title (is still "New Chat" or empty)
    const needsTitle = !chatTitle || 
                      chatTitle.trim() === '' || 
                      chatTitle.toLowerCase() === 'new chat';

    if (!needsTitle) {
      console.log('🏷️ Chat already has a title, skipping generation');
      return;
    }

    // Prevent duplicate title generation for the same chat
    if (chatId && titleGenerationInProgress.has(chatId)) {
      console.log('🏷️ Title generation already in progress for this chat, skipping');
      return;
    }

    // Ensure we have user message
    if (!userMessage?.trim()) {
      console.log('🏷️ Missing user message, skipping title generation');
      return;
    }

    console.log('🏷️ Chat needs a title, generating...');
    
    // Mark title generation as in progress
    if (chatId) {
      titleGenerationInProgress.add(chatId);
    }

    try {
      // Generate the title
      const newTitle = await generateChatTitle(
        userMessage,
        modelId
      );

      // Update the title using the callback
      await updateTitleCallback(newTitle);
      
      console.log('✅ Chat title updated successfully');
    } finally {
      // Always remove from progress tracking
      if (chatId) {
        titleGenerationInProgress.delete(chatId);
      }
    }

  } catch (error) {
    console.error('❌ Error in checkAndGenerateTitle:', error);
    // Clean up progress tracking on error
    if (chatId) {
      titleGenerationInProgress.delete(chatId);
    }
  }
};
