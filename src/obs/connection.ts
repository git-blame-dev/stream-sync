import { createRequire } from 'node:module';
import { logger } from '../core/logging';
import { ERROR_MESSAGES as DEFAULT_ERROR_MESSAGES } from '../core/constants';
import { secrets } from '../core/secrets';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { safeSetTimeout } from '../utils/timeout-validator';
import { withTimeout } from '../utils/timeout-wrapper';
import { OBSHealthChecker } from './health-checker';
import { initializeHandcamGlow } from './handcam-glow';

type ObsLogger = {
    debug: typeof logger.debug;
    info: typeof logger.info;
};

type ObsSocketLike = {
    connect: (address?: string, password?: string) => Promise<{ obsWebSocketVersion?: unknown; negotiatedRpcVersion?: unknown }>;
    disconnect: () => Promise<void>;
    call: (requestType: string, requestData?: Record<string, unknown>) => Promise<unknown>;
    on: (eventName: string, handler: (data?: { reason?: unknown; code?: unknown }) => void) => void;
    off: (eventName: string, handler: (data?: { reason?: unknown; code?: unknown }) => void) => void;
};

type ObsConfig = {
    address?: string;
    password?: string;
    enabled?: boolean;
    connectionTimeoutMs?: number;
};

type ConnectionDependencies = {
    constants?: {
        ERROR_MESSAGES: Record<string, string | undefined>;
    };
    OBSWebSocket?: new () => ObsSocketLike;
    config?: ObsConfig;
    obs?: ObsSocketLike;
    obsEventService?: {
        connect: () => Promise<void>;
    };
    handcam?: Parameters<typeof initializeHandcamGlow>[1];
};

const nodeRequire = createRequire(import.meta.url);
const { default: OBSWebSocket } = nodeRequire('obs-websocket-js') as {
    default: new () => ObsSocketLike;
};

// Dependency injection support
class OBSConnectionManager {
    logger: ObsLogger;
    log: ObsLogger;
    constants: {
        ERROR_MESSAGES: Record<string, string | undefined>;
    };
    OBSWebSocket: new () => ObsSocketLike;
    ERROR_MESSAGES: Record<string, string | undefined>;
    config: {
        address?: string;
        password?: string;
        enabled?: boolean;
    };
    OBS_CONNECTION_TIMEOUT: number | undefined;
    obs: ObsSocketLike;
    errorHandler: ReturnType<typeof createPlatformErrorHandler> | null;
    isConnecting: boolean;
    connectionPromise: Promise<boolean> | null;
    connectionCompleteHandler: (() => void) | null;
    sceneItemIdCache: Map<string, unknown>;
    _isConnected: boolean;
    healthChecker: OBSHealthChecker | null;
    reconnectTimer: ReturnType<typeof safeSetTimeout> | null;
    reconnectIntervalMs: number;

    constructor(dependencies: ConnectionDependencies = {}) {
        this.logger = logger;
        this.log = logger;
        this.constants = dependencies.constants || { ERROR_MESSAGES: DEFAULT_ERROR_MESSAGES };
        this.OBSWebSocket = dependencies.OBSWebSocket || OBSWebSocket;

        const { ERROR_MESSAGES } = this.constants;
        this.ERROR_MESSAGES = ERROR_MESSAGES;

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
        
        this.obs = dependencies.obs || new this.OBSWebSocket();
        this.errorHandler = createPlatformErrorHandler(this.logger, 'obs-connection');
        
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
            this.logger.debug(`[OBS Connection] Connection Closed: ${data?.reason} (${data?.code})`, 'obs-connection', data);
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
    
    updateConfig(newConfig?: ObsConfig) {
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
    
    connect(): Promise<boolean> {
        if (this.isConnected()) {
            this.logger.debug('[OBS Connection] Already connected', 'obs-connection');
            return Promise.resolve(true);
        }
        if (this.isConnecting && this.connectionPromise) {
            this.logger.debug('[OBS Connection] Connection in progress, returning existing promise', 'obs-connection');
            return this.connectionPromise;
        }

        this.logger.debug(`[OBS Connection] Attempting to connect to: ${this.config.address}`, 'obs-connection');
        this.logger.debug(`[OBS Connection] Password configured: ${this.config.password ? 'Yes' : 'No'}`, 'obs-connection');

        this.isConnecting = true;

        this.connectionPromise = new Promise<boolean>(async (resolve, reject) => {
            let identifiedTimeout: ReturnType<typeof globalThis.setTimeout> | null = null;
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
                const identifiedTimeoutMs = this.OBS_CONNECTION_TIMEOUT;
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
                
                // Clean up the error message for better readability
                const connectionError = error instanceof Error ? error : new Error(String(error));
                const errorCode = typeof error === 'object' && error !== null && 'code' in error
                    ? (error as { code?: unknown }).code
                    : undefined;

                let userFriendlyMessage = 'Failed to connect to OBS';
                if (errorCode === -1 || connectionError.message.includes('ECONNREFUSED')) {
                    userFriendlyMessage = 'OBS is not running or WebSocket server is disabled';
                } else if (connectionError.message.includes('401') || connectionError.message.includes('Authentication')) {
                    userFriendlyMessage = 'OBS WebSocket password incorrect';
                } else if (connectionError.message) {
                    userFriendlyMessage = `OBS connection error: ${connectionError.message.split('\n')[0]}`;
                }

                this._handleConnectionError(userFriendlyMessage, connectionError, { requestType: 'Connect' });
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
                reject(connectionError);
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
        return this._isConnected;
    }

    async isReady() {
        // Lazy initialization of health checker
        if (!this.healthChecker) {
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

        const pendingConnection = this.connectionPromise;
        if (!pendingConnection) {
            throw new Error('OBS connection promise missing while ensuring connection');
        }

        await withTimeout(
            pendingConnection,
            maxWait,
            {
                operationName: 'OBS connection readiness',
                errorMessage: this.ERROR_MESSAGES.OBS_CONNECTION_TIMEOUT
            }
        );
    }

    async call(requestType: string, requestData: Record<string, unknown> = {}) {
        if (!this.isConnected()) {
            throw new Error('OBS is not connected');
        }
        
        try {
            const response = await this.obs.call(requestType, requestData);
            return response;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this._handleConnectionError(`API Error for request '${requestType}': ${errorMessage}`, error, { requestType });
            throw error;
        }
    }
    
    addEventListener(eventName: string, handler: (data?: { reason?: unknown; code?: unknown }) => void) {
        this.obs.on(eventName, handler);
    }
    
    removeEventListener(eventName: string, handler: (data?: { reason?: unknown; code?: unknown }) => void) {
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
            const sources = nodeRequire('./sources') as {
                clearSceneItemCache?: () => void;
            };
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
    
    cacheSceneItemId(key: string, id: unknown) {
        this.sceneItemIdCache.set(key, id);
        this.logger.debug(`[OBS Connection] Cached scene item ID: ${key} -> ${id}`, 'obs-connection');
    }
    
    getCachedSceneItemId(key: string) {
        return this.sceneItemIdCache.get(key);
    }

    _handleConnectionError(message: string, error: unknown, payload: Record<string, unknown> | null = null) {
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
let globalOBSManager: OBSConnectionManager | null = null;

function getOBSConnectionManager(dependencies: ConnectionDependencies = {}): OBSConnectionManager {
    if (!globalOBSManager) {
        globalOBSManager = createOBSConnectionManager(dependencies);
    } else if (dependencies && Object.keys(dependencies).length > 0) {
        // Update existing manager configuration if new dependencies provided
        if (dependencies.config) {
            globalOBSManager.updateConfig(dependencies.config);
        }
    }

    if (!globalOBSManager) {
        throw new Error('OBS connection manager unavailable');
    }

    return globalOBSManager;
}

function createOBSConnectionManager(dependencies: ConnectionDependencies = {}) {
    const manager = new OBSConnectionManager(dependencies);

    logger.debug('[OBS] Initializing OBS WebSocket connection manager (v5)...', 'OBS');

    return manager;
}

async function initializeOBSConnection(config: ObsConfig = {}, dependencies: ConnectionDependencies = {}) {
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
    
    logger.debug(`[OBS] Connection Config Check: enabled=${config.enabled}`, 'OBS');
    if (config.enabled) {
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
                    await initializeHandcamGlow(manager.obs, handcamConfig);
                    logger.debug('[OBS] Handcam glow initialized to 0 (startup reset)', 'OBS');
                } catch (glowError) {
                    const glowErrorMessage = glowError instanceof Error ? glowError.message : String(glowError);
                    logger.debug(`[OBS] Handcam glow initialization failed: ${glowErrorMessage}`, 'OBS');
                }
            } else {
                logger.debug('[OBS] Handcam glow initialization skipped - not enabled', 'OBS');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.debug(`[OBS] OBS connection failed: ${errorMessage}`, 'OBS');
            // Error is already logged in manager.connect(), no need to re-log
            // We catch it here to prevent it from crashing the main application startup
        }
    } else {
        logger.debug('[OBS] OBS is disabled, skipping connection', 'OBS');
    }
    
    logger.debug('[OBS] OBS connection initialization completed', 'OBS');
    return manager;
}

async function obsCall(requestType: string, requestData: Record<string, unknown> = {}) {
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

export {
    OBSConnectionManager,
    getOBSConnectionManager,
    createOBSConnectionManager,
    initializeOBSConnection,
    resetOBSConnectionManager,

    obsCall,
    ensureOBSConnected
};
