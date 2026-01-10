
const mockErrorHandler = {
    handleEventProcessingError: jest.fn(),
    logOperationalError: jest.fn()
};

jest.mock('../../src/core/logging', () => {
    const logger = {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    };
    return {
        logger,
        getLogger: jest.fn(() => logger),
        getUnifiedLogger: jest.fn(() => logger),
        initializeLoggingConfig: jest.fn(),
        initializeConsoleOverride: jest.fn(),
        setConfigValidator: jest.fn(),
        setDebugMode: jest.fn()
    };
});

jest.mock('../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: jest.fn(() => mockErrorHandler)
}));

const mockWireStreamStatusHandlers = jest.fn(() => jest.fn());
jest.mock('../../src/viewer-count/stream-status-handler', () => mockWireStreamStatusHandlers);

// Keep heavy dependencies lean for behavior tests
jest.mock('../../src/services/PlatformEventRouter', () => jest.fn(() => ({})));
jest.mock('../../src/services/ChatNotificationRouter', () => jest.fn(() => ({})));
jest.mock('../../src/chat/commands', () => ({
    CommandParser: jest.fn(() => ({}))
}));

const { createRuntimeConstantsFixture } = require('../helpers/runtime-constants-fixture');
const { PlatformEvents } = require('../../src/interfaces/PlatformEvents');

describe('main.js event handler wiring', () => {
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
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            console: jest.fn()
        },
        notificationManager: overrides.notificationManager || { handleNotification: jest.fn() },
        displayQueue: overrides.displayQueue || { addItem: jest.fn() },
        eventBus: overrides.eventBus !== undefined ? overrides.eventBus : {
            subscribe: jest.fn(),
            emit: jest.fn(),
            unsubscribe: jest.fn()
        },
        configService: overrides.configService || {},
        vfxCommandService: overrides.vfxCommandService || { executeCommandForKey: jest.fn().mockResolvedValue({ success: true }) },
        ttsService: overrides.ttsService || { speak: jest.fn().mockResolvedValue({ success: true }) },
        userTrackingService: overrides.userTrackingService || { isFirstMessage: jest.fn().mockResolvedValue(false) },
        commandCooldownService: overrides.commandCooldownService || { updateCooldown: jest.fn() },
        platformLifecycleService: overrides.platformLifecycleService || { getAllPlatforms: jest.fn(() => ({})) },
        dependencyFactory: overrides.dependencyFactory || { createYoutubeDependencies: jest.fn(() => ({})) },
        runtimeConstants: overrides.runtimeConstants || createRuntimeConstantsFixture(),
        authManager: overrides.authManager || {},
        obsEventService: overrides.obsEventService || {},
        sceneManagementService: overrides.sceneManagementService || {}
    });

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        mockWireStreamStatusHandlers.mockReturnValue(jest.fn());
    });

    it('rejects construction when EventBus is unavailable', () => {
        const processOnSpy = jest.spyOn(process, 'on').mockImplementation(() => process);

        const { AppRuntime } = require('../../src/main.js');
        expect(() => new AppRuntime(baseConfig, createDeps({ eventBus: null })))
            .toThrow('AppRuntime missing required dependencies');

        processOnSpy.mockRestore();
    });

    it('wires stream status handlers when EventBus is available', () => {
        const processOnSpy = jest.spyOn(process, 'on').mockImplementation(() => process);

        const cleanupSpy = jest.fn();
        mockWireStreamStatusHandlers.mockReturnValue(cleanupSpy);

        const eventBus = { subscribe: jest.fn() };
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
        const processOnSpy = jest.spyOn(process, 'on').mockImplementation(() => process);

        const { AppRuntime } = require('../../src/main.js');
        const deps = createDeps();
        expect(() => new AppRuntime(baseConfig, deps)).not.toThrow();

        processOnSpy.mockRestore();
    });

    it('routes event handler failures through platform error handler', async () => {
        const processOnSpy = jest.spyOn(process, 'on').mockImplementation(() => process);

        const handlers = {};
        const eventBus = {
            subscribe: jest.fn((event, handler) => {
                handlers[event] = handler;
            })
        };
        const vfxCommandService = {
            executeCommand: jest.fn(() => {
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
        const processOnSpy = jest.spyOn(process, 'on').mockImplementation(() => process);

        const { AppRuntime } = require('../../src/main.js');
        const bot = new AppRuntime(baseConfig, createDeps());

        bot.handleGiftNotification = jest.fn(() => {
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
