
const EventEmitter = require('events');
const { logger } = require('./logging');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');

const eventBusErrorHandler = createPlatformErrorHandler(logger, 'event-bus');

function logEventBusError(message, error, eventType = 'event-bus', payload = null) {
    if (error instanceof Error) {
        eventBusErrorHandler.handleEventProcessingError(error, eventType, payload, message);
    } else {
        eventBusErrorHandler.logOperationalError(message, 'event-bus', payload || error);
    }
}

class EventBus extends EventEmitter {
    constructor(options = {}) {
        super();

        this.debugEnabled = options.debugEnabled || false;
        this.maxListeners = options.maxListeners || 50;
        this.eventStats = new Map();

        // Set max listeners to prevent memory leak warnings
        this.setMaxListeners(this.maxListeners);
        
        // Bind methods to preserve context
        this.emit = this.emit.bind(this);
        this.subscribe = this.subscribe.bind(this);
        this.unsubscribe = this.unsubscribe.bind(this);
        
        if (this.debugEnabled) {
            logger.debug('[EventBus] Initialized with debug logging enabled', 'event-bus');
        }
    }

    subscribe(eventName, handler, options = {}) {
        if (typeof handler !== 'function') {
            throw new Error(`Handler for event '${eventName}' must be a function`);
        }

        const { once = false, context = null } = options;

        // Wrap handler with error isolation and debugging
        const wrappedHandler = async (...args) => {
            const startTime = Date.now();

            try {
                if (this.debugEnabled) {
                    logger.debug(`[EventBus] Executing handler for '${eventName}'`, 'event-bus', {
                        argsCount: args.length,
                        context: context?.constructor?.name || 'unknown'
                    });
                }

                // Execute handler with proper context binding
                const result = context ? handler.apply(context, args) : handler(...args);

                if (result && typeof result.then === 'function') {
                    await result;
                }

                const executionTime = Math.max(0, Date.now() - startTime);

                // Update stats
                this._updateEventStats(eventName, 'success', executionTime);

                if (this.debugEnabled) {
                    logger.debug(`[EventBus] Handler completed for '${eventName}' in ${executionTime}ms`, 'event-bus');
                }

            } catch (error) {
                const executionTime = Math.max(0, Date.now() - startTime);
                this._updateEventStats(eventName, 'error', executionTime);

                logEventBusError(`[EventBus] Handler error for '${eventName}': ${error.message}`, error, 'event-handler-error', {
                    eventName
                });

                // Emit error event but don't throw to prevent cascading failures
                this.emit('handler-error', {
                    eventName,
                    error,
                    context: context?.constructor?.name || 'unknown',
                    args: args.map(arg => {
                        if (typeof arg === 'object' && arg !== null) {
                            try {
                                return JSON.stringify(arg).substring(0, 100);
                            } catch (circularError) {
                                return '[Circular Object]';
                            }
                        }
                        return arg;
                    })
                });
            }
        };

        // Store original handler reference for unsubscription
        wrappedHandler._originalHandler = handler;
        wrappedHandler._context = context;

        if (once) {
            this.once(eventName, wrappedHandler);
        } else {
            this.on(eventName, wrappedHandler);
        }

        if (this.debugEnabled) {
            logger.debug(`[EventBus] Subscribed to '${eventName}'`, 'event-bus', {
                once,
                context: context?.constructor?.name || 'unknown',
                totalListeners: this.listenerCount(eventName)
            });
        }

        // Return unsubscribe function
        return () => this.unsubscribe(eventName, handler, context);
    }

    unsubscribe(eventName, handler, context = null) {
        const listeners = this.listeners(eventName);
        
        for (const wrappedHandler of listeners) {
            if (wrappedHandler._originalHandler === handler && wrappedHandler._context === context) {
                this.removeListener(eventName, wrappedHandler);
                
                if (this.debugEnabled) {
                    logger.debug(`[EventBus] Unsubscribed from '${eventName}'`, 'event-bus', {
                        context: context?.constructor?.name || 'unknown',
                        remainingListeners: this.listenerCount(eventName)
                    });
                }
                
                return true;
            }
        }
        
        logger.warn(`[EventBus] Handler not found for unsubscription from '${eventName}'`, 'event-bus');
        return false;
    }

    emit(eventName, ...args) {
        const startTime = Date.now();

        if (this.debugEnabled) {
            logger.debug(`[EventBus] Emitting '${eventName}'`, 'event-bus', {
                argsCount: args.length,
                listenerCount: this.listenerCount(eventName)
            });
        }

        const hadListeners = super.emit(eventName, ...args);
        const emissionTime = Math.max(0, Date.now() - startTime);

        this._updateEventStats(eventName, 'emitted', emissionTime);

        if (!hadListeners && this.debugEnabled) {
            logger.debug(`[EventBus] No listeners for '${eventName}'`, 'event-bus');
        }

        return hadListeners;
    }

    getListenerSummary() {
        const summary = {};
        for (const eventName of this.eventNames()) {
            summary[eventName] = this.listenerCount(eventName);
        }
        return summary;
    }

    getEventStats() {
        const stats = {};
        for (const [eventName, eventStat] of this.eventStats) {
            stats[eventName] = { ...eventStat };
        }
        return stats;
    }

    reset() {
        this.removeAllListeners();
        this.eventStats.clear();

        if (this.debugEnabled) {
            logger.debug('[EventBus] Reset - all listeners and stats cleared', 'event-bus');
        }
    }

    setDebugEnabled(enabled) {
        this.debugEnabled = !!enabled;
        logger.debug(`[EventBus] Debug logging ${enabled ? 'enabled' : 'disabled'}`, 'event-bus');
    }

    _updateEventStats(eventName, type, duration) {
        if (!this.eventStats.has(eventName)) {
            this.eventStats.set(eventName, {
                emitted: 0,
                success: 0,
                error: 0,
                totalDuration: 0,
                avgDuration: 0
            });
        }
        
        const stats = this.eventStats.get(eventName);
        stats[type]++;
        stats.totalDuration += duration;
        
        if (type === 'success' || type === 'error') {
            stats.avgDuration = stats.totalDuration / (stats.success + stats.error);
        }
    }
}

const EventTypes = {
    // VFX Command Events
    VFX_COMMAND: 'vfx:command',
    VFX_EXECUTED: 'vfx:executed', 
    VFX_FAILED: 'vfx:failed',
    
    // TTS Events
    TTS_SPEAK: 'tts:speak',
    TTS_STARTED: 'tts:started',
    TTS_COMPLETED: 'tts:completed',
    
    // Notification Events
    NOTIFICATION_RECEIVED: 'notification:received',
    NOTIFICATION_PROCESSED: 'notification:processed',
    NOTIFICATION_SUPPRESSED: 'notification:suppressed',
    
    // System Events
    HANDLER_ERROR: 'handler-error'
};

function createEventBus(options = {}) {
    return new EventBus(options);
}

// Export the class and utilities
module.exports = {
    EventBus,
    EventTypes,
    createEventBus
};
