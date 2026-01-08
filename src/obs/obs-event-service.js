const { safeDelay } = require('../utils/timeout-validator');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');


class OBSEventService {
    constructor(dependencies) {
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

        const handleConnectionClosed = (data = {}) => {
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

    async _handleTextUpdate(data) {
        const { sourceName, text } = data;

        try {
            await this.obsSources.updateTextSource(sourceName, text);

            this.eventBus.emit('obs:source:text-updated', {
                sourceName,
                text,
                success: true,
                timestamp: Date.now()
            });
        } catch (error) {
            this._handleObsEventError(`Failed to update text source ${sourceName}`, error, { sourceName, operation: 'text-update' });

            this.eventBus.emit('obs:source:error', {
                sourceName,
                error,
                operation: 'text-update',
                timestamp: Date.now()
            });
        }
    }

    async _handleTextClear(data) {
        const { sourceName } = data;

        try {
            await this.obsSources.clearTextSource(sourceName);

            this.eventBus.emit('obs:source:text-cleared', {
                sourceName,
                success: true,
                timestamp: Date.now()
            });
        } catch (error) {
            this._handleObsEventError(`Failed to clear text source ${sourceName}`, error, { sourceName, operation: 'text-clear' });

            this.eventBus.emit('obs:source:error', {
                sourceName,
                error,
                operation: 'text-clear',
                timestamp: Date.now()
            });
        }
    }

    async _handleVisibilityChange(data) {
        const { sceneName, sourceName, visible } = data;

        try {
            await this.obsSources.setSourceVisibility(sceneName, sourceName, visible);

            this.eventBus.emit('obs:source:visibility-changed', {
                sceneName,
                sourceName,
                visible,
                success: true,
                timestamp: Date.now()
            });
        } catch (error) {
            this._handleObsEventError(`Failed to set visibility for ${sourceName}`, error, {
                sceneName,
                sourceName,
                visible,
                operation: 'set-visibility'
            });

            this.eventBus.emit('obs:source:error', {
                sceneName,
                sourceName,
                error,
                operation: 'visibility-change',
                timestamp: Date.now()
            });
        }
    }

    async _handleSceneSwitch(data) {
        const { sceneName } = data;

        try {
            await this.obsConnection.call('SetCurrentProgramScene', {
                sceneName
            });

            this.eventBus.emit('obs:scene:switched', {
                sceneName,
                success: true,
                timestamp: Date.now()
            });
        } catch (error) {
            this._handleObsEventError(`Failed to switch to scene ${sceneName}`, error, { sceneName, operation: 'scene-switch' });

            this.eventBus.emit('obs:scene:error', {
                sceneName,
                error,
                operation: 'scene-switch',
                timestamp: Date.now()
            });
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

            this.eventBus.emit('obs:reconnecting', {
                attempt: this.state.reconnectAttempts,
                maxAttempts: this.reconnectConfig.maxAttempts,
                timestamp: Date.now()
            });

            try {
                await this.connect();

                this.eventBus.emit('obs:reconnected', {
                    attempts: this.state.reconnectAttempts,
                    timestamp: Date.now()
                });

                this.state.reconnecting = false;
                this.state.reconnectAttempts = 0;
                return;
            } catch (error) {
                const delay = Math.min(
                    this.reconnectConfig.baseDelay * Math.pow(2, this.state.reconnectAttempts - 1),
                    this.reconnectConfig.maxDelay
                );

                await safeDelay(delay, this.reconnectConfig.baseDelay, 'OBS reconnect backoff');
            }
        }

        this.state.reconnecting = false;

        this.eventBus.emit('obs:reconnect-failed', {
            attempts: this.state.reconnectAttempts,
            timestamp: Date.now()
        });
    }

    async connect() {
        const previousState = this.state.connected ? 'connected' : 'disconnected';

        try {
            await this.obsConnection.connect();

            this.state.connected = true;
            this.state.ready = true;
            this.state.lastError = null;

            this.eventBus.emit('obs:connected', {
                timestamp: Date.now(),
                success: true
            });

            this.eventBus.emit('obs:connection:state-changed', {
                state: 'connected',
                previousState,
                timestamp: Date.now()
            });
        } catch (error) {
            this.state.connected = false;
            this.state.ready = false;
            this.state.lastError = error;

            this._handleObsEventError('Failed to connect to OBS', error, { operation: 'connect' });

            this.eventBus.emit('obs:connection:error', {
                error,
                timestamp: Date.now()
            });

            throw error;
        }
    }

    async disconnect() {
        const previousState = this.state.connected ? 'connected' : 'disconnected';

        try {
            await this.obsConnection.disconnect();

            this.state.connected = false;
            this.state.ready = false;

            this.eventBus.emit('obs:disconnected', {
                timestamp: Date.now()
            });

            this.eventBus.emit('obs:connection:state-changed', {
                state: 'disconnected',
                previousState,
                timestamp: Date.now()
            });
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
            } catch (error) {
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

    _handleObsEventError(message, error, payload = null) {
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
        if (this.obsConnection && typeof this.obsConnection.removeEventListener === 'function') {
            this.connectionEventHandlers.forEach(({ event, handler }) => {
                this.obsConnection.removeEventListener(event, handler);
            });
        }
        this.connectionEventHandlers = [];
    }
}

function createOBSEventService(dependencies) {
    return new OBSEventService(dependencies);
}

module.exports = {
    createOBSEventService
};
