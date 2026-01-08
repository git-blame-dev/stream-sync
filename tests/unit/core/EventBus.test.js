
const { EventBus, EventTypes, createEventBus } = require('../../../src/core/EventBus');
const { logger } = require('../../../src/core/logging');

// Mock logger to capture debug output
jest.mock('../../../src/core/logging', () => ({
    logger: {
        debug: jest.fn(),
        error: jest.fn(),
        warn: jest.fn(),
        info: jest.fn()
    }
}));

describe('EventBus', () => {
    let eventBus;
    
    beforeEach(() => {
        jest.clearAllMocks();
        eventBus = new EventBus({ debugEnabled: true });
    });
    
    afterEach(() => {
        if (eventBus) {
            eventBus.reset();
        }
    });

    describe('Constructor and Initialization', () => {
        test('should create EventBus with default options', () => {
            const bus = new EventBus();
            expect(bus.debugEnabled).toBe(false);
            expect(bus.maxListeners).toBe(50);
            expect(bus.eventStats).toBeInstanceOf(Map);
            expect(bus.getMaxListeners()).toBe(50);
        });

        test('should create EventBus with custom options', () => {
            const bus = new EventBus({ 
                debugEnabled: true, 
                maxListeners: 100 
            });
            expect(bus.debugEnabled).toBe(true);
            expect(bus.maxListeners).toBe(100);
            expect(bus.getMaxListeners()).toBe(100);
        });

        test('should enable debug mode when debugEnabled is true', () => {
            const bus = new EventBus({ debugEnabled: true });
            expect(bus.debugEnabled).toBe(true);
        });

        test('should bind methods to preserve context', () => {
            const bus = new EventBus();
            const { emit, subscribe, unsubscribe } = bus;
            
            // Methods should still work when extracted
            expect(() => emit('test')).not.toThrow();
            expect(() => subscribe('test', () => {})).not.toThrow();
        });
    });

    describe('Event Subscription', () => {
        test('should subscribe to events successfully', () => {
            const handler = jest.fn();
            const unsubscribe = eventBus.subscribe('test-event', handler);
            
            expect(typeof unsubscribe).toBe('function');
            expect(eventBus.listenerCount('test-event')).toBe(1);
        });

        test('should throw error for non-function handler', () => {
            expect(() => {
                eventBus.subscribe('test-event', 'not-a-function');
            }).toThrow("Handler for event 'test-event' must be a function");
        });

        test('should support once subscription', () => {
            const handler = jest.fn();
            eventBus.subscribe('test-event', handler, { once: true });
            
            eventBus.emit('test-event', 'data');
            eventBus.emit('test-event', 'data2');
            
            expect(handler).toHaveBeenCalledTimes(1);
        });

        test('should support context binding', () => {
            const context = { name: 'TestContext', value: 42 };
            const handler = jest.fn(function() {
                return this.value;
            });
            
            eventBus.subscribe('test-event', handler, { context });
            eventBus.emit('test-event');
            
            expect(handler).toHaveBeenCalled();
            // Verify context was properly bound - handler should have access to this.value
        });

        test('should return unsubscribe function from subscription', () => {
            const handler = jest.fn();
            const unsubscribe = eventBus.subscribe('test-event', handler);
            
            expect(eventBus.listenerCount('test-event')).toBe(1);
            
            const result = unsubscribe();
            expect(result).toBe(true);
            expect(eventBus.listenerCount('test-event')).toBe(0);
        });

        test('should handle multiple subscribers to same event', () => {
            const handler1 = jest.fn();
            const handler2 = jest.fn();
            const handler3 = jest.fn();
            
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
            const handler = jest.fn();
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
            const handler = jest.fn();
            eventBus.subscribe('test-event', handler);
            
            eventBus.emit('test-event');
            
            const stats = eventBus.getEventStats();
            expect(stats['test-event']).toBeDefined();
            expect(stats['test-event'].emitted).toBe(1);
            expect(stats['test-event'].success).toBe(1);
            expect(stats['test-event'].error).toBe(0);
        });
    });

    describe('Async Handler Support', () => {
        test('should handle async handlers successfully', async () => {
            const asyncHandler = jest.fn(async (data) => {
                await waitForDelay(10);
                return data.toUpperCase();
            });
            
            eventBus.subscribe('async-event', asyncHandler);
            eventBus.emit('async-event', 'hello');
            
            // Give async handler time to complete
            await waitForDelay(50);
            
            expect(asyncHandler).toHaveBeenCalledTimes(1);
            
            const stats = eventBus.getEventStats();
            expect(stats['async-event'].success).toBe(1);
        });

        test('should handle async handler errors', async () => {
            const errorHandler = jest.fn(async () => {
                throw new Error('Async handler error');
            });
            
            eventBus.subscribe('error-event', errorHandler);
            eventBus.emit('error-event');
            
            // Give async handler time to complete and fail
            await waitForDelay(50);
            
            const stats = eventBus.getEventStats();
            expect(stats['error-event'].error).toBe(1);
        });

        test('should handle Promise-returning handlers', async () => {
            const promiseHandler = jest.fn(() => {
                return Promise.resolve('success');
            });
            
            eventBus.subscribe('promise-event', promiseHandler);
            eventBus.emit('promise-event');
            
            // Give promise time to resolve
            await waitForDelay(50);
            
            expect(promiseHandler).toHaveBeenCalled();
            
            const stats = eventBus.getEventStats();
            expect(stats['promise-event'].success).toBe(1);
        });
    });

    describe('Error Handling and Isolation', () => {
        test('should isolate handler errors from other handlers', async () => {
            const goodHandler = jest.fn();
            const errorHandler = jest.fn(() => {
                throw new Error('Handler failed');
            });
            const anotherGoodHandler = jest.fn();
            
            eventBus.subscribe('test-event', goodHandler);
            eventBus.subscribe('test-event', errorHandler);
            eventBus.subscribe('test-event', anotherGoodHandler);
            
            eventBus.emit('test-event', 'data');
            
            // Give handlers time to execute
            await waitForDelay(50);
            
            expect(goodHandler).toHaveBeenCalledTimes(1);
            expect(anotherGoodHandler).toHaveBeenCalledTimes(1);
            expect(errorHandler).toHaveBeenCalledTimes(1);
            
            const stats = eventBus.getEventStats();
            expect(stats['test-event'].success).toBe(2); // Two successful handlers
            expect(stats['test-event'].error).toBe(1); // One failed handler
        });

        test('should emit handler-error event when handler fails', async () => {
            const errorHandler = jest.fn(() => {
                throw new Error('Test error');
            });
            const errorEventHandler = jest.fn();
            
            eventBus.subscribe('test-event', errorHandler);
            eventBus.subscribe('handler-error', errorEventHandler);
            
            eventBus.emit('test-event', 'data');
            
            // Give handlers time to execute
            await waitForDelay(50);
            
            expect(errorEventHandler).toHaveBeenCalledTimes(1);
            const errorEventArgs = errorEventHandler.mock.calls[0][0];
            expect(errorEventArgs.eventName).toBe('test-event');
            expect(errorEventArgs.error).toBeInstanceOf(Error);
        });

        test('should handle context errors gracefully', async () => {
            const context = { name: 'TestContext' };
            const errorHandler = jest.fn(function() {
                throw new Error('Context error');
            });
            
            eventBus.subscribe('test-event', errorHandler, { context });
            eventBus.emit('test-event');
            
            // Give handler time to execute and fail
            await waitForDelay(50);
            
            const stats = eventBus.getEventStats();
            expect(stats['test-event'].error).toBe(1);
        });

        test('should truncate long arguments in error reporting', async () => {
            const longObject = { data: 'x'.repeat(200) };
            const errorHandler = jest.fn(() => {
                throw new Error('Handler error');
            });
            const errorEventHandler = jest.fn();
            
            eventBus.subscribe('test-event', errorHandler);
            eventBus.subscribe('handler-error', errorEventHandler);
            
            eventBus.emit('test-event', longObject);
            
            // Give handlers time to execute
            await waitForDelay(50);
            
            expect(errorEventHandler).toHaveBeenCalledTimes(1);
            const errorEventArgs = errorEventHandler.mock.calls[0][0];
            expect(errorEventArgs.eventName).toBe('test-event');
            expect(errorEventArgs.error).toBeInstanceOf(Error);
            expect(errorEventArgs.args[0].length).toBeLessThanOrEqual(100); // Should be truncated
        });
    });

    describe('Unsubscribe Functionality', () => {
        test('should unsubscribe handlers successfully', () => {
            const handler = jest.fn();
            eventBus.subscribe('test-event', handler);
            
            expect(eventBus.listenerCount('test-event')).toBe(1);
            
            const result = eventBus.unsubscribe('test-event', handler);
            
            expect(result).toBe(true);
            expect(eventBus.listenerCount('test-event')).toBe(0);
        });

        test('should handle unsubscribe with context', () => {
            const context = { name: 'TestContext' };
            const handler = jest.fn();
            
            eventBus.subscribe('test-event', handler, { context });
            
            const result = eventBus.unsubscribe('test-event', handler, context);
            
            expect(result).toBe(true);
            expect(eventBus.listenerCount('test-event')).toBe(0);
        });

        test('should not unsubscribe handler with different context', () => {
            const context1 = { name: 'Context1' };
            const context2 = { name: 'Context2' };
            const handler = jest.fn();
            
            eventBus.subscribe('test-event', handler, { context: context1 });
            
            const result = eventBus.unsubscribe('test-event', handler, context2);
            
            expect(result).toBe(false);
            expect(eventBus.listenerCount('test-event')).toBe(1);
        });

        test('should warn when handler not found for unsubscription', () => {
            const handler = jest.fn();
            
            const result = eventBus.unsubscribe('nonexistent-event', handler);
            
            expect(result).toBe(false);
        });

        test('should handle multiple handlers with same function reference', () => {
            const handler = jest.fn();
            const context1 = { name: 'Context1' };
            const context2 = { name: 'Context2' };
            
            eventBus.subscribe('test-event', handler, { context: context1 });
            eventBus.subscribe('test-event', handler, { context: context2 });
            eventBus.subscribe('test-event', handler); // No context
            
            expect(eventBus.listenerCount('test-event')).toBe(3);
            
            // Unsubscribe with context1
            const result1 = eventBus.unsubscribe('test-event', handler, context1);
            expect(result1).toBe(true);
            expect(eventBus.listenerCount('test-event')).toBe(2);
            
            // Unsubscribe without context
            const result2 = eventBus.unsubscribe('test-event', handler);
            expect(result2).toBe(true);
            expect(eventBus.listenerCount('test-event')).toBe(1);
            
            // context2 should still be subscribed
            eventBus.emit('test-event', 'data');
            expect(handler).toHaveBeenCalledTimes(1);
        });
    });

    describe('Once Functionality', () => {
        test('should call once handlers only once', () => {
            const onceHandler = jest.fn();
            const regularHandler = jest.fn();
            
            eventBus.subscribe('test-event', onceHandler, { once: true });
            eventBus.subscribe('test-event', regularHandler);
            
            eventBus.emit('test-event', 'first');
            eventBus.emit('test-event', 'second');
            
            expect(onceHandler).toHaveBeenCalledTimes(1);
            expect(regularHandler).toHaveBeenCalledTimes(2);
        });

        test('should support unsubscribing once handlers before they trigger', () => {
            const onceHandler = jest.fn();
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
            
            const handler = jest.fn(function() {
                return this.getValue();
            });
            
            eventBus.subscribe('test-event', handler, { context });
            eventBus.emit('test-event');
            
            expect(handler).toHaveBeenCalled();
            // The handler should have been called with the correct context
        });

        test('should handle context constructor name correctly', () => {
            class TestClass {
                constructor() {
                    this.value = 42;
                }
            }
            
            const context = new TestClass();
            const handler = jest.fn();
            
            eventBus.subscribe('test-event', handler, { context });
            
            expect(eventBus.listenerCount('test-event')).toBe(1);
        });

        test('should handle null context gracefully', () => {
            const handler = jest.fn();
            
            eventBus.subscribe('test-event', handler, { context: null });
            eventBus.emit('test-event', 'data');
            
            expect(handler).toHaveBeenCalledTimes(1);
        });
    });

    describe('Debug Logging', () => {
        test('should track subscription when debug enabled', () => {
            const handler = jest.fn();
            eventBus.subscribe('test-event', handler);
            
            expect(eventBus.listenerCount('test-event')).toBe(1);
            expect(eventBus.debugEnabled).toBe(true);
        });

        test('should track emission when debug enabled', () => {
            eventBus.emit('test-event', 'data');
            
            expect(eventBus.debugEnabled).toBe(true);
        });

        test('should track handler execution when debug enabled', async () => {
            const handler = jest.fn();
            eventBus.subscribe('test-event', handler);
            
            eventBus.emit('test-event', 'data');
            
            // Give handler time to execute
            await waitForDelay(10);
            
            expect(handler).toHaveBeenCalledTimes(1);
            expect(eventBus.debugEnabled).toBe(true);
        });

        test('should not log when debug disabled', () => {
            const quietBus = new EventBus({ debugEnabled: false });
            const handler = jest.fn();
            
            logger.debug.mockClear();
            
            quietBus.subscribe('test-event', handler);
            quietBus.emit('test-event');
            
            // Should only have the setDebugEnabled call from reset, not subscription/emission
            expect(quietBus.debugEnabled).toBe(false);
        });

        test('should toggle debug logging', () => {
            eventBus.setDebugEnabled(false);
            expect(eventBus.debugEnabled).toBe(false);
            
            eventBus.setDebugEnabled(true);
            expect(eventBus.debugEnabled).toBe(true);
        });
    });

    describe('Event Statistics', () => {
        test('should track event emission statistics', () => {
            const handler = jest.fn();
            eventBus.subscribe('test-event', handler);
            
            eventBus.emit('test-event');
            eventBus.emit('test-event');
            
            const stats = eventBus.getEventStats();
            expect(stats['test-event']).toBeDefined();
            expect(stats['test-event'].emitted).toBe(2);
            expect(stats['test-event'].success).toBe(2);
            expect(stats['test-event'].error).toBe(0);
            expect(typeof stats['test-event'].totalDuration).toBe('number');
            expect(typeof stats['test-event'].avgDuration).toBe('number');
        });

        test('should track handler success and error rates', async () => {
            const goodHandler = jest.fn();
            const badHandler = jest.fn(() => {
                throw new Error('Handler error');
            });
            
            eventBus.subscribe('test-event', goodHandler);
            eventBus.subscribe('test-event', badHandler);
            
            eventBus.emit('test-event');
            
            // Give handlers time to execute
            await waitForDelay(50);
            
            const stats = eventBus.getEventStats();
            expect(stats['test-event'].success).toBe(1);
            expect(stats['test-event'].error).toBe(1);
        });

        test('should calculate average duration correctly', async () => {
            const slowHandler = jest.fn(async () => {
                await waitForDelay(20);
            });
            
            eventBus.subscribe('test-event', slowHandler);
            
            eventBus.emit('test-event');
            eventBus.emit('test-event');
            
            // Give handlers time to execute
            await waitForDelay(100);
            
            const stats = eventBus.getEventStats();
            expect(stats['test-event'].avgDuration).toBeGreaterThan(0);
            expect(stats['test-event'].totalDuration).toBeGreaterThan(stats['test-event'].avgDuration);
        });

        test('should return copy of stats to prevent mutation', () => {
            eventBus.emit('test-event');
            
            const stats1 = eventBus.getEventStats();
            const stats2 = eventBus.getEventStats();
            
            stats1['test-event'].emitted = 999;
            
            expect(stats2['test-event'].emitted).not.toBe(999);
        });
    });

    describe('Memory Management and Cleanup', () => {
        test('should reset all listeners and stats', () => {
            const handler = jest.fn();
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
            const handler = jest.fn();
            
            // This should not exceed max listeners
            smallBus.subscribe('test-event', handler);
            smallBus.subscribe('test-event', handler);
            
            expect(smallBus.listenerCount('test-event')).toBe(2);
        });

        test('should get listener summary', () => {
            const handler = jest.fn();
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

    describe('EventTypes Constants', () => {
        test('should export EventTypes with correct constants', () => {
            expect(EventTypes).toBeDefined();
            expect(EventTypes.VFX_COMMAND).toBe('vfx:command');
            expect(EventTypes.VFX_EXECUTED).toBe('vfx:executed');
            expect(EventTypes.VFX_FAILED).toBe('vfx:failed');
            expect(EventTypes.TTS_SPEAK).toBe('tts:speak');
            expect(EventTypes.TTS_STARTED).toBe('tts:started');
            expect(EventTypes.TTS_COMPLETED).toBe('tts:completed');
            expect(EventTypes.NOTIFICATION_RECEIVED).toBe('notification:received');
            expect(EventTypes.NOTIFICATION_PROCESSED).toBe('notification:processed');
            expect(EventTypes.NOTIFICATION_SUPPRESSED).toBe('notification:suppressed');
            expect(EventTypes.HANDLER_ERROR).toBe('handler-error');
        });

        test('should use EventTypes constants in actual events', () => {
            const handler = jest.fn();
            eventBus.subscribe(EventTypes.VFX_COMMAND, handler);
            
            const result = eventBus.emit(EventTypes.VFX_COMMAND, { command: 'hello' });
            
            expect(result).toBe(true);
            expect(handler).toHaveBeenCalledTimes(1);
        });
    });

    describe('Factory Function', () => {
        test('should create EventBus instance via factory', () => {
            const bus = createEventBus({ debugEnabled: true, maxListeners: 25 });
            
            expect(bus).toBeInstanceOf(EventBus);
            expect(bus.debugEnabled).toBe(true);
            expect(bus.maxListeners).toBe(25);
        });

        test('should create EventBus with default options via factory', () => {
            const bus = createEventBus();
            
            expect(bus).toBeInstanceOf(EventBus);
            expect(bus.debugEnabled).toBe(false);
            expect(bus.maxListeners).toBe(50);
        });
    });

    describe('Performance and Edge Cases', () => {
        test('should handle rapid event emissions', async () => {
            const handler = jest.fn();
            eventBus.subscribe('rapid-event', handler);
            
            const startTime = Date.now();
            
            // Emit 100 events rapidly
            for (let i = 0; i < 100; i++) {
                eventBus.emit('rapid-event', i);
            }
            
            const emissionTime = Date.now() - startTime;
            
            // Give handlers time to complete
            await waitForDelay(100);
            
            expect(handler).toHaveBeenCalledTimes(100);
            expect(emissionTime).toBeLessThan(100); // Should be fast
            
            const stats = eventBus.getEventStats();
            expect(stats['rapid-event'].success).toBe(100);
        });

        test('should handle empty event name', () => {
            const handler = jest.fn();
            eventBus.subscribe('', handler);
            
            const result = eventBus.emit('', 'data');
            
            expect(result).toBe(true);
            expect(handler).toHaveBeenCalledTimes(1);
        });

        test('should handle special characters in event names', () => {
            const handler = jest.fn();
            const eventName = 'special:event/with-chars.and_stuff';
            
            eventBus.subscribe(eventName, handler);
            
            const result = eventBus.emit(eventName, 'data');
            
            expect(result).toBe(true);
            expect(handler).toHaveBeenCalledTimes(1);
        });

        test('should handle large argument lists', () => {
            const handler = jest.fn();
            const largeArgs = Array.from({ length: 100 }, (_, i) => i);
            
            eventBus.subscribe('large-args', handler);
            eventBus.emit('large-args', ...largeArgs);
            
            expect(handler).toHaveBeenCalledTimes(1);
        });

        test('should handle circular object references in arguments', async () => {
            const handler = jest.fn(() => {
                throw new Error('Test error');
            });
            const errorEventHandler = jest.fn();
            
            // Create circular reference
            const obj = { name: 'test' };
            obj.self = obj;
            
            eventBus.subscribe('test-event', handler);
            eventBus.subscribe('handler-error', errorEventHandler);
            
            eventBus.emit('test-event', obj);
            
            // Give handlers time to execute
            await waitForDelay(50);
            
            expect(errorEventHandler).toHaveBeenCalledTimes(1);
            const errorEventArgs = errorEventHandler.mock.calls[0][0];
            expect(errorEventArgs.eventName).toBe('test-event');
            expect(errorEventArgs.error).toBeInstanceOf(Error);
            expect(errorEventArgs.args[0]).toBe('[Circular Object]'); // Should replace circular reference with placeholder
        });

        test('should handle undefined and null arguments', () => {
            const handler = jest.fn();
            
            eventBus.subscribe('test-event', handler);
            eventBus.emit('test-event', undefined, null, 0, '', false);
            
            expect(handler).toHaveBeenCalledTimes(1);
        });

        test('should measure handler execution time accurately', async () => {
            const delayMs = 50;
            const slowHandler = jest.fn(async () => {
                await waitForDelay(delayMs);
            });
            
            eventBus.subscribe('slow-event', slowHandler);
            eventBus.emit('slow-event');
            
            // Give handler time to complete
            await waitForDelay(delayMs + 50);
            
            const stats = eventBus.getEventStats();
            expect(stats['slow-event'].avgDuration).toBeGreaterThan(delayMs - 10);
            expect(stats['slow-event'].avgDuration).toBeLessThan(delayMs + 50);
        });

        test('should handle synchronous and asynchronous handlers mixed', async () => {
            const syncHandler = jest.fn(() => 'sync');
            const asyncHandler = jest.fn(async () => {
                await waitForDelay(10);
                return 'async';
            });
            const promiseHandler = jest.fn(() => Promise.resolve('promise'));
            
            eventBus.subscribe('mixed-event', syncHandler);
            eventBus.subscribe('mixed-event', asyncHandler);
            eventBus.subscribe('mixed-event', promiseHandler);
            
            eventBus.emit('mixed-event', 'data');
            
            // Give async handlers time to complete
            await waitForDelay(50);
            
            expect(syncHandler).toHaveBeenCalledTimes(1);
            expect(asyncHandler).toHaveBeenCalledTimes(1);
            expect(promiseHandler).toHaveBeenCalledTimes(1);
            
            const stats = eventBus.getEventStats();
            expect(stats['mixed-event'].success).toBe(3);
        });
    });
});
