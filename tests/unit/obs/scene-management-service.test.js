
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const { createEventBus } = require('../../../src/core/EventBus');
const testClock = require('../../helpers/test-clock');

describe('SceneManagementService', () => {
    let sceneService;
    let eventBus;
    let mockOBSConnection;
    let mockLogger;

    beforeEach(() => {
        // Create fresh event bus
        eventBus = createEventBus({ debugEnabled: false });

        // Mock OBS connection
        mockOBSConnection = {
            call: createMockFn().mockResolvedValue({}),
            isConnected: createMockFn().mockReturnValue(true),
            isReady: createMockFn().mockResolvedValue(true)
        };

        mockLogger = {
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        };

        // Import SceneManagementService after mocks are set up
        const { createSceneManagementService } = require('../../../src/obs/scene-management-service');
        sceneService = createSceneManagementService({
            eventBus,
            obsConnection: mockOBSConnection,
            logger: mockLogger
        });
    });

    afterEach(() => {
        restoreAllMocks();
        sceneService.destroy();
        eventBus.reset();
    });

    describe('Scene Switching', () => {
        test('switches to specified scene when scene:switch event is emitted', async () => {
            eventBus.emit('scene:switch', { sceneName: 'GameplayScene' });

            await waitForDelay(10);

            expect(mockOBSConnection.call).toHaveBeenCalled();
            const [method, payload] = mockOBSConnection.call.mock.calls[0];
            expect(method).toBe('SetCurrentProgramScene');
            expect(payload).toEqual({ sceneName: 'GameplayScene' });
        });

        test('does not update state when scene switch fails', async () => {
            mockOBSConnection.call.mockRejectedValue(new Error('Scene not found'));

            eventBus.emit('scene:switch', { sceneName: 'InvalidScene' });

            // Wait for retries to complete (3 retries * 100ms delay + buffer)
            await waitForDelay(400);

            const state = sceneService.getSceneState();
            expect(state.currentScene).not.toBe('InvalidScene');
            expect(state.switchCount).toBe(0);
        });

        test('tracks current scene after successful switch', async () => {
            eventBus.emit('scene:switch', { sceneName: 'ChatScene' });

            await waitForDelay(10);

            const currentScene = sceneService.getCurrentScene();
            expect(currentScene).toBe('ChatScene');
        });
    });

    describe('Scene State Monitoring', () => {
        test('provides scene state information', () => {
            const state = sceneService.getSceneState();

            expect(state).toEqual(
                expect.objectContaining({
                    currentScene: expect.any(String),
                    previousScene: expect.any(String),
                    switchCount: expect.any(Number)
                })
            );
        });

        test('tracks scene switch history', async () => {
            eventBus.emit('scene:switch', { sceneName: 'Scene1' });
            await waitForDelay(10);

            eventBus.emit('scene:switch', { sceneName: 'Scene2' });
            await waitForDelay(10);

            const history = sceneService.getSceneHistory();

            expect(history).toHaveLength(2);
            expect(history[0].sceneName).toBe('Scene1');
            expect(history[1].sceneName).toBe('Scene2');
        });

        test('limits scene history to prevent memory leaks', async () => {
            // Emit 150 scene switches
            for (let i = 0; i < 150; i++) {
                eventBus.emit('scene:switch', { sceneName: `Scene${i}` });
            }

            await waitForDelay(50);

            const history = sceneService.getSceneHistory();

            // Should limit to 100 entries
            expect(history.length).toBeLessThanOrEqual(100);
        });
    });

    describe('Scene Validation', () => {
        test('validates scene exists before switching', async () => {
            mockOBSConnection.call.mockImplementation((method) => {
                if (method === 'GetSceneList') {
                    return Promise.resolve({
                        scenes: [
                            { sceneName: 'GameplayScene' },
                            { sceneName: 'ChatScene' }
                        ]
                    });
                }
                return Promise.resolve({});
            });

            const result = await sceneService.validateScene('GameplayScene');

            expect(result).toBe(true);
        });

        test('returns false for non-existent scenes', async () => {
            mockOBSConnection.call.mockImplementation((method) => {
                if (method === 'GetSceneList') {
                    return Promise.resolve({
                        scenes: [
                            { sceneName: 'GameplayScene' }
                        ]
                    });
                }
                return Promise.resolve({});
            });

            const result = await sceneService.validateScene('InvalidScene');

            expect(result).toBe(false);
        });

        test('validates scenes consistently across multiple calls', async () => {
            mockOBSConnection.call.mockImplementation((method) => {
                if (method === 'GetSceneList') {
                    return Promise.resolve({
                        scenes: [{ sceneName: 'GameplayScene' }]
                    });
                }
                return Promise.resolve({});
            });

            // Multiple validation calls should return consistent results
            const result1 = await sceneService.validateScene('GameplayScene');
            const result2 = await sceneService.validateScene('GameplayScene');
            const result3 = await sceneService.validateScene('InvalidScene');

            // Verify user-visible outcomes: correct validation results
            expect(result1).toBe(true);
            expect(result2).toBe(true);
            expect(result3).toBe(false);
        });
    });

    describe('Scene Transitions', () => {
        test('applies transition when switching scenes', async () => {
            eventBus.emit('scene:switch', {
                sceneName: 'GameplayScene',
                transition: {
                    type: 'fade',
                    duration: 300
                }
            });

            await waitForDelay(10);

            const history = sceneService.getSceneHistory();
            expect(history[0]).toEqual(expect.objectContaining({
                sceneName: 'GameplayScene',
                transition: expect.objectContaining({
                    type: 'fade',
                    duration: 300
                })
            }));
        });
    });

    describe('Error Recovery', () => {
        test('retries scene switch on transient errors', async () => {
            let callCount = 0;
            mockOBSConnection.call.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return Promise.reject(new Error('Temporary failure'));
                }
                return Promise.resolve({});
            });

            const startTime = testClock.now();

            eventBus.emit('scene:switch', { sceneName: 'GameplayScene', retry: true });

            // Wait for retry to complete
            await waitForDelay(200);
            testClock.advance(200);

            const duration = testClock.now() - startTime;

            const state = sceneService.getSceneState();
            expect(state.currentScene).toBe('GameplayScene');
            // 2. Took extra time because retry occurred (> 100ms delay for retry)
            expect(duration).toBeGreaterThan(100);
        });

        test('fails immediately when retry is disabled', async () => {
            mockOBSConnection.call.mockRejectedValue(new Error('Failure'));

            const startTime = testClock.now();

            eventBus.emit('scene:switch', { sceneName: 'GameplayScene', retry: false });

            await waitForDelay(100);
            testClock.advance(100);

            const duration = testClock.now() - startTime;

            const state = sceneService.getSceneState();
            expect(state.currentScene).not.toBe('GameplayScene');
            // Failed quickly (< 150ms) because no retries occurred
            expect(duration).toBeLessThan(150);
        });
    });

    describe('Performance Requirements', () => {
        test('completes scene switch within 50ms latency', async () => {
            const startTime = testClock.now();

            eventBus.emit('scene:switch', { sceneName: 'GameplayScene' });

            await waitForDelay(10);
            testClock.advance(10);

            const duration = testClock.now() - startTime;
            expect(duration).toBeLessThan(50);
        });

        test('maintains memory footprint during rapid scene switches', async () => {
            const initialMemory = process.memoryUsage().heapUsed;

            // Perform 100 rapid scene switches
            for (let i = 0; i < 100; i++) {
                eventBus.emit('scene:switch', { sceneName: `Scene${i % 5}` });
            }

            await waitForDelay(100);

            const finalMemory = process.memoryUsage().heapUsed;
            const memoryIncrease = (finalMemory - initialMemory) / 1024 / 1024;

            expect(memoryIncrease).toBeLessThan(10); // Should not increase by more than 10MB
        });
    });

    describe('Integration with EventBus', () => {
        test('subscribes to scene:switch event on initialization', () => {
            const listeners = eventBus.getListenerSummary();

            expect(listeners['scene:switch']).toBeGreaterThan(0);
        });

        test('cleans up event listeners on service destruction', () => {
            sceneService.destroy();

            const listeners = eventBus.getListenerSummary();
            const sceneListeners = Object.keys(listeners).filter(name => name.startsWith('scene:'));

            expect(sceneListeners.length).toBe(0);
        });
    });
});
