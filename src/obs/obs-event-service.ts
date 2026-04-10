import { safeDelay } from '../utils/timeout-validator';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';

type EventBusLike = {
    subscribe: (eventName: string, handler: (data: Record<string, unknown>) => Promise<void>) => () => void;
    emit: (eventName: string, payload: Record<string, unknown>) => void;
};

type ObsConnectionLike = {
    addEventListener?: (eventName: string, handler: (data?: { reason?: unknown; code?: unknown }) => void) => void;
    removeEventListener?: (eventName: string, handler: (data?: { reason?: unknown; code?: unknown }) => void) => void;
    call: (requestType: string, payload: Record<string, unknown>) => Promise<unknown>;
    connect: () => Promise<void>;
    disconnect: () => Promise<void>;
    isReady: () => Promise<boolean>;
};

type ObsSourcesLike = {
    updateTextSource: (sourceName: string, text: string) => Promise<void>;
    clearTextSource: (sourceName: string) => Promise<void>;
    setSourceVisibility: (sceneName: string, sourceName: string, visible: boolean) => Promise<void>;
};

type ObsEventLogger = {
    warn: (message: string, context?: unknown, payload?: unknown) => void;
};

type ReconnectConfig = {
    maxAttempts: number;
    baseDelay: number;
    maxDelay: number;
    enabled: boolean;
};

type ObsEventState = {
    connected: boolean;
    ready: boolean;
    reconnecting: boolean;
    reconnectAttempts: number;
    lastError: Error | null;
};

function getRequiredString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
}

function getString(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}


class OBSEventService {
    eventBus: EventBusLike;
    obsConnection: ObsConnectionLike;
    obsSources: ObsSourcesLike;
    logger: ObsEventLogger;
    errorHandler: ReturnType<typeof createPlatformErrorHandler> | null;
    state: ObsEventState;
    reconnectConfig: ReconnectConfig;
    unsubscribeFns: Array<() => void>;
    connectionEventHandlers: Array<{
        event: string;
        handler: (data?: { reason?: unknown; code?: unknown }) => void;
    }>;

    constructor(dependencies: {
        eventBus: EventBusLike;
        obsConnection: ObsConnectionLike;
        obsSources: ObsSourcesLike;
        logger: ObsEventLogger;
        reconnectConfig?: ReconnectConfig;
    }) {
        const { eventBus, obsConnection, obsSources, logger, reconnectConfig } = dependencies;

        this.eventBus = eventBus;
        this.obsConnection = obsConnection;
        this.obsSources = obsSources;
        this.logger = logger;
        this.errorHandler = logger ? createPlatformErrorHandler(logger, 'obs-events') : null;

        // Connection state tracking
        this.state = {
            connected: false,
            ready: false,
            reconnecting: false,
            reconnectAttempts: 0,
            lastError: null
        };

        // Reconnection configuration (with defaults)
        this.reconnectConfig = reconnectConfig || {
            maxAttempts: 5,
            baseDelay: 1000,
            maxDelay: 30000,
            enabled: true
        };

        // Event unsubscribe functions for cleanup
        this.unsubscribeFns = [];
        this.connectionEventHandlers = [];

        // Initialize event listeners
        this._setupEventListeners();
        this._setupConnectionMonitoring();
    }

    _setupEventListeners() {
        // Text update command
        this.unsubscribeFns.push(
            this.eventBus.subscribe('obs:update-text', async (data) => {
                await this._handleTextUpdate(data);
            })
        );

        // Text clear command
        this.unsubscribeFns.push(
            this.eventBus.subscribe('obs:clear-text', async (data) => {
                await this._handleTextClear(data);
            })
        );

        // Visibility change command
        this.unsubscribeFns.push(
            this.eventBus.subscribe('obs:set-visibility', async (data) => {
                await this._handleVisibilityChange(data);
            })
        );

        // Scene switch command
        this.unsubscribeFns.push(
            this.eventBus.subscribe('obs:switch-scene', async (data) => {
                await this._handleSceneSwitch(data);
            })
        );

        // Connection loss handler
        this.unsubscribeFns.push(
            this.eventBus.subscribe('obs:connection-lost', async () => {
                await this._handleConnectionLoss();
            })
        );
    }

    _setupConnectionMonitoring() {
        if (!this.obsConnection || typeof this.obsConnection.addEventListener !== 'function') {
            return;
        }

        const handleConnectionClosed = (data: { reason?: unknown; code?: unknown } = {}) => {
            this.logger.warn('OBS connection closed; emitting obs:connection-lost event', data);
            this.eventBus.emit('obs:connection-lost', {
                reason: data.reason,
                code: data.code,
                timestamp: Date.now()
            });
        };

        this.obsConnection.addEventListener('ConnectionClosed', handleConnectionClosed);
        this.connectionEventHandlers.push({
            event: 'ConnectionClosed',
            handler: handleConnectionClosed
        });
    }

    async _handleTextUpdate(data: Record<string, unknown>) {
        const { sourceName, text } = data;
        const resolvedSourceName = getRequiredString(sourceName);
        const resolvedText = getString(text);

        if (!resolvedSourceName || resolvedText === null) {
            this._handleObsEventError('Invalid OBS text update payload', null, {
                sourceName,
                text,
                operation: 'text-update'
            });
            return;
        }

        try {
            await this.obsSources.updateTextSource(resolvedSourceName, resolvedText);
        } catch (error) {
            this._handleObsEventError(`Failed to update text source ${sourceName}`, error, { sourceName, operation: 'text-update' });
        }
    }

    async _handleTextClear(data: Record<string, unknown>) {
        const { sourceName } = data;
        const resolvedSourceName = getRequiredString(sourceName);

        if (!resolvedSourceName) {
            this._handleObsEventError('Invalid OBS text clear payload', null, {
                sourceName,
                operation: 'text-clear'
            });
            return;
        }

        try {
            await this.obsSources.clearTextSource(resolvedSourceName);
        } catch (error) {
            this._handleObsEventError(`Failed to clear text source ${sourceName}`, error, { sourceName, operation: 'text-clear' });
        }
    }

    async _handleVisibilityChange(data: Record<string, unknown>) {
        const { sceneName, sourceName, visible } = data;
        const resolvedSceneName = getRequiredString(sceneName);
        const resolvedSourceName = getRequiredString(sourceName);

        if (!resolvedSceneName || !resolvedSourceName || typeof visible !== 'boolean') {
            this._handleObsEventError('Invalid OBS visibility payload', null, {
                sceneName,
                sourceName,
                visible,
                operation: 'set-visibility'
            });
            return;
        }

        try {
            await this.obsSources.setSourceVisibility(resolvedSceneName, resolvedSourceName, visible);
        } catch (error) {
            this._handleObsEventError(`Failed to set visibility for ${sourceName}`, error, {
                sceneName,
                sourceName,
                visible,
                operation: 'set-visibility'
            });
        }
    }

    async _handleSceneSwitch(data: Record<string, unknown>) {
        const { sceneName } = data;
        const resolvedSceneName = getRequiredString(sceneName);

        if (!resolvedSceneName) {
            this._handleObsEventError('Invalid OBS scene switch payload', null, {
                sceneName,
                operation: 'scene-switch'
            });
            return;
        }

        try {
            await this.obsConnection.call('SetCurrentProgramScene', {
                sceneName: resolvedSceneName
            });
        } catch (error) {
            this._handleObsEventError(`Failed to switch to scene ${sceneName}`, error, { sceneName, operation: 'scene-switch' });
        }
    }

    async _handleConnectionLoss() {
        if (this.state.reconnecting || !this.reconnectConfig.enabled) {
            return;
        }

        this.state.reconnecting = true;
        this.state.reconnectAttempts = 0;

        while (this.state.reconnectAttempts < this.reconnectConfig.maxAttempts) {
            this.state.reconnectAttempts++;

            try {
                await this.connect();

                this.state.reconnecting = false;
                this.state.reconnectAttempts = 0;
                return;
            } catch (_error) {
                const delay = Math.min(
                    this.reconnectConfig.baseDelay * Math.pow(2, this.state.reconnectAttempts - 1),
                    this.reconnectConfig.maxDelay
                );

                await safeDelay(delay, this.reconnectConfig.baseDelay, 'OBS reconnect backoff');
            }
        }

        this.state.reconnecting = false;
    }

    async connect() {
        try {
            await this.obsConnection.connect();

            this.state.connected = true;
            this.state.ready = true;
            this.state.lastError = null;
        } catch (error) {
            this.state.connected = false;
            this.state.ready = false;
            this.state.lastError = error instanceof Error ? error : new Error(String(error));

            this._handleObsEventError('Failed to connect to OBS', error, { operation: 'connect' });

            throw error;
        }
    }

    async disconnect() {
        try {
            await this.obsConnection.disconnect();

            this.state.connected = false;
            this.state.ready = false;
        } catch (error) {
            this._handleObsEventError('Failed to disconnect from OBS', error, { operation: 'disconnect' });
            throw error;
        }
    }

    getConnectionState() {
        return {
            connected: this.state.connected,
            ready: this.state.ready,
            reconnecting: this.state.reconnecting,
            reconnectAttempts: this.state.reconnectAttempts,
            lastError: this.state.lastError
        };
    }

    async getHealthStatus() {
        const connected = this.state.connected;
        let responsive = false;

        if (connected) {
            try {
                responsive = await this.obsConnection.isReady();
            } catch (_error) {
                responsive = false;
            }
        }

        return {
            healthy: connected && responsive,
            connected,
            responsive,
            reconnecting: this.state.reconnecting,
            lastError: this.state.lastError?.message
        };
    }

    _handleObsEventError(message: string, error: unknown, payload: Record<string, unknown> | null = null) {
        if (!this.errorHandler && this.logger) {
            this.errorHandler = createPlatformErrorHandler(this.logger, 'obs-events');
        }

        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, 'obs-events', payload, message, 'obs-events');
            return;
        }

        if (this.errorHandler) {
            this.errorHandler.logOperationalError(message, 'obs-events', payload);
        }
    }

    destroy() {
        this.unsubscribeFns.forEach(unsubscribe => unsubscribe());
        this.unsubscribeFns = [];
        const removeEventListener = this.obsConnection?.removeEventListener;
        if (typeof removeEventListener === 'function') {
            this.connectionEventHandlers.forEach(({ event, handler }) => {
                removeEventListener.call(this.obsConnection, event, handler);
            });
        }
        this.connectionEventHandlers = [];
    }
}

function createOBSEventService(dependencies: {
    eventBus: EventBusLike;
    obsConnection: ObsConnectionLike;
    obsSources: ObsSourcesLike;
    logger: ObsEventLogger;
    reconnectConfig?: ReconnectConfig;
}) {
    return new OBSEventService(dependencies);
}

export {
    createOBSEventService
};
