
const { getFallbackUsername } = require('./fallback-username');

function sanitizeForOBS(text) {
    // Handle invalid input
    if (!text || typeof text !== 'string') {
        return '';
    }
    
    // Keep only ASCII printable characters (32-126)
    // This includes:
    // - Space (32)
    // - All keyboard symbols and punctuation (!@#$%^&*()_+-=[]{}|;':",./<>?)
    // - Numbers (0-9)
    // - Letters (a-z, A-Z)
    // - Tilde (126)
    const asciiOnly = text.replace(/[^\x20-\x7E]/g, '');
    
    // Return ASCII-only text, preserving original spacing
    return asciiOnly;
}

function isOBSSafe(text) {
    if (!text || typeof text !== 'string') {
        return true; // Empty/invalid text is safe
    }
    
    // Check if all characters are in ASCII printable range
    return /^[\x20-\x7E]*$/.test(text);
}

function sanitizeUsernameForOBS(username) {
    const sanitized = sanitizeForOBS(username);
    
    // If username becomes empty after sanitization, use fallback
    return sanitized || getFallbackUsername();
}

function sanitizeChatForOBS(message) {
    return sanitizeForOBS(message);
}

module.exports = {
    sanitizeForOBS,
    isOBSSafe,
    sanitizeUsernameForOBS,
    sanitizeChatForOBS
};
