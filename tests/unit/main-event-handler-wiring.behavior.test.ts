const { describe, expect, it, afterEach, beforeEach } = require('bun:test');
const { createMockFn, spyOn, restoreAllMocks } = require('../helpers/bun-mock-utils');

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
        config: overrides.config || {},
        vfxCommandService: overrides.vfxCommandService || { executeCommandForKey: createMockFn().mockResolvedValue({ success: true }) },
        userTrackingService: overrides.userTrackingService || { isFirstMessage: createMockFn().mockResolvedValue(false) },
        commandParser: overrides.commandParser !== undefined ? overrides.commandParser : { getVFXConfig: createMockFn() },
        commandCooldownService: overrides.commandCooldownService || { updateCooldown: createMockFn() },
        platformLifecycleService: overrides.platformLifecycleService || { getAllPlatforms: createMockFn(() => ({})) },
        dependencyFactory: overrides.dependencyFactory || { createYoutubeDependencies: createMockFn(() => ({})) },
        twitchAuth: overrides.twitchAuth || null,
        obsEventService: overrides.obsEventService || {},
        sceneManagementService: overrides.sceneManagementService || {}
    });

    const baseConfig = { general: {} };

    it('rejects construction when EventBus is unavailable', () => {
        const { AppRuntime } = require('../../src/main.ts');
        expect(() => new AppRuntime(baseConfig, createDeps({ eventBus: null })))
            .toThrow('AppRuntime missing required dependencies');
    });

});
