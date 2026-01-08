
const crypto = require('crypto');

const AUTH_STATES = {
    UNINITIALIZED: 'UNINITIALIZED',
    INITIALIZING: 'INITIALIZING', 
    READY: 'READY',
    ERROR: 'ERROR',
    REFRESHING: 'REFRESHING'
};

const TWITCH_OAUTH_SCOPES = [
    'user:read:chat',           // Required for EventSub channel.chat.message (replaces chat:read)
    'chat:edit',                // Required for sending messages
    'channel:read:subscriptions',
    'bits:read',
    'channel:read:redemptions',
    'moderator:read:followers'
];

const TOKEN_REFRESH_CONFIG = {
    // When to trigger near-expiry refresh (15 minutes before expiration)
    REFRESH_THRESHOLD_SECONDS: 900,
    
    // Minutes before expiration to schedule refresh
    SCHEDULE_BUFFER_MINUTES: 15,
    
    // Maximum hours to schedule ahead (prevents overly long delays)
    MAX_SCHEDULE_HOURS: 3,
    
    // Maximum retry attempts for token refresh
    MAX_RETRY_ATTEMPTS: 3,
    
    // OAuth flow timeout (10 minutes)
    OAUTH_TIMEOUT_MS: 10 * 60 * 1000,
    
    // Token validation timeout (3 seconds for proactive checks - streaming optimized)
    VALIDATION_TIMEOUT_MS: 3000,
    
    // Token exchange timeout (5 seconds - streaming optimized)
    EXCHANGE_TIMEOUT_MS: 5000
};

const REQUIRED_CONFIG_FIELDS = {
    BASIC: ['clientId', 'clientSecret', 'accessToken', 'channel'],
    WITH_REFRESH: ['clientId', 'clientSecret', 'accessToken', 'refreshToken', 'channel'],
    OAUTH_FLOW: ['clientId', 'clientSecret']
};

const PLACEHOLDER_TOKEN_PATTERNS = [
    /^new_access_\d+$/i,         // new_access_123456789
    /^test_token_/i,             // test_token_123
    /^placeholder_/i,            // placeholder_token
    /your_access_token/i,        // your_access_token_here
    /^example_/i,                // example_token
    /^demo_/i,                   // demo_access_token
    /^temp_token_/i,             // temp_token_xyz
    /^sample_/i,                 // sample_token
    /^dummy_/i,                  // dummy_token
    /^mock_/i,                   // mock_token
    /^null$/i,                   // "null" string
    /^undefined$/i               // "undefined" string  
];

const TWITCH_ENDPOINTS = {
    OAUTH: {
        AUTHORIZE: 'https://id.twitch.tv/oauth2/authorize',
        TOKEN: 'https://id.twitch.tv/oauth2/token',
        VALIDATE: 'https://id.twitch.tv/oauth2/validate',
        REVOKE: 'https://id.twitch.tv/oauth2/revoke'
    }
};

const OAUTH_SERVER_CONFIG = {
    DEFAULT_PORT: 3000,
    PORT_RANGE: {
        START: 3000,
        END: 3100
    },
    SSL_OPTIONS: {
        DAYS: 365,
        KEY_SIZE: 2048,
        ALGORITHM: 'sha256'
    }
};

const ERROR_TEMPLATES = {
    MISSING_CONFIG: 'Invalid configuration: missing fields [{{fields}}]',
    INVALID_TOKEN: 'Access token is missing or invalid',
    TOKEN_EXPIRED: 'Access token has expired',
    REFRESH_FAILED: 'Token refresh failed: {{reason}}',
    OAUTH_REQUIRED: 'OAuth authentication required',
    NETWORK_ERROR: 'Network error during authentication: {{details}}',
    SERVER_ERROR: 'Authentication server error: {{details}}'
};

const PERFORMANCE_THRESHOLDS = {
    TOKEN_VALIDATION_MS: 3000,    // Maximum time for token validation (streaming optimized)
    TOKEN_REFRESH_MS: 5000,       // Maximum time for token refresh (streaming optimized)
    OAUTH_FLOW_MS: 600000,        // Maximum time for OAuth flow (10 minutes)
    CONFIG_UPDATE_MS: 1000        // Maximum time for config file updates
};

const STREAMING_TIMEOUT_CONFIG = {
    // Different timeout strategies based on operation criticality
    IMMEDIATE: {
        tokenValidation: 2000,
        tokenRefresh: 3000,
        oauthValidation: 2000,
        proactiveRefresh: 1500
    },
    HIGH: {
        tokenValidation: 3000,
        tokenRefresh: 4000,
        oauthValidation: 3000,
        proactiveRefresh: 2500
    },
    NORMAL: {
        tokenValidation: 3000,
        tokenRefresh: 5000,
        oauthValidation: 3000,
        proactiveRefresh: 3000
    },
    LOW: {
        tokenValidation: 5000,
        tokenRefresh: 8000,
        oauthValidation: 5000,
        proactiveRefresh: 5000
    }
};

const RETRY_CONFIG = {
    // Initial retry delay (1 second)
    INITIAL_DELAY_MS: 1000,
    
    // Maximum retry delay (8 seconds)
    MAX_DELAY_MS: 8000,
    
    // Exponential backoff multiplier
    BACKOFF_MULTIPLIER: 2,
    
    // Jitter percentage (20% random variation)
    JITTER_PERCENTAGE: 0.2,
    
    // Maximum retry attempts
    MAX_ATTEMPTS: 3
};

class AuthConstants {
    static isPlaceholderToken(token) {
        if (!token || typeof token !== 'string') {
            return false;
        }
        return PLACEHOLDER_TOKEN_PATTERNS.some(pattern => pattern.test(token));
    }

    static validateConfig(config, requireRefreshToken = false) {
        const requiredFields = requireRefreshToken 
            ? REQUIRED_CONFIG_FIELDS.WITH_REFRESH 
            : REQUIRED_CONFIG_FIELDS.BASIC;
            
        const missing = requiredFields.filter(field => !config[field]);
        
        return {
            isValid: missing.length === 0,
            missingFields: missing,
            hasRefreshCapability: !!config.refreshToken
        };
    }

    static buildOAuthUrl(config, redirectUri, state = null) {
        const params = new URLSearchParams({
            client_id: config.clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: TWITCH_OAUTH_SCOPES.join(' '),
            state: state || 'cb_' + Date.now().toString(36)
        });

        return `${TWITCH_ENDPOINTS.OAUTH.AUTHORIZE}?${params.toString()}`;
    }

    static calculateRefreshTiming(expiresAt) {
        const now = Date.now();
        const bufferTime = TOKEN_REFRESH_CONFIG.SCHEDULE_BUFFER_MINUTES * 60 * 1000;
        const refreshTime = expiresAt - bufferTime;
        const timeUntilRefresh = refreshTime - now;
        const maxRefreshInterval = TOKEN_REFRESH_CONFIG.MAX_SCHEDULE_HOURS * 60 * 60 * 1000;

        return {
            refreshTime,
            timeUntilRefresh,
            actualDelay: Math.min(timeUntilRefresh, maxRefreshInterval),
            shouldRefreshImmediately: timeUntilRefresh <= 0,
            hoursUntilRefresh: timeUntilRefresh / (60 * 60 * 1000)
        };
    }

    static formatErrorMessage(template, variables = {}) {
        let message = ERROR_TEMPLATES[template] || template;
        
        // Simple template substitution
        Object.entries(variables).forEach(([key, value]) => {
            message = message.replace(new RegExp(`{{${key}}}`, 'g'), value);
        });
        
        return message;
    }

    static exceedsPerformanceThreshold(operation, duration) {
        const threshold = PERFORMANCE_THRESHOLDS[operation.toUpperCase() + '_MS'];
        return threshold && duration > threshold;
    }

    static getStreamingOptimizedTimeout(criticality = 'normal', operationType = 'tokenValidation') {
        const criticalityLevel = criticality.toUpperCase();
        const config = STREAMING_TIMEOUT_CONFIG[criticalityLevel] || STREAMING_TIMEOUT_CONFIG.NORMAL;
        return config[operationType] || config.tokenValidation;
    }

    static calculateBackoffDelay(attempt, baseDelay = RETRY_CONFIG.INITIAL_DELAY_MS) {
        // Calculate exponential delay: baseDelay * (multiplier ^ attempt)
        const exponentialDelay = baseDelay * Math.pow(RETRY_CONFIG.BACKOFF_MULTIPLIER, attempt);
        
        // Cap at maximum delay
        const cappedDelay = Math.min(exponentialDelay, RETRY_CONFIG.MAX_DELAY_MS);
        
        // Apply jitter: ±20% random variation
        const jitterRange = Math.max(0, Math.round(cappedDelay * RETRY_CONFIG.JITTER_PERCENTAGE));
        const jitter = jitterRange > 0
            ? crypto.randomInt(-jitterRange, jitterRange + 1)
            : 0;

        return Math.max(100, Math.round(cappedDelay + jitter)); // Minimum 100ms delay
    }

    static getTimeoutConfiguration(options = {}) {
        const {
            criticality = 'normal',
            networkConditions = 'normal'
        } = options;

        const baseConfig = STREAMING_TIMEOUT_CONFIG[criticality.toUpperCase()] || STREAMING_TIMEOUT_CONFIG.NORMAL;
        
        // Adjust for network conditions
        const networkMultiplier = {
            excellent: 0.8,
            normal: 1.0,
            poor: 1.5,
            very_poor: 2.0
        }[networkConditions] || 1.0;

        return {
            tokenValidationTimeout: Math.round(baseConfig.tokenValidation * networkMultiplier),
            tokenRefreshTimeout: Math.round(baseConfig.tokenRefresh * networkMultiplier),
            oauthFlowTimeout: TOKEN_REFRESH_CONFIG.OAUTH_TIMEOUT_MS, // Keep OAuth timeout longer (10 minutes)
            proactiveRefreshTimeout: Math.round(baseConfig.proactiveRefresh * networkMultiplier),
            retryConfig: RETRY_CONFIG
        };
    }

    static determineOperationCriticality(context = {}) {
        const {
            userInitiated = false,
            streamingActive = false,
            viewerCount = 0,
            userWaiting = false
        } = context;

        // User-initiated operations require immediate response
        if (userInitiated || userWaiting) {
            return 'immediate';
        }

        // High viewer count or active streaming gets high priority
        if (streamingActive && viewerCount > 100) {
            return 'high';
        }

        // Background operations during streaming get normal priority
        if (streamingActive) {
            return 'normal';
        }

        // Non-critical background operations get low priority
        return 'low';
    }
}

module.exports = {
    AUTH_STATES,
    TWITCH_OAUTH_SCOPES,
    TOKEN_REFRESH_CONFIG,
    REQUIRED_CONFIG_FIELDS,
    PLACEHOLDER_TOKEN_PATTERNS,
    TWITCH_ENDPOINTS,
    OAUTH_SERVER_CONFIG,
    PERFORMANCE_THRESHOLDS,
    RETRY_CONFIG,
    AuthConstants
};
