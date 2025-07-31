// Language mapping service for Vosk to Kokoro TTS integration

export interface LanguageMapping {
  voskLanguage: string;
  kokoroLanguageCode: string;
  kokoroLanguageName: string;
  defaultVoice: string;
  supported: boolean;
}

// Mapping from Vosk model languages to Kokoro TTS languages
// Based on https://github.com/hexgrad/kokoro requirements
export const LANGUAGE_MAPPINGS: LanguageMapping[] = [
  // English models (default - no extra dependencies needed)
  {
    voskLanguage: 'en',
    kokoroLanguageCode: 'a',
    kokoroLanguageName: 'American English',
    defaultVoice: 'af_heart',
    supported: true
  },
  {
    voskLanguage: 'en-us',
    kokoroLanguageCode: 'a',
    kokoroLanguageName: 'American English',
    defaultVoice: 'af_heart',
    supported: true
  },
  {
    voskLanguage: 'en-gb',
    kokoroLanguageCode: 'b',
    kokoroLanguageName: 'British English',
    defaultVoice: 'bf_emma',
    supported: true
  },
  {
    voskLanguage: 'en-in',
    kokoroLanguageCode: 'a',
    kokoroLanguageName: 'American English',
    defaultVoice: 'af_heart',
    supported: true
  },
  
  // Spanish models (supported by default)
  {
    voskLanguage: 'es',
    kokoroLanguageCode: 'e',
    kokoroLanguageName: 'Spanish',
    defaultVoice: 'ef_dora',
    supported: true
  },
  
  // French models (supported by default)
  {
    voskLanguage: 'fr',
    kokoroLanguageCode: 'f',
    kokoroLanguageName: 'French',
    defaultVoice: 'ff_siwis',
    supported: true
  },
  
  // Italian models (supported by default)
  {
    voskLanguage: 'it',
    kokoroLanguageCode: 'i',
    kokoroLanguageName: 'Italian',
    defaultVoice: 'if_sara',
    supported: true
  },
  
  // Portuguese/Brazilian Portuguese models (supported by default)
  {
    voskLanguage: 'pt',
    kokoroLanguageCode: 'p',
    kokoroLanguageName: 'Brazilian Portuguese',
    defaultVoice: 'pf_dora',
    supported: true
  },
  
  // Hindi models (supported by default)
  {
    voskLanguage: 'hi',
    kokoroLanguageCode: 'h',
    kokoroLanguageName: 'Hindi',
    defaultVoice: 'hf_alpha',
    supported: true
  },
  
  // Chinese models (included in requirements.txt)
  {
    voskLanguage: 'cn',
    kokoroLanguageCode: 'z',
    kokoroLanguageName: 'Mandarin Chinese',
    defaultVoice: 'zf_xiaobei',
    supported: true
  },
  {
    voskLanguage: 'zh',
    kokoroLanguageCode: 'z',
    kokoroLanguageName: 'Mandarin Chinese',
    defaultVoice: 'zf_xiaobei',
    supported: true
  },
  
  // Japanese models (included in requirements.txt)
  {
    voskLanguage: 'ja',
    kokoroLanguageCode: 'j',
    kokoroLanguageName: 'Japanese',
    defaultVoice: 'jf_alpha',
    supported: true
  },
  
  // Unsupported languages (will use English fallback)
  {
    voskLanguage: 'ru',
    kokoroLanguageCode: 'a',
    kokoroLanguageName: 'English (fallback)',
    defaultVoice: 'af_heart',
    supported: false
  },
  {
    voskLanguage: 'de',
    kokoroLanguageCode: 'a',
    kokoroLanguageName: 'English (fallback)',
    defaultVoice: 'af_heart',
    supported: false
  },
  {
    voskLanguage: 'tr',
    kokoroLanguageCode: 'a',
    kokoroLanguageName: 'English (fallback)',
    defaultVoice: 'af_heart',
    supported: false
  },
  {
    voskLanguage: 'vn',
    kokoroLanguageCode: 'a',
    kokoroLanguageName: 'English (fallback)',
    defaultVoice: 'af_heart',
    supported: false
  },
  {
    voskLanguage: 'nl',
    kokoroLanguageCode: 'a',
    kokoroLanguageName: 'English (fallback)',
    defaultVoice: 'af_heart',
    supported: false
  },
  {
    voskLanguage: 'ca',
    kokoroLanguageCode: 'a',
    kokoroLanguageName: 'English (fallback)',
    defaultVoice: 'af_heart',
    supported: false
  },
  {
    voskLanguage: 'ar',
    kokoroLanguageCode: 'a',
    kokoroLanguageName: 'English (fallback)',
    defaultVoice: 'af_heart',
    supported: false
  },
  {
    voskLanguage: 'fa',
    kokoroLanguageCode: 'a',
    kokoroLanguageName: 'English (fallback)',
    defaultVoice: 'af_heart',
    supported: false
  },
  {
    voskLanguage: 'tl',
    kokoroLanguageCode: 'a',
    kokoroLanguageName: 'English (fallback)',
    defaultVoice: 'af_heart',
    supported: false
  },
  {
    voskLanguage: 'uk',
    kokoroLanguageCode: 'a',
    kokoroLanguageName: 'English (fallback)',
    defaultVoice: 'af_heart',
    supported: false
  },
  {
    voskLanguage: 'kz',
    kokoroLanguageCode: 'a',
    kokoroLanguageName: 'English (fallback)',
    defaultVoice: 'af_heart',
    supported: false
  },
  {
    voskLanguage: 'sv',
    kokoroLanguageCode: 'a',
    kokoroLanguageName: 'English (fallback)',
    defaultVoice: 'af_heart',
    supported: false
  },
  {
    voskLanguage: 'eo',
    kokoroLanguageCode: 'a',
    kokoroLanguageName: 'English (fallback)',
    defaultVoice: 'af_heart',
    supported: false
  },
  {
    voskLanguage: 'cs',
    kokoroLanguageCode: 'a',
    kokoroLanguageName: 'English (fallback)',
    defaultVoice: 'af_heart',
    supported: false
  },
  {
    voskLanguage: 'pl',
    kokoroLanguageCode: 'a',
    kokoroLanguageName: 'English (fallback)',
    defaultVoice: 'af_heart',
    supported: false
  },
  {
    voskLanguage: 'uz',
    kokoroLanguageCode: 'a',
    kokoroLanguageName: 'English (fallback)',
    defaultVoice: 'af_heart',
    supported: false
  },
  {
    voskLanguage: 'ko',
    kokoroLanguageCode: 'a',
    kokoroLanguageName: 'English (fallback)',
    defaultVoice: 'af_heart',
    supported: false
  },
  {
    voskLanguage: 'br',
    kokoroLanguageCode: 'a',
    kokoroLanguageName: 'English (fallback)',
    defaultVoice: 'af_heart',
    supported: false
  },
  {
    voskLanguage: 'gu',
    kokoroLanguageCode: 'a',
    kokoroLanguageName: 'English (fallback)',
    defaultVoice: 'af_heart',
    supported: false
  },
  {
    voskLanguage: 'tg',
    kokoroLanguageCode: 'a',
    kokoroLanguageName: 'English (fallback)',
    defaultVoice: 'af_heart',
    supported: false
  },
  {
    voskLanguage: 'te',
    kokoroLanguageCode: 'a',
    kokoroLanguageName: 'English (fallback)',
    defaultVoice: 'af_heart',
    supported: false
  }
];

/**
 * Extract language code from Vosk model name
 */
export function extractLanguageFromVoskModel(modelName: string): string {
  if (!modelName) {
    return 'en';
  }
  
  // Simplified patterns based on actual Vosk model naming convention
  // Models follow: vosk-model-[language]-[version] or vosk-model-small-[language]-[version]
  const patterns = [
    // Standard model pattern: vosk-model-cn-0.22, vosk-model-en-us-0.22
    /^vosk-model-([a-z]{2}(?:-[a-z]{2})?)-/i,
    
    // Small model pattern: vosk-model-small-cn-0.22, vosk-model-small-en-us-0.15
    /^vosk-model-small-([a-z]{2}(?:-[a-z]{2})?)-/i,
    
    // Direct model name (if just the model name without prefix): cn-0.22, en-us-0.22
    /^([a-z]{2}(?:-[a-z]{2})?)-/i,
    
    // Special cases for specific models
    // Greek: vosk-model-el-gr-0.7
    /^vosk-model-(el-gr)-/i,
    
    // Filipino: vosk-model-tl-ph-generic-0.6
    /^vosk-model-(tl-ph)-/i,
    
    // Arabic Tunisian: vosk-model-ar-tn-0.1-linto
    /^vosk-model-(ar-tn)-/i,
    
    // Portuguese Brazilian: vosk-model-pt-fb-v0.1.1
    /^vosk-model-(pt)-/i
  ];
  
  for (const pattern of patterns) {
    const match = modelName.match(pattern);
    if (match && match[1]) {
      const lang = match[1].toLowerCase();
      console.log(`🌐 Detected language "${lang}" from model: ${modelName}`);
      return lang;
    }
  }
  
  // Default to English if no language detected
  console.log(`⚠️ Could not detect language from model "${modelName}", defaulting to English`);
  return 'en';
}

/**
 * Get Kokoro TTS mapping for a Vosk model
 */
export function getKokoroMappingForVoskModel(modelName: string): LanguageMapping {
  const detectedLanguage = extractLanguageFromVoskModel(modelName);
  
  // Find exact match first
  let mapping = LANGUAGE_MAPPINGS.find(m => m.voskLanguage === detectedLanguage);
  
  // If no exact match, try partial matches
  if (!mapping) {
    mapping = LANGUAGE_MAPPINGS.find(m => 
      detectedLanguage.startsWith(m.voskLanguage) || 
      m.voskLanguage.startsWith(detectedLanguage)
    );
  }
  
  // Default to English if no mapping found
  if (!mapping) {
    mapping = LANGUAGE_MAPPINGS.find(m => m.voskLanguage === 'en') || LANGUAGE_MAPPINGS[0];
  }
  
  return mapping;
}

/**
 * Check if a language is supported by Kokoro TTS
 */
export function isLanguageSupportedByKokoro(voskModelName: string): boolean {
  const mapping = getKokoroMappingForVoskModel(voskModelName);
  return mapping.supported;
}

/**
 * Get unsupported language message
 */
export function getUnsupportedLanguageMessage(voskModelName: string): string {
  const detectedLanguage = extractLanguageFromVoskModel(voskModelName);
  const mapping = getKokoroMappingForVoskModel(voskModelName);
  
  if (mapping.supported) {
    return '';
  }
  
  // Create a user-friendly language name
  const languageNames: { [key: string]: string } = {
    'ru': 'Russian',
    'de': 'German',
    'tr': 'Turkish',
    'vi': 'Vietnamese',
    'nl': 'Dutch',
    'ca': 'Catalan',
    'ar': 'Arabic',
    'fa': 'Persian/Farsi',
    'tl': 'Filipino/Tagalog',
    'uk': 'Ukrainian',
    'kz': 'Kazakh',
    'sv': 'Swedish',
    'eo': 'Esperanto',
    'cs': 'Czech',
    'pl': 'Polish',
    'uz': 'Uzbek',
    'ko': 'Korean',
    'br': 'Breton',
    'gu': 'Gujarati',
    'tg': 'Tajik',
    'te': 'Telugu'
  };
  
  const languageName = languageNames[detectedLanguage] || detectedLanguage.toUpperCase();
  
  return `${languageName} language is not supported by Kokoro TTS. Using English voice instead.`;
}
