
const { createPlatformErrorHandler } = require('./platform-error-handler');

class ConnectionStateManager {
    constructor(platform, connectionFactory) {
        this.platform = platform;
        
        // FAIL-FAST: Validate connection factory interface
        if (connectionFactory) {
            const { validateConnectionFactoryInterface } = require('./dependency-validator');
            validateConnectionFactoryInterface(connectionFactory);
        }
        
        this.connectionFactory = connectionFactory;
        this.logger = null; // Initialize as null, set up in initialize() method
        this.errorHandler = null;
        
        // Connection state tracking
        this.state = 'disconnected'; // disconnected, connecting, connected, error
        this.connection = null;
        this.lastError = null;
        this.connectionTime = 0;
        
        // Configuration for state management
        this.config = null;
        this.dependencies = null;
    }
    
    initialize(config, dependencies) {
        // FAIL-FAST: Validate dependencies before proceeding
        const { validateConnectionStateManagerDependencies } = require('./dependency-validator');
        validateConnectionStateManagerDependencies(config, dependencies);
        
        this.config = config;
        this.dependencies = dependencies;
        
        this.logger = dependencies.logger;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'connection-state-manager');
        
    }
    
    ensureConnection() {
        // Check if current connection is valid
        if (this.connection && this.isConnectionValid(this.connection)) {
            this.logger?.debug(`Connection already exists and is valid for ${this.platform}`, this.platform);
            return this.connection;
        }
        
        // Connection is null or invalid - create new one
        this.logger?.debug(`Creating new connection for ${this.platform}`, this.platform);
        
        if (!this.config || !this.dependencies) {
            throw new Error(`Cannot create connection - state manager not properly initialized for ${this.platform}`);
        }
        
        try {
            // Use factory to create new connection
            this.connection = this.connectionFactory.createConnection(this.platform, this.config, this.dependencies);
            
            if (!this.connection) {
                throw new Error(`Factory returned null/invalid connection for ${this.platform}. ` +
                               'Connection factory must return a valid connection object.');
            }
            
            // Validate the newly created connection
            if (!this.isConnectionValid(this.connection)) {
                throw new Error(`Factory created invalid connection for ${this.platform}`);
            }
            
            return this.connection;
            
        } catch (error) {
            this.lastError = error;
            this.state = 'error';
            this._logStateManagerError(`Failed to create connection for ${this.platform}: ${error.message}`, error);
            throw error;
        }
    }
    
    isConnectionValid(connection) {
        if (!connection || typeof connection !== 'object') {
            return false;
        }
        
        // Check for essential connection methods (more lenient for testing)
        if (this.platform === 'tiktok') {
            const hasConnect = typeof connection.connect === 'function';
            const hasEmitterSurface = typeof connection.on === 'function' &&
                                      typeof connection.emit === 'function' &&
                                      typeof connection.removeAllListeners === 'function';
            return hasConnect && hasEmitterSurface;
        }
        
        // For other platforms, basic object validation
        return typeof connection.connect === 'function';
    }
    
    getState() {
        return this.state;
    }
    
    setState(newState) {
        const oldState = this.state;
        this.state = newState;
        
        if (newState === 'connected') {
            this.connectionTime = Date.now();
            this.lastError = null;
        }
        
        this.logger?.debug(`Connection state changed from ${oldState} to ${newState} for ${this.platform}`, this.platform);
    }
    
    getConnection() {
        return this.connection;
    }
    
    isConnected() {
        return this.state === 'connected' && 
               this.connection && 
               this.isConnectionValid(this.connection);
    }
    
    isConnecting() {
        return this.state === 'connecting';
    }
    
    markConnecting() {
        this.setState('connecting');
    }
    
    markConnected() {
        this.setState('connected');
    }
    
    markDisconnected() {
        this.setState('disconnected');
        this.connection = null;
        this.connectionTime = 0;
    }
    
    markError(error) {
        this.lastError = error;
        this.setState('error');
        this.connection = null;
    }
    
    cleanup() {
        if (this.connection) {
            try {
                if (typeof this.connection.removeAllListeners === 'function') {
                    this.connection.removeAllListeners();
                }
                if (typeof this.connection.disconnect === 'function') {
                    const result = this.connection.disconnect();
                    if (result && typeof result.catch === 'function') {
                        result.catch(() => {});
                    }
                }
            } catch (error) {
                this.logger?.debug(`Error during connection cleanup for ${this.platform}: ${error.message}`, this.platform);
            }
        }
        
        this.connection = null;
        this.state = 'disconnected';
        this.connectionTime = 0;
        this.lastError = null;
        
        this.logger?.debug(`Connection state manager cleaned up for ${this.platform}`, this.platform);
    }
    
    getConnectionInfo() {
        return {
            platform: this.platform,
            state: this.state,
            hasConnection: !!this.connection,
            isValid: this.connection ? this.isConnectionValid(this.connection) : false,
            connectionTime: this.connectionTime,
            lastError: this.lastError?.message || null,
            isConnected: this.isConnected(),
            isConnecting: this.isConnecting()
        };
    }

    _logStateManagerError(message, error) {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, 'connection-state-manager', null, message);
        } else if (this.errorHandler) {
            this.errorHandler.logOperationalError(message, 'connection-state-manager', error);
        }
    }
}

module.exports = { ConnectionStateManager };
