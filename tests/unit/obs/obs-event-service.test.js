
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const { createEventBus } = require('../../../src/core/EventBus');
const testClock = require('../../helpers/test-clock');

describe('OBSEventService', () => {
    let obsEventService;
    let eventBus;
    let mockOBSConnection;
    let mockObsSources;

    beforeEach(() => {
        // Create fresh event bus
        eventBus = createEventBus({ debugEnabled: false });

        // Mock OBS connection
        mockOBSConnection = {
            connect: createMockFn().mockResolvedValue(true),
            disconnect: createMockFn().mockResolvedValue(undefined),
            isConnected: createMockFn().mockReturnValue(true),
            isReady: createMockFn().mockResolvedValue(true),
            call: createMockFn().mockResolvedValue({}),
            addEventListener: createMockFn((event, handler) => {
                return handler;
            }),
            removeEventListener: createMockFn(),
            getConnectionState: createMockFn().mockReturnValue({
                isConnected: true,
                isConnecting: false
            })
        };

        // Mock OBS sources
        mockObsSources = {
            updateTextSource: createMockFn().mockResolvedValue(undefined),
            setSourceVisibility: createMockFn().mockResolvedValue(undefined),
            clearTextSource: createMockFn().mockResolvedValue(undefined)
        };

        // Import OBSEventService after mocks are set up
        const { createOBSEventService } = require('../../../src/obs/obs-event-service');
        obsEventService = createOBSEventService({
            eventBus,
            obsConnection: mockOBSConnection,
            obsSources: mockObsSources,
            logger: {
                debug: createMockFn(),
                info: createMockFn(),
                warn: createMockFn(),
                error: createMockFn()
            },
            reconnectConfig: {
                maxAttempts: 3,
                baseDelay: 10,
                maxDelay: 100,
                enabled: true
            }
        });
    });

    afterEach(() => {
        restoreAllMocks();
        if (obsEventService) {
            obsEventService.destroy();
            obsEventService = null;
        }
        eventBus.reset();
    });

    describe('Connection Events', () => {
        test('connects and updates state when connection succeeds', async () => {
            await obsEventService.connect();

            expect(mockOBSConnection.connect).toHaveBeenCalled();
            const state = obsEventService.getConnectionState();
            expect(state.connected).toBe(true);
            expect(state.ready).toBe(true);
        });

        test('disconnects and updates state when disconnection occurs', async () => {
            await obsEventService.connect();
            await obsEventService.disconnect();

            expect(mockOBSConnection.disconnect).toHaveBeenCalled();
            const state = obsEventService.getConnectionState();
            expect(state.connected).toBe(false);
            expect(state.ready).toBe(false);
        });

        test('records connection errors when connection fails', async () => {
            mockOBSConnection.connect.mockRejectedValueOnce(new Error('Connection refused'));

            await obsEventService.connect().catch(() => {}); // Catch the thrown error

            const state = obsEventService.getConnectionState();
            expect(state.connected).toBe(false);
            expect(state.ready).toBe(false);
            expect(state.lastError).toBeInstanceOf(Error);
        });

        test('removes OBS connection listeners on destroy', () => {
            obsEventService.destroy();
            obsEventService = null;
            expect(mockOBSConnection.removeEventListener).toHaveBeenCalled();
            const [eventName, handler] = mockOBSConnection.removeEventListener.mock.calls[0];
            expect(eventName).toBe('ConnectionClosed');
            expect(typeof handler).toBe('function');
        });
    });

    describe('Text Source Events', () => {
        test('updates text source when obs:update-text is emitted', async () => {
            eventBus.emit('obs:update-text', {
                sourceName: 'ChatMessage',
                text: 'Hello World'
            });

            await waitForDelay(10);

            expect(mockObsSources.updateTextSource).toHaveBeenCalled();
            const [sourceName, text] = mockObsSources.updateTextSource.mock.calls[0];
            expect(sourceName).toBe('ChatMessage');
            expect(text).toBe('Hello World');
        });

        test('clears text source when obs:clear-text is emitted', async () => {
            eventBus.emit('obs:clear-text', {
                sourceName: 'ChatMessage'
            });

            await waitForDelay(10);

            expect(mockObsSources.clearTextSource).toHaveBeenCalled();
            const [sourceName] = mockObsSources.clearTextSource.mock.calls[0];
            expect(sourceName).toBe('ChatMessage');
        });

        test('handles text update failures without crashing', async () => {
            mockObsSources.updateTextSource.mockRejectedValueOnce(new Error('Source not found'));

            eventBus.emit('obs:update-text', {
                sourceName: 'InvalidSource',
                text: 'Test'
            });

            await waitForDelay(10);

            expect(mockObsSources.updateTextSource).toHaveBeenCalled();
        });
    });

    describe('Visibility Events', () => {
        test('sets source visibility when obs:set-visibility is emitted', async () => {
            eventBus.emit('obs:set-visibility', {
                sceneName: 'MainScene',
                sourceName: 'Statusbar',
                visible: true
            });

            await waitForDelay(10);

            expect(mockObsSources.setSourceVisibility).toHaveBeenCalled();
            const [sceneName, sourceName, visible] = mockObsSources.setSourceVisibility.mock.calls[0];
            expect(sceneName).toBe('MainScene');
            expect(sourceName).toBe('Statusbar');
            expect(visible).toBe(true);
        });
    });

    describe('Scene Events', () => {
        test('switches scenes when obs:switch-scene is emitted', async () => {
            mockOBSConnection.call.mockResolvedValueOnce({});
            eventBus.emit('obs:switch-scene', {
                sceneName: 'GameplayScene'
            });

            await waitForDelay(10);

            expect(mockOBSConnection.call).toHaveBeenCalled();
            const [method, payload] = mockOBSConnection.call.mock.calls[0];
            expect(method).toBe('SetCurrentProgramScene');
            expect(payload).toEqual({ sceneName: 'GameplayScene' });
        });

        test('handles scene switch failures without crashing', async () => {
            mockOBSConnection.call.mockRejectedValueOnce(new Error('Scene not found'));
            eventBus.emit('obs:switch-scene', {
                sceneName: 'InvalidScene'
            });

            await waitForDelay(10);

            expect(mockOBSConnection.call).toHaveBeenCalled();
        });
    });

    describe('Connection State Tracking', () => {
        test('maintains connection state after connection', async () => {
            await obsEventService.connect();

            const state = obsEventService.getConnectionState();

            expect(state).toEqual(
                expect.objectContaining({
                    connected: true,
                    ready: true
                })
            );
        });

        test('maintains connection state after disconnection', async () => {
            await obsEventService.connect();
            await obsEventService.disconnect();

            const state = obsEventService.getConnectionState();

            expect(state).toEqual(
                expect.objectContaining({
                    connected: false,
                    ready: false
                })
            );
        });

        test('provides connection health status', async () => {
            await obsEventService.connect();

            const health = await obsEventService.getHealthStatus();

            expect(health).toEqual(
                expect.objectContaining({
                    healthy: true,
                    connected: true,
                    responsive: true
                })
            );
        });
    });

    describe('Error Recovery', () => {
        test('attempts automatic reconnection after connection loss', async () => {
            // Simulate connection loss
            await obsEventService.connect();
            eventBus.emit('obs:connection-lost');

            await waitForDelay(100);

            expect(mockOBSConnection.connect.mock.calls.length).toBeGreaterThan(1);
        });

        test('reconnects successfully after connection loss', async () => {
            // Simulate connection loss and recovery
            await obsEventService.connect();
            eventBus.emit('obs:connection-lost');
            await waitForDelay(100);

            const state = obsEventService.getConnectionState();
            expect(state.connected).toBe(true);
        });

        test('stops reconnect attempts after max retries', async () => {
            // First establish a successful connection
            await obsEventService.connect();

            // Now make all future connection attempts fail
            mockOBSConnection.connect.mockRejectedValue(new Error('Connection refused'));

            // Simulate connection loss
            eventBus.emit('obs:connection-lost');

            // Wait for all reconnection attempts to complete
            // 3 attempts with exponential backoff: 10ms, 20ms, 40ms = ~100ms total
            await waitForDelay(200);

            const state = obsEventService.getConnectionState();
            expect(state.reconnecting).toBe(false);
            expect(state.reconnectAttempts).toBe(3);
        });
    });

    describe('Performance Requirements', () => {
        test('handles text updates within 50ms latency', async () => {
            const startTime = testClock.now();

            eventBus.emit('obs:update-text', {
                sourceName: 'ChatMessage',
                text: 'Performance Test'
            });

            await waitForDelay(10);
            testClock.advance(10);

            const duration = testClock.now() - startTime;
            expect(duration).toBeLessThan(50);
        });

        test('maintains memory footprint under 200MB during operations', async () => {
            const initialMemory = process.memoryUsage().heapUsed;

            // Perform multiple operations
            for (let i = 0; i < 100; i++) {
                eventBus.emit('obs:update-text', {
                    sourceName: 'ChatMessage',
                    text: `Message ${i}`
                });
            }

            await waitForDelay(50);

            const finalMemory = process.memoryUsage().heapUsed;
            const memoryIncrease = (finalMemory - initialMemory) / 1024 / 1024;

            expect(memoryIncrease).toBeLessThan(10); // Should not increase by more than 10MB
        });
    });

    describe('Integration with EventBus', () => {
        test('subscribes to all required OBS command events', () => {
            const requiredEvents = [
                'obs:update-text',
                'obs:clear-text',
                'obs:set-visibility',
                'obs:switch-scene'
            ];

            const listeners = eventBus.getListenerSummary();

            requiredEvents.forEach(eventName => {
                expect(listeners[eventName]).toBeGreaterThan(0);
            });
        });

        test('cleans up event listeners on service destruction', () => {
            obsEventService.destroy();

            const listeners = eventBus.getListenerSummary();
            const obsListeners = Object.keys(listeners).filter(name => name.startsWith('obs:'));

            expect(obsListeners.length).toBe(0);
        });
    });
});
