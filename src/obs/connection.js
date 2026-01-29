const { safeSetTimeout } = require('../utils/timeout-validator');
const { withTimeout } = require('../utils/timeout-wrapper');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');
const { ERROR_MESSAGES: DEFAULT_ERROR_MESSAGES } = require('../core/constants');
const { secrets } = require('../core/secrets');

// Dependency injection support
class OBSConnectionManager {
    constructor(dependencies = {}) {
        // Inject dependencies with default implementations
        const { logger } = require('../core/logging');
        this.logger = logger;
        this.log = logger;
        this.constants = dependencies.constants || { ERROR_MESSAGES: DEFAULT_ERROR_MESSAGES };
        this.OBSWebSocket = dependencies.OBSWebSocket || require('obs-websocket-js').default;

        const { ERROR_MESSAGES } = this.constants;
        this.ERROR_MESSAGES = ERROR_MESSAGES;

        // Test environment detection
        this.isTestEnvironment = dependencies.isTestEnvironment !== undefined ? 
            dependencies.isTestEnvironment : 
            (process.env.NODE_ENV === 'test');
        
        // Test connection behavior flag - allows testing actual connection logic with mocks
        this.testConnectionBehavior = dependencies.testConnectionBehavior || false;

        const incomingConfig = dependencies.config || {};
        const resolvedPassword = incomingConfig.password === undefined
            ? (secrets.obs.password ?? undefined)
            : incomingConfig.password;
        this.config = {
            address: incomingConfig.address,
            password: resolvedPassword,
            enabled: incomingConfig.enabled
        };
        this.OBS_CONNECTION_TIMEOUT = incomingConfig.connectionTimeoutMs;
        
        // Initialize OBS WebSocket instance
        if (this.isTestEnvironment) {
            this.obs = dependencies.mockOBS || {
                connect: () => Promise.resolve(),
                disconnect: () => Promise.resolve(),
                call: () => Promise.resolve({}),
                on: () => {},
                off: () => {},
                once: () => {},
                identified: false,
                addEventListener: () => {},
                removeEventListener: () => {}
            };
        } else {
        this.obs = new this.OBSWebSocket();
        this.errorHandler = createPlatformErrorHandler(this.logger, 'obs-connection');
        }
        
        // Internal state
        this.isConnecting = false;
        this.connectionPromise = null;
        this.connectionCompleteHandler = null;
        this.sceneItemIdCache = new Map();
        this._isConnected = false;
        this.healthChecker = null;
        this.reconnectTimer = null;
        this.reconnectIntervalMs = 30000;

        // Set up event handlers
        this.setupEventHandlers();
    }
    
    setupEventHandlers() {
        this.obs.on('ConnectionOpened', () => {
            this.logger.debug('[OBS Connection] Connection Opened', 'obs-connection');
        });
        
        this.obs.on('ConnectionClosed', (data) => {
            this.logger.debug(`[OBS Connection] Connection Closed: ${data.reason} (${data.code})`, 'obs-connection', data);
            this._isConnected = false;
            this.connectionPromise = null;
            this.scheduleReconnect('connection-closed');
        });
        
        this.obs.on('Identified', () => {
            this.log.info('[OBS] Successfully connected and authenticated with OBS.');
            this._isConnected = true;
            this.clearReconnectTimer();
            
            // If there's a pending connection promise, complete it
            if (this.connectionCompleteHandler) {
                this.logger.debug('[OBS Connection] Calling connection completion handler', 'obs-connection');
                this.connectionCompleteHandler();
                this.connectionCompleteHandler = null;
            } else {
                this.logger.debug('[OBS Connection] No completion handler waiting', 'obs-connection');
            }
        });
        
        // Scene item cache invalidation events
        this.obs.on('SceneItemCreated', () => {
            this.clearSceneItemCache();
            this.notifySourcesCacheClearing();
        });
        
        this.obs.on('SceneItemRemoved', () => {
            this.clearSceneItemCache();
            this.notifySourcesCacheClearing();
        });
        
        this.obs.on('SceneCreated', () => {
            this.clearSceneItemCache();
            this.notifySourcesCacheClearing();
        });
        
        this.obs.on('SceneRemoved', () => {
            this.clearSceneItemCache();
            this.notifySourcesCacheClearing();
        });
        
        this.obs.on('InputCreated', () => {
            this.clearSceneItemCache();
            this.notifySourcesCacheClearing();
        });
        
        this.obs.on('InputRemoved', () => {
            this.clearSceneItemCache();
            this.notifySourcesCacheClearing();
        });
    }
    
    updateConfig(newConfig) {
        // Extract properties explicitly to handle getter-based configs
        if (newConfig) {
            if (newConfig.address !== undefined) {
                this.config.address = newConfig.address;
            }
            if (newConfig.password !== undefined) {
                this.config.password = newConfig.password;
            }
            if (newConfig.enabled !== undefined) {
                this.config.enabled = newConfig.enabled;
            }
        }
        this.logger.debug(`[OBS Connection] Updated config - Address: ${this.config.address}, Password: ${this.config.password ? 'Yes' : 'No'}`, 'obs-connection');
    }
    
    connect() {
        if (this.isConnected()) {
            this.logger.debug('[OBS Connection] Already connected', 'obs-connection');
            return Promise.resolve(true);
        }
        if (this.isConnecting) {
            this.logger.debug('[OBS Connection] Connection in progress, returning existing promise', 'obs-connection');
            return this.connectionPromise;
        }

        this.logger.debug(`[OBS Connection] Attempting to connect to: ${this.config.address}`, 'obs-connection');
        this.logger.debug(`[OBS Connection] Password configured: ${this.config.password ? 'Yes' : 'No'}`, 'obs-connection');

        this.isConnecting = true;

        this.connectionPromise = new Promise(async (resolve, reject) => {
            let identifiedTimeout = null;
            let connectionCompleted = false;
            
            // Set up a one-time completion handler
            const completeConnection = () => {
                if (connectionCompleted) return; // Prevent double completion
                connectionCompleted = true;
                
                if (identifiedTimeout) {
                    clearTimeout(identifiedTimeout);
                    identifiedTimeout = null;
                }
                this.isConnecting = false;
                resolve(true);
            };
            
            // Store the completion handler so it can be called by the existing 'Identified' handler
            this.connectionCompleteHandler = completeConnection;
            
            try {
                // Set timeout for Identified event (5 seconds default)
                const identifiedTimeoutMs = this.OBS_CONNECTION_TIMEOUT || 5000;
                identifiedTimeout = safeSetTimeout(() => {
                    if (!connectionCompleted) {
                        connectionCompleted = true;
                        this.isConnecting = false;
                        this.connectionPromise = null;
                        this.connectionCompleteHandler = null;
                        reject(new Error('OBS connection timed out waiting for authentication'));
                    }
                }, identifiedTimeoutMs);
                
                // Now attempt the connection
                const { obsWebSocketVersion, negotiatedRpcVersion } = await this.obs.connect(this.config.address, this.config.password);
                this.logger.debug(`[OBS Connection] WebSocket connected to server ${obsWebSocketVersion} (using RPC ${negotiatedRpcVersion})`, 'obs-connection');
                
                // Connection established, but now we wait for Identified event
                // The resolve() will be called by the existing 'Identified' handler in setupEventHandlers()
                
            } catch (error) {
                // Clean up on error
                if (identifiedTimeout) {
                    clearTimeout(identifiedTimeout);
                }
                this.connectionCompleteHandler = null;
                
                const errorCode = error.code || 'N/A';
                
                // Clean up the error message for better readability
                let userFriendlyMessage = 'Failed to connect to OBS';
                if (error.code === -1 || error.message?.includes('ECONNREFUSED')) {
                    userFriendlyMessage = 'OBS is not running or WebSocket server is disabled';
                } else if (error.message?.includes('401') || error.message?.includes('Authentication')) {
                    userFriendlyMessage = 'OBS WebSocket password incorrect';
                } else if (error.message) {
                    userFriendlyMessage = `OBS connection error: ${error.message.split('\n')[0]}`;
                }

                this._handleConnectionError(userFriendlyMessage, error, { requestType: 'Connect' });
                this.logger.debug(`Target address: ${this.config.address}`, 'OBS');
                this.logger.debug('Troubleshooting steps:', 'OBS');
                this.logger.debug('1. Check if OBS is running', 'OBS');
                this.logger.debug('2. Go to Tools > WebSocket Server Settings in OBS', 'OBS');
                this.logger.debug('3. Ensure "Enable WebSocket server" is checked', 'OBS');
                this.logger.debug(`4. Verify server port matches config (current: ${this.config.address})`, 'OBS');
                this.logger.debug('5. Check if password in config.ini matches OBS WebSocket password', 'OBS');
                
                this.isConnecting = false;
                this.connectionPromise = null; // Clear promise on failure
                this.scheduleReconnect('connect-failed');
                reject(error);
            }
        });

        return this.connectionPromise;
    }
    
    async disconnect() {
        if (this.obs && this.isConnected()) {
            this.logger.debug('[OBS Connection] Disconnecting from OBS WebSocket...', 'obs-connection');
            await this.obs.disconnect();
            this.logger.debug('[OBS Connection] Successfully disconnected from OBS WebSocket', 'obs-connection');
        }
        
        // Invalidate health checker cache when disconnecting
        if (this.healthChecker) {
            this.healthChecker.invalidateCache();
        }
        
        this._isConnected = false;
        this.connectionPromise = null;
    }
    
    isConnected() {
        if (this.isTestEnvironment && !this.testConnectionBehavior) return true;
        return this._isConnected;
    }

    async isReady() {
        // Lazy initialization of health checker
        if (!this.healthChecker) {
            const OBSHealthChecker = require('./health-checker');
            this.healthChecker = new OBSHealthChecker(this);
        }
        
        return await this.healthChecker.isReady();
    }
    
    async ensureConnected(maxWait = 5000) {
        if (this.isConnected()) {
            return;
        }

        if (!this.connectionPromise) {
            this.connect();
        }

        await withTimeout(
            this.connectionPromise,
            maxWait,
            {
                operationName: 'OBS connection readiness',
                errorMessage: this.ERROR_MESSAGES.OBS_CONNECTION_TIMEOUT
            }
        );
    }

    async call(requestType, requestData = {}) {
        if (!this.isConnected()) {
            throw new Error('OBS is not connected');
        }
        
        try {
            const response = await this.obs.call(requestType, requestData);
            return response;
        } catch (error) {
            const errorMessage = error?.message || String(error);
            this._handleConnectionError(`API Error for request '${requestType}': ${errorMessage}`, error, { requestType });
            throw error;
        }
    }
    
    addEventListener(eventName, handler) {
        this.obs.on(eventName, handler);
    }
    
    removeEventListener(eventName, handler) {
        this.obs.off(eventName, handler);
    }
    
    getConfig() {
        return { ...this.config };
    }
    
    getConnectionState() {
        return {
            isConnected: this.isConnected(),
            isConnecting: this.isConnecting,
            config: this.getConfig(),
            sceneItemCacheSize: this.sceneItemIdCache.size
        };
    }
    
    clearSceneItemCache() {
        this.sceneItemIdCache.clear();
        this.logger.debug('[OBS Connection] Scene item cache cleared', 'obs-connection');
    }
    
    notifySourcesCacheClearing() {
        try {
            const sources = require('./sources');
            if (sources && typeof sources.clearSceneItemCache === 'function') {
                sources.clearSceneItemCache();
            }
        } catch {
            // Ignore errors - sources manager might not be initialized yet
            this.logger.debug('[OBS Cache] Could not notify sources cache clearing - sources manager not available', 'obs-connection');
        }
    }

    scheduleReconnect(reason = 'unknown') {
        if (!this.config.enabled) {
            return;
        }
        if (this.reconnectTimer) {
            return;
        }
        const delay = this.reconnectIntervalMs || 30000;
        this.logger.debug(`[OBS Connection] Scheduling reconnect in ${delay}ms (reason: ${reason})`, 'obs-connection');
        this.reconnectTimer = safeSetTimeout(async () => {
            this.reconnectTimer = null;
            if (this.isConnecting || this.isConnected()) {
                this.logger.debug('[OBS Connection] Reconnect skipped - already connecting/connected', 'obs-connection');
                return;
            }
            try {
                await this.connect();
            } catch (error) {
                this._handleConnectionError('Reconnection attempt failed', error, { requestType: 'Reconnect' });
                this.scheduleReconnect('reconnect-failed');
            }
        }, delay);
    }

    clearReconnectTimer() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
    }
    
    cacheSceneItemId(key, id) {
        this.sceneItemIdCache.set(key, id);
        this.logger.debug(`[OBS Connection] Cached scene item ID: ${key} -> ${id}`, 'obs-connection');
    }
    
    getCachedSceneItemId(key) {
        return this.sceneItemIdCache.get(key);
    }

    _handleConnectionError(message, error, payload = null) {
        if (!this.errorHandler && this.logger) {
            this.errorHandler = createPlatformErrorHandler(this.logger, 'obs-connection');
        }

        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, 'obs-connection', payload, message, 'obs-connection');
            return;
        }

        if (this.errorHandler) {
            this.errorHandler.logOperationalError(message, 'obs-connection', payload);
        }
    }
}

// Global instance management
let globalOBSManager = null;

function getOBSConnectionManager(dependencies = {}) {
    if (!globalOBSManager) {
        globalOBSManager = createOBSConnectionManager(dependencies);
    } else if (dependencies && Object.keys(dependencies).length > 0) {
        // Update existing manager configuration if new dependencies provided
        if (dependencies.config) {
            globalOBSManager.updateConfig(dependencies.config);
        }
    }
    return globalOBSManager;
}

function createOBSConnectionManager(dependencies = {}) {
    const manager = new OBSConnectionManager(dependencies);
    
    // Initialize debug logging
    const { logger } = require('../core/logging');
    logger.debug('[OBS] Initializing OBS WebSocket connection manager (v5)...', 'OBS');
    
    return manager;
}

async function initializeOBSConnection(config = {}, dependencies = {}) {
    const { logger } = require('../core/logging');
    logger.debug('[OBS] initializeOBSConnection() called...', 'OBS');
    
    const combinedDependencies = {
        ...dependencies,
        config: {
            ...dependencies.config,
            ...config
        }
    };
    
    logger.debug('[OBS] Getting OBS connection manager...', 'OBS');
    const manager = getOBSConnectionManager(combinedDependencies);
    logger.debug('[OBS] OBS connection manager obtained', 'OBS');
    
    // Auto-connect if OBS is enabled and not in a test environment
    logger.debug(`[OBS] Connection Config Check: enabled=${config.enabled}, testEnv=${manager.isTestEnvironment}`, 'OBS');
    if (config.enabled && !manager.isTestEnvironment) {
        logger.debug('[OBS] OBS is enabled, attempting to connect...', 'OBS');
        try {
            if (dependencies.obsEventService && typeof dependencies.obsEventService.connect === 'function') {
                logger.debug('[OBS] Using OBSEventService for connection lifecycle', 'OBS');
                await dependencies.obsEventService.connect();
            } else {
                await manager.connect();
            }
            logger.debug('[OBS] OBS connection successful', 'OBS');
            
            // Initialize handcam glow to 0 when enabled
            const handcamConfig = dependencies.handcam;
            if (handcamConfig?.enabled) {
                try {
                    const { initializeHandcamGlow } = require('./handcam-glow');
                    await initializeHandcamGlow(manager.obs, handcamConfig);
                    logger.debug('[OBS] Handcam glow initialized to 0 (startup reset)', 'OBS');
                } catch (glowError) {
                    const glowErrorMessage = glowError?.message || String(glowError);
                    logger.debug(`[OBS] Handcam glow initialization failed: ${glowErrorMessage}`, 'OBS');
                }
            } else {
                logger.debug('[OBS] Handcam glow initialization skipped - not enabled', 'OBS');
            }
        } catch (error) {
            const errorMessage = error?.message || String(error);
            logger.debug(`[OBS] OBS connection failed: ${errorMessage}`, 'OBS');
            // Error is already logged in manager.connect(), no need to re-log
            // We catch it here to prevent it from crashing the main application startup
        }
    } else {
        logger.debug('[OBS] OBS is disabled or in test environment, skipping connection', 'OBS');
    }
    
    logger.debug('[OBS] OBS connection initialization completed', 'OBS');
    return manager;
}

async function obsCall(requestType, requestData = {}) {
    const manager = getOBSConnectionManager();
    return await manager.call(requestType, requestData);
}

async function ensureOBSConnected(maxWait = 5000) {
    const manager = getOBSConnectionManager();
    return await manager.ensureConnected(maxWait);
}

function resetOBSConnectionManager() {
    globalOBSManager = null;
}

// Export the class and factory functions
module.exports = {
    OBSConnectionManager,
    getOBSConnectionManager,
    createOBSConnectionManager,
    initializeOBSConnection,
    resetOBSConnectionManager,

    // Backward compatibility exports
    obsCall,
    ensureOBSConnected
}; 
