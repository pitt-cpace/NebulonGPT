/**
 * RTL (Right-to-Left) Language Detection Service
 * Automatically detects RTL languages like Persian, Arabic, Hebrew, etc.
 * and applies appropriate text direction styling
 */

// RTL Unicode ranges and patterns
const RTL_UNICODE_RANGES = [
  // Arabic (including Arabic Supplement, Arabic Extended-A, Arabic Presentation Forms)
  [0x0600, 0x06FF], // Arabic
  [0x0750, 0x077F], // Arabic Supplement
  [0x08A0, 0x08FF], // Arabic Extended-A
  [0xFB50, 0xFDFF], // Arabic Presentation Forms-A
  [0xFE70, 0xFEFF], // Arabic Presentation Forms-B
  
  // Hebrew
  [0x0590, 0x05FF], // Hebrew
  [0xFB1D, 0xFB4F], // Hebrew Presentation Forms
  
  // Persian/Farsi (uses Arabic script with additional characters)
  [0x06A0, 0x06FF], // Persian-specific Arabic characters
  
  // Urdu (uses Arabic script)
  // Covered by Arabic ranges above
  
  // Other RTL scripts
  [0x07C0, 0x07FF], // NKo
  [0x0800, 0x083F], // Samaritan
  [0x0840, 0x085F], // Mandaic
  [0x0860, 0x086F], // Syriac Supplement
  [0x08A0, 0x08FF], // Arabic Extended-A
  [0x10800, 0x1083F], // Cypriot Syllabary
  [0x10840, 0x1085F], // Imperial Aramaic
  [0x10860, 0x1087F], // Palmyrene
  [0x10880, 0x108AF], // Nabataean
  [0x108E0, 0x108FF], // Hatran
  [0x10900, 0x1091F], // Phoenician
  [0x10920, 0x1093F], // Lydian
  [0x10980, 0x1099F], // Meroitic Hieroglyphs
  [0x109A0, 0x109FF], // Meroitic Cursive
  [0x10A00, 0x10A5F], // Kharoshthi
  [0x10A60, 0x10A7F], // Old South Arabian
  [0x10A80, 0x10A9F], // Old North Arabian
  [0x10AC0, 0x10AFF], // Manichaean
  [0x10B00, 0x10B3F], // Avestan
  [0x10B40, 0x10B5F], // Inscriptional Parthian
  [0x10B60, 0x10B7F], // Inscriptional Pahlavi
  [0x10B80, 0x10BAF], // Psalter Pahlavi
  [0x10C00, 0x10C4F], // Old Turkic
  [0x10E60, 0x10E7F], // Rumi Numeral Symbols
  [0x1E800, 0x1E8DF], // Mende Kikakui
  [0x1E900, 0x1E95F], // Adlam
];

// Common RTL language keywords and patterns
const RTL_LANGUAGE_PATTERNS = [
  // Persian/Farsi common words
  /[\u06A9\u06AF\u06CC\u067E\u0686\u0698]/g, // Persian-specific letters: ک گ ی پ چ ژ
  
  // Arabic common words and patterns
  /[\u0627\u0644\u0644\u0647\u0645\u062D\u0645\u062F]/g, // Common Arabic letters and Allah
  
  // Hebrew common patterns
  /[\u05D0-\u05EA]/g, // Hebrew letters
  
  // Urdu patterns (Arabic script with specific usage)
  /[\u0627\u0628\u067E\u062A\u0679]/g, // Common Urdu letters
];

// RTL language codes (ISO 639-1 and common variations)
const RTL_LANGUAGE_CODES = new Set([
  'ar', 'ara', 'arabic',           // Arabic
  'fa', 'fas', 'per', 'persian', 'farsi', // Persian/Farsi
  'he', 'heb', 'hebrew',          // Hebrew
  'ur', 'urd', 'urdu',            // Urdu
  'yi', 'yid', 'yiddish',         // Yiddish
  'ku', 'kur', 'kurdish',         // Kurdish (some dialects)
  'ps', 'pus', 'pashto',          // Pashto
  'sd', 'snd', 'sindhi',          // Sindhi
  'ug', 'uig', 'uyghur',          // Uyghur
  'dv', 'div', 'dhivehi',         // Dhivehi/Maldivian
  'arc', 'aramaic',               // Aramaic
  'syr', 'syriac',                // Syriac
  'sam', 'samaritan',             // Samaritan
  'mand', 'mandaic',              // Mandaic
]);

/**
 * Detects if text contains RTL characters
 */
export function containsRTLCharacters(text: string): boolean {
  if (!text || typeof text !== 'string') {
    return false;
  }

  // Check each character against RTL Unicode ranges
  for (let i = 0; i < text.length; i++) {
    const charCode = text.codePointAt(i);
    if (!charCode) continue;

    // Check if character falls within any RTL Unicode range
    for (const [start, end] of RTL_UNICODE_RANGES) {
      if (charCode >= start && charCode <= end) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Calculates the percentage of RTL characters in text
 */
export function calculateRTLPercentage(text: string): number {
  if (!text || typeof text !== 'string') {
    return 0;
  }

  let rtlCount = 0;
  let totalChars = 0;

  for (let i = 0; i < text.length; i++) {
    const charCode = text.codePointAt(i);
    if (!charCode) continue;

    // Skip whitespace and punctuation for more accurate calculation
    if (/\s/.test(text[i]) || /[.,!?;:()[\]{}"'-]/.test(text[i])) {
      continue;
    }

    totalChars++;

    // Check if character is RTL
    for (const [start, end] of RTL_UNICODE_RANGES) {
      if (charCode >= start && charCode <= end) {
        rtlCount++;
        break;
      }
    }
  }

  return totalChars > 0 ? (rtlCount / totalChars) * 100 : 0;
}

/**
 * Detects if text is primarily RTL based on character analysis
 */
export function isTextPrimarilyRTL(text: string, threshold: number = 30): boolean {
  if (!text || typeof text !== 'string') {
    return false;
  }

  // Quick check for RTL characters
  if (!containsRTLCharacters(text)) {
    return false;
  }

  // Calculate RTL percentage
  const rtlPercentage = calculateRTLPercentage(text);
  
  return rtlPercentage >= threshold;
}

/**
 * Detects RTL based on language code
 */
export function isLanguageRTL(languageCode: string): boolean {
  if (!languageCode || typeof languageCode !== 'string') {
    return false;
  }

  const normalizedCode = languageCode.toLowerCase().trim();
  
  // Check exact matches and common variations
  return RTL_LANGUAGE_CODES.has(normalizedCode) ||
         RTL_LANGUAGE_CODES.has(normalizedCode.split('-')[0]) || // Handle codes like 'ar-SA'
         RTL_LANGUAGE_CODES.has(normalizedCode.split('_')[0]);   // Handle codes like 'ar_SA'
}

/**
 * Comprehensive RTL detection combining multiple methods
 */
export function detectTextDirection(
  text: string, 
  languageCode?: string,
  options: {
    rtlThreshold?: number;
    preferLanguageCode?: boolean;
  } = {}
): 'rtl' | 'ltr' {
  const { rtlThreshold = 30, preferLanguageCode = false } = options;

  // If language code is provided and we prefer it, check that first
  if (preferLanguageCode && languageCode && isLanguageRTL(languageCode)) {
    return 'rtl';
  }

  // Analyze text content
  if (text && typeof text === 'string') {
    if (isTextPrimarilyRTL(text, rtlThreshold)) {
      return 'rtl';
    }
  }

  // Fallback to language code if text analysis is inconclusive
  if (languageCode && isLanguageRTL(languageCode)) {
    return 'rtl';
  }

  return 'ltr';
}

/**
 * Gets appropriate CSS direction and text-align values for text
 */
export function getTextDirectionStyles(
  text: string,
  languageCode?: string,
  options?: {
    rtlThreshold?: number;
    preferLanguageCode?: boolean;
  }
): {
  direction: 'rtl' | 'ltr';
  textAlign: 'right' | 'left';
  unicodeBidi: 'embed' | 'normal';
} {
  const direction = detectTextDirection(text, languageCode, options);
  
  return {
    direction,
    textAlign: direction === 'rtl' ? 'right' : 'left',
    unicodeBidi: direction === 'rtl' ? 'embed' : 'normal',
  };
}

/**
 * Detects mixed RTL/LTR content and suggests appropriate handling
 */
export function analyzeMixedContent(text: string): {
  hasRTL: boolean;
  hasLTR: boolean;
  isMixed: boolean;
  rtlPercentage: number;
  suggestedDirection: 'rtl' | 'ltr';
  shouldUseBidi: boolean;
} {
  if (!text || typeof text !== 'string') {
    return {
      hasRTL: false,
      hasLTR: false,
      isMixed: false,
      rtlPercentage: 0,
      suggestedDirection: 'ltr',
      shouldUseBidi: false,
    };
  }

  const hasRTL = containsRTLCharacters(text);
  const rtlPercentage = calculateRTLPercentage(text);
  
  // Detect LTR characters (basic Latin, numbers, etc.)
  const hasLTR = /[a-zA-Z0-9]/.test(text);
  
  const isMixed = hasRTL && hasLTR;
  const suggestedDirection = rtlPercentage > 50 ? 'rtl' : 'ltr';
  const shouldUseBidi = isMixed && rtlPercentage > 10 && rtlPercentage < 90;

  return {
    hasRTL,
    hasLTR,
    isMixed,
    rtlPercentage,
    suggestedDirection,
    shouldUseBidi,
  };
}

/**
 * Utility function to wrap text with appropriate RTL/LTR markers
 */
export function wrapTextWithDirectionMarkers(text: string, direction: 'rtl' | 'ltr'): string {
  if (!text || typeof text !== 'string') {
    return text;
  }

  // Unicode direction markers
  const LTR_MARK = '\u200E'; // Left-to-Right Mark
  const RTL_MARK = '\u200F'; // Right-to-Left Mark
  const LTR_EMBED = '\u202A'; // Left-to-Right Embedding
  const RTL_EMBED = '\u202B'; // Right-to-Left Embedding
  const POP_DIRECTIONAL = '\u202C'; // Pop Directional Formatting

  if (direction === 'rtl') {
    return `${RTL_EMBED}${text}${POP_DIRECTIONAL}`;
  } else {
    return `${LTR_EMBED}${text}${POP_DIRECTIONAL}`;
  }
}

/**
 * Debug function to analyze text direction properties
 */
export function debugTextDirection(text: string, languageCode?: string): {
  text: string;
  languageCode?: string;
  containsRTL: boolean;
  rtlPercentage: number;
  detectedDirection: 'rtl' | 'ltr';
  languageBasedDirection?: 'rtl' | 'ltr';
  mixedContentAnalysis: ReturnType<typeof analyzeMixedContent>;
  recommendedStyles: ReturnType<typeof getTextDirectionStyles>;
} {
  const containsRTL = containsRTLCharacters(text);
  const rtlPercentage = calculateRTLPercentage(text);
  const detectedDirection = detectTextDirection(text, languageCode);
  const languageBasedDirection = languageCode ? (isLanguageRTL(languageCode) ? 'rtl' : 'ltr') : undefined;
  const mixedContentAnalysis = analyzeMixedContent(text);
  const recommendedStyles = getTextDirectionStyles(text, languageCode);

  return {
    text,
    languageCode,
    containsRTL,
    rtlPercentage,
    detectedDirection,
    languageBasedDirection,
    mixedContentAnalysis,
    recommendedStyles,
  };
}
