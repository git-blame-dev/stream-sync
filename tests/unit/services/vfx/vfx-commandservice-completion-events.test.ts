
const { describe, test, expect, beforeEach } = require('bun:test');
const { createMockFn } = require('../../../helpers/bun-mock-utils');

const { PlatformEvents } = require('../../../../src/interfaces/PlatformEvents');
const { VFXCommandService, createVFXCommandService } = require('../../../../src/services/VFXCommandService.js');

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
            cooldowns: { cmdCooldown: 60, globalCmdCooldownMs: 60000 }
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

    test('factory passes injected effects manager through to service construction', () => {
        const config = {
            commands: { greetings: '!hello' },
            farewell: {},
            vfx: { filePath: '/tmp' },
            cooldowns: { cmdCooldown: 60, globalCmdCooldownMs: 60000 }
        };
        const customEffectsManager = { playMediaInOBS: createMockFn().mockResolvedValue(undefined) };

        const service = createVFXCommandService(config, null, {
            effectsManager: customEffectsManager
        });

        expect(service._effectsManager).toBe(customEffectsManager);
    });

    test('does not update cooldown state when completion event emission fails', async () => {
        const config = {
            commands: { greetings: '!hello' },
            farewell: {},
            vfx: { filePath: '/tmp' },
            cooldowns: { cmdCooldown: 60, globalCmdCooldownMs: 60000 }
        };
        const failingEventBus = {
            emit: (name) => {
                if (name === PlatformEvents.VFX_EFFECT_COMPLETED) {
                    throw new Error('emit failed');
                }
            }
        };
        const service = new VFXCommandService(config, failingEventBus, {
            effectsManager: mockEffectsManager
        });

        service.selectVFXCommand = createMockFn().mockResolvedValue({
            commandKey: 'greetings',
            filename: 'hello',
            mediaSource: 'VFX Top',
            vfxFilePath: '/tmp',
            command: '!hello',
            duration: 5000
        });

        const result = await service.executeCommand('!hello', {
            username: 'testViewer',
            platform: 'twitch',
            userId: 'test-user-123',
            skipCooldown: false,
            correlationId: 'test-corr-2'
        });

        expect(result.success).toBe(false);
        expect(service.userLastCommand.size).toBe(0);
        expect(service.globalCommandCooldowns.size).toBe(0);
    });
});
