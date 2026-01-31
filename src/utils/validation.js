
const { getFallbackUsername } = require('./fallback-username');

const REGEX_PATTERNS = {
    // Username validation patterns
    USERNAME_BASIC: /^[a-zA-Z0-9_-]{1,50}$/,
    USERNAME_ALPHANUMERIC: /^[a-zA-Z0-9]$/,
    USERNAME_LETTER: /^[a-zA-Z]$/,
    USERNAME_NUMBER: /^[0-9]$/,
    
    // Command validation patterns
    COMMAND_FORMAT: /^![a-zA-Z0-9_-]+(\s+[a-zA-Z0-9\s_-]*)?$/,
    COMMAND_PREFIX: /^![a-zA-Z0-9_-]+$/,
    
    // Platform-specific patterns
    YOUTUBE_VIDEO_ID: /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    TIKTOK_USERNAME: /@?([a-zA-Z0-9_.]+)/,
    TWITCH_USERNAME: /^[a-zA-Z0-9_]{4,25}$/,
    
    // Content validation patterns
    URL_VALIDATION: /^https?:\/\/.+/,
    HTML_TAGS: /<[^>]*>/g,
    JAVASCRIPT_URLS: /javascript:/gi,
    ALERT_CALLS: /alert\([^)]*\)/g,
    
    // Text processing patterns
    EMOJI_UNICODE: /[\u{1F300}-\u{1F9FF}]/gu,
    SPECIAL_CHARS: /[^\w\s]/g,
    NUMBERS: /\d+/g,
    WHITESPACE_NORMALIZE: /\s+/g,
    ALLOWED_TTS_CHARS: /^[a-zA-Z0-9 ]*$/,
    
    // Security patterns
    SHELL_INJECTION: /[;|&$`]/g,
    HTML_SCRIPT_CHARS: /[<>&"']/g,
    DANGEROUS_CHARS: /[<>&"';|&$`]/g
};

const PLATFORM_LIMITS = {
    MESSAGE_MAX_LENGTH: {
        TikTok: 150,
        Twitch: 500,
        YouTube: 200,
        default: 200
    },
    USERNAME_MAX_LENGTH: 50,
    COMMAND_MAX_LENGTH: 100,
    TTS_MAX_LENGTH: 50
};

function sanitizeForTTS(username) {
    if (!username || typeof username !== 'string') {
        return '';
    }
    
    // Remove Unicode emojis first
    let processedUsername = username.replace(REGEX_PATTERNS.EMOJI_UNICODE, '').trim();
    
    // Replace common separators with spaces for better TTS pronunciation
    processedUsername = processedUsername.replace(/[_\-\.@]/g, ' ');
    
    // Remove all other non-alphanumeric characters (keep only A-Z, a-z, 0-9, spaces)
    processedUsername = processedUsername.replace(/[^a-zA-Z0-9 ]/g, '');
    
    // Truncate long numbers to first digit (e.g., "haru 24345" → "haru 2", "user123" → "user1")
    processedUsername = processedUsername.replace(/\d{2,}/g, (match) => match[0]);
    
    // Normalize whitespace (multiple spaces → single space)
    processedUsername = processedUsername.replace(/\s+/g, ' ').trim();
    
    // Return the sanitized username or empty string if nothing remains
    return processedUsername || '';
}

function getFirstWord(username) {
    if (!username || typeof username !== 'string') {
        return getFallbackUsername(); // Default if input is invalid
    }

    let firstWord = "";
    let foundStart = false;
    
    // First pass: find the start of the first alphanumeric sequence
    for (let i = 0; i < username.length; i++) {
        const char = username[i];
        if (REGEX_PATTERNS.USERNAME_ALPHANUMERIC.test(char)) {
            foundStart = true;
            // If we find a number, just use that number
            if (REGEX_PATTERNS.USERNAME_NUMBER.test(char)) {
                return char;
            }
            // If we find a letter, start collecting the word
            if (REGEX_PATTERNS.USERNAME_LETTER.test(char)) {
                firstWord = char;
                // Continue collecting letters until we hit a non-letter
                for (let j = i + 1; j < username.length; j++) {
                    const nextChar = username[j];
                    if (REGEX_PATTERNS.USERNAME_LETTER.test(nextChar)) {
                        firstWord += nextChar;
                    } else {
                        break;
                    }
                }
                break;
            }
        }
    }
    
    // If we didn't find any alphanumeric characters, return fallback username
    return foundStart ? firstWord : getFallbackUsername();
}

function formatUsername12(username, forTTS = false) {
    if (!username || typeof username !== 'string') {
        return getFallbackUsername();
    }

    let processedUsername = username.trim();
    
    // For TTS: remove emojis and special characters first
    if (forTTS) {
        processedUsername = processedUsername.replace(REGEX_PATTERNS.EMOJI_UNICODE, '').trim();
        
        // Replace common separators with spaces for better TTS pronunciation
        processedUsername = processedUsername.replace(/[_\-\.@]/g, ' ');
        
        // Remove all other non-alphanumeric characters (keep only A-Z, a-z, 0-9, spaces)
        processedUsername = processedUsername.replace(/[^a-zA-Z0-9 ]/g, '');
        
        // Truncate long numbers to first digit (e.g., "haru 24345" → "haru 2", "user123" → "user1")
        processedUsername = processedUsername.replace(/\d{2,}/g, (match) => match[0]);
        
        // Normalize whitespace (multiple spaces → single space)
        processedUsername = processedUsername.replace(/\s+/g, ' ').trim();
        
        // If no valid characters remain, fallback to configured username
        if (!processedUsername) {
            return getFallbackUsername();
        }
    } else {
        // For display: only remove dangerous HTML/script characters
        processedUsername = processedUsername
            .replace(REGEX_PATTERNS.HTML_TAGS, '')
            .replace(REGEX_PATTERNS.JAVASCRIPT_URLS, '')
            .replace(REGEX_PATTERNS.ALERT_CALLS, '')
            .replace(REGEX_PATTERNS.WHITESPACE_NORMALIZE, ' ')
            .trim();
    }
    
    // If nothing remains after processing, return fallback
    if (!processedUsername) {
        return getFallbackUsername();
    }
    
    // If already 12 characters or less, return as-is
    if (processedUsername.length <= 12) {
        return processedUsername;
    }
    
    // Try to use first word(s) that fit within 12 characters
    const words = processedUsername.split(/\s+/);
    let result = '';
    
    for (const word of words) {
        const testResult = result ? `${result} ${word}` : word;
        if (testResult.length <= 12) {
            result = testResult;
        } else {
            break;
        }
    }
    
    // If we got some words that fit, use them
    if (result && result.length > 0) {
        return result;
    }
    
    // Otherwise, truncate to 12 characters
    return processedUsername.substring(0, 12);
}

function sanitizeDisplayName(displayName, maxLength = 12) {
    return formatUsername12(displayName, false);
}

function sanitizeForTTSGreeting(username) {
    return formatUsernameForTTSGreeting(username);
}

function formatUsernameForTTSGreeting(username) {
    if (!username || typeof username !== 'string') {
        return getFallbackUsername();
    }

    let processedUsername = username.trim();
    
    // Remove emojis and special characters for TTS clarity
    processedUsername = processedUsername.replace(REGEX_PATTERNS.EMOJI_UNICODE, '').trim();
    
    // Replace common separators with spaces for better TTS pronunciation
    processedUsername = processedUsername.replace(/[_\-\.@]/g, ' ');
    
    // Remove all other non-alphanumeric characters (keep only A-Z, a-z, 0-9, spaces)
    processedUsername = processedUsername.replace(/[^a-zA-Z0-9 ]/g, '');
    
    // Truncate long numbers to first digit (e.g., "haru 24345" → "haru 2", "user123" → "user1")
    processedUsername = processedUsername.replace(/\d{2,}/g, (match) => match[0]);
    
    // Normalize whitespace (multiple spaces → single space)
    processedUsername = processedUsername.replace(/\s+/g, ' ').trim();
    
    // If no valid characters remain, fallback to configured username
    if (!processedUsername) {
        return getFallbackUsername();
    }
    
    // For greetings, use a more generous 20-character limit to preserve more of the username
    if (processedUsername.length <= 20) {
        return processedUsername;
    }
    
    // Try to use first words that fit within 20 characters
    const words = processedUsername.split(/\s+/);
    let result = '';
    
    for (const word of words) {
        const testResult = result ? `${result} ${word}` : word;
        if (testResult.length <= 20) {
            result = testResult;
        } else {
            break;
        }
    }
    
    // If we got some words that fit, use them
    if (result && result.length > 0) {
        return result;
    }
    
    // Otherwise, truncate to 20 characters
    return processedUsername.substring(0, 20);
}

function isValidCommand(command) {
    if (!command || typeof command !== 'string') {
        return false;
    }
    
    return REGEX_PATTERNS.COMMAND_FORMAT.test(command.trim());
}

function sanitizeCommand(command) {
    if (!command || typeof command !== 'string') {
        return '';
    }
    
    return command
        .replace(REGEX_PATTERNS.HTML_SCRIPT_CHARS, '') // Remove HTML/script chars
        .replace(REGEX_PATTERNS.SHELL_INJECTION, '') // Remove shell injection chars
        .trim()
        .substring(0, PLATFORM_LIMITS.COMMAND_MAX_LENGTH);
}

function validateMessage(message, platform) {
    const validation = {
        isValid: true,
        errors: [],
        sanitized: message
    };
    
    // Basic validation
    if (!message || typeof message !== 'string') {
        validation.isValid = false;
        validation.errors.push('Invalid message format');
        return validation;
    }
    
    // Length validation (platform-specific)
    const maxLength = PLATFORM_LIMITS.MESSAGE_MAX_LENGTH[platform] || PLATFORM_LIMITS.MESSAGE_MAX_LENGTH.default;
    
    if (message.length > maxLength) {
        validation.isValid = false;
        validation.errors.push(`Message too long (max ${maxLength} chars)`);
    }
    
    // Sanitize HTML/script content
    validation.sanitized = message
        .replace(REGEX_PATTERNS.HTML_TAGS, '') // Remove HTML tags
        .replace(REGEX_PATTERNS.JAVASCRIPT_URLS, '') // Remove javascript: urls
        .replace(REGEX_PATTERNS.ALERT_CALLS, '') // Remove alert calls
        .trim();
    
    return validation;
}

function isValidUsername(username) {
    if (!username || typeof username !== 'string') {
        return false;
    }
    
    return username.length <= PLATFORM_LIMITS.USERNAME_MAX_LENGTH && 
           REGEX_PATTERNS.USERNAME_BASIC.test(username);
}

function isValidPlatformUsername(username, platform) {
    if (!username || typeof username !== 'string') {
        return false;
    }
    
    switch (platform.toLowerCase()) {
        case 'twitch':
            return REGEX_PATTERNS.TWITCH_USERNAME.test(username);
        case 'tiktok':
            return REGEX_PATTERNS.TIKTOK_USERNAME.test(username);
        case 'youtube':
            // YouTube usernames are more flexible
            return username.length >= 1 && username.length <= 50;
        default:
            return isValidUsername(username);
    }
}

function isValidUrl(url) {
    if (!url || typeof url !== 'string') {
        return false;
    }
    
    return REGEX_PATTERNS.URL_VALIDATION.test(url);
}

function extractYouTubeVideoId(url) {
    if (!url || typeof url !== 'string') {
        return null;
    }
    
    const match = url.match(REGEX_PATTERNS.YOUTUBE_VIDEO_ID);
    return match ? match[1] : null;
}

function sanitizeForDisplay(text, maxLength = 200) {
    if (!text || typeof text !== 'string') {
        return '';
    }
    
    return text
        .replace(REGEX_PATTERNS.HTML_TAGS, '') // Remove HTML tags
        .replace(REGEX_PATTERNS.JAVASCRIPT_URLS, '') // Remove javascript: urls
        .replace(REGEX_PATTERNS.WHITESPACE_NORMALIZE, ' ') // Normalize whitespace
        .trim()
        .substring(0, maxLength);
}

function validateForTTS(text) {
    const sanitized = sanitizeForTTS(text);
    
    return {
        isValid: sanitized.length > 0,
        sanitized: sanitized
    };
}

function validateConfigStructure(config) {
    if (!config || typeof config !== 'object') {
        throw new Error('Configuration must be an object');
    }
    
    if (!config.general) {
        throw new Error('Missing required configuration section: general');
    }
    
    return true;
}

function isValidUserId(userId) {
    return userId && typeof userId === 'string' && userId.trim().length > 0;
}

function getMessageLengthLimit(platform) {
    return PLATFORM_LIMITS.MESSAGE_MAX_LENGTH[platform] || PLATFORM_LIMITS.MESSAGE_MAX_LENGTH.default;
}

module.exports = {
    // Core validation functions
    sanitizeForTTS,
    getFirstWord,
    sanitizeDisplayName,
    formatUsername12,
    sanitizeForTTSGreeting,
    formatUsernameForTTSGreeting,
    isValidCommand,
    sanitizeCommand,
    validateMessage,
    isValidPlatformUsername,
    isValidUrl,
    isValidUserId,
    
    // Text processing utilities
    sanitizeForDisplay,
    validateForTTS,
    extractYouTubeVideoId,
    
    // Configuration validation
    validateConfigStructure,
    
    // Utility functions
    getMessageLengthLimit
};
