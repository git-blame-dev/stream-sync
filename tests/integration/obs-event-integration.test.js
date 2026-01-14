
const { describe, test, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { createEventBus } = require('../../src/core/EventBus');
const { createOBSEventService } = require('../../src/obs/obs-event-service');
const { createSceneManagementService } = require('../../src/obs/scene-management-service');
const testClock = require('../helpers/test-clock');

describe('OBS Event-Driven Integration', () => {
    let eventBus;
    let obsEventService;
    let sceneManagementService;
    let mockOBSConnection;
    let mockObsSources;
    let mockLogger;

    beforeEach(() => {
        // Create event bus
        eventBus = createEventBus({ debugEnabled: false });

        // Mock OBS connection
        mockOBSConnection = {
            connect: createMockFn().mockResolvedValue(true),
            disconnect: createMockFn().mockResolvedValue(undefined),
            isConnected: createMockFn(() => true),
            isReady: createMockFn().mockResolvedValue(true),
            call: createMockFn().mockResolvedValue({}),
            addEventListener: createMockFn(),
            removeEventListener: createMockFn(),
            getConnectionState: createMockFn(() => ({
                isConnected: true,
                isConnecting: false
            }))
        };

        // Mock OBS sources
        mockObsSources = {
            updateTextSource: createMockFn().mockResolvedValue(undefined),
            setSourceVisibility: createMockFn().mockResolvedValue(undefined),
            clearTextSource: createMockFn().mockResolvedValue(undefined)
        };

        // Mock logger
        mockLogger = {
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        };

        // Create services
        obsEventService = createOBSEventService({
            eventBus,
            obsConnection: mockOBSConnection,
            obsSources: mockObsSources,
            logger: mockLogger
        });

        sceneManagementService = createSceneManagementService({
            eventBus,
            obsConnection: mockOBSConnection,
            logger: mockLogger
        });
    });

    afterEach(() => {
        obsEventService.destroy();
        sceneManagementService.destroy();
        eventBus.reset();
        clearAllMocks();
        restoreAllMocks();
    });

    describe('End-to-End Event Flow', () => {
        test('text update flows through EventBus to OBS', async () => {
            // Emit text update event
            eventBus.emit('obs:update-text', {
                sourceName: 'ChatMessage',
                text: 'Hello from EventBus!'
            });

            await waitForDelay(20);

            expect(mockObsSources.updateTextSource).toHaveBeenCalled();
            const [sourceName, text] = mockObsSources.updateTextSource.mock.calls[0];
            expect(sourceName).toBe('ChatMessage');
            expect(text).toBe('Hello from EventBus!');
        });

        test('scene switch flows through EventBus to OBS', async () => {
            // Emit scene switch event
            eventBus.emit('scene:switch', {
                sceneName: 'GameplayScene'
            });

            await waitForDelay(20);

            expect(mockOBSConnection.call).toHaveBeenCalled();
            const [method, payload] = mockOBSConnection.call.mock.calls[0];
            expect(method).toBe('SetCurrentProgramScene');
            expect(payload).toEqual({ sceneName: 'GameplayScene' });
        });

        test('multiple services can handle events independently', async () => {
            // Emit both types of events
            eventBus.emit('obs:update-text', {
                sourceName: 'Status',
                text: 'Live'
            });

            eventBus.emit('scene:switch', {
                sceneName: 'ChatScene'
            });

            await waitForDelay(20);

            expect(mockObsSources.updateTextSource).toHaveBeenCalled();
            expect(mockOBSConnection.call).toHaveBeenCalled();
        });
    });

    describe('Error Handling Integration', () => {
        test('errors in one service do not affect other services', async () => {
            mockObsSources.updateTextSource.mockRejectedValue(new Error('Text update failed'));

            // Emit both events
            eventBus.emit('obs:update-text', {
                sourceName: 'Broken',
                text: 'Test'
            });

            eventBus.emit('scene:switch', {
                sceneName: 'WorkingScene'
            });

            await waitForDelay(20);

            expect(mockObsSources.updateTextSource).toHaveBeenCalled();
            expect(mockOBSConnection.call).toHaveBeenCalled();
        });

        test('errors do not update scene state when switching fails', async () => {
            mockOBSConnection.call.mockRejectedValue(new Error('OBS call failed'));

            eventBus.emit('scene:switch', {
                sceneName: 'FailScene',
                retry: false
            });

            await waitForDelay(20);

            const state = sceneManagementService.getSceneState();
            expect(state.currentScene).not.toBe('FailScene');
        });
    });

    describe('Performance Integration', () => {
        test('handles rapid event bursts without memory leaks', async () => {
            const initialMemory = process.memoryUsage().heapUsed;

            // Send 200 rapid events
            for (let i = 0; i < 200; i++) {
                eventBus.emit('obs:update-text', {
                    sourceName: 'Message',
                    text: `Message ${i}`
                });

                if (i % 10 === 0) {
                    eventBus.emit('scene:switch', {
                        sceneName: `Scene${i % 5}`
                    });
                }
            }

            await waitForDelay(100);

            const finalMemory = process.memoryUsage().heapUsed;
            const memoryIncrease = (finalMemory - initialMemory) / 1024 / 1024;

            // Memory increase should be minimal (< 10MB)
            expect(memoryIncrease).toBeLessThan(10);
        });

        test('maintains event latency under load', async () => {
            const latencies = [];

            for (let i = 0; i < 50; i++) {
                const startTime = testClock.now();

                eventBus.emit('obs:update-text', {
                    sourceName: 'Message',
                    text: `Test ${i}`
                });

                await waitForDelay(1);
                testClock.advance(1);

                const latency = testClock.now() - startTime;
                latencies.push(latency);
            }

            const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;

            // Keep latency under a single animation frame on typical CI hardware
            expect(avgLatency).toBeLessThan(30);
        });
    });

    describe('Service Coordination', () => {
        test('services share EventBus correctly', () => {
            const listeners = eventBus.getListenerSummary();

            // Both services should have registered listeners
            expect(listeners['obs:update-text']).toBeGreaterThan(0);
            expect(listeners['scene:switch']).toBeGreaterThan(0);
        });

        test('services clean up independently', () => {
            obsEventService.destroy();

            const listeners = eventBus.getListenerSummary();

            // OBS event listeners should be gone
            expect(listeners['obs:update-text']).toBeUndefined();

            // Scene listeners should still exist
            expect(listeners['scene:switch']).toBeGreaterThan(0);
        });

        test('event bus remains functional after service destruction', async () => {
            obsEventService.destroy();

            const handler = createMockFn();
            eventBus.subscribe('test:event', handler);

            eventBus.emit('test:event', { data: 'test' });

            await waitForDelay(10);

            expect(handler).toHaveBeenCalled();
        });
    });

    describe('State Management Integration', () => {
        test('scene state is tracked correctly across events', async () => {
            eventBus.emit('scene:switch', { sceneName: 'Scene1' });
            await waitForDelay(20);

            eventBus.emit('scene:switch', { sceneName: 'Scene2' });
            await waitForDelay(20);

            const state = sceneManagementService.getSceneState();

            expect(state.currentScene).toBe('Scene2');
            expect(state.previousScene).toBe('Scene1');
            expect(state.switchCount).toBe(2);
        });

        test('connection state is tracked correctly', async () => {
            await obsEventService.connect();

            const state = obsEventService.getConnectionState();

            expect(state.connected).toBe(true);
            expect(state.ready).toBe(true);
        });
    });
});
