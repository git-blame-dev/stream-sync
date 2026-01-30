
const { describe, test, expect, beforeEach } = require('bun:test');
const { createMockFn } = require('../../../helpers/bun-mock-utils');

const { PlatformEvents } = require('../../../../src/interfaces/PlatformEvents');
const { VFXCommandService } = require('../../../../src/services/VFXCommandService');

describe('VFXCommandService completion events', () => {
    let eventBus;
    let recordedEvents;
    let mockEffectsManager;

    beforeEach(() => {
        recordedEvents = [];
        eventBus = {
            emit: (name, payload) => recordedEvents.push({ name, payload })
        };
        mockEffectsManager = {
            playMediaInOBS: createMockFn().mockResolvedValue(undefined)
        };
    });

    test('emits both executed and effect-completed with enriched payload', async () => {
        const config = {
            commands: { greetings: '!hello' },
            farewell: {},
            vfx: { filePath: '/tmp' },
            general: { cmdCoolDown: 60, globalCmdCooldownMs: 60000 }
        };
        const service = new VFXCommandService(config, eventBus, {
            effectsManager: mockEffectsManager
        });

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
            username: 'testViewer',
            platform: 'twitch',
            userId: 'test-user-123',
            skipCooldown: true,
            notificationType: 'greeting',
            correlationId: 'test-corr-1'
        });

        const executedEvent = recordedEvents.find(e => e.name === PlatformEvents.VFX_COMMAND_EXECUTED);
        const completedEvent = recordedEvents.find(e => e.name === PlatformEvents.VFX_EFFECT_COMPLETED);

        expect(executedEvent).toBeDefined();
        expect(completedEvent).toBeDefined();

        const payload = completedEvent.payload;
        expect(payload.commandKey).toBe('greetings');
        expect(payload.filename).toBe('hello');
        expect(payload.mediaSource).toBe('VFX Top');
        expect(payload.username).toBe('testViewer');
        expect(payload.platform).toBe('twitch');
        expect(payload.userId).toBe('test-user-123');
        expect(payload.context).toEqual(expect.objectContaining({ notificationType: 'greeting' }));
    });
});
