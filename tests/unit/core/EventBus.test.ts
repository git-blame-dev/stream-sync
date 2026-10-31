import { vi, describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';

import { advanceTimersByTime, setSystemTime, useFakeTimers, useRealTimers } from '../../helpers/bun-timers';
import { waitForDelay } from '../../helpers/time-utils';

import { EventBus, createEventBus } from '../../../src/core/EventBus.ts';
import { PlatformEvents } from '../../../src/interfaces/PlatformEvents.ts';

type EventStatsSnapshot = ReturnType<EventBus['getEventStats']>;

type HandlerErrorEvent = {
    eventName: string | symbol;
    error: unknown;
    args: unknown[];
};

function getEventStatsFor(stats: EventStatsSnapshot, eventName: string) {
    const eventStats = stats[eventName];
    expect(eventStats).toBeDefined();
    if (!eventStats) {
        throw new Error(`Expected stats for ${eventName}`);
    }
    return eventStats;
}

function getFirstCallArg(fn: { mock: { calls: unknown[][] } }) {
    const firstCall = fn.mock.calls[0];
    expect(firstCall).toBeDefined();
    if (!firstCall) {
        throw new Error('Expected at least one mock call');
    }
    return firstCall[0];
}

function asHandlerErrorEvent(value: unknown): HandlerErrorEvent {
    expect(value).toBeDefined();
    if (!value || typeof value !== 'object') {
        throw new Error('Expected handler-error event payload');
    }
    return value as HandlerErrorEvent;
}

async function settleHandlers() {
    advanceTimersByTime(10);
    await Promise.resolve();
    await Promise.resolve();
}

describe('EventBus', () => {
    let eventBus: EventBus;
    
    beforeEach(() => {
        useFakeTimers();
        vi.clearAllMocks();
        eventBus = new EventBus({});
    });
    
    afterEach(() => {
        if (eventBus) {
            eventBus.reset();
        }
        useRealTimers();
    });

    describe('Constructor and Initialization', () => {
        test('should create EventBus with default options', () => {
            const bus = new EventBus();
            expect(bus.maxListeners).toBe(50);
            expect(bus.eventStats).toBeInstanceOf(Map);
            expect(bus.getMaxListeners()).toBe(50);
        });

        test('should create EventBus with custom options', () => {
            const bus = new EventBus({ 
                maxListeners: 100 
            });
            expect(bus.maxListeners).toBe(100);
            expect(bus.getMaxListeners()).toBe(100);
        });

        test('should bind methods to preserve context', () => {
            const bus = new EventBus();
            const { emit, subscribe } = bus;

            expect(() => emit('test')).not.toThrow();
            expect(() => subscribe('test', () => {})).not.toThrow();
        });
    });

    describe('Event Subscription', () => {
        test('should subscribe to events successfully', () => {
            const handler = vi.fn<(...args: unknown[]) => unknown>();
            const unsubscribe = eventBus.subscribe('test-event', handler);
            
            expect(typeof unsubscribe).toBe('function');
            expect(eventBus.listenerCount('test-event')).toBe(1);
        });

        test('should throw error for non-function handler', () => {
            const invalidHandler = 'not-a-function' as unknown as Parameters<EventBus['subscribe']>[1];
            expect(() => {
                eventBus.subscribe('test-event', invalidHandler);
            }).toThrow("Handler for event 'test-event' must be a function");
        });

        test('should support once subscription', () => {
            const handler = vi.fn<(...args: unknown[]) => unknown>();
            eventBus.subscribe('test-event', handler, { once: true });
            
            eventBus.emit('test-event', 'data');
            eventBus.emit('test-event', 'data2');
            
            expect(handler).toHaveBeenCalledTimes(1);
        });

        test('should support context binding', () => {
            const context = { name: 'TestContext', value: 42 };
            const handler = vi.fn(function(this: typeof context) {
                return this.value;
            });
            
            eventBus.subscribe('test-event', handler, { context });
            eventBus.emit('test-event');
            
            expect(handler).toHaveBeenCalled();
        });

        test('should return unsubscribe function from subscription', () => {
            const handler = vi.fn<(...args: unknown[]) => unknown>();
            const unsubscribe = eventBus.subscribe('test-event', handler);
            
            expect(eventBus.listenerCount('test-event')).toBe(1);
            
            const result = unsubscribe();
            expect(result).toBe(true);
            expect(eventBus.listenerCount('test-event')).toBe(0);
        });

        test('should handle multiple subscribers to same event', () => {
            const handler1 = vi.fn<(...args: unknown[]) => unknown>();
            const handler2 = vi.fn<(...args: unknown[]) => unknown>();
            const handler3 = vi.fn<(...args: unknown[]) => unknown>();
            
            eventBus.subscribe('test-event', handler1);
            eventBus.subscribe('test-event', handler2);
            eventBus.subscribe('test-event', handler3);
            
            expect(eventBus.listenerCount('test-event')).toBe(3);
            
            eventBus.emit('test-event', 'data');
            
            expect(handler1).toHaveBeenCalledTimes(1);
            expect(handler2).toHaveBeenCalledTimes(1);
            expect(handler3).toHaveBeenCalledTimes(1);
        });
    });

    describe('Event Emission', () => {
        test('should emit events successfully', () => {
            const handler = vi.fn<(...args: unknown[]) => unknown>();
            eventBus.subscribe('test-event', handler);
            
            const result = eventBus.emit('test-event', 'data', 42, { key: 'value' });
            
            expect(result).toBe(true);
            expect(handler).toHaveBeenCalledTimes(1);
        });

        test('should return false when no listeners', () => {
            const result = eventBus.emit('nonexistent-event');
            
            expect(result).toBe(false);
        });

        test('should update event statistics on emission', () => {
            const handler = vi.fn<(...args: unknown[]) => unknown>();
            eventBus.subscribe('test-event', handler);
            
            eventBus.emit('test-event');
            
            const stats = eventBus.getEventStats();
            const testEventStats = getEventStatsFor(stats, 'test-event');
            expect(testEventStats.emitted).toBe(1);
            expect(testEventStats.success).toBe(1);
            expect(testEventStats.error).toBe(0);
        });
    });

    describe('Async Handler Support', () => {
        test('should handle async handlers successfully', async () => {
            const asyncHandler = vi.fn(async (data: unknown) => {
                await waitForDelay(10);
                return String(data).toUpperCase();
            });
            
            eventBus.subscribe('async-event', asyncHandler);
            eventBus.emit('async-event', 'hello');

            await settleHandlers();
            
            expect(asyncHandler).toHaveBeenCalledTimes(1);
            
            const stats = eventBus.getEventStats();
            expect(getEventStatsFor(stats, 'async-event').success).toBe(1);
        });

        test('should handle async handler errors', async () => {
            const errorHandler = vi.fn(async () => {
                throw new Error('Async handler error');
            });
            
            eventBus.subscribe('error-event', errorHandler);
            eventBus.emit('error-event');

            await settleHandlers();
            
            const stats = eventBus.getEventStats();
            expect(getEventStatsFor(stats, 'error-event').error).toBe(1);
        });

        test('should handle Promise-returning handlers', async () => {
            const promiseHandler = vi.fn(() => {
                return Promise.resolve('success');
            });
            
            eventBus.subscribe('promise-event', promiseHandler);
            eventBus.emit('promise-event');

            await settleHandlers();
            
            expect(promiseHandler).toHaveBeenCalled();
            
            const stats = eventBus.getEventStats();
            expect(getEventStatsFor(stats, 'promise-event').success).toBe(1);
        });
    });

    describe('Error Handling and Isolation', () => {
        test('should isolate handler errors from other handlers', async () => {
            const goodHandler = vi.fn<(...args: unknown[]) => unknown>();
            const errorHandler = vi.fn(() => {
                throw new Error('Handler failed');
            });
            const anotherGoodHandler = vi.fn<(...args: unknown[]) => unknown>();
            
            eventBus.subscribe('test-event', goodHandler);
            eventBus.subscribe('test-event', errorHandler);
            eventBus.subscribe('test-event', anotherGoodHandler);
            
            eventBus.emit('test-event', 'data');
            
            await settleHandlers();
            
            expect(goodHandler).toHaveBeenCalledTimes(1);
            expect(anotherGoodHandler).toHaveBeenCalledTimes(1);
            expect(errorHandler).toHaveBeenCalledTimes(1);
            
            const stats = eventBus.getEventStats();
            const testEventStats = getEventStatsFor(stats, 'test-event');
            expect(testEventStats.success).toBe(2);
            expect(testEventStats.error).toBe(1);
        });

        test('should emit handler-error event when handler fails', async () => {
            const errorHandler = vi.fn(() => {
                throw new Error('Test error');
            });
            const errorEventHandler = vi.fn<(...args: unknown[]) => unknown>();
            
            eventBus.subscribe('test-event', errorHandler);
            eventBus.subscribe('handler-error', errorEventHandler);
            
            eventBus.emit('test-event', 'data');
            
            await settleHandlers();
            
            expect(errorEventHandler).toHaveBeenCalledTimes(1);
            const errorEventArgs = asHandlerErrorEvent(getFirstCallArg(errorEventHandler));
            expect(errorEventArgs.eventName).toBe('test-event');
            expect(errorEventArgs.error).toBeInstanceOf(Error);
        });

        test('does not re-emit handler-error when handler-error handler fails', async () => {
            const errorHandler = vi.fn(() => {
                throw new Error('Test error');
            });
            const handlerErrorHandler = vi.fn(() => {
                throw new Error('Handler error failure');
            });

            eventBus.subscribe('test-event', errorHandler);
            eventBus.subscribe('handler-error', handlerErrorHandler);

            eventBus.emit('test-event', 'data');

            await settleHandlers();

            expect(handlerErrorHandler).toHaveBeenCalledTimes(1);
        });

        test('should handle context errors gracefully', async () => {
            const context = { name: 'TestContext' };
            const errorHandler = vi.fn(function(this: typeof context) {
                throw new Error('Context error');
            });
            
            eventBus.subscribe('test-event', errorHandler, { context });
            eventBus.emit('test-event');

            await settleHandlers();
            
            const stats = eventBus.getEventStats();
            expect(getEventStatsFor(stats, 'test-event').error).toBe(1);
        });

        test('should truncate long arguments in error reporting', async () => {
            const longObject = { data: 'x'.repeat(200) };
            const errorHandler = vi.fn(() => {
                throw new Error('Handler error');
            });
            const errorEventHandler = vi.fn<(...args: unknown[]) => unknown>();
            
            eventBus.subscribe('test-event', errorHandler);
            eventBus.subscribe('handler-error', errorEventHandler);
            
            eventBus.emit('test-event', longObject);
            
            await settleHandlers();
            
            expect(errorEventHandler).toHaveBeenCalledTimes(1);
            const errorEventArgs = asHandlerErrorEvent(getFirstCallArg(errorEventHandler));
            expect(errorEventArgs.eventName).toBe('test-event');
            expect(errorEventArgs.error).toBeInstanceOf(Error);
            expect(String(errorEventArgs.args[0]).length).toBeLessThanOrEqual(100);
        });
    });

    describe('Unsubscribe Functionality', () => {
        test('should unsubscribe handlers successfully', () => {
            const handler = vi.fn<(...args: unknown[]) => unknown>();
            eventBus.subscribe('test-event', handler);
            
            expect(eventBus.listenerCount('test-event')).toBe(1);
            
            const result = eventBus.unsubscribe('test-event', handler);
            
            expect(result).toBe(true);
            expect(eventBus.listenerCount('test-event')).toBe(0);
        });

        test('should handle unsubscribe with context', () => {
            const context = { name: 'TestContext' };
            const handler = vi.fn<(...args: unknown[]) => unknown>();
            
            eventBus.subscribe('test-event', handler, { context });
            
            const result = eventBus.unsubscribe('test-event', handler, context);
            
            expect(result).toBe(true);
            expect(eventBus.listenerCount('test-event')).toBe(0);
        });

        test('should not unsubscribe handler with different context', () => {
            const context1 = { name: 'Context1' };
            const context2 = { name: 'Context2' };
            const handler = vi.fn<(...args: unknown[]) => unknown>();
            
            eventBus.subscribe('test-event', handler, { context: context1 });
            
            const result = eventBus.unsubscribe('test-event', handler, context2);
            
            expect(result).toBe(false);
            expect(eventBus.listenerCount('test-event')).toBe(1);
        });

        test('should warn when handler not found for unsubscription', () => {
            const handler = vi.fn<(...args: unknown[]) => unknown>();
            
            const result = eventBus.unsubscribe('nonexistent-event', handler);
            
            expect(result).toBe(false);
        });

        test('should handle multiple handlers with same function reference', () => {
            const handler = vi.fn<(...args: unknown[]) => unknown>();
            const context1 = { name: 'Context1' };
            const context2 = { name: 'Context2' };
            
            eventBus.subscribe('test-event', handler, { context: context1 });
            eventBus.subscribe('test-event', handler, { context: context2 });
            eventBus.subscribe('test-event', handler);
            
            expect(eventBus.listenerCount('test-event')).toBe(3);

            const result1 = eventBus.unsubscribe('test-event', handler, context1);
            expect(result1).toBe(true);
            expect(eventBus.listenerCount('test-event')).toBe(2);

            const result2 = eventBus.unsubscribe('test-event', handler);
            expect(result2).toBe(true);
            expect(eventBus.listenerCount('test-event')).toBe(1);

            eventBus.emit('test-event', 'data');
            expect(handler).toHaveBeenCalledTimes(1);
        });
    });

    describe('Once Functionality', () => {
        test('should call once handlers only once', () => {
            const onceHandler = vi.fn<(...args: unknown[]) => unknown>();
            const regularHandler = vi.fn<(...args: unknown[]) => unknown>();
            
            eventBus.subscribe('test-event', onceHandler, { once: true });
            eventBus.subscribe('test-event', regularHandler);
            
            eventBus.emit('test-event', 'first');
            eventBus.emit('test-event', 'second');
            
            expect(onceHandler).toHaveBeenCalledTimes(1);
            expect(regularHandler).toHaveBeenCalledTimes(2);
        });

        test('should support unsubscribing once handlers before they trigger', () => {
            const onceHandler = vi.fn<(...args: unknown[]) => unknown>();
            const unsubscribe = eventBus.subscribe('test-event', onceHandler, { once: true });
            
            unsubscribe();
            eventBus.emit('test-event', 'data');
            
            expect(onceHandler).not.toHaveBeenCalled();
        });
    });

    describe('Context Binding', () => {
        test('should bind handler to provided context', () => {
            const context = {
                name: 'TestContext',
                getValue() {
                    return this.name;
                }
            };
            
            const handler = vi.fn(function(this: typeof context) {
                return this.getValue();
            });
            
            eventBus.subscribe('test-event', handler, { context });
            eventBus.emit('test-event');
            
            expect(handler).toHaveBeenCalled();
        });

        test('should handle context constructor name correctly', () => {
            class TestClass {
                value: number;
                constructor() {
                    this.value = 42;
                }
            }
            
            const context = new TestClass();
            const handler = vi.fn<(...args: unknown[]) => unknown>();
            
            eventBus.subscribe('test-event', handler, { context });
            
            expect(eventBus.listenerCount('test-event')).toBe(1);
        });

        test('should handle null context gracefully', () => {
            const handler = vi.fn<(...args: unknown[]) => unknown>();
            
            eventBus.subscribe('test-event', handler, { context: null });
            eventBus.emit('test-event', 'data');
            
            expect(handler).toHaveBeenCalledTimes(1);
        });
    });

    describe('Event Statistics', () => {
        test('should track event emission statistics', () => {
            const handler = vi.fn<(...args: unknown[]) => unknown>();
            eventBus.subscribe('test-event', handler);
            
            eventBus.emit('test-event');
            eventBus.emit('test-event');
            
            const stats = eventBus.getEventStats();
            const testEventStats = getEventStatsFor(stats, 'test-event');
            expect(testEventStats.emitted).toBe(2);
            expect(testEventStats.success).toBe(2);
            expect(testEventStats.error).toBe(0);
            expect(typeof testEventStats.totalDuration).toBe('number');
            expect(typeof testEventStats.avgDuration).toBe('number');
        });

        test('should track handler success and error rates', async () => {
            const goodHandler = vi.fn<(...args: unknown[]) => unknown>();
            const badHandler = vi.fn(() => {
                throw new Error('Handler error');
            });
            
            eventBus.subscribe('test-event', goodHandler);
            eventBus.subscribe('test-event', badHandler);
            
            eventBus.emit('test-event');
            
            await settleHandlers();
            
            const stats = eventBus.getEventStats();
            const testEventStats = getEventStatsFor(stats, 'test-event');
            expect(testEventStats.success).toBe(1);
            expect(testEventStats.error).toBe(1);
        });

        test('counts only completed wrapped handlers using monotonic elapsed time', async () => {
            let elapsed = 100;
            let wall = 10000;
            const monotonic = spyOn(performance, 'now').mockImplementation(() => elapsed);
            setSystemTime(new Date(wall));
            try {
                eventBus.subscribe('samples', () => { elapsed += 10; wall -= 1000; setSystemTime(new Date(wall)); });
                eventBus.emit('samples');
                expect(eventBus.getEventStats().samples).toEqual({ emitted: 1, success: 1, error: 0, totalDuration: 10, avgDuration: 10 });
                eventBus.emit('samples');
                expect(eventBus.getEventStats().samples).toEqual({ emitted: 2, success: 2, error: 0, totalDuration: 20, avgDuration: 10 });
                const off = eventBus.subscribe('samples', () => { elapsed += 30; throw new Error('synthetic failure'); });
                eventBus.emit('samples');
                expect(eventBus.getEventStats().samples).toEqual({ emitted: 3, success: 3, error: 1, totalDuration: 60, avgDuration: 15 });
                off();
                eventBus.emit('empty');
                eventBus.on('raw', () => { elapsed += 99; });
                eventBus.emit('raw');
                for (const name of ['empty', 'raw']) {
                    expect(eventBus.getEventStats()[name]).toEqual({ emitted: 1, success: 0, error: 0, totalDuration: 0, avgDuration: 0 });
                }
            } finally {
                monotonic.mockRestore();
                setSystemTime();
            }
        });

        test('keeps synchronous dispatch and measures overlapping completions in settlement order', async () => {
            let elapsed = 0;
            const monotonic = spyOn(performance, 'now').mockImplementation(() => elapsed);
            const first = Promise.withResolvers<void>();
            const second = Promise.withResolvers<void>();
            const order: string[] = [];
            const errors: unknown[] = [];
            try {
                eventBus.subscribe('handler-error', error => { errors.push(error); });
                eventBus.subscribe('overlap', value => {
                    order.push(`start:${value}`);
                    elapsed += 3;
                    return value === 1 ? first.promise : second.promise;
                });
                eventBus.subscribe('overlap', value => { order.push(`later:${value}`); elapsed += 7; });
                expect(eventBus.emit('overlap', 1)).toBe(true);
                expect(eventBus.emit('overlap', 2)).toBe(true);
                expect(order).toEqual(['start:1', 'later:1', 'start:2', 'later:2']);
                expect(eventBus.getEventStats().overlap).toEqual({ emitted: 2, success: 2, error: 0, totalDuration: 14, avgDuration: 7 });
                elapsed = 30;
                second.reject(new Error('synthetic rejection'));
                await second.promise.catch(() => {});
                expect(errors).toHaveLength(1);
                expect(eventBus.getEventStats().overlap).toEqual({ emitted: 2, success: 2, error: 1, totalDuration: 34, avgDuration: 34 / 3 });
                elapsed = 50;
                first.resolve();
                await first.promise;
                expect(eventBus.getEventStats().overlap).toEqual({ emitted: 2, success: 3, error: 1, totalDuration: 84, avgDuration: 21 });
            } finally {
                first.resolve();
                second.resolve();
                await Promise.allSettled([first.promise, second.promise]);
                monotonic.mockRestore();
            }
        });

        test('should return copy of stats to prevent mutation', () => {
            eventBus.emit('test-event');
            
            const stats1 = eventBus.getEventStats();
            const stats2 = eventBus.getEventStats();
            
            getEventStatsFor(stats1, 'test-event').emitted = 999;
            
            expect(getEventStatsFor(stats2, 'test-event').emitted).not.toBe(999);
        });
    });

    describe('Memory Management and Cleanup', () => {
        test('should reset all listeners and stats', () => {
            const handler = vi.fn<(...args: unknown[]) => unknown>();
            eventBus.subscribe('test-event', handler);
            eventBus.emit('test-event');
            
            expect(eventBus.listenerCount('test-event')).toBe(1);
            expect(Object.keys(eventBus.getEventStats())).toHaveLength(1);
            
            eventBus.reset();
            
            expect(eventBus.listenerCount('test-event')).toBe(0);
            expect(Object.keys(eventBus.getEventStats())).toHaveLength(0);
        });

        test('should handle max listeners warning', () => {
            const smallBus = new EventBus({ maxListeners: 2 });
            const handler = vi.fn<(...args: unknown[]) => unknown>();

            smallBus.subscribe('test-event', handler);
            smallBus.subscribe('test-event', handler);
            
            expect(smallBus.listenerCount('test-event')).toBe(2);
        });

        test('should get listener summary', () => {
            const handler = vi.fn<(...args: unknown[]) => unknown>();
            eventBus.subscribe('event1', handler);
            eventBus.subscribe('event1', handler);
            eventBus.subscribe('event2', handler);
            
            const summary = eventBus.getListenerSummary();
            
            expect(summary).toEqual({
                'event1': 2,
                'event2': 1
            });
        });
    });

    describe('PlatformEvents interop', () => {
        test('supports PlatformEvents constants in actual events', () => {
            const handler = vi.fn<(...args: unknown[]) => unknown>();
            eventBus.subscribe(PlatformEvents.VFX_COMMAND_RECEIVED, handler);

            const result = eventBus.emit(PlatformEvents.VFX_COMMAND_RECEIVED, { command: 'hello' });

            expect(result).toBe(true);
            expect(handler).toHaveBeenCalledTimes(1);
        });
    });

    describe('Factory Function', () => {
        test('should create EventBus instance via factory', () => {
            const bus = createEventBus({ maxListeners: 25 });
            
            expect(bus).toBeInstanceOf(EventBus);
            expect(bus.maxListeners).toBe(25);
        });

        test('should create EventBus with default options via factory', () => {
            const bus = createEventBus();
            
            expect(bus).toBeInstanceOf(EventBus);
            expect(bus.maxListeners).toBe(50);
        });
    });

    describe('Performance and Edge Cases', () => {
        test('should handle rapid event emissions', async () => {
            const handler = vi.fn<(...args: unknown[]) => unknown>();
            eventBus.subscribe('rapid-event', handler);
            
            for (let i = 0; i < 100; i++) {
                eventBus.emit('rapid-event', i);
            }
            expect(handler).toHaveBeenCalledTimes(100);

            const stats = eventBus.getEventStats();
            expect(getEventStatsFor(stats, 'rapid-event').success).toBe(100);
        });

        test('should handle empty event name', () => {
            const handler = vi.fn<(...args: unknown[]) => unknown>();
            eventBus.subscribe('', handler);
            
            const result = eventBus.emit('', 'data');
            
            expect(result).toBe(true);
            expect(handler).toHaveBeenCalledTimes(1);
        });

        test('should handle special characters in event names', () => {
            const handler = vi.fn<(...args: unknown[]) => unknown>();
            const eventName = 'special:event/with-chars.and_stuff';
            
            eventBus.subscribe(eventName, handler);
            
            const result = eventBus.emit(eventName, 'data');
            
            expect(result).toBe(true);
            expect(handler).toHaveBeenCalledTimes(1);
        });

        test('should handle large argument lists', () => {
            const handler = vi.fn<(...args: unknown[]) => unknown>();
            const largeArgs = Array.from({ length: 100 }, (_, i) => i);
            
            eventBus.subscribe('large-args', handler);
            eventBus.emit('large-args', ...largeArgs);
            
            expect(handler).toHaveBeenCalledTimes(1);
        });

        test('should handle circular object references in arguments', async () => {
            const handler = vi.fn(() => {
                throw new Error('Test error');
            });
            const errorEventHandler = vi.fn<(...args: unknown[]) => unknown>();

            const obj: { name: string; self?: unknown } = { name: 'test' };
            obj.self = obj;
            
            eventBus.subscribe('test-event', handler);
            eventBus.subscribe('handler-error', errorEventHandler);
            
            eventBus.emit('test-event', obj);
            
            await settleHandlers();
            
            expect(errorEventHandler).toHaveBeenCalledTimes(1);
            const errorEventArgs = asHandlerErrorEvent(getFirstCallArg(errorEventHandler));
            expect(errorEventArgs.eventName).toBe('test-event');
            expect(errorEventArgs.error).toBeInstanceOf(Error);
            expect(errorEventArgs.args[0]).toBe('[Circular Object]');
        });

        test('should handle undefined and null arguments', () => {
            const handler = vi.fn<(...args: unknown[]) => unknown>();
            
            eventBus.subscribe('test-event', handler);
            eventBus.emit('test-event', undefined, null, 0, '', false);
            
            expect(handler).toHaveBeenCalledTimes(1);
        });

        test('should handle synchronous and asynchronous handlers mixed', async () => {
            const syncHandler = vi.fn(() => 'sync');
            const asyncHandler = vi.fn(async () => {
                await waitForDelay(10);
                return 'async';
            });
            const promiseHandler = vi.fn(() => Promise.resolve('promise'));
            
            eventBus.subscribe('mixed-event', syncHandler);
            eventBus.subscribe('mixed-event', asyncHandler);
            eventBus.subscribe('mixed-event', promiseHandler);
            
            eventBus.emit('mixed-event', 'data');

            await settleHandlers();
            
            expect(syncHandler).toHaveBeenCalledTimes(1);
            expect(asyncHandler).toHaveBeenCalledTimes(1);
            expect(promiseHandler).toHaveBeenCalledTimes(1);
            
            const stats = eventBus.getEventStats();
            expect(getEventStatsFor(stats, 'mixed-event').success).toBe(3);
        });
    });

});
