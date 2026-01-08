
const { TWITCH_OAUTH_SCOPES, AuthConstants } = require('../utils/auth-constants');
const { resolveLogger } = require('../utils/logger-resolver');

class TwitchAuthService {
    constructor(config, dependencies = {}) {
        // Pure constructor - only store data, no side effects
        this.config = config;
        this.logger = resolveLogger(dependencies.logger, 'TwitchAuthService');
        this.userId = null;
        this.isInitialized = false;
        this.tokenExpiresAt = null;
    }

    isAuthenticated() {
        return Boolean(
            this.config.accessToken && 
            this.config.accessToken !== 'undefined' && 
            this.config.accessToken !== '' && 
            this.config.accessToken != null &&
            !this._isPlaceholderToken(this.config.accessToken)
        );
    }

    _isPlaceholderToken(token) {
        return AuthConstants.isPlaceholderToken(token);
    }

    isTokenExpired() {
        if (!this.tokenExpiresAt) return false;
        return Date.now() > this.tokenExpiresAt;
    }

    validateCredentials() {
        // Use centralized validation for consistency
        const configValidation = AuthConstants.validateConfig(this.config, false);
        const issues = [];
        
        if (!configValidation.isValid) {
            issues.push(...configValidation.missingFields.map(field => `${field} is required`));
        }
        
        if (!this.isAuthenticated()) {
            issues.push('accessToken is missing or invalid');
        }
        
        if (this.isTokenExpired()) {
            issues.push('accessToken has expired');
        }

        return {
            isValid: issues.length === 0,
            issues: issues,
            hasToken: this.isAuthenticated(),
            isExpired: this.isTokenExpired(),
            hasRefreshCapability: configValidation.hasRefreshCapability
        };
    }

    getRequiredScopes() {
        return TWITCH_OAUTH_SCOPES;
    }

    getStatus() {
        return {
            isInitialized: this.isInitialized,
            hasValidTokens: this.isAuthenticated() && !this.isTokenExpired(),
            userId: this.userId,
            configValid: this.validateCredentials().isValid
        };
    }

    setAuthenticationState(authData) {
        this.userId = authData.userId;
        this.isInitialized = authData.isInitialized;
        this.tokenExpiresAt = authData.tokenExpiresAt;
    }

    getAccessToken() {
        return this.isAuthenticated() ? this.config.accessToken : null;
    }

    updateAccessToken(newToken) {
        this.config.accessToken = newToken;
    }

    updateRefreshToken(newRefreshToken) {
        this.config.refreshToken = newRefreshToken;
    }

    getRefreshToken() {
        return this.config.refreshToken || null;
    }

    getUserId() {
        return this.userId;
    }

    cleanup() {
        this.isInitialized = false;
        this.userId = null;
        this.tokenExpiresAt = null;
    }
}

module.exports = TwitchAuthService;
