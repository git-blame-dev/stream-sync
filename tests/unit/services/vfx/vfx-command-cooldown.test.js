const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn } = require('../../../helpers/bun-mock-utils');
const { useFakeTimers, useRealTimers, advanceTimersByTime, setSystemTime } = require('../../../helpers/bun-timers');
const { createConfigFixture } = require('../../../helpers/config-fixture');

const { VFXCommandService } = require('../../../../src/services/VFXCommandService');

describe('VFXCommandService cooldown handling', () => {
    let mockEffectsManager;

    const createConfig = (commandValue, overrides = {}) => createConfigFixture({
        gifts: { command: commandValue },
        farewell: {},
        vfx: { filePath: '/tmp' },
        general: {
            cmdCoolDown: overrides.cmdCoolDown ?? 60,
            globalCmdCooldownMs: overrides.globalCmdCooldownMs ?? 60000
        }
    });

    const createMockCommandParser = () => ({
        getVFXConfig: createMockFn((message) => ({
            command: message,
            commandKey: message,
            filename: `${message}.mp4`,
            mediaSource: 'VFX Source',
            vfxFilePath: `${message}.vfx`,
            duration: 5000
        }))
    });

    beforeEach(() => {
        mockEffectsManager = {
            playMediaInOBS: createMockFn().mockResolvedValue(undefined)
        };
    });

    afterEach(() => {
        useRealTimers();
    });

    test('blocks repeat VFX command for same user during cooldown window', async () => {
        const service = new VFXCommandService(createConfig('!one | !two'), null, {
            effectsManager: mockEffectsManager
        });
        service.commandParser = createMockCommandParser();

        const first = await service.executeCommand('!one', {
            username: 'testUser1',
            userId: 'test-user-123',
            platform: 'tiktok',
            skipCooldown: false
        });
        expect(first.success).toBe(true);

        const second = await service.executeCommand('!one', {
            username: 'testUser1',
            userId: 'test-user-123',
            platform: 'tiktok',
            skipCooldown: false
        });
        expect(second.success).toBe(false);
        expect(second.error).toBe('Command on cooldown');
    });

    test('honors skipCooldown flag for notification-triggered executions', async () => {
        const service = new VFXCommandService(createConfig('!one | !two'), null, {
            effectsManager: mockEffectsManager
        });
        service.commandParser = createMockCommandParser();

        const first = await service.executeCommand('!one', {
            username: 'testUser1',
            userId: 'test-user-123',
            platform: 'tiktok',
            skipCooldown: true
        });

        const second = await service.executeCommand('!one', {
            username: 'testUser1',
            userId: 'test-user-123',
            platform: 'tiktok',
            skipCooldown: true
        });

        expect(first.success).toBe(true);
        expect(second.success).toBe(true);
    });

    test('returns failure when VFX execution throws', async () => {
        const failingEffectsManager = {
            playMediaInOBS: createMockFn().mockRejectedValue(new Error('vfx failed'))
        };
        const service = new VFXCommandService(createConfig('!one | !two'), null, {
            effectsManager: failingEffectsManager
        });
        service.commandParser = createMockCommandParser();

        const result = await service.executeCommand('!boom', {
            username: 'testUser1',
            userId: 'test-user-123',
            platform: 'tiktok',
            skipCooldown: false
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('vfx failed');
    });

    test('allows disabling user and global cooldowns via zero config values', async () => {
        const service = new VFXCommandService(createConfig('!one', {
            cmdCoolDown: 0,
            globalCmdCooldownMs: 0
        }), null, {
            effectsManager: mockEffectsManager
        });
        service.commandParser = createMockCommandParser();

        const first = await service.executeCommand('!one', {
            username: 'testUser1',
            userId: 'test-user-123',
            platform: 'tiktok',
            skipCooldown: false
        });
        const second = await service.executeCommand('!one', {
            username: 'testUser1',
            userId: 'test-user-123',
            platform: 'tiktok',
            skipCooldown: false
        });

        expect(first.success).toBe(true);
        expect(second.success).toBe(true);
    });

    test('applies global cooldown across users using configured duration', async () => {
        useFakeTimers();
        setSystemTime(new Date(0));
        try {
            const service = new VFXCommandService(createConfig('!spark', {
                cmdCoolDown: 0,
                globalCmdCooldownMs: 2000
            }), null, {
                effectsManager: mockEffectsManager
            });
            service.commandParser = createMockCommandParser();

            const first = await service.executeCommand('!spark', {
                username: 'testUser1',
                userId: 'test-user-u1',
                platform: 'twitch',
                skipCooldown: false
            });
            expect(first.success).toBe(true);

            const second = await service.executeCommand('!spark', {
                username: 'testUser2',
                userId: 'test-user-u2',
                platform: 'twitch',
                skipCooldown: false
            });
            expect(second.success).toBe(false);
            expect(second.error).toBe('Command on cooldown');

            advanceTimersByTime(2100);

            const third = await service.executeCommand('!spark', {
                username: 'testUser2',
                userId: 'test-user-u2',
                platform: 'twitch',
                skipCooldown: false
            });
            expect(third.success).toBe(true);
        } finally {
            useRealTimers();
        }
    });

    test('honors configured cooldown duration from config', async () => {
        useFakeTimers();
        setSystemTime(new Date(1000));
        try {
            const service = new VFXCommandService(createConfig('!one', {
                cmdCoolDown: 1,
                globalCmdCooldownMs: 1
            }), null, {
                effectsManager: mockEffectsManager
            });
            service.selectVFXCommand = createMockFn().mockResolvedValue({
                command: '!one',
                commandKey: '!one',
                filename: '!one.mp4',
                mediaSource: 'VFX Source',
                vfxFilePath: '!one.vfx',
                duration: 5000
            });

            const first = await service.executeCommandForKey('gifts', {
                username: 'testUser1',
                userId: 'test-user-123',
                platform: 'twitch',
                skipCooldown: false
            });
            expect(first.success).toBe(true);
            expect(service.userLastCommand.size).toBe(1);
            expect(service.checkCommandCooldown('test-user-123', '!one').allowed).toBe(false);

            const second = await service.executeCommandForKey('gifts', {
                username: 'testUser1',
                userId: 'test-user-123',
                platform: 'twitch',
                skipCooldown: false
            });
            expect(second.success).toBe(false);
            expect(second.error).toBe('Command on cooldown');

            advanceTimersByTime(1500);
            expect(service.checkCommandCooldown('test-user-123', '!one').allowed).toBe(true);

            const third = await service.executeCommandForKey('gifts', {
                username: 'testUser1',
                userId: 'test-user-123',
                platform: 'twitch',
                skipCooldown: false
            });
            expect(third.success).toBe(true);
        } finally {
            useRealTimers();
        }
    });
});
