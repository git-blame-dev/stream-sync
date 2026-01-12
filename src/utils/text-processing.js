
const { formatUsername12 } = require('./validation');
const { validateLoggerInterface } = require('./dependency-validator');

class TextProcessingManager {
    constructor(dependencies = {}) {
        this._logger = dependencies.logger || null;
    }

    get logger() {
        if (!this._logger) {
            this._logger = this._resolveLogger();
        }
        return this._logger;
    }

    _resolveLogger() {
        if (this._logger) {
            validateLoggerInterface(this._logger);
            return this._logger;
        }

        const candidates = [];

        try {
            const { logger } = require('../core/logging');
            if (logger) {
                candidates.push(logger);
            }
        } catch {
            // Logging may not yet be initialized; fall through to other candidates
        }

        if (global.__TEST_LOGGER__) {
            candidates.push(global.__TEST_LOGGER__);
        }

        const selected = candidates.find(Boolean);
        if (!selected) {
            throw new Error('TextProcessingManager requires a logger dependency to operate');
        }

        const normalized = this._normalizeLoggerMethods(selected);
        validateLoggerInterface(normalized);
        return normalized;
    }

    _normalizeLoggerMethods(logger) {
        const requiredMethods = ['debug', 'info', 'warn', 'error'];
        const normalized = { ...logger };
        requiredMethods.forEach((method) => {
            if (typeof normalized[method] !== 'function') {
                normalized[method] = () => {};
            }
        });
        return normalized;
    }

    sanitizeUsername(username) {
        if (!username || typeof username !== 'string') {
            return '';
        }
        
        // Only remove control characters and problematic characters, preserve Unicode letters and symbols
        return username
            .replace(/[\u0000-\u001F\u007F-\u009F]/g, '') // Remove control characters including null
            .replace(/&amp;/g, '&') // Decode HTML entities
            .replace(/%20/g, ' ') // Decode URL encoding
            .replace(/["\n\r\t]/g, '') // Remove quotes and whitespace chars
            .replace(/<[^>]*>/g, '') // Remove HTML tags
            .replace(/javascript:/gi, '') // Remove javascript injection
            .trim();
    }

    smartTruncateUsername(username, maxLength = 40) {
        if (!username || username.length <= maxLength) {
            return username;
        }

        // Check if username is mostly repetitive characters (like 'AAAAAAA...')
        const uniqueChars = new Set(username).size;
        const isRepetitive = uniqueChars <= 3 && username.length > maxLength;
        
        // Check if username contains meaningful international characters
        const hasInternationalChars = /[\u0080-\uFFFF]/.test(username);
        
        // If username is repetitive (like 'AAAA...'), truncate it
        if (isRepetitive) {
            return username.substring(0, maxLength);
        }
        
        // If username has international characters and is reasonable length (<= 60), keep it full
        if (hasInternationalChars && username.length <= 60) {
            return username;
        }
        
        // For very long usernames (>60 chars), truncate but preserve some international content
        if (username.length > 60) {
            return username.substring(0, maxLength);
        }
        
        // Default truncation for other cases
        return username.substring(0, maxLength);
    }

    extractMessageText(messageParts, platform = 'unknown', context = {}) {
        // Use simplified concatenation for YouTube
        if (platform && platform.toLowerCase() === 'youtube') {
            if (Array.isArray(messageParts)) {
                return messageParts.map(part => {
                    if (typeof part === 'string') {
                        return part;
                    }
                    return part.text || part.emojiText || '';
                }).join('');
            }
            // Fallback: if not array, just return as string
            return typeof messageParts === 'string' ? messageParts.trim() : '';
        }

        // --- Existing logic for other platforms ---
        if (!messageParts) {
            this.logger.debug(`Empty messageParts for ${platform}`, 'text-processing', context);
            return '';
        }
        if (typeof messageParts === 'string') {
            this.logger.debug(`String message for ${platform}: "${messageParts}"`, 'text-processing', context);
            return messageParts.trim();
        }
        if (Array.isArray(messageParts)) {
            if (messageParts.length === 0) {
                this.logger.debug(`Empty messageParts array for ${platform}`, 'text-processing', context);
                return '';
            }
            this.logger.debug(`Processing array message for ${platform}`, 'text-processing', {
                messageParts,
                length: messageParts.length,
                context
            });
            const extractedText = messageParts.map(part => {
                if (typeof part === 'string') {
                    this.logger.debug(`String part: "${part}"`, 'text-processing', context);
                    return part;
                }
                if (typeof part === 'object' && part !== null) {
                    const text = part.text || part.emojiText || part.message || '';
                    this.logger.debug(`Object part`, 'text-processing', {
                        part,
                        extractedText: text,
                        context
                    });
                    return text;
                }
                this.logger.debug(`Unknown part type`, 'text-processing', {
                    part,
                    partType: typeof part,
                    context
                });
                return '';
            }).join('');
            if (!extractedText && messageParts.length > 0) {
                this.logger.debug(`Empty result from non-empty messageParts for ${platform}`, 'text-processing', {
                    messageParts,
                    context
                });
            } else {
                this.logger.debug(`Final extracted text for ${platform}: "${extractedText}"`, 'text-processing', context);
            }
            return extractedText;
        }
        this.logger.debug(`Unexpected messageParts type for ${platform}`, 'text-processing', {
            type: typeof messageParts,
            value: messageParts,
            context
        });
        return String(messageParts || '').trim();
    }

    formatCoinAmount(amount, currency = 'coins') {
        if (!Number.isFinite(Number(amount)) || amount <= 0) {
            return '';
        }

        const label = currency && typeof currency === 'string' ? currency : 'coins';
        if (label !== 'coins') {
            return `${amount} ${label}`;
        }

        const coinText = Number(amount) === 1 ? 'coin' : 'coins';
        return `${amount} ${coinText}`;
    }

    determineGiftName(data, platform, type) {
        if (data.giftType) {
            return data.giftType;
        }

        if (platform === 'tiktok' && type === 'platform:gift') {
            return 'gift';
        }

        if (type === 'platform:gift') {
            return 'gift';
        }

        return 'unknown';
    }

    formatChatMessage(type, username, message, options = {}, truncateUsername = true) {
        const trimmedUsername = (typeof username === 'string') ? username.trim() : '';
        if (!trimmedUsername) {
            return null;
        }

        // Process username based on context:
        // - TTS contexts (truncateUsername = true): Use 12-character limit for readability  
        // - Display contexts (truncateUsername = false): Preserve full username
        const processedUsername = truncateUsername ? 
            formatUsername12(trimmedUsername, false) : // Apply 12-char truncation with display formatting
            trimmedUsername; // Preserve full username without fallback
        
        // Apply message length limits
        const maxMessageLength = options.maxLength || 200;
        const truncatedMessage = this.truncateText(message, maxMessageLength, true);
        
        // Format based on message type
        switch(type) {
            case 'chat':
                return `${processedUsername}: ${truncatedMessage}`;
            case 'system':
                return `[SYSTEM] ${truncatedMessage}`;
            case 'notification':
                return `[${processedUsername}] ${truncatedMessage}`;
            default:
                return `${processedUsername}: ${truncatedMessage}`;
        }
}

    formatDuration(milliseconds) {
        if (milliseconds === 0) {
            return '0s';
        }
        
        if (!milliseconds || milliseconds < 0) {
            return '0s';
        }
        
        if (milliseconds < 1000) {
            return `${milliseconds}ms`;
        }
        
        const totalSeconds = milliseconds / 1000;
        
        // If less than 60 seconds, show seconds with decimal if needed
        if (totalSeconds < 60) {
            return totalSeconds % 1 === 0 ? `${Math.floor(totalSeconds)}s` : `${totalSeconds}s`;
        }
        
        let remaining = Math.floor(totalSeconds);
        const parts = [];
        
        // Hours
        if (remaining >= 3600) {
            const hours = Math.floor(remaining / 3600);
            parts.push(`${hours}h`);
            remaining %= 3600;
        }
        
        // Minutes
        if (remaining >= 60) {
            const minutes = Math.floor(remaining / 60);
            parts.push(`${minutes}m`);
            remaining %= 60;
        }
        
        // Seconds
        if (remaining > 0 || parts.length === 0) {
            parts.push(`${remaining}s`);
        }
        
        return parts.join(' ');
    }

    formatNumber(number, decimals = 1) {
        if (number === null || number === undefined || isNaN(number)) {
            return decimals > 0 ? '0.0' : '0';
        }
        
        return number.toLocaleString('en-US', {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    }

    truncateText(text, maxLength, preserveWords = false) {
    if (!text || typeof text !== 'string') {
        return '';
    }
    
    if (text.length <= maxLength) {
        return text;
    }
    
        if (preserveWords) {
            const words = text.split(' ');
            let result = '';
            
            for (const word of words) {
                if ((result + word).length > maxLength - 3) {
                    break;
    }
                result += (result ? ' ' : '') + word;
            }
            
            return result + (result.length < text.length ? '...' : '');
        }
        
        return text.substring(0, maxLength - 3) + '...';
        }

    toTitleCase(text) {
        if (!text || typeof text !== 'string') {
            return '';
        }
        
        // Split on separators including underscores and hyphens
        return text.split(/([_\-\s]+)/).map(part => {
            if (/[a-zA-Z0-9]/.test(part)) {
                return part.charAt(0).toUpperCase() + part.substr(1).toLowerCase();
            }
            return part;
        }).join('');
    }

    cleanText(text) {
        if (!text || typeof text !== 'string') {
            return '';
        }

        const decoded = text
            .replace(/&amp;/g, '&') // Decode HTML entities
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>');
        
        return decoded
            .replace(/<[^>]*>/g, '') // Remove HTML tags after decoding
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
    }

    extractHashtags(text) {
        if (!text || typeof text !== 'string') {
            return [];
        }
        
        const withoutUrls = text
            .replace(/\b\w+:\/\/\S+/gi, ' ')
            .replace(/\bjavascript:[^\s]+/gi, ' ');
        const withoutTags = withoutUrls.replace(/<[^>]*>/g, ' ');
        const matches = withoutTags.match(/#\w+/g);
        
        return matches || [];
    }

    extractMentions(text) {
        if (!text || typeof text !== 'string') {
            return [];
        }

        // Match mentions that are at the start or preceded by non-word/non-@ to avoid emails/URLs
        const matches = [];
        const mentionPattern = /(^|[^A-Za-z0-9_@])(@[A-Za-z0-9_]+)/g;
        let match;
        while ((match = mentionPattern.exec(text)) !== null) {
            matches.push(match[2]);
        }

        return matches;
    }

    toSlug(text) {
    if (!text || typeof text !== 'string') {
        return '';
    }
    
    return text
        .toLowerCase()
        .replace(/[^\w\s-]/g, '') // Remove special characters
        .replace(/\s+/g, '-') // Replace spaces with hyphens
        .replace(/-+/g, '-') // Remove multiple hyphens
        .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
}

    wrapText(text, lineLength = 80) {
        if (!text || typeof text !== 'string') {
            return '';
        }
        
        const words = text.split(' ');
        const lines = [];
        let currentLine = '';
        
        for (const word of words) {
            if (currentLine.length + word.length + 1 <= lineLength) {
                currentLine += (currentLine ? ' ' : '') + word;
            } else {
                if (currentLine) {
                    lines.push(currentLine);
                }
                currentLine = word;
            }
        }
        
        if (currentLine) {
            lines.push(currentLine);
        }
        
        return lines.join('\n');
}

    generateLogFilename(platform, username) {
        if (!username || typeof username !== 'string' || !username.trim()) {
            return null;
        }

        const safeUsername = username.replace(/[^a-zA-Z0-9]/g, '');
        const date = new Date();
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        
        return `${platform.toLowerCase()}-${safeUsername}-${year}-${month}-${day}.txt`;
    }

    formatViewerCount(count) {
        // Validate input
        if (count === null || count === undefined || isNaN(count)) {
            return "0";
        }
        
        const numericCount = Math.max(0, Math.floor(Number(count)));
        
        // Format with K/M/B suffixes for compact viewer count display
        if (numericCount >= 1000000000) {
            // Billions
            const billions = numericCount / 1000000000;
            return billions >= 10 ? `${Math.round(billions)}B` : `${billions.toFixed(1).replace('.0', '')}B`;
        } else if (numericCount >= 1000000) {
            // Millions
            const millions = numericCount / 1000000;
            return millions >= 10 ? `${Math.round(millions)}M` : `${millions.toFixed(1).replace('.0', '')}M`;
        } else if (numericCount >= 1000) {
            // Thousands
            const thousands = numericCount / 1000;
            return thousands >= 10 ? `${Math.round(thousands)}K` : `${thousands.toFixed(1).replace('.0', '')}K`;
        } else {
            // Under 1000 - show full number
            return numericCount.toString();
        }
    }

    formatLogEntry(timestamp, username, message, platform) {
        let formattedTimestamp = timestamp;
        if (timestamp instanceof Date) {
            formattedTimestamp = timestamp.toISOString().split('T')[0]; // YYYY-MM-DD format
        }
        return `[${formattedTimestamp}] [${platform}] ${username}: ${message}`;
    }
}

// Factory function for creating TextProcessingManager instances with custom dependencies
function createTextProcessingManager(dependencies) {
    return new TextProcessingManager(dependencies);
}

function formatTimestampCompact(ts) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) {
        return '00:00:00';
    }
    const pad = (n) => n.toString().padStart(2, "0");
    const hours = pad(d.getUTCHours());
    const minutes = pad(d.getUTCMinutes());
    const seconds = pad(d.getUTCSeconds());
    return `${hours}:${minutes}:${seconds}`;
}

// Export both class and functions for flexibility
module.exports = {
    // Class exports
    TextProcessingManager,
    createTextProcessingManager,

    formatTimestampCompact
}; 
