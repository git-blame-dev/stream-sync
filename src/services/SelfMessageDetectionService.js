
const { logger } = require('../core/logging');

class SelfMessageDetectionService {
    constructor(config) {
        this.config = config;
        this.logger = logger;
        
        // Validate configuration
        if (!config) {
            this.logger.warn('SelfMessageDetectionService initialized without config, using safe defaults', 'self-filter');
        }
    }

    isFilteringEnabled(platform) {
        try {
            if (!this.config) {
                // Safe default: don't filter self messages (for testing)
                return false;
            }

            // Check for platform-specific override first
            const platformSpecific = this.config.get?.(platform, 'ignoreSelfMessages', null);
            if (platformSpecific !== null) {
                return this.config.getBoolean?.(platform, 'ignoreSelfMessages', false);
            }

            // Fall back to global setting (now uses standard override pattern in config.js)
            return this.config.getBoolean?.('general', 'ignoreSelfMessages', false);
        } catch (error) {
            this.logger.warn(`Error checking filtering config for ${platform}: ${error.message}`, 'self-filter');
            // Safe default: don't filter self messages (for testing)
            return false;
        }
    }

    isSelfMessage(platform, messageData, platformConfig) {
        try {
            if (!messageData) {
                return false;
            }

            switch (platform.toLowerCase()) {
                case 'twitch':
                    return this._isTwitchSelfMessage(messageData, platformConfig);
                case 'youtube':
                    return this._isYouTubeSelfMessage(messageData, platformConfig);
                case 'tiktok':
                    return this._isTikTokSelfMessage(messageData, platformConfig);
                default:
                    this.logger.warn(`Unknown platform for self-message detection: ${platform}`, 'self-filter');
                    return false;
            }
        } catch (error) {
            this.logger.warn(`Error detecting self-message for ${platform}: ${error.message}`, 'self-filter', error);
            // Safe default: don't filter on error
            return false;
        }
    }

    shouldFilterMessage(platform, messageData, platformConfig) {
        try {
            // If filtering is disabled, never filter
            if (!this.isFilteringEnabled(platform)) {
                return false;
            }

            // Check if this is a self-message
            return this.isSelfMessage(platform, messageData, platformConfig);
        } catch (error) {
            this.logger.warn(`Error in shouldFilterMessage for ${platform}: ${error.message}`, 'self-filter', error);
            // Safe default: don't filter on error
            return false;
        }
    }

    _isTwitchSelfMessage(messageData, platformConfig) {
        // Twitch provides a direct 'self' flag
        if (messageData.self !== undefined) {
            return Boolean(messageData.self);
        }

        // Fallback: compare usernames if available
        if (messageData.username && platformConfig?.username) {
            return messageData.username.toLowerCase() === platformConfig.username.toLowerCase();
        }

        // Additional fallback: check context if available (for Twitch IRC format)
        if (messageData.context?.username && platformConfig?.username) {
            return messageData.context.username.toLowerCase() === platformConfig.username.toLowerCase();
        }

        return false;
    }

    _isYouTubeSelfMessage(messageData, platformConfig) {
        // Method 1: Compare usernames/display names
        if (messageData.username && platformConfig?.username) {
            return messageData.username.toLowerCase() === platformConfig.username.toLowerCase();
        }

        // Method 2: Check if author has broadcaster badge or special flag
        if (messageData.author?.isChatOwner || messageData.isBroadcaster) {
            return true;
        }

        // Method 3: Check badges for owner/broadcaster badge
        if (messageData.badges) {
            const badges = Array.isArray(messageData.badges) ? messageData.badges : [];
            return badges.some(badge => 
                badge.toLowerCase().includes('owner') || 
                badge.toLowerCase().includes('broadcaster')
            );
        }

        return false;
    }

    _isTikTokSelfMessage(messageData, platformConfig) {
        // Method 1: Compare usernames directly
        if (messageData.username && platformConfig?.username) {
            return messageData.username.toLowerCase() === platformConfig.username.toLowerCase();
        }

        // Method 2: Compare unique IDs if available
        if (messageData.userId && platformConfig?.userId) {
            return messageData.userId === platformConfig.userId;
        }

        // Method 3: Check for broadcaster/owner flag
        if (messageData.isBroadcaster) {
            return true;
        }

        return false;
    }

    validateConfiguration() {
        const result = {
            isValid: true,
            warnings: [],
            errors: []
        };

        try {
            if (!this.config) {
                result.warnings.push('No configuration provided to SelfMessageDetectionService');
                return result;
            }

            // Check if general section has ignoreSelfMessages setting
            const generalConfig = this.config.getSection?.('general') || {};
            if (!generalConfig.hasOwnProperty('ignoreSelfMessages')) {
                result.warnings.push('No ignoreSelfMessages setting found in [general] section');
            }

            // Validate platform-specific overrides format
            const platforms = ['twitch', 'youtube', 'tiktok'];
            platforms.forEach(platform => {
                const platformOverride = this.config.get?.(platform, 'ignoreSelfMessages', null);
                if (platformOverride !== null && typeof platformOverride !== 'boolean' && 
                    !['true', 'false'].includes(String(platformOverride).toLowerCase())) {
                    result.warnings.push(
                        `Platform override ${platform}.ignoreSelfMessages should be a boolean value`
                    );
                }
            });

        } catch (error) {
            result.errors.push(`Configuration validation error: ${error.message}`);
            result.isValid = false;
        }

        return result;
    }
}

module.exports = SelfMessageDetectionService;
