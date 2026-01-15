
const { describe, test, beforeEach, afterEach, expect } = require('bun:test');
const { clearAllMocks, createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');

const { TEST_TIMEOUTS } = require('../helpers/test-setup');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');
const { AppRuntime } = require('../../src/main');
const { createAppRuntimeTestDependencies } = require('../helpers/runtime-test-harness');
const path = require('path');
const { safeDelay } = require('../../src/utils/timeout-validator');
const { PlatformEvents } = require('../../src/interfaces/PlatformEvents');

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

// OBS auto-mocks in test environment (see src/obs/connection.js line 45-56)

describe('AppRuntime VFXCommandService Lifecycle Management', () => {
    let runtime;
    let config;

    beforeEach(() => {
        clearAllMocks();

        // Minimal config for VFX testing
        config = {
            general: {
                greetingsEnabled: true,
                streamDetectionEnabled: false,
                streamRetryInterval: 15,
                streamMaxRetries: 3,
                continuousMonitoringInterval: 60000
            },
            vfx: {
                filePath: path.join(__dirname, '../../test-assets/vfx')
            },
            commands: {
                'hello': '!hello, vfx bottom green'
            }
        };
    });

    afterEach(async () => {
        if (runtime && typeof runtime.stop === 'function') {
            await runtime.stop();
        }
        restoreAllMocks();
    });

    describe('VFXCommandService Initialization', () => {
        test('should initialize VFXCommandService during AppRuntime startup', async () => {
            // GIVEN: AppRuntime with VFX configuration
            const { dependencies } = createAppRuntimeTestDependencies();
            runtime = new AppRuntime(config, dependencies);

            // WHEN: AppRuntime starts
            await runtime.start();

            // THEN: VFXCommandService should be available
            expect(runtime.vfxCommandService).toBeDefined();
            expect(runtime.vfxCommandService).not.toBeNull();
            expect(typeof runtime.vfxCommandService.executeCommand).toBe('function');
        }, { timeout: TEST_TIMEOUTS.INTEGRATION });
    });

    describe('EventBus VFX Command Integration', () => {
        test('should execute VFX commands via EventBus', async () => {
            // GIVEN: Running AppRuntime with VFXCommandService
            const { dependencies } = createAppRuntimeTestDependencies();
            runtime = new AppRuntime(config, dependencies);
            await runtime.start();

            // Track VFX execution
            let vfxExecuted = false;
            const originalExecuteCommand = runtime.vfxCommandService.executeCommand;
            runtime.vfxCommandService.executeCommand = createMockFn(async (...args) => {
                vfxExecuted = true;
                return originalExecuteCommand.apply(runtime.vfxCommandService, args);
            });

            // WHEN: VFX command event is emitted
            runtime.eventBus.emit(PlatformEvents.VFX_COMMAND_RECEIVED, {
                command: '!hello',
                username: 'TestUser',
                platform: 'twitch',
                userId: 'test-123',
                context: { skipCooldown: true, correlationId: 'corr-1' }
            });

            // Allow async processing
            await new Promise(resolve => setImmediate(resolve));

            // THEN: VFX should execute
            expect(vfxExecuted).toBe(true);
        }, { timeout: TEST_TIMEOUTS.INTEGRATION });

        test('should handle VFX command errors gracefully', async () => {
            // GIVEN: Running AppRuntime
            const { dependencies } = createAppRuntimeTestDependencies();
            runtime = new AppRuntime(config, dependencies);
            await runtime.start();

            // Mock executeCommand to throw error
            runtime.vfxCommandService.executeCommand = createMockFn().mockRejectedValue(
                new Error('VFX execution failed')
            );

            // WHEN: VFX command event is emitted
            runtime.eventBus.emit(PlatformEvents.VFX_COMMAND_RECEIVED, {
                command: '!invalid',
                username: 'TestUser',
                platform: 'twitch',
                userId: 'user-1',
                context: { skipCooldown: true, correlationId: 'corr-2' }
            });

            // Allow async processing
            await new Promise(resolve => setImmediate(resolve));

            // THEN: System should continue (no crash)
            expect(runtime.vfxCommandService.executeCommand).toHaveBeenCalledTimes(1);
        }, { timeout: TEST_TIMEOUTS.INTEGRATION });

        test('should ignore events emitted by VFXCommandService to prevent recursion', async () => {
            // GIVEN: Running AppRuntime
            const { dependencies } = createAppRuntimeTestDependencies();
            runtime = new AppRuntime(config, dependencies);
            await runtime.start();

            // AND: Spy on executeCommand
            runtime.vfxCommandService.executeCommand = createMockFn();

            // WHEN: EventBus receives event sourced from VFX service
            runtime.eventBus.emit(PlatformEvents.VFX_COMMAND_RECEIVED, {
                command: '!hello',
                username: 'LoopTester',
                platform: 'tiktok',
                userId: 'user-2',
                source: 'vfx-service',
                context: { skipCooldown: true, correlationId: 'corr-3' }
            });

            await new Promise(resolve => setImmediate(resolve));

            // THEN: AppRuntime should ignore the event to avoid infinite loops
            expect(runtime.vfxCommandService.executeCommand).not.toHaveBeenCalled();
        }, { timeout: TEST_TIMEOUTS.INTEGRATION });

        test('processes VFX commands even when commandsEnabled is false (current behavior)', async () => {
            const { dependencies } = createAppRuntimeTestDependencies();
            const disabledConfig = {
                ...config,
                general: {
                    ...config.general,
                    commandsEnabled: false
                }
            };
            runtime = new AppRuntime(disabledConfig, dependencies);
            await runtime.start();

            runtime.vfxCommandService.executeCommand = createMockFn();

            runtime.eventBus.emit(PlatformEvents.VFX_COMMAND_RECEIVED, {
                command: '!hello',
                username: 'NoCmd',
                platform: 'twitch',
                userId: 'user-3',
                context: { skipCooldown: true, correlationId: 'corr-4' }
            });

            await new Promise(resolve => setImmediate(resolve));

            expect(runtime.vfxCommandService.executeCommand).toHaveBeenCalledTimes(1);
        }, { timeout: TEST_TIMEOUTS.INTEGRATION });

        test('should continue processing VFX when commands are enabled', async () => {
            const { dependencies } = createAppRuntimeTestDependencies();
            runtime = new AppRuntime(config, dependencies);
            await runtime.start();

            runtime.vfxCommandService.executeCommand = createMockFn().mockResolvedValue({ success: true });

            runtime.eventBus.emit(PlatformEvents.VFX_COMMAND_RECEIVED, {
                command: '!hello',
                username: 'CmdUser',
                platform: 'twitch',
                userId: 'user-4',
                context: { skipCooldown: true, correlationId: 'corr-5' }
            });

            await new Promise(resolve => setImmediate(resolve));

            expect(runtime.vfxCommandService.executeCommand).toHaveBeenCalledTimes(1);
        }, { timeout: TEST_TIMEOUTS.INTEGRATION });

        test('ignores VFX events already sourced from eventbus to avoid recursion', async () => {
            const { dependencies } = createAppRuntimeTestDependencies();
            runtime = new AppRuntime(config, dependencies);
            await runtime.start();

            runtime.vfxCommandService.executeCommand = createMockFn();

            runtime.eventBus.emit(PlatformEvents.VFX_COMMAND_RECEIVED, {
                command: '!hello',
                username: 'LoopUser',
                platform: 'twitch',
                source: 'eventbus',
                userId: 'user-5',
                context: { skipCooldown: true, correlationId: 'corr-6' }
            });

            await new Promise(resolve => setImmediate(resolve));

            expect(runtime.vfxCommandService.executeCommand).not.toHaveBeenCalled();
        }, { timeout: TEST_TIMEOUTS.INTEGRATION });

        test('ignores VFX events sourced from vfx-service to avoid recursion', async () => {
            const { dependencies } = createAppRuntimeTestDependencies();
            runtime = new AppRuntime(config, dependencies);
            await runtime.start();

            runtime.vfxCommandService.executeCommand = createMockFn();

            runtime.eventBus.emit(PlatformEvents.VFX_COMMAND_RECEIVED, {
                command: '!hello',
                username: 'LoopUser',
                platform: 'twitch',
                source: 'vfx-service',
                userId: 'user-6',
                context: { skipCooldown: true, correlationId: 'corr-7' }
            });

            await new Promise(resolve => setImmediate(resolve));

            expect(runtime.vfxCommandService.executeCommand).not.toHaveBeenCalled();
        }, { timeout: TEST_TIMEOUTS.INTEGRATION });

        test('gracefully skips when VFXCommandService is unavailable', async () => {
            const { dependencies } = createAppRuntimeTestDependencies();
            runtime = new AppRuntime(config, dependencies);
            await runtime.start();

            // Simulate missing VFX service (e.g., initialization failure)
            runtime.vfxCommandService = null;

            runtime.eventBus.emit(PlatformEvents.VFX_COMMAND_RECEIVED, {
                command: '!hello',
                username: 'NoService',
                platform: 'tiktok',
                userId: 'user-7',
                context: { skipCooldown: true, correlationId: 'corr-8' }
            });

            await new Promise(resolve => setImmediate(resolve));

            // No VFX service means nothing executes, but handler should not crash
            expect(runtime.vfxCommandService).toBeNull();
        }, { timeout: TEST_TIMEOUTS.INTEGRATION });

        test('handles VFX events with no command payload without crashing', async () => {
            const { dependencies } = createAppRuntimeTestDependencies();
            runtime = new AppRuntime(config, dependencies);
            await runtime.start();

            runtime.vfxCommandService.executeCommand = createMockFn();
            runtime.vfxCommandService.executeCommandForKey = createMockFn();

            runtime.eventBus.emit(PlatformEvents.VFX_COMMAND_RECEIVED, {
                username: 'NoCommand',
                platform: 'youtube',
                userId: 'user-8',
                context: { skipCooldown: true, correlationId: 'corr-9' }
            });

            await new Promise(resolve => setImmediate(resolve));

            expect(runtime.vfxCommandService.executeCommand).not.toHaveBeenCalled();
            expect(runtime.vfxCommandService.executeCommandForKey).not.toHaveBeenCalled();
        }, { timeout: TEST_TIMEOUTS.INTEGRATION });

        test('executes commandKey branch when command is absent', async () => {
            const { dependencies } = createAppRuntimeTestDependencies();
            runtime = new AppRuntime(config, dependencies);
            await runtime.start();

            runtime.vfxCommandService.executeCommand = createMockFn();
            runtime.vfxCommandService.executeCommandForKey = createMockFn().mockResolvedValue({ success: true });

            runtime.eventBus.emit(PlatformEvents.VFX_COMMAND_RECEIVED, {
                commandKey: 'gifts',
                username: 'KeyUser',
                platform: 'youtube',
                userId: 'user-42',
                context: { skipCooldown: true, correlationId: 'corr-10' }
            });

            await new Promise(resolve => setImmediate(resolve));

            expect(runtime.vfxCommandService.executeCommand).not.toHaveBeenCalled();
            expect(runtime.vfxCommandService.executeCommandForKey).toHaveBeenCalledWith('gifts', expect.objectContaining({
                username: 'KeyUser',
                platform: 'youtube',
                userId: 'user-42',
                source: 'eventbus',
                skipCooldown: true,
                correlationId: 'corr-10'
            }));
        }, { timeout: TEST_TIMEOUTS.INTEGRATION });

        test('processes commandKey events even when commandsEnabled is false (current behavior)', async () => {
            const { dependencies } = createAppRuntimeTestDependencies();
            const disabledConfig = {
                ...config,
                general: { ...config.general, commandsEnabled: false }
            };
            runtime = new AppRuntime(disabledConfig, dependencies);
            await runtime.start();

            runtime.vfxCommandService.executeCommandForKey = createMockFn().mockResolvedValue({ success: true });

            runtime.eventBus.emit(PlatformEvents.VFX_COMMAND_RECEIVED, {
                commandKey: 'gifts',
                username: 'DisabledKeyUser',
                platform: 'tiktok',
                userId: 'user-99',
                context: { skipCooldown: true, correlationId: 'corr-11' }
            });

            await new Promise(resolve => setImmediate(resolve));

            expect(runtime.vfxCommandService.executeCommandForKey).toHaveBeenCalledTimes(1);
            expect(runtime.vfxCommandService.executeCommandForKey).toHaveBeenCalledWith('gifts', expect.objectContaining({
                username: 'DisabledKeyUser',
                platform: 'tiktok',
                userId: 'user-99',
                source: 'eventbus',
                skipCooldown: true,
                correlationId: 'corr-11'
            }));
        }, { timeout: TEST_TIMEOUTS.INTEGRATION });
    });

    describe('AppRuntime Lifecycle Management', () => {
        test('should maintain VFXCommandService throughout AppRuntime lifecycle', async () => {
            // GIVEN: AppRuntime startup
            const { dependencies } = createAppRuntimeTestDependencies();
            runtime = new AppRuntime(config, dependencies);
            await runtime.start();

            const vfxServiceBeforeStop = runtime.vfxCommandService;

            // WHEN: AppRuntime lifecycle continues
            // (simulate runtime operation)
            await safeDelay(100);

            // THEN: VFXCommandService should remain available
            expect(runtime.vfxCommandService).toBe(vfxServiceBeforeStop);
            expect(runtime.vfxCommandService).toBeDefined();
        }, { timeout: TEST_TIMEOUTS.INTEGRATION });
    });
});
