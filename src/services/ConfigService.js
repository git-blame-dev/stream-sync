const { logger } = require('../core/logging');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');
const { NOTIFICATION_CONFIGS } = require('../core/constants');

const configServiceErrorHandler = createPlatformErrorHandler(logger, 'config-service');
const SECTION_COMMAND_KEYS = new Set(
    Object.values(NOTIFICATION_CONFIGS)
        .map((config) => config.commandKey)
        .filter((commandKey) => commandKey && !['commands', 'chat', 'general'].includes(commandKey))
);

function handleConfigServiceError(message, error, eventType = 'config-operation') {
    if (error instanceof Error) {
        configServiceErrorHandler.handleEventProcessingError(error, eventType, null, message);
    } else {
        configServiceErrorHandler.logOperationalError(message, 'config-service', error);
    }
}

class ConfigService {
    constructor(config, eventBus = null) {
        this.config = config;
        this.eventBus = eventBus;
        this.cache = new Map();
        
        if (this.eventBus) {
            logger.debug('[ConfigService] Initialized with EventBus integration', 'config-service');
        } else {
            logger.debug('[ConfigService] Initialized without EventBus (standalone mode)', 'config-service');
        }
    }

    get(section, key = null) {
        try {
            this._assertConfigAvailable('get');

            if (key === null && section.includes('.')) {
                return this._getByPath(section);
            }

            if (key !== null) {
                return this._getSectionKey(section, key);
            }

            const sectionValue = this.config[section];
            if (sectionValue === undefined) {
                throw new Error(`Missing config section: ${section}`);
            }
            return sectionValue;

        } catch (error) {
            handleConfigServiceError(`[ConfigService] Error accessing config: ${error.message}`, error, 'get');
            throw error;
        }
    }

    getPlatformConfig(platform, key) {
        try {
            this._assertConfigAvailable('get-platform-config');

            const platformConfig = this.config[platform];
            if (platformConfig && platformConfig[key] !== undefined) {
                return platformConfig[key];
            }

            throw new Error(`Missing platform config: ${platform}.${key}`);

        } catch (error) {
            handleConfigServiceError(`[ConfigService] Error accessing platform config: ${error.message}`, error, 'get-platform-config');
            throw error;
        }
    }

    areNotificationsEnabled(notificationType, platform = null) {
        try {
            this._assertConfigAvailable('notifications');

            if (platform) {
                const platformConfig = this.config[platform];
                if (platformConfig && platformConfig[notificationType] !== undefined) {
                    return !!platformConfig[notificationType];
                }
            }
            
            const generalEnabled = this.config.general?.[notificationType];
            if (generalEnabled !== undefined) {
                return !!generalEnabled;
            }
            
            throw new Error(`Missing notification config: ${platform ? `${platform}.` : ''}${notificationType}`);

        } catch (error) {
            handleConfigServiceError(`[ConfigService] Error checking notifications enabled: ${error.message}`, error, 'notifications');
            throw error;
        }
    }

    getTTSConfig() {
        try {
            this._assertConfigAvailable('tts');

            const ttsConfig = this.config.tts;
            if (!ttsConfig) {
                throw new Error('Missing tts config');
            }

            const enabled = this.config.general?.ttsEnabled;
            
            return {
                enabled: Boolean(enabled),
                deduplicationEnabled: ttsConfig.deduplicationEnabled,
                debugDeduplication: ttsConfig.debugDeduplication,
                onlyForGifts: ttsConfig.onlyForGifts,
                voice: ttsConfig.voice,
                rate: ttsConfig.rate,
                volume: ttsConfig.volume
            };

        } catch (error) {
            handleConfigServiceError(`[ConfigService] Error getting TTS config: ${error.message}`, error, 'tts');
            throw error;
        }
    }

    getTimingConfig() {
        try {
            const timing = this.get('timing');

            if (!timing) {
                throw new Error('Missing timing config');
            }
            
            return {
                greetingDuration: timing.greetingDuration,
                commandDuration: timing.defaultNotificationDuration,
                chatDuration: timing.chatMessageDuration,
                notificationDuration: timing.defaultNotificationDuration
            };

        } catch (error) {
            handleConfigServiceError(`[ConfigService] Error getting timing config: ${error.message}`, error, 'timing');
            throw error;
        }
    }

    getCommand(commandKey) {
        try {
            if (commandKey === 'members') {
                return null;
            }

            const useSectionCommand = SECTION_COMMAND_KEYS.has(commandKey);

            if (useSectionCommand) {
                const sectionCommand = this.config?.[commandKey]?.command;
                if (sectionCommand) {
                    return sectionCommand;
                }
            } else if (this.config?.commands?.[commandKey]) {
                return this.config.commands[commandKey];
            }

            throw new Error(`Missing command config: ${commandKey}`);

        } catch (error) {
            handleConfigServiceError(`[ConfigService] Error getting command config: ${error.message}`, error, 'command');
            throw error;
        }
    }

    isDebugEnabled() {
        try {
            this._assertConfigAvailable('debug');

            const debugEnabled = this.config.general?.debugEnabled;
            if (debugEnabled === undefined) {
                throw new Error('Missing general.debugEnabled config');
            }

            return !!debugEnabled;
            
        } catch (error) {
            handleConfigServiceError(`[ConfigService] Error checking debug enabled: ${error.message}`, error, 'debug');
            throw error;
        }
    }

    getSpamConfig() {
        return this.get('spam');
    }


    set(section, key, value) {
        try {
            if (!this.config) {
                logger.warn('[ConfigService] No config available for modification', 'config-service');
                return false;
            }

            if (!this.config[section]) {
                this.config[section] = {};
            }
            this.config[section][key] = value;

            this.cache.clear();

            if (this.eventBus) {
                this.eventBus.emit('config:changed', { section, key, value });
            }

            logger.debug(`[ConfigService] Config updated: ${section}.${key}`, 'config-service');
            return true;

        } catch (error) {
            handleConfigServiceError(`[ConfigService] Error setting config: ${error.message}`, error, 'set');
            return false;
        }
    }

    reload() {
        try {
            this.cache.clear();

            if (this.eventBus) {
                this.eventBus.emit('config:reloaded');
            }

            logger.info('[ConfigService] Configuration reloaded', 'config-service');
            return true;

        } catch (error) {
            handleConfigServiceError(`[ConfigService] Error reloading config: ${error.message}`, error, 'reload');
            return false;
        }
    }

    getConfigSummary() {
        try {
            return {
                hasConfig: !!this.config,
                configType: 'Object',
                sections: this.config ? Object.keys(this.config) : [],
                hasEventBus: !!this.eventBus,
                cacheSize: this.cache.size
            };
        } catch (error) {
            handleConfigServiceError(`[ConfigService] Error getting config summary: ${error.message}`, error, 'summary');
            throw error;
        }
    }

    _assertConfigAvailable(context) {
        if (!this.config) {
            throw new Error(`ConfigService requires config for ${context}`);
        }
    }

    _getByPath(path) {
        this._assertConfigAvailable('get-by-path');

        const parts = path.split('.');
        let current = this.config;
        
        for (const part of parts) {
            if (current && typeof current === 'object' && part in current) {
                current = current[part];
            } else {
                throw new Error(`Missing config path: ${path}`);
            }
        }
        
        return current;
    }

    _getSectionKey(section, key) {
        this._assertConfigAvailable('get-section-key');

        const sectionConfig = this.config[section];
        if (sectionConfig && typeof sectionConfig === 'object') {
            if (sectionConfig[key] === undefined) {
                throw new Error(`Missing config: ${section}.${key}`);
            }
            return sectionConfig[key];
        }
        
        throw new Error(`Missing config section: ${section}`);
    }
}

function createConfigService(config, eventBus = null) {
    return new ConfigService(config, eventBus);
}

module.exports = {
    ConfigService,
    createConfigService
};
