jest.mock('../../src/core/logging', () => ({
    setConfigValidator: jest.fn(),
    setDebugMode: jest.fn(),
    initializeLoggingConfig: jest.fn(),
    initializeConsoleOverride: jest.fn(),
    logger: {
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    },
    getLogger: jest.fn(() => ({
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn()
    }))
}));

const { AppRuntime } = require('../../src/main');

describe('AppRuntime system readiness payload', () => {
    const createAppRuntimeDouble = () => {
        const bot = Object.create(AppRuntime.prototype);
        bot.eventBus = {
            emit: jest.fn()
        };
        bot.getReadyServices = jest.fn().mockReturnValue(['notificationManager', 'platformLifecycleService']);
        return bot;
    };

    it('omits monitoring metrics when emitting system:ready', () => {
        const runtime = createAppRuntimeDouble();
        runtime.platformLifecycleService = {
            getStatus: jest.fn().mockReturnValue({ initializedPlatforms: ['twitch'] })
        };
        runtime.commandCooldownService = {
            getStatus: jest.fn().mockReturnValue({ activeUsers: 3 })
        };

        runtime.emitSystemReady({ correlationId: 'startup-1' });

        expect(runtime.eventBus.emit).toHaveBeenCalledWith(
            'system:ready',
            expect.objectContaining({
                services: ['notificationManager', 'platformLifecycleService'],
                platforms: { initializedPlatforms: ['twitch'] },
                cooldowns: { activeUsers: 3 },
                correlationId: 'startup-1'
            })
        );

        const [, payload] = runtime.eventBus.emit.mock.calls[0];
        expect(payload.monitoring).toBeUndefined();
    });

    it('throws when EventBus is unavailable', () => {
        const runtime = createAppRuntimeDouble();
        runtime.eventBus = null;

        expect(() => runtime.emitSystemReady({ correlationId: 'noop' })).toThrow('EventBus emit unavailable for system:ready');
    });
});

describe('AppRuntime shutdown lifecycle', () => {
    const createAppRuntimeDouble = () => {
        const bot = Object.create(AppRuntime.prototype);
        bot.eventBus = {
            emit: jest.fn()
        };
        bot.logger = {
            info: jest.fn(),
            error: jest.fn(),
            debug: jest.fn()
        };
        return bot;
    };

    it('emits system:shutdown and restart events when restart requested', () => {
        const runtime = createAppRuntimeDouble();
        runtime.emitSystemShutdown({ reason: 'test', restartRequested: true });

        expect(runtime.eventBus.emit).toHaveBeenCalledWith(
            'system:shutdown',
            expect.objectContaining({
                reason: 'test',
                restartRequested: true
            })
        );
        expect(runtime.eventBus.emit).toHaveBeenCalledWith(
            'service:restart-requested',
            expect.objectContaining({
                reason: 'test'
            })
        );
    });
});
