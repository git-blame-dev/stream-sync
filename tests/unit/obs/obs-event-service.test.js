
const { createEventBus } = require('../../../src/core/EventBus');

describe('OBSEventService', () => {
    let obsEventService;
    let eventBus;
    let mockOBSConnection;
    let mockObsSources;
    let connectionClosedHandler;

    beforeEach(() => {
        // Create fresh event bus
        eventBus = createEventBus({ debugEnabled: false });
        connectionClosedHandler = null;

        // Mock OBS connection
        mockOBSConnection = {
            connect: jest.fn().mockResolvedValue(true),
            disconnect: jest.fn().mockResolvedValue(undefined),
            isConnected: jest.fn().mockReturnValue(true),
            isReady: jest.fn().mockResolvedValue(true),
            call: jest.fn().mockResolvedValue({}),
            addEventListener: jest.fn((event, handler) => {
                if (event === 'ConnectionClosed') {
                    connectionClosedHandler = handler;
                }
            }),
            removeEventListener: jest.fn(),
            getConnectionState: jest.fn().mockReturnValue({
                isConnected: true,
                isConnecting: false
            })
        };

        // Mock OBS sources
        mockObsSources = {
            updateTextSource: jest.fn().mockResolvedValue(undefined),
            setSourceVisibility: jest.fn().mockResolvedValue(undefined),
            clearTextSource: jest.fn().mockResolvedValue(undefined)
        };

        // Import OBSEventService after mocks are set up
        const { createOBSEventService } = require('../../../src/obs/obs-event-service');
        obsEventService = createOBSEventService({
            eventBus,
            obsConnection: mockOBSConnection,
            obsSources: mockObsSources,
            logger: {
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn()
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
        if (obsEventService) {
            obsEventService.destroy();
            obsEventService = null;
        }
        eventBus.reset();
    });

    describe('Connection Events', () => {
        test('emits obs:connected event when connection succeeds', async () => {
            const connectedHandler = jest.fn();
            eventBus.subscribe('obs:connected', connectedHandler);

            await obsEventService.connect();

            expect(connectedHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    timestamp: expect.any(Number),
                    success: true
                })
            );
        });

        test('emits obs:disconnected event when disconnection occurs', async () => {
            const disconnectedHandler = jest.fn();
            eventBus.subscribe('obs:disconnected', disconnectedHandler);

            await obsEventService.disconnect();

            expect(disconnectedHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    timestamp: expect.any(Number)
                })
            );
        });

        test('emits obs:connection:error event when connection fails', async () => {
            mockOBSConnection.connect.mockRejectedValueOnce(new Error('Connection refused'));
            const errorHandler = jest.fn();
            eventBus.subscribe('obs:connection:error', errorHandler);

            await obsEventService.connect().catch(() => {}); // Catch the thrown error

            expect(errorHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    error: expect.any(Error),
                    timestamp: expect.any(Number)
                })
            );
        });

        test('emits obs:connection:state-changed when connection state changes', async () => {
            const stateChangedHandler = jest.fn();
            eventBus.subscribe('obs:connection:state-changed', stateChangedHandler);

            await obsEventService.connect();

            expect(stateChangedHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    state: 'connected',
                    previousState: expect.any(String)
                })
            );
        });

        test('emits obs:connection-lost when OBS connection closes', async () => {
            const connectionLostHandler = jest.fn();
            eventBus.subscribe('obs:connection-lost', connectionLostHandler);

            await obsEventService.connect();

            // Simulate OBS ConnectionClosed event
            connectionClosedHandler({
                reason: 'network',
                code: 4000
            });

            expect(connectionLostHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    reason: 'network',
                    code: 4000,
                    timestamp: expect.any(Number)
                })
            );
        });

        test('removes OBS connection listeners on destroy', () => {
            obsEventService.destroy();
            obsEventService = null;
            expect(mockOBSConnection.removeEventListener).toHaveBeenCalledWith(
                'ConnectionClosed',
                expect.any(Function)
            );
        });
    });

    describe('Text Source Events', () => {
        test('emits obs:source:text-updated when text source is updated', async () => {
            const textUpdatedHandler = jest.fn();
            eventBus.subscribe('obs:source:text-updated', textUpdatedHandler);

            eventBus.emit('obs:update-text', {
                sourceName: 'ChatMessage',
                text: 'Hello World'
            });

            await waitForDelay(10);

            expect(textUpdatedHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    sourceName: 'ChatMessage',
                    text: 'Hello World',
                    success: true
                })
            );
        });

        test('emits obs:source:text-cleared when text source is cleared', async () => {
            const textClearedHandler = jest.fn();
            eventBus.subscribe('obs:source:text-cleared', textClearedHandler);

            eventBus.emit('obs:clear-text', {
                sourceName: 'ChatMessage'
            });

            await waitForDelay(10);

            expect(textClearedHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    sourceName: 'ChatMessage',
                    success: true
                })
            );
        });

        test('emits obs:source:error when text update fails', async () => {
            mockObsSources.updateTextSource.mockRejectedValueOnce(new Error('Source not found'));
            const errorHandler = jest.fn();
            eventBus.subscribe('obs:source:error', errorHandler);

            eventBus.emit('obs:update-text', {
                sourceName: 'InvalidSource',
                text: 'Test'
            });

            await waitForDelay(10);

            expect(errorHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    sourceName: 'InvalidSource',
                    error: expect.any(Error)
                })
            );
        });
    });

    describe('Visibility Events', () => {
        test('emits obs:source:visibility-changed when source visibility is toggled', async () => {
            const visibilityHandler = jest.fn();
            eventBus.subscribe('obs:source:visibility-changed', visibilityHandler);

            eventBus.emit('obs:set-visibility', {
                sceneName: 'MainScene',
                sourceName: 'Statusbar',
                visible: true
            });

            await waitForDelay(10);

            expect(visibilityHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    sceneName: 'MainScene',
                    sourceName: 'Statusbar',
                    visible: true,
                    success: true
                })
            );
        });
    });

    describe('Scene Events', () => {
        test('emits obs:scene:switched when scene change is requested', async () => {
            mockOBSConnection.call.mockResolvedValueOnce({});
            const sceneSwitchedHandler = jest.fn();
            eventBus.subscribe('obs:scene:switched', sceneSwitchedHandler);

            eventBus.emit('obs:switch-scene', {
                sceneName: 'GameplayScene'
            });

            await waitForDelay(10);

            expect(sceneSwitchedHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    sceneName: 'GameplayScene',
                    success: true
                })
            );
        });

        test('emits obs:scene:error when scene switch fails', async () => {
            mockOBSConnection.call.mockRejectedValueOnce(new Error('Scene not found'));
            const errorHandler = jest.fn();
            eventBus.subscribe('obs:scene:error', errorHandler);

            eventBus.emit('obs:switch-scene', {
                sceneName: 'InvalidScene'
            });

            await waitForDelay(10);

            expect(errorHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    sceneName: 'InvalidScene',
                    error: expect.any(Error)
                })
            );
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
            const reconnectingHandler = jest.fn();
            eventBus.subscribe('obs:reconnecting', reconnectingHandler);

            // Simulate connection loss
            await obsEventService.connect();
            eventBus.emit('obs:connection-lost');

            await waitForDelay(100);

            expect(reconnectingHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    attempt: expect.any(Number)
                })
            );
        });

        test('emits obs:reconnected after successful reconnection', async () => {
            const reconnectedHandler = jest.fn();
            eventBus.subscribe('obs:reconnected', reconnectedHandler);

            // Simulate connection loss and recovery
            await obsEventService.connect();
            eventBus.emit('obs:connection-lost');
            await waitForDelay(100);

            expect(reconnectedHandler).toHaveBeenCalled();
        });

        test('emits obs:reconnect-failed after max reconnection attempts', async () => {
            const failedHandler = jest.fn();
            eventBus.subscribe('obs:reconnect-failed', failedHandler);

            // First establish a successful connection
            await obsEventService.connect();

            // Now make all future connection attempts fail
            mockOBSConnection.connect.mockRejectedValue(new Error('Connection refused'));

            // Simulate connection loss
            eventBus.emit('obs:connection-lost');

            // Wait for all reconnection attempts to complete
            // 3 attempts with exponential backoff: 10ms, 20ms, 40ms = ~100ms total
            await waitForDelay(200);

            expect(failedHandler).toHaveBeenCalled();
        });
    });

    describe('Performance Requirements', () => {
        test('handles text updates within 50ms latency', async () => {
            const startTime = Date.now();

            eventBus.emit('obs:update-text', {
                sourceName: 'ChatMessage',
                text: 'Performance Test'
            });

            await waitForDelay(10);

            const duration = Date.now() - startTime;
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
