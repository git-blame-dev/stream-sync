const TwitchAuthManagerDefault = require('./TwitchAuthManager');
const { getUnifiedLogger } = require('../core/logging');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');

class TwitchAuthFactory {
    constructor(config, dependencies = {}) {
        this.config = JSON.parse(JSON.stringify(config));
        this.authManager = null;
        this.initialized = false;
        this.lastError = null;
        this.logger = dependencies.logger || getUnifiedLogger();
        this.errorHandler = createPlatformErrorHandler(this.logger, 'auth-factory');
        this.TwitchAuthManager = dependencies.TwitchAuthManager || TwitchAuthManagerDefault;

        this.validateConfig();
    }
    
    validateConfig() {
        const required = ['clientId', 'clientSecret', 'channel'];
        const missing = required.filter(field => !this.config[field]);
        
        if (missing.length > 0) {
            throw new Error(`Invalid configuration: missing fields [${missing.join(', ')}]`);
        }
    }
    
    getConfig() {
        return { ...this.config };
    }
    
    updateConfig(newConfig) {
        // Deep copy configuration to ensure complete isolation between instances
        this.config = JSON.parse(JSON.stringify(newConfig));
        this.validateConfig();
        
        // Reset factory state
        this.initialized = false;
        this.lastError = null;
        
        // Update auth manager if it exists
        if (this.authManager) {
            this.authManager.updateConfig(this.config);
        }
        
    }
    
    createAuthManager() {
        try {
            this.authManager = this.TwitchAuthManager.getInstance(this.config, { logger: this.logger });
            return this.authManager;
        } catch (error) {
            this.lastError = error;
            this.errorHandler.logOperationalError('Failed to create auth manager', 'auth-factory', error);
            throw error;
        }
    }
    
    async getInitializedAuthManager() {
        try {
            // Create manager if needed
            if (!this.authManager) {
                this.createAuthManager();
            }
            
            // Initialize if needed
            if (this.authManager.getState() !== 'READY') {
                await this.authManager.initialize();
            }
            
            this.initialized = true;
            this.lastError = null;
            
            return this.authManager;
            
        } catch (error) {
            this.initialized = false;
            this.lastError = error;
            this.errorHandler.logOperationalError('Failed to get initialized auth manager', 'auth-factory', error);
            throw error;
        }
    }
    
    async getAuthProvider() {
        const authManager = await this.getInitializedAuthManager();
        return authManager.getAuthProvider();
    }
    
    async getUserId() {
        const authManager = await this.getInitializedAuthManager();
        return authManager.getUserId();
    }
    
    async getAccessToken() {
        const authManager = await this.getInitializedAuthManager();
        return await authManager.getAccessToken();
    }
    
    async sendChatMessage(message) {
        const authManager = await this.getInitializedAuthManager();
        return await authManager.sendChatMessage(message);
    }
    
    isReady() {
        return this.initialized && 
               this.authManager && 
               this.authManager.getState() === 'READY';
    }
    
    getStatus() {
        const baseStatus = {
            initialized: this.initialized,
            configValid: this.lastError === null,
            lastError: this.lastError?.message || null
        };
        
        if (this.authManager) {
            return {
                ...baseStatus,
                ...this.authManager.getStatus()
            };
        }
        
        return {
            ...baseStatus,
            state: 'UNINITIALIZED',
            hasAuthProvider: false,
            userId: null
        };
    }
    
    async cleanup() {
        if (this.authManager) {
            await this.authManager.cleanup();
        }
        
        this.initialized = false;
        this.lastError = null;
        
        this.logger.debug('TwitchAuthFactory cleaned up', 'auth-factory');
    }
}

module.exports = TwitchAuthFactory;
