const { describe, expect, it, afterEach, beforeEach } = require('bun:test');
const { createMockFn, spyOn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { createRuntimeConstantsFixture } = require('../helpers/config-fixture');

describe('main.js event handler wiring', () => {
    let processOnSpy;

    beforeEach(() => {
        processOnSpy = spyOn(process, 'on').mockImplementation(() => process);
    });

    afterEach(() => {
        processOnSpy.mockRestore();
        restoreAllMocks();
    });

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

    const baseConfig = {
        general: {
            streamDetectionEnabled: false,
            streamRetryInterval: 15,
            streamMaxRetries: 3,
            continuousMonitoringInterval: 60000
        }
    };

    it('rejects construction when EventBus is unavailable', () => {
        const { AppRuntime } = require('../../src/main.js');
        expect(() => new AppRuntime(baseConfig, createDeps({ eventBus: null })))
            .toThrow('AppRuntime missing required dependencies');
    });
});
