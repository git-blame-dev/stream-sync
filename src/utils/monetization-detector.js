
// Performance optimization: Cache compiled regex patterns
const COMPILED_PATTERNS = {
    // Twitch cheermote pattern: word followed by digits
    // Matches: Cheer100, uni50, ShowLove25, Kappa69, BibleThump10, etc.
    TWITCH_CHEERMOTE: /\b[A-Za-z]+\d+\b/g,
    
    // Extract numeric portion from cheermote
    EXTRACT_NUMBERS: /\d+$/
};

// Constants for better maintainability and performance
const MONETIZATION_TYPES = {
    TWITCH_BITS: 'twitch_bits',
    YOUTUBE_SUPERCHAT: 'youtube_superchat',
    TIKTOK_GIFT: 'tiktok_gift'
};

const DETECTION_RESULT = {
    NONE: { detected: false, type: null, details: null },
    ERROR: (error) => ({ detected: false, type: null, details: null, error: error.message })
};

const PLATFORMS = {
    TWITCH: 'twitch',
    YOUTUBE: 'youtube', 
    TIKTOK: 'tiktok'
};

// Performance metrics tracking
let detectionMetrics = {
    totalDetections: 0,
    detectionsByType: {},
    averageDetectionTime: 0,
    lastResetTime: Date.now()
};

class MonetizationDetector {
    static detectMonetization(messageData, platform) {
        const startTime = performance.now();
        
        try {
            // Input validation for better error handling
            if (!messageData || typeof messageData !== 'object') {
                throw new Error('messageData must be a valid object');
            }
            
            if (!platform || typeof platform !== 'string') {
                throw new Error('platform must be a valid string');
            }
            
            const normalizedPlatform = platform.toLowerCase();
            let result;
            
            // Platform-specific detection with optimized switch
            switch (normalizedPlatform) {
                case PLATFORMS.TWITCH:
                    result = this.detectTwitchBits(messageData);
                    break;
                case PLATFORMS.YOUTUBE:
                    result = this.detectYouTubeSuperChat(messageData);
                    break;
                case PLATFORMS.TIKTOK:
                    result = this.detectTikTokGifts(messageData);
                    break;
                default:
                    result = DETECTION_RESULT.NONE;
                    break;
            }
            
            // Add performance metrics
            const timingMs = performance.now() - startTime;
            result.timingMs = Math.round(timingMs * 100) / 100; // Round to 2 decimal places
            
            // Update metrics for observability
            this.updateMetrics(result, timingMs);
            
            return result;
            
        } catch (error) {
            const timingMs = performance.now() - startTime;
            const errorResult = DETECTION_RESULT.ERROR(error);
            errorResult.timingMs = Math.round(timingMs * 100) / 100;
            
            return errorResult;
        }
    }

    static updateMetrics(result, timingMs) {
        detectionMetrics.totalDetections++;
        
        if (result.detected && result.type) {
            detectionMetrics.detectionsByType[result.type] = 
                (detectionMetrics.detectionsByType[result.type] || 0) + 1;
        }
        
        // Calculate rolling average detection time
        const smoothingFactor = 0.1; // Exponential smoothing factor
        detectionMetrics.averageDetectionTime = 
            (detectionMetrics.averageDetectionTime * (1 - smoothingFactor)) + (timingMs * smoothingFactor);
    }

    static getMetrics() {
        return {
            ...detectionMetrics,
            uptime: Date.now() - detectionMetrics.lastResetTime
        };
    }

    static resetMetrics() {
        detectionMetrics = {
            totalDetections: 0,
            detectionsByType: {},
            averageDetectionTime: 0,
            lastResetTime: Date.now()
        };
    }

    static detectTwitchBits(messageData) {
        // Fast path: Check if message exists and has content
        const message = typeof messageData.message === 'string' ? messageData.message : '';
        if (!message || message.length === 0) {
            return DETECTION_RESULT.NONE;
        }
        
        // Performance optimization: Use pre-compiled regex pattern
        // Reset regex state to ensure clean matching
        COMPILED_PATTERNS.TWITCH_CHEERMOTE.lastIndex = 0;
        const matches = message.match(COMPILED_PATTERNS.TWITCH_CHEERMOTE);
        
        if (!matches || matches.length === 0) {
            return DETECTION_RESULT.NONE;
        }
        
        // Optimized validation: Filter and calculate in single pass
        const validCheermotes = [];
        let totalBits = 0;
        
        for (const match of matches) {
            const numberPart = match.match(COMPILED_PATTERNS.EXTRACT_NUMBERS);
            if (numberPart) {
                const amount = parseInt(numberPart[0], 10);
                if (amount > 0) { // Exclude Cheer0 and similar invalid amounts
                    validCheermotes.push(match);
                    totalBits += amount;
                }
            }
        }
        
        // Early return if no valid cheermotes found
        if (validCheermotes.length === 0) {
            return DETECTION_RESULT.NONE;
        }
        
        return {
            detected: true,
            type: MONETIZATION_TYPES.TWITCH_BITS,
            details: {
                cheermotes: validCheermotes,
                totalBits: totalBits,
                messageLength: message.length,
                cheermoteCount: validCheermotes.length
            }
        };
    }

    static detectYouTubeSuperChat(messageData) {
        // Fast path: Early validation
        if (!messageData || typeof messageData !== 'object') {
            return DETECTION_RESULT.NONE;
        }
        
        // SuperChat events have monetary amount and/or currency data
        const hasAmount = messageData.amount !== undefined && messageData.amount !== null;
        const hasCurrency = messageData.currency !== undefined && messageData.currency !== null;
        const isAnonymous = messageData.isAnonymous === true;
        
        // Enhanced validation: Must have at least amount or currency for SuperChat
        const hasSuperchatData = hasAmount || hasCurrency || isAnonymous;
        
        if (!hasSuperchatData) {
            return DETECTION_RESULT.NONE;
        }
        if (!hasAmount || !hasCurrency) {
            throw new Error('YouTube SuperChat detection requires amount and currency');
        }
        if (typeof messageData.amount !== 'number' || messageData.amount <= 0) {
            throw new Error('YouTube SuperChat detection requires positive numeric amount');
        }
        if (typeof messageData.currency !== 'string' || !messageData.currency.trim()) {
            throw new Error('YouTube SuperChat detection requires currency');
        }

        return {
            detected: true,
            type: MONETIZATION_TYPES.YOUTUBE_SUPERCHAT,
            details: {
                amount: messageData.amount,
                currency: messageData.currency,
                isAnonymous: isAnonymous,
                hasValidAmount: true,
                originalAmount: messageData.amount
            }
        };
    }

    static detectTikTokGifts(messageData) {
        if (!messageData || typeof messageData !== 'object') {
            return DETECTION_RESULT.NONE;
        }

        const hasGiftType = messageData.giftType !== undefined && messageData.giftType !== null;
        const hasGiftCount = messageData.giftCount !== undefined && messageData.giftCount !== null;
        const hasAmount = messageData.amount !== undefined && messageData.amount !== null;

        if (!hasGiftType && !hasGiftCount) {
            return DETECTION_RESULT.NONE;
        }
        if (!hasGiftType || typeof messageData.giftType !== 'string' || !messageData.giftType.trim()) {
            throw new Error('TikTok gift detection requires giftType');
        }

        const giftCount = Number(messageData.giftCount);
        if (!hasGiftCount || !Number.isFinite(giftCount) || giftCount <= 0) {
            throw new Error('TikTok gift detection requires positive giftCount');
        }

        const amount = Number(messageData.amount);
        if (!hasAmount || !Number.isFinite(amount) || amount <= 0) {
            throw new Error('TikTok gift detection requires positive amount');
        }
        if (typeof messageData.currency !== 'string' || !messageData.currency.trim()) {
            throw new Error('TikTok gift detection requires currency');
        }

        return {
            detected: true,
            type: MONETIZATION_TYPES.TIKTOK_GIFT,
            details: {
                giftType: messageData.giftType,
                giftCount,
                amount,
                currency: messageData.currency,
                totalValue: amount,
                hasValidAmount: true,
                originalData: {
                    giftCount: messageData.giftCount,
                    amount: messageData.amount
                }
            }
        };
    }
}

module.exports = MonetizationDetector;
