
const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, spyOn, clearAllMocks, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { mockModule, resetModules, restoreAllModuleMocks } = require('../helpers/bun-module-mocks');

const mockErrorHandler = {
    handleEventProcessingError: createMockFn(),
    logOperationalError: createMockFn()
};

mockModule('../../src/core/logging', () => {
    const logger = {
        debug: createMockFn(),
        info: createMockFn(),
        warn: createMockFn(),
        error: createMockFn()
    };
    return {
        logger,
        getLogger: createMockFn(() => logger),
        getUnifiedLogger: createMockFn(() => logger),
        initializeLoggingConfig: createMockFn(),
        initializeConsoleOverride: createMockFn(),
        setConfigValidator: createMockFn(),
        setDebugMode: createMockFn()
    };
});

mockModule('../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: createMockFn(() => mockErrorHandler)
}));

const mockWireStreamStatusHandlers = createMockFn(() => createMockFn());
mockModule('../../src/viewer-count/stream-status-handler', () => mockWireStreamStatusHandlers);

// Keep heavy dependencies lean for behavior tests
mockModule('../../src/services/PlatformEventRouter', () => createMockFn(() => ({})));
mockModule('../../src/services/ChatNotificationRouter', () => createMockFn(() => ({})));
mockModule('../../src/chat/commands', () => ({
    CommandParser: createMockFn(() => ({}))
}));

const { createRuntimeConstantsFixture } = require('../helpers/runtime-constants-fixture');
const { PlatformEvents } = require('../../src/interfaces/PlatformEvents');

describe('main.js event handler wiring', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    const baseConfig = {
        general: {
            streamDetectionEnabled: false,
            streamRetryInterval: 15,
            streamMaxRetries: 3,
            continuousMonitoringInterval: 60000
        }
    };

    const createDeps = (overrides = {}) => ({
        logging: {
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn(),
            console: createMockFn()
        },
        notificationManager: overrides.notificationManager || { handleNotification: createMockFn() },
        displayQueue: overrides.displayQueue || { addItem: createMockFn() },
        eventBus: overrides.eventBus !== undefined ? overrides.eventBus : {
            subscribe: createMockFn(),
            emit: createMockFn(),
            unsubscribe: createMockFn()
        },
        configService: overrides.configService || {},
        vfxCommandService: overrides.vfxCommandService || { executeCommandForKey: createMockFn().mockResolvedValue({ success: true }) },
        ttsService: overrides.ttsService || { speak: createMockFn().mockResolvedValue({ success: true }) },
        userTrackingService: overrides.userTrackingService || { isFirstMessage: createMockFn().mockResolvedValue(false) },
        commandCooldownService: overrides.commandCooldownService || { updateCooldown: createMockFn() },
        platformLifecycleService: overrides.platformLifecycleService || { getAllPlatforms: createMockFn(() => ({})) },
        dependencyFactory: overrides.dependencyFactory || { createYoutubeDependencies: createMockFn(() => ({})) },
        runtimeConstants: overrides.runtimeConstants || createRuntimeConstantsFixture(),
        authManager: overrides.authManager || {},
        obsEventService: overrides.obsEventService || {},
        sceneManagementService: overrides.sceneManagementService || {}
    });

    beforeEach(() => {
        resetModules();
        mockWireStreamStatusHandlers.mockReturnValue(createMockFn());
    });

    it('rejects construction when EventBus is unavailable', () => {
        const processOnSpy = spyOn(process, 'on').mockImplementation(() => process);

        const { AppRuntime } = require('../../src/main.js');
        expect(() => new AppRuntime(baseConfig, createDeps({ eventBus: null })))
            .toThrow('AppRuntime missing required dependencies');

        processOnSpy.mockRestore();
    });

    it('wires stream status handlers when EventBus is available', () => {
        const processOnSpy = spyOn(process, 'on').mockImplementation(() => process);

        const cleanupSpy = createMockFn();
        mockWireStreamStatusHandlers.mockReturnValue(cleanupSpy);

        const eventBus = { subscribe: createMockFn() };
        const { AppRuntime } = require('../../src/main.js');
        const bot = new AppRuntime(baseConfig, createDeps({ eventBus }));

        expect(mockWireStreamStatusHandlers).toHaveBeenCalledWith({
            eventBus,
            viewerCountSystem: bot.viewerCountSystem,
            logger: expect.any(Object)
        });
        expect(bot.viewerCountStatusCleanup).toBe(cleanupSpy);

        processOnSpy.mockRestore();
    });

    it('constructs without event logging or error handling services', () => {
        const processOnSpy = spyOn(process, 'on').mockImplementation(() => process);

        const { AppRuntime } = require('../../src/main.js');
        const deps = createDeps();
        expect(() => new AppRuntime(baseConfig, deps)).not.toThrow();

        processOnSpy.mockRestore();
    });

    it('routes event handler failures through platform error handler', async () => {
        const processOnSpy = spyOn(process, 'on').mockImplementation(() => process);

        const handlers = {};
        const eventBus = {
            subscribe: createMockFn((event, handler) => {
                handlers[event] = handler;
            })
        };
        const vfxCommandService = {
            executeCommand: createMockFn(() => {
                throw new Error('vfx failure');
            })
        };

        const { AppRuntime } = require('../../src/main.js');
        new AppRuntime(baseConfig, createDeps({ eventBus, vfxCommandService }));

        expect(eventBus.subscribe).toHaveBeenCalledWith(PlatformEvents.VFX_COMMAND_RECEIVED, expect.any(Function));

        await expect(handlers[PlatformEvents.VFX_COMMAND_RECEIVED]({
            command: '!boom',
            platform: 'twitch',
            username: 'alice',
            userId: 'user-1',
            context: { skipCooldown: true, correlationId: 'corr-1' }
        })).resolves.toBeUndefined();

        expect(mockErrorHandler.handleEventProcessingError).toHaveBeenCalledTimes(1);
        const [errorArg, eventType, payload, message, logContext] = mockErrorHandler.handleEventProcessingError.mock.calls[0];
        expect(errorArg).toBeInstanceOf(Error);
        expect(message).toContain('Error executing VFX command');
        expect(eventType).toBe('event-handler');
        expect(logContext).toBe('AppRuntime');
        expect(payload).toEqual(expect.objectContaining({ event: expect.objectContaining({ command: '!boom' }) }));

        processOnSpy.mockRestore();
    });

    it('routes envelope handler failures without crashing', async () => {
        const processOnSpy = spyOn(process, 'on').mockImplementation(() => process);

        const { AppRuntime } = require('../../src/main.js');
        const bot = new AppRuntime(baseConfig, createDeps());

        bot.handleGiftNotification = createMockFn(() => {
            throw new Error('envelope failure');
        });

        await expect(bot.handleEnvelopeNotification('tiktok', {
            userId: 'enveloper-id',
            uniqueId: 'enveloper',
            coins: 42
        })).resolves.toBeUndefined();

        expect(mockErrorHandler.handleEventProcessingError).toHaveBeenCalledTimes(1);
        const [errorArg, eventType, payload, message, logContext] = mockErrorHandler.handleEventProcessingError.mock.calls[0];
        expect(errorArg).toBeInstanceOf(Error);
        expect(message).toContain('Error handling envelope notification');
        expect(eventType).toBe('notification');
        expect(logContext).toBe('tiktok');
        expect(payload).toEqual(expect.objectContaining({ platform: 'tiktok' }));

        processOnSpy.mockRestore();
    });

});
