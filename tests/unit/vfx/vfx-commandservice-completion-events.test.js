const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, resetModules, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

const { initializeTestLogging } = require('../../helpers/test-setup');
const { PlatformEvents } = require('../../../src/interfaces/PlatformEvents');

initializeTestLogging();

mockModule('../../../src/chat/commands', () => ({
    CommandParser: createMockFn(),
    runCommand: createMockFn().mockResolvedValue()
}));

describe('VFXCommandService completion events', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    let VFXCommandService;
    let eventBus;
    let recordedEvents;

    beforeEach(() => {
        resetModules();
        recordedEvents = [];
        eventBus = {
            emit: (name, payload) => recordedEvents.push({ name, payload })
        };

        ({ VFXCommandService } = require('../../../src/services/VFXCommandService'));
    });

    it('emits both executed and effect-completed with enriched payload', async () => {
        const configService = {
            get: createMockFn((section, key) => {
                if (section === 'commands') return { greetings: '!hello' };
                if (section === 'farewell') return {};
                if (section === 'vfx' && key === 'filePath') return '/tmp';
                if (section === 'general') return { cmdCoolDown: 60, globalCmdCooldownMs: 60000 };
                if (section === 'general' && key === 'cmdCoolDown') return 60;
                if (section === 'general' && key === 'globalCmdCooldownMs') return 60000;
                return undefined;
            }),
            getCommand: createMockFn(() => '!hello')
        };
        const service = new VFXCommandService(configService, eventBus);

        const vfxConfig = {
            commandKey: 'greetings',
            filename: 'hello',
            mediaSource: 'VFX Top',
            vfxFilePath: '/tmp',
            command: '!hello',
            duration: 5000
        };

        service.selectVFXCommand = createMockFn().mockResolvedValue(vfxConfig);

        await service.executeCommand('!hello', {
            username: 'Viewer',
            platform: 'twitch',
            userId: 'user-123',
            skipCooldown: true,
            notificationType: 'greeting',
            correlationId: 'corr-1'
        });

        const executedEvent = recordedEvents.find(e => e.name === PlatformEvents.VFX_COMMAND_EXECUTED);
        const completedEvent = recordedEvents.find(e => e.name === PlatformEvents.VFX_EFFECT_COMPLETED);

        expect(executedEvent).toBeDefined();
        expect(completedEvent).toBeDefined();

        const payload = completedEvent.payload;
        expect(payload.commandKey).toBe('greetings');
        expect(payload.filename).toBe('hello');
        expect(payload.mediaSource).toBe('VFX Top');
        expect(payload.username).toBe('Viewer');
        expect(payload.platform).toBe('twitch');
        expect(payload.userId).toBe('user-123');
        expect(payload.context).toEqual(expect.objectContaining({ notificationType: 'greeting' }));
    });
});
