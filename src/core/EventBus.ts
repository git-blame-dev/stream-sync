import { EventEmitter } from 'node:events';

import { logger } from './logging';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';

const eventBusErrorHandler = createPlatformErrorHandler(logger, 'event-bus');

type EventName = string | symbol;
type EventPayload = unknown;
type EventHandler = (...args: unknown[]) => unknown;
type SubscriptionOptions = { once?: boolean; context?: object | null };
type EventStats = { emitted: number; success: number; error: number; totalDuration: number; avgDuration: number };
type WrappedEventHandler = EventHandler & { _originalHandler?: EventHandler; _context?: unknown };
type EventBusOptions = { maxListeners?: number };

function formatEventName(eventName: EventName): string {
    return typeof eventName === 'symbol' ? String(eventName) : eventName;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    return !!value && (typeof value === 'object' || typeof value === 'function')
        && typeof (value as { then?: unknown }).then === 'function';
}

function logEventBusError(message: string, error: unknown, eventType = 'event-bus', payload: EventPayload = null) {
    if (error instanceof Error) {
        eventBusErrorHandler.handleEventProcessingError(error, eventType, payload, message);
    } else {
        eventBusErrorHandler.logOperationalError(message, 'event-bus', payload || error);
    }
}

class EventBus extends EventEmitter {
    maxListeners: number;
    eventStats: Map<EventName, EventStats>;

    constructor(options: EventBusOptions = {}) {
        super();

        this.maxListeners = options.maxListeners || 50;
        this.eventStats = new Map();

        this.setMaxListeners(this.maxListeners);

        this.emit = this.emit.bind(this);
        this.subscribe = this.subscribe.bind(this);
        this.unsubscribe = this.unsubscribe.bind(this);
    }

    subscribe(eventName: EventName, handler: EventHandler, options: SubscriptionOptions = {}) {
        if (typeof handler !== 'function') {
            throw new Error(`Handler for event '${formatEventName(eventName)}' must be a function`);
        }

        const { once = false, context = null } = options;

        const wrappedHandler: WrappedEventHandler = async (...args: unknown[]) => {
            const startTime = performance.now();

            try {
                const result = context ? handler.apply(context, args) : handler(...args);

                if (isPromiseLike(result)) {
                    await result;
                }

                const executionTime = Math.max(0, performance.now() - startTime);

                this._updateEventStats(eventName, 'success', executionTime);
            } catch (error) {
                const executionTime = Math.max(0, performance.now() - startTime);
                this._updateEventStats(eventName, 'error', executionTime);

                const errorMessage = error instanceof Error ? error.message : String(error);
                logEventBusError(`[EventBus] Handler error for '${formatEventName(eventName)}': ${errorMessage}`, error, 'event-handler-error', {
                    eventName
                });

                if (eventName !== 'handler-error') {
                    this.emit('handler-error', {
                        eventName,
                        error,
                        context: context?.constructor?.name || 'unknown',
                        args: args.map((arg) => {
                            if (typeof arg === 'object' && arg !== null) {
                                try {
                                    return JSON.stringify(arg).substring(0, 100);
                                } catch (_circularError) {
                                    return '[Circular Object]';
                                }
                            }
                            return arg;
                        })
                    });
                }
            }
        };

        wrappedHandler._originalHandler = handler;
        wrappedHandler._context = context;

        if (once) {
            this.once(eventName, wrappedHandler);
        } else {
            this.on(eventName, wrappedHandler);
        }

        return () => this.unsubscribe(eventName, handler, context);
    }

    unsubscribe(eventName: EventName, handler: EventHandler, context: unknown = null) {
        const listeners = this.listeners(eventName);

        for (const wrappedHandler of listeners as WrappedEventHandler[]) {
            if (wrappedHandler._originalHandler === handler && wrappedHandler._context === context) {
                this.removeListener(eventName, wrappedHandler);

                return true;
            }
        }

        logger?.warn?.(`[EventBus] Handler not found for unsubscription from '${formatEventName(eventName)}'`, 'event-bus');
        return false;
    }

    override emit(eventName: EventName, ...args: unknown[]) {
        const hadListeners = super.emit(eventName, ...args);
        this._updateEventStats(eventName, 'emitted');

        return hadListeners;
    }

    getListenerSummary() {
        const summary: Record<PropertyKey, number> = {};
        for (const eventName of this.eventNames()) {
            summary[eventName] = this.listenerCount(eventName);
        }
        return summary;
    }

    getEventStats() {
        const stats: Record<string, EventStats> = {};
        for (const [eventName, eventStat] of this.eventStats) {
            stats[formatEventName(eventName)] = { ...eventStat };
        }
        return stats;
    }

    reset() {
        this.removeAllListeners();
        this.eventStats.clear();
    }

    _updateEventStats(eventName: EventName, type: keyof Pick<EventStats, 'emitted' | 'success' | 'error'>, duration = 0) {
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
        if (!stats) {
            return;
        }
        stats[type]++;

        if (type === 'success' || type === 'error') {
            stats.totalDuration += duration;
            stats.avgDuration = stats.totalDuration / (stats.success + stats.error);
        }
    }
}

function createEventBus(options: EventBusOptions = {}): EventBus {
    return new EventBus(options);
}

export {
    EventBus,
    createEventBus
};
