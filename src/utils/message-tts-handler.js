
class MessageTTSHandler {
    static MESSAGE_DELAYS = {
        paypiggy: 4000,
        bits: 3000,
        comment: 0 // Immediate for chat comments
    };

    static createTTSStages(notification) {
        const stages = [];
        
        // Stage 1: Primary TTS (amount, event description) - always included
        if (notification.ttsMessage) {
            stages.push({
                text: notification.ttsMessage,
                delay: 0,
                type: 'primary'
            });
        }
        
        // Stage 2: Message TTS (if message exists and type supports it)
        if (this.supportsMessages(notification) && this.hasValidMessage(notification.message)) {
            stages.push(this.createMessageStage(notification));
        }
        
        return stages;
    }
    
    static createMessageStage(notification) {
        const delay = this.getMessageDelay(notification);

        const messageTTS = this.createMessageTTS(notification.username, notification.message, notification);
        return {
            text: messageTTS,
            delay: delay,
            type: 'message'
        };
    }
    
    static supportsMessages(notification) {
        if (!notification || typeof notification !== 'object') {
            return false;
        }

        // YouTube message-supporting notifications
        if (notification.isSuperChat) return true;
        if (this._isPaypiggyWithMessage(notification)) return true;
        
        // TikTok message-supporting notifications
        if (notification.isComment) return true;
        
        return false;
    }
    
    static hasValidMessage(message) {
        if (!message || typeof message !== 'string') {
            return false;
        }
        
        return message.trim().length > 0;
    }
    
    static createMessageTTS(username, message, notification = null) {
        const NotificationBuilder = require('./notification-builder');
        
        // Use clean text content if available from cheermote processing
        let cleanMessage = message;
        if (notification && notification.cheermoteInfo && notification.cheermoteInfo.textContent) {
            cleanMessage = notification.cheermoteInfo.textContent;
        }
        
        // Apply 12-character limit for usernames that need sanitization, are very long, or when message needs trimming
        const messageNeedsTrimming = cleanMessage && cleanMessage !== cleanMessage.trim();
        const needsTruncation = this.needsUsernameTruncation(username, messageNeedsTrimming);
        const maxLength = needsTruncation ? 12 : null;
        const ttsUsername = NotificationBuilder.sanitizeUsernameForTts(username, maxLength);
        
        const sanitizedMessage = cleanMessage.trim();
        return `${ttsUsername} says ${sanitizedMessage}`;
    }
    
    static needsUsernameTruncation(username, messageNeedsTrimming = false) {
        if (!username || typeof username !== 'string') return false;
        
        // Truncate usernames with emojis or special Unicode characters
        const hasEmojis = /[\u{1F000}-\u{1F999}]|[🌸🌈✨🦄🎮💎🔥💯]/gu.test(username);
        
        // Truncate very long usernames (>15 characters)
        const isVeryLong = username.length > 15;
        
        // Also truncate when message needs trimming (optimization context)
        const shouldOptimize = messageNeedsTrimming;
        
        return hasEmojis || isVeryLong || shouldOptimize;
    }
    
    static getMessageDelay(notification) {
        // Canonical paypiggy with a user message (covers renewals/resub notes)
        if (this._isPaypiggyWithMessage(notification)) return this.MESSAGE_DELAYS.paypiggy;
        
        // Twitch Bits
        const currency = typeof notification.currency === 'string' ? notification.currency.trim().toLowerCase() : '';
        if (currency === 'bits') return this.MESSAGE_DELAYS.bits;
        
        // TikTok Comments (immediate)
        if (notification.isComment) return this.MESSAGE_DELAYS.comment;
        
        // Default fallback
        return 4000;
    }

    static _isPaypiggyWithMessage(notification) {
        return notification?.type === 'platform:paypiggy' && this.hasValidMessage(notification.message);
    }
}

module.exports = MessageTTSHandler;
