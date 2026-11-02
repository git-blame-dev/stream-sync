import OBSWebSocket from 'obs-websocket-js';
import { logger } from '../core/logging';
import { ERROR_MESSAGES as DEFAULT_ERROR_MESSAGES } from '../core/constants';
import { secrets } from '../core/secrets';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { safeSetTimeout } from '../utils/timeout-validator';
import { withTimeout, withOperationDeadline } from '../utils/timeout-wrapper';
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

type OBSLifecycleState = 'disconnected' | 'connecting' | 'connected' | 'disposed';

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

type ManagerOwnedDependencyKeys = 'obs' | 'OBSWebSocket' | 'constants';

const MANAGER_OWNED_DEPENDENCY_KEYS: ManagerOwnedDependencyKeys[] = ['obs', 'OBSWebSocket', 'constants'];

const OBSWebSocketCtor = OBSWebSocket as new () => ObsSocketLike;

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
    lifecycleState: OBSLifecycleState;
    connectAttemptVersion: number;
    activeConnectAttemptVersion: number | null;
    isIntentionalDisconnect: boolean;
    isDisposed: boolean;
    eventHandlers: Map<string, (data?: { reason?: unknown; code?: unknown }) => void>;
    sourcesCacheInvalidator: (() => void) | null;

    private cancelConnectAttempt: (() => void) | null = null;
    private transportRetirement: Promise<void> | null = null;
    private transportInUse = false;
    private connectedListeners = new Set<() => void>();
    private requestLifetime = new AbortController();

    constructor(dependencies: ConnectionDependencies = {}) {
        this.logger = logger;
        this.log = logger;
        this.constants = dependencies.constants || { ERROR_MESSAGES: DEFAULT_ERROR_MESSAGES };
        this.OBSWebSocket = dependencies.OBSWebSocket || OBSWebSocketCtor;

        const { ERROR_MESSAGES } = this.constants;
        this.ERROR_MESSAGES = ERROR_MESSAGES;

        const incomingConfig = dependencies.config || {};
        const resolvedPassword = incomingConfig.password === undefined
            ? (secrets.obs.password ?? undefined)
            : incomingConfig.password;
        this.config = {
            ...(incomingConfig.address === undefined ? {} : { address: incomingConfig.address }),
            ...(resolvedPassword === undefined ? {} : { password: resolvedPassword }),
            ...(incomingConfig.enabled === undefined ? {} : { enabled: incomingConfig.enabled })
        };
        this.OBS_CONNECTION_TIMEOUT = incomingConfig.connectionTimeoutMs;
        
        this.obs = dependencies.obs || new this.OBSWebSocket();
        this.errorHandler = createPlatformErrorHandler(this.logger, 'obs-connection');
        
        this.isConnecting = false;
        this.connectionPromise = null;
        this.connectionCompleteHandler = null;
        this.sceneItemIdCache = new Map();
        this._isConnected = false;
        this.healthChecker = null;
        this.reconnectTimer = null;
        this.reconnectIntervalMs = 30000;
        this.lifecycleState = 'disconnected';
        this.connectAttemptVersion = 0;
        this.activeConnectAttemptVersion = null;
        this.isIntentionalDisconnect = false;
        this.isDisposed = false;
        this.eventHandlers = new Map();
        this.sourcesCacheInvalidator = null;

        this.setupEventHandlers();
    }
    
    setupEventHandlers() {
        const connectionOpenedHandler = () => {
            this.logger.debug('Connection Opened', 'obs-connection');
        };
        this.eventHandlers.set('ConnectionOpened', connectionOpenedHandler);
        this.obs.on('ConnectionOpened', connectionOpenedHandler);
        
        const connectionClosedHandler = (data?: { reason?: unknown; code?: unknown }) => {
            // During acquisition the SDK's attempt promise owns close failures.
            // Retirement closes belong to the old transport, never a queued one.
            if (this.transportRetirement || this.isConnecting) return;
            this.logger.debug('Connection closed', 'obs-connection', {
                code: typeof data?.code === 'number' && Number.isFinite(data.code) ? data.code : undefined
            });
            this._isConnected = false;
            this.requestLifetime.abort(new Error('OBS connection closed'));
            this.lifecycleState = this.isDisposed
                ? 'disposed'
                : (this.isConnecting ? 'connecting' : 'disconnected');

            if (!this.isConnecting) {
                this.connectionCompleteHandler = null;
                this.connectionPromise = null;
                this.activeConnectAttemptVersion = null;
            }

            if (this.isIntentionalDisconnect || this.isDisposed) {
                return;
            }

            this.scheduleReconnect('connection-closed');
        };
        this.eventHandlers.set('ConnectionClosed', connectionClosedHandler);
        this.obs.on('ConnectionClosed', connectionClosedHandler);
        
        const identifiedHandler = () => {
            if (this.config.enabled === false) {
                this.logger.debug('Ignoring Identified event while disabled', 'obs-connection');
                this._isConnected = false;
                this.lifecycleState = this.isDisposed ? 'disposed' : 'disconnected';
                this.connectionCompleteHandler = null;
                return;
            }
            if (this.lifecycleState !== 'connecting' && this.lifecycleState !== 'connected') {
                this.logger.debug('Ignoring late Identified event', 'obs-connection');
                return;
            }

            // Identified is global to the SDK. Only the current connect promise
            // can corroborate it; an old transport's event cannot admit a session.
            this.connectionCompleteHandler?.();
        };
        this.eventHandlers.set('Identified', identifiedHandler);
        this.obs.on('Identified', identifiedHandler);
        
        const sceneItemCreatedHandler = () => {
            this.clearSceneItemCache();
        };
        this.eventHandlers.set('SceneItemCreated', sceneItemCreatedHandler);
        this.obs.on('SceneItemCreated', sceneItemCreatedHandler);
        
        const sceneItemRemovedHandler = () => {
            this.clearSceneItemCache();
        };
        this.eventHandlers.set('SceneItemRemoved', sceneItemRemovedHandler);
        this.obs.on('SceneItemRemoved', sceneItemRemovedHandler);
        
        const sceneCreatedHandler = () => {
            this.clearSceneItemCache();
        };
        this.eventHandlers.set('SceneCreated', sceneCreatedHandler);
        this.obs.on('SceneCreated', sceneCreatedHandler);
        
        const sceneRemovedHandler = () => {
            this.clearSceneItemCache();
        };
        this.eventHandlers.set('SceneRemoved', sceneRemovedHandler);
        this.obs.on('SceneRemoved', sceneRemovedHandler);
        
        const inputCreatedHandler = () => {
            this.clearSceneItemCache();
        };
        this.eventHandlers.set('InputCreated', inputCreatedHandler);
        this.obs.on('InputCreated', inputCreatedHandler);
        
        const inputRemovedHandler = () => {
            this.clearSceneItemCache();
        };
        this.eventHandlers.set('InputRemoved', inputRemovedHandler);
        this.obs.on('InputRemoved', inputRemovedHandler);
    }
    
    updateConfig(newConfig?: ObsConfig) {
        // Extract properties explicitly to handle getter-based configs
        if (newConfig) {
            const wasEnabled = this.config.enabled !== false;
            if (newConfig.address !== undefined) {
                this.config.address = newConfig.address;
            }
            if (newConfig.password !== undefined) {
                this.config.password = newConfig.password;
            }
            if (newConfig.enabled !== undefined) {
                this.config.enabled = newConfig.enabled;
            }
            if (newConfig.connectionTimeoutMs !== undefined) {
                this.OBS_CONNECTION_TIMEOUT = newConfig.connectionTimeoutMs;
            }

            const isEnabled = this.config.enabled !== false;
            if (!isEnabled) {
                this.clearReconnectTimer();
                if (wasEnabled && (this.isConnected() || this.isConnecting)) {
                    void this.disconnect().catch(error => this._handleConnectionError('OBS disable disconnect failed', error));
                }
            }
        }

    }

    private createDisabledError() {
        return new Error('OBS integration is disabled in configuration');
    }
    
    connect(): Promise<boolean> {
        if (this.isDisposed) {
            return Promise.reject(new Error('OBS connection manager has been disposed'));
        }
        if (this.config.enabled === false) {
            return Promise.reject(this.createDisabledError());
        }
        if (this.isConnected()) {
            this.logger.debug('Already connected', 'obs-connection');
            return Promise.resolve(true);
        }
        if (this.isConnecting && this.connectionPromise) {
            this.logger.debug('Connection in progress, returning existing promise', 'obs-connection');
            return this.connectionPromise;
        }

        this.clearReconnectTimer();
        this.isIntentionalDisconnect = false;
        this.isConnecting = true;
        this.lifecycleState = 'connecting';
        const attemptVersion = ++this.connectAttemptVersion;
        this.activeConnectAttemptVersion = attemptVersion;

        this.connectionPromise = new Promise<boolean>(async (resolve, reject) => {
            let identifiedTimeout: ReturnType<typeof globalThis.setTimeout> | null = null;
            let connectionCompleted = false;
            let sdkConnected = false;
            let identified = false;
            const finishAttempt = () => {
                connectionCompleted = true;
                if (identifiedTimeout) clearTimeout(identifiedTimeout);
                identifiedTimeout = null;
                this.cancelConnectAttempt = null;
                this.connectionCompleteHandler = null;
                this.isConnecting = false;
                this.connectionPromise = null;
                this.activeConnectAttemptVersion = null;
            };
            this.cancelConnectAttempt = () => {
                if (connectionCompleted) return;
                finishAttempt();
                reject(new Error('OBS connection cancelled'));
            };
            
            const completeConnection = () => {
                if (this.activeConnectAttemptVersion !== attemptVersion) {
                    return;
                }
                if (connectionCompleted || !sdkConnected || !identified) return;
                finishAttempt();
                this.requestLifetime = new AbortController();
                this._isConnected = true;
                this.lifecycleState = 'connected';
                this.clearReconnectTimer();
                this.log.info('Successfully connected and authenticated with OBS.', 'obs-connection');
                resolve(true);
                for (const listener of this.connectedListeners) {
                    try { listener(); }
                    catch (error) { this._handleConnectionError('OBS connected listener failed', error); }
                }
            };
            
            this.connectionCompleteHandler = () => {
                identified = true;
                completeConnection();
            };
            
            try {
                if (this.transportRetirement) await this.transportRetirement;
                if (this.activeConnectAttemptVersion !== attemptVersion) return;
                const identifiedTimeoutMs = this.OBS_CONNECTION_TIMEOUT;
                identifiedTimeout = safeSetTimeout(() => {
                    if (this.activeConnectAttemptVersion !== attemptVersion) {
                        return;
                    }
                    if (!connectionCompleted) {
                        finishAttempt();
                        this.lifecycleState = this.isDisposed ? 'disposed' : 'disconnected';
                        void this.retireTransport().catch(error => this._handleConnectionError('OBS timeout disconnect failed', error));
                        if (!this.isIntentionalDisconnect && !this.isDisposed) this.scheduleReconnect('authentication-timeout');
                        reject(new Error('OBS connection timed out waiting for authentication'));
                    }
                }, identifiedTimeoutMs);
                
                this.transportInUse = true;
                await this.obs.connect(this.config.address, this.config.password);
                if (this.activeConnectAttemptVersion !== attemptVersion) return;
                sdkConnected = true;
                completeConnection();
                
                // Connection established, but now we wait for Identified event
                // The resolve() will be called by the existing 'Identified' handler in setupEventHandlers()
                
            } catch (error) {
                if (identifiedTimeout) {
                    clearTimeout(identifiedTimeout);
                }

                if (this.activeConnectAttemptVersion !== attemptVersion) {
                    return;
                }
                finishAttempt();
                
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
                this.lifecycleState = this.isDisposed ? 'disposed' : 'disconnected';
                if (!this.isIntentionalDisconnect && !this.isDisposed) {
                    this.scheduleReconnect('connect-failed');
                }
                reject(connectionError);
            }
        });

        return this.connectionPromise;
    }
    
    private retireTransport(): Promise<void> {
        if (this.transportRetirement) return this.transportRetirement;
        if (!this.transportInUse && !this._isConnected) return Promise.resolve();
        this.transportInUse = false;
        let retirement: Promise<void>;
        try {
            retirement = this.obs.disconnect();
        } catch (error) {
            retirement = Promise.reject(error);
        }
        this.transportRetirement = retirement;
        // Keep a failed retirement as an admission barrier: its transport is not
        // known to be closed. Every background owner observes its rejection.
        void retirement.then(() => {
            if (this.transportRetirement === retirement) this.transportRetirement = null;
        }, () => undefined);
        return retirement;
    }

    async disconnect() {
        this.requestLifetime.abort(new Error('OBS connection closed'));
        this.isIntentionalDisconnect = true;
        this.clearReconnectTimer();
        this.cancelConnectAttempt?.();
        this.connectAttemptVersion += 1;
        this.activeConnectAttemptVersion = null;
        this.connectionCompleteHandler = null;
        this.isConnecting = false;
        this.lifecycleState = this.isDisposed ? 'disposed' : 'disconnected';
        const retirement = this.retireTransport();
        this._isConnected = false;
        this.connectionPromise = null;
        this.healthChecker?.invalidateCache();
        await retirement;
    }

    isConnected() {
        return this._isConnected;
    }

    async isReady() {
        if (!this.healthChecker) {
            this.healthChecker = new OBSHealthChecker(this);
        }
        
        return await this.healthChecker.isReady();
    }
    
    async ensureConnected(maxWait = 5000) {
        if (this.config.enabled === false) {
            throw this.createDisabledError();
        }

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
                ...(this.ERROR_MESSAGES.OBS_CONNECTION_TIMEOUT === undefined
                    ? {}
                    : { errorMessage: this.ERROR_MESSAGES.OBS_CONNECTION_TIMEOUT })
            }
        );
    }

    async call(requestType: string, requestData: Record<string, unknown> = {}) {
        if (!this.isConnected()) {
            throw new Error('OBS is not connected');
        }
        
        try {
            // The SDK can abandon pending responses on disconnect. Retire their
            // waiters with the connection so output queues can resume after reconnect.
            const pending = this.obs.call(requestType, requestData);
            // An SDK call may synchronously close the transport before the
            // deadline owner admits it; still observe its eventual rejection.
            void pending.catch(() => {});
            const response = await withOperationDeadline(() => pending, {
                parentAbortSignal: this.requestLifetime.signal, operationName: 'OBS request'
            });
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

    onConnected(listener: () => void): () => void {
        if (this.isDisposed) return () => {};
        this.connectedListeners.add(listener);
        return () => { this.connectedListeners.delete(listener); };
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
        this.logger.debug('Scene item cache cleared', 'obs-connection');
        if (typeof this.sourcesCacheInvalidator === 'function') {
            this.sourcesCacheInvalidator();
        }
    }

    setSourcesCacheInvalidator(invalidator: (() => void) | null) {
        this.sourcesCacheInvalidator = typeof invalidator === 'function' ? invalidator : null;
    }

    scheduleReconnect(reason = 'unknown') {
        if (this.isDisposed || this.isIntentionalDisconnect) {
            return;
        }
        if (!this.config.enabled) {
            return;
        }
        if (this.reconnectTimer) {
            return;
        }
        const delay = this.reconnectIntervalMs || 30000;
        this.logger.debug(`Scheduling reconnect in ${delay}ms (reason: ${reason})`, 'obs-connection');
        this.reconnectTimer = safeSetTimeout(async () => {
            this.reconnectTimer = null;
            if (this.isConnecting || this.isConnected()) {
                this.logger.debug('Reconnect skipped - already connecting/connected', 'obs-connection');
                return;
            }
            try {
                await this.connect();
            } catch (error) {
                if (this.isIntentionalDisconnect || this.isDisposed) return;
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

    dispose() {
        if (this.isDisposed) {
            return;
        }

        this.isDisposed = true;
        // Logical retirement is synchronous; reset callers retain their existing
        // synchronous contract while asynchronous close errors are observed.
        void this.disconnect().catch(error => this._handleConnectionError('OBS disposal disconnect failed', error));
        this.sourcesCacheInvalidator = null;

        this.connectedListeners.clear();

        for (const [eventName, handler] of this.eventHandlers.entries()) {
            this.obs.off(eventName, handler);
        }
        this.eventHandlers.clear();
    }
    
    cacheSceneItemId(key: string, id: unknown) {
        this.sceneItemIdCache.set(key, id);
        this.logger.debug(`Cached scene item ID: ${key} -> ${id}`, 'obs-connection');
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

let globalOBSManager: OBSConnectionManager | null = null;

function assertNoIncompatibleSingletonOverrides(dependencies: ConnectionDependencies) {
    if (!dependencies || Object.keys(dependencies).length === 0) {
        return;
    }

    const invalidOverrideKeys = MANAGER_OWNED_DEPENDENCY_KEYS.filter((key) => dependencies[key] !== undefined);
    if (invalidOverrideKeys.length > 0) {
        throw new Error(`getOBSConnectionManager incompatible non-config dependency overrides: ${invalidOverrideKeys.join(', ')}`);
    }
}

function getOBSConnectionManager(dependencies: ConnectionDependencies = {}): OBSConnectionManager {
    if (!globalOBSManager) {
        globalOBSManager = createOBSConnectionManager(dependencies);
    } else if (dependencies && Object.keys(dependencies).length > 0) {
        assertNoIncompatibleSingletonOverrides(dependencies);
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

    return manager;
}

async function initializeOBSConnection(config: ObsConfig = {}, dependencies: ConnectionDependencies = {}) {

    const combinedDependencies = {
        ...dependencies,
        config: {
            ...dependencies.config,
            ...config
        }
    };

    const manager = getOBSConnectionManager(combinedDependencies);

    let outcome: 'connected' | 'degraded' | 'disabled' = config.enabled === true ? 'degraded' : 'disabled';
    if (config.enabled === true) {

        try {
            if (dependencies.obsEventService && typeof dependencies.obsEventService.connect === 'function') {

                await dependencies.obsEventService.connect();
            } else {
                await manager.connect();
            }

            outcome = 'connected';
            
            const handcamConfig = dependencies.handcam;
            if (handcamConfig?.enabled) {
                try {
                    await initializeHandcamGlow(manager, handcamConfig);

                } catch (glowError) {
                    const glowErrorMessage = glowError instanceof Error ? glowError.message : String(glowError);
                    logger.debug(`[OBS] Handcam glow initialization failed: ${glowErrorMessage}`, 'obs-connection');
                }
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            logger.debug(`[OBS] OBS connection failed: ${errorMessage}`, 'obs-connection');
        }
    }

    return { manager, outcome };
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
    if (globalOBSManager) {
        globalOBSManager.dispose();
    }
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
