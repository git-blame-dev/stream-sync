import type { AppLogger } from '../core/logger/types';
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
    isConnected: () => boolean;
};

type ObsSourcesLike = {
    updateTextSource: (sourceName: string, text: string) => Promise<void>;
    clearTextSource: (sourceName: string) => Promise<void>;
    setSourceVisibility: (sceneName: string, sourceName: string, visible: boolean) => Promise<void>;
};

type ObsEventLogger = Pick<AppLogger<string>, 'warn'>;

type ObsEventState = {
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
    unsubscribeFns: Array<() => void>;
    connectionEventHandlers: Array<{
        event: string;
        handler: (data?: { reason?: unknown; code?: unknown }) => void;
    }>;
    connectPromise: Promise<void> | null;

    constructor(dependencies: {
        eventBus: EventBusLike;
        obsConnection: ObsConnectionLike;
        obsSources: ObsSourcesLike;
        logger: ObsEventLogger;
    }) {
        const { eventBus, obsConnection, obsSources, logger } = dependencies;

        this.eventBus = eventBus;
        this.obsConnection = obsConnection;
        this.obsSources = obsSources;
        this.logger = logger;
        this.errorHandler = logger ? createPlatformErrorHandler(logger, 'obs-events') : null;

        this.state = {
            lastError: null
        };

        this.unsubscribeFns = [];
        this.connectionEventHandlers = [];
        this.connectPromise = null;

        this._setupEventListeners();
        this._setupConnectionMonitoring();
    }

    _setupEventListeners() {
        this.unsubscribeFns.push(
            this.eventBus.subscribe('obs:update-text', async (data) => {
                await this._handleTextUpdate(data);
            })
        );

        this.unsubscribeFns.push(
            this.eventBus.subscribe('obs:clear-text', async (data) => {
                await this._handleTextClear(data);
            })
        );

        this.unsubscribeFns.push(
            this.eventBus.subscribe('obs:set-visibility', async (data) => {
                await this._handleVisibilityChange(data);
            })
        );

        this.unsubscribeFns.push(
            this.eventBus.subscribe('obs:switch-scene', async (data) => {
                await this._handleSceneSwitch(data);
            })
        );

    }

    _setupConnectionMonitoring() {
        if (!this.obsConnection || typeof this.obsConnection.addEventListener !== 'function') {
            return;
        }

        const handleConnectionClosed = (data: { reason?: unknown; code?: unknown } = {}) => {
            this.logger.warn('OBS connection closed; emitting obs:connection-lost event', 'obs-event-service', {
                code: typeof data.code === 'number' && Number.isFinite(data.code) ? data.code : undefined
            });
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

    async connect() {
        if (this.connectPromise) {
            return this.connectPromise;
        }

        this.connectPromise = (async () => {
            try {
                await this.obsConnection.connect();

                this.state.lastError = null;
            } catch (error) {
                this.state.lastError = error instanceof Error ? error : new Error(String(error));

                this._handleObsEventError('Failed to connect to OBS', error, { operation: 'connect' });

                throw error;
            } finally {
                this.connectPromise = null;
            }
        })();

        return this.connectPromise;
    }

    async disconnect() {
        try {
            await this.obsConnection.disconnect();
        } catch (error) {
            this._handleObsEventError('Failed to disconnect from OBS', error, { operation: 'disconnect' });
            throw error;
        }
    }

    getConnectionState() {
        const connected = this.obsConnection.isConnected();
        return {
            connected,
            ready: connected,
            lastError: connected ? null : this.state.lastError
        };
    }

    async getHealthStatus() {
        const connectionState = this.getConnectionState();
        const connected = connectionState.connected;
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
            lastError: connectionState.lastError?.message
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
        const unsubscribeFns = this.unsubscribeFns;
        const connectionEventHandlers = this.connectionEventHandlers;
        this.unsubscribeFns = [];
        this.connectionEventHandlers = [];
        this.connectPromise = null;

        unsubscribeFns.forEach(unsubscribe => {
            try {
                unsubscribe();
            } catch (error) {
                this._handleObsEventError('Failed to unsubscribe OBS event handler during destroy', error, { operation: 'destroy-unsubscribe' });
            }
        });
        const removeEventListener = this.obsConnection?.removeEventListener;
        if (typeof removeEventListener === 'function') {
            connectionEventHandlers.forEach(({ event, handler }) => {
                try {
                    removeEventListener.call(this.obsConnection, event, handler);
                } catch (error) {
                    this._handleObsEventError('Failed to remove OBS connection listener during destroy', error, { operation: 'destroy-remove-listener', event });
                }
            });
        }
    }
}

function createOBSEventService(dependencies: {
    eventBus: EventBusLike;
    obsConnection: ObsConnectionLike;
    obsSources: ObsSourcesLike;
    logger: ObsEventLogger;
}) {
    return new OBSEventService(dependencies);
}

export {
    createOBSEventService
};
