
class ConfigValidator {
    constructor(logger) {
        this.logger = logger;
    }
    
    parseBoolean(value, defaultValue = false) {
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
    
    parseString(value, defaultValue = '') {
        if (value === undefined || value === null) return defaultValue;
        return String(value).trim();
    }
    
    parseNumber(value, defaultValue = 0, options = {}) {
        const { min, max, allowZero = true } = options;
        
        if (value === undefined || value === null) return defaultValue;
        
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return defaultValue;
        
        // Check zero restriction
        if (!allowZero && parsed === 0) return defaultValue;
        
        // Check min/max bounds
        if (typeof min === 'number' && parsed < min) return defaultValue;
        if (typeof max === 'number' && parsed > max) return defaultValue;
        
        return parsed;
    }

    parseSecret(value) {
        const parsed = this.parseString(value, undefined);
        if (typeof parsed !== 'string') {
            return undefined;
        }
        const trimmed = parsed.trim();
        return trimmed.length ? trimmed : undefined;
    }
    
    validateRetryConfig(config = {}, defaults = {}) {
        const defaultRetryConfig = {
            maxRetries: 3,
            baseDelay: 1000,
            maxDelay: 30000,
            enableRetry: true,
            ...defaults
        };
        
        return {
            maxRetries: this.parseNumber(config.maxRetries, defaultRetryConfig.maxRetries, { min: 0, max: 20 }),
            baseDelay: this.parseNumber(config.baseDelay, defaultRetryConfig.baseDelay, { min: 100, max: 10000 }),
            maxDelay: this.parseNumber(config.maxDelay, defaultRetryConfig.maxDelay, { min: 1000, max: 300000 }),
            enableRetry: this.parseBoolean(config.enableRetry, defaultRetryConfig.enableRetry)
        };
    }
    
    validateIntervalConfig(config = {}, defaults = {}) {
        const defaultIntervalConfig = {
            pollInterval: 5000,
            connectionTimeout: 30000,
            keepAliveInterval: 30000,
            healthCheckInterval: 60000,
            ...defaults
        };
        
        return {
            pollInterval: this.parseNumber(
                config.pollInterval, 
                defaultIntervalConfig.pollInterval, 
                { min: 1000, max: 60000 }
            ),
            connectionTimeout: this.parseNumber(
                config.connectionTimeout, 
                defaultIntervalConfig.connectionTimeout, 
                { min: 5000, max: 120000 }
            ),
            keepAliveInterval: this.parseNumber(
                config.keepAliveInterval, 
                defaultIntervalConfig.keepAliveInterval, 
                { min: 10000, max: 300000 }
            ),
            healthCheckInterval: this.parseNumber(
                config.healthCheckInterval, 
                defaultIntervalConfig.healthCheckInterval, 
                { min: 30000, max: 600000 }
            )
        };
    }
    
    validateConnectionLimits(config = {}, defaults = {}) {
        const defaultLimits = {
            maxConnections: 3,
            maxConcurrentRequests: 5,
            maxStreamsPerConnection: 1,
            ...defaults
        };
        
        return {
            maxConnections: this.parseNumber(
                config.maxConnections, 
                defaultLimits.maxConnections, 
                { min: 1, max: 10 }
            ),
            maxConcurrentRequests: this.parseNumber(
                config.maxConcurrentRequests, 
                defaultLimits.maxConcurrentRequests, 
                { min: 1, max: 20 }
            ),
            maxStreamsPerConnection: this.parseNumber(
                config.maxStreamsPerConnection, 
                defaultLimits.maxStreamsPerConnection, 
                { min: 1, max: 5 }
            )
        };
    }
    
    validateApiConfig(config = {}, platformName = 'unknown') {
        const validated = {
            apiKey: this.parseSecret(config.apiKey),
            enabled: this.parseBoolean(config.enabled, false),
            useAPI: this.parseBoolean(config.useAPI, true),
            useScraping: this.parseBoolean(config.useScraping, false),
            requestTimeout: this.parseNumber(config.requestTimeout, 5000, { min: 1000, max: 30000 })
        };
        
        // Validate API key if API usage is enabled
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
            level: this.parseString(config.level, 'info'),
            enableDebug: this.parseBoolean(config.enableDebug, false),
            enableConsole: this.parseBoolean(config.enableConsole, true),
            enableFile: this.parseBoolean(config.enableFile, false),
            logPath: this.parseString(config.logPath, './logs'),
            maxFileSize: this.parseNumber(config.maxFileSize, 10485760, { min: 1048576, max: 104857600 }) // 1MB - 100MB
        };
    }
}

class ConfigValidatorStatic {
    static parseBoolean(value, defaultValue = false) {
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
    
    static parseString(value, defaultValue = '') {
        if (value === undefined || value === null) return defaultValue;
        return String(value).trim();
    }
    
    static parseNumber(value, defaultValue = 0, options = {}) {
        const { min, max, allowZero = true } = options;
        
        if (value === undefined || value === null) return defaultValue;
        
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return defaultValue;
        
        if (!allowZero && parsed === 0) return defaultValue;
        if (typeof min === 'number' && parsed < min) return defaultValue;
        if (typeof max === 'number' && parsed > max) return defaultValue;
        
        return parsed;
    }
}

module.exports = {
    ConfigValidator,
    ConfigValidatorStatic
};
