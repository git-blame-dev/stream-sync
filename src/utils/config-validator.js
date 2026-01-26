const { DEFAULTS } = require('../core/config-defaults');

class ConfigValidator {
    constructor(logger) {
        this.logger = logger;
    }

    validateRetryConfig(config = {}, defaults = {}) {
        const defaultRetryConfig = { ...DEFAULTS.retry, ...defaults };

        return {
            maxRetries: ConfigValidator.parseNumber(config.maxRetries, { defaultValue: defaultRetryConfig.maxRetries, min: 0, max: 20 }),
            baseDelay: ConfigValidator.parseNumber(config.baseDelay, { defaultValue: defaultRetryConfig.baseDelay, min: 100, max: 10000 }),
            maxDelay: ConfigValidator.parseNumber(config.maxDelay, { defaultValue: defaultRetryConfig.maxDelay, min: 1000, max: 300000 }),
            enableRetry: ConfigValidator.parseBoolean(config.enableRetry, defaultRetryConfig.enableRetry)
        };
    }

    validateIntervalConfig(config = {}, defaults = {}) {
        const defaultIntervalConfig = { ...DEFAULTS.intervals, ...defaults };

        return {
            pollInterval: ConfigValidator.parseNumber(config.pollInterval, { defaultValue: defaultIntervalConfig.pollInterval, min: 1000, max: 60000 }),
            connectionTimeout: ConfigValidator.parseNumber(config.connectionTimeout, { defaultValue: defaultIntervalConfig.connectionTimeout, min: 5000, max: 120000 }),
            keepAliveInterval: ConfigValidator.parseNumber(config.keepAliveInterval, { defaultValue: defaultIntervalConfig.keepAliveInterval, min: 10000, max: 300000 }),
            healthCheckInterval: ConfigValidator.parseNumber(config.healthCheckInterval, { defaultValue: defaultIntervalConfig.healthCheckInterval, min: 30000, max: 600000 })
        };
    }

    validateConnectionLimits(config = {}, defaults = {}) {
        const defaultLimits = { ...DEFAULTS.connectionLimits, ...defaults };

        return {
            maxConnections: ConfigValidator.parseNumber(config.maxConnections, { defaultValue: defaultLimits.maxConnections, min: 1, max: 10 }),
            maxConcurrentRequests: ConfigValidator.parseNumber(config.maxConcurrentRequests, { defaultValue: defaultLimits.maxConcurrentRequests, min: 1, max: 20 }),
            maxStreamsPerConnection: ConfigValidator.parseNumber(config.maxStreamsPerConnection, { defaultValue: defaultLimits.maxStreamsPerConnection, min: 1, max: 5 })
        };
    }

    validateApiConfig(config = {}, platformName = 'unknown') {
        const validated = {
            apiKey: ConfigValidator.parseSecret(config.apiKey),
            enabled: ConfigValidator.parseBoolean(config.enabled, false),
            useAPI: ConfigValidator.parseBoolean(config.useAPI, true),
            useScraping: ConfigValidator.parseBoolean(config.useScraping, false),
            requestTimeout: ConfigValidator.parseNumber(config.requestTimeout, { defaultValue: DEFAULTS.api.requestTimeout, min: 1000, max: 30000 })
        };

        if (validated.enabled && validated.useAPI && !validated.apiKey) {
            this.logger.warn(
                `API usage enabled but no API key provided for ${platformName}`,
                platformName
            );
        }

        return validated;
    }

    validateLoggingConfig(config = {}) {
        return {
            level: ConfigValidator.parseString(config.level, DEFAULTS.logging.level),
            enableDebug: ConfigValidator.parseBoolean(config.enableDebug, DEFAULTS.logging.enableDebug),
            enableConsole: ConfigValidator.parseBoolean(config.enableConsole, DEFAULTS.logging.enableConsole),
            enableFile: ConfigValidator.parseBoolean(config.enableFile, DEFAULTS.logging.enableFile),
            logPath: ConfigValidator.parseString(config.logPath, DEFAULTS.LOG_DIRECTORY),
            maxFileSize: ConfigValidator.parseNumber(config.maxFileSize, { defaultValue: DEFAULTS.logging.maxFileSize, min: 1048576, max: 104857600 })
        };
    }

    static parseBoolean(value, defaultValue) {
        if (value === undefined || value === null) return defaultValue;
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
            const lowerValue = value.toLowerCase();
            if (lowerValue === 'true') return true;
            if (lowerValue === 'false') return false;
            return defaultValue;
        }
        return defaultValue;
    }

    static parseString(value, defaultValue) {
        if (value === undefined || value === null) return defaultValue;
        return String(value).trim();
    }

    static parseNumber(value, options = {}) {
        const { defaultValue, min, max, allowZero = true } = options;
        if (value === undefined || value === null) return defaultValue;
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return defaultValue;
        if (!allowZero && parsed === 0) return defaultValue;
        if (typeof min === 'number' && parsed < min) return defaultValue;
        if (typeof max === 'number' && parsed > max) return defaultValue;
        return parsed;
    }

    static parseSecret(value) {
        const parsed = ConfigValidator.parseString(value);
        if (typeof parsed !== 'string') {
            return undefined;
        }
        const trimmed = parsed.trim();
        return trimmed.length ? trimmed : undefined;
    }

    static requireBoolean(value, fieldName) {
        if (typeof value === 'boolean') return value;
        if (typeof value === 'string') {
            const lowerValue = value.toLowerCase();
            if (lowerValue === 'true') return true;
            if (lowerValue === 'false') return false;
        }
        throw new Error(`${fieldName} must be a boolean`);
    }

    static requireString(value, fieldName, options = {}) {
        const { allowEmpty = false } = options;
        if (value === undefined || value === null) {
            throw new Error(`${fieldName} is required`);
        }
        const str = String(value).trim();
        if (!allowEmpty && str.length === 0) {
            throw new Error(`${fieldName} cannot be empty`);
        }
        return str;
    }

    static requireNumber(value, fieldName, options = {}) {
        const { min, max, integer = false } = options;
        if (value === undefined || value === null) {
            throw new Error(`${fieldName} is required`);
        }
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
            throw new Error(`${fieldName} must be a valid number`);
        }
        if (integer && !Number.isInteger(parsed)) {
            throw new Error(`${fieldName} must be an integer`);
        }
        if (typeof min === 'number' && parsed < min) {
            throw new Error(`${fieldName} must be at least ${min}`);
        }
        if (typeof max === 'number' && parsed > max) {
            throw new Error(`${fieldName} must be at most ${max}`);
        }
        return parsed;
    }

    static normalize(rawConfig) {
        return {
            general: this._normalizeGeneralSection(rawConfig.general || {}),
            http: this._normalizeHttpSection(rawConfig.http || {}),
            obs: this._normalizeObsSection(rawConfig.obs || {}),
            tiktok: this._normalizeTiktokSection(rawConfig.tiktok || {}),
            twitch: this._normalizeTwitchSection(rawConfig.twitch || {}),
            youtube: this._normalizeYoutubeSection(rawConfig.youtube || {}),
            handcam: this._normalizeHandcamSection(rawConfig.handcam || {}),
            goals: this._normalizeGoalsSection(rawConfig.goals || {}),
            gifts: this._normalizeGiftsSection(rawConfig.gifts || {}),
            timing: this._normalizeTimingSection(rawConfig.timing || {}),
            cooldowns: this._normalizeCooldownsSection(rawConfig.cooldowns || {}),
            tts: this._normalizeTtsSection(rawConfig.tts || {}),
            spam: this._normalizeSpamSection(rawConfig.spam || {}),
            displayQueue: this._normalizeDisplayQueueSection(rawConfig.displayQueue || {}),
            retry: this._normalizeRetrySection(rawConfig.retry || {}),
            intervals: this._normalizeIntervalsSection(rawConfig.intervals || {}),
            connectionLimits: this._normalizeConnectionLimitsSection(rawConfig.connectionLimits || {}),
            api: this._normalizeApiSection(rawConfig.api || {}),
            logging: this._normalizeLoggingSection(rawConfig.logging || {}),
            farewell: this._normalizeFarewellSection(rawConfig.farewell || {}),
            commands: this._normalizeCommandsSection(rawConfig.commands || {}),
            vfx: this._normalizeVfxSection(rawConfig.vfx || {}),
            streamelements: this._normalizeStreamElementsSection(rawConfig.streamelements || {}),
            follows: this._normalizeFollowsSection(rawConfig.follows || {}),
            raids: this._normalizeRaidsSection(rawConfig.raids || {}),
            paypiggies: this._normalizePaypiggiesSection(rawConfig.paypiggies || {}),
            greetings: this._normalizeGreetingsSection(rawConfig.greetings || {})
        };
    }

    static _normalizeGeneralSection(raw) {
        return {};
    }

    static _normalizeHttpSection(raw) {
        return {};
    }

    static _normalizeObsSection(raw) {
        return {};
    }

    static _normalizeTiktokSection(raw) {
        return {};
    }

    static _normalizeTwitchSection(raw) {
        return {};
    }

    static _normalizeYoutubeSection(raw) {
        return {};
    }

    static _normalizeHandcamSection(raw) {
        return {};
    }

    static _normalizeGoalsSection(raw) {
        return {};
    }

    static _normalizeGiftsSection(raw) {
        return {};
    }

    static _normalizeTimingSection(raw) {
        return {};
    }

    static _normalizeCooldownsSection(raw) {
        return {};
    }

    static _normalizeTtsSection(raw) {
        return {};
    }

    static _normalizeSpamSection(raw) {
        return {};
    }

    static _normalizeDisplayQueueSection(raw) {
        return {};
    }

    static _normalizeRetrySection(raw) {
        return {};
    }

    static _normalizeIntervalsSection(raw) {
        return {};
    }

    static _normalizeConnectionLimitsSection(raw) {
        return {};
    }

    static _normalizeApiSection(raw) {
        return {};
    }

    static _normalizeLoggingSection(raw) {
        return {};
    }

    static _normalizeFarewellSection(raw) {
        return {};
    }

    static _normalizeCommandsSection(raw) {
        return {};
    }

    static _normalizeVfxSection(raw) {
        return {};
    }

    static _normalizeStreamElementsSection(raw) {
        return {};
    }

    static _normalizeFollowsSection(raw) {
        return {};
    }

    static _normalizeRaidsSection(raw) {
        return {};
    }

    static _normalizePaypiggiesSection(raw) {
        return {};
    }

    static _normalizeGreetingsSection(raw) {
        return {};
    }
}

module.exports = {
    ConfigValidator
};
