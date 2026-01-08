
jest.mock('../../../src/core/logging', () => ({
    logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    }
}));

jest.mock('../../../src/chat/commands', () => {
    const runCommand = jest.fn().mockResolvedValue();
    const CommandParser = jest.fn().mockImplementation(() => ({
        getVFXConfig: jest.fn((message) => ({
            command: message,
            commandKey: message,
            primaryCommand: message,
            vfxFilePath: `${message}.vfx`
        }))
    }));

    return {
        CommandParser,
        runCommand
    };
});

const { VFXCommandService } = require('../../../src/services/VFXCommandService');
const { runCommand } = require('../../../src/chat/commands');

describe('VFXCommandService cooldown handling', () => {
    const createConfigService = (commandValue, overrides = {}) => ({
        getCommand: jest.fn().mockReturnValue(commandValue),
        get: jest.fn((section, key) => {
            if (section === 'commands') return { gifts: commandValue };
            if (section === 'farewell') return {};
            if (section === 'vfx' && key === 'filePath') return '/tmp';
            if (section === 'general' && key === 'cmdCoolDown') return overrides.cmdCoolDown ?? 60;
            if (section === 'general' && key === 'globalCmdCooldownMs') return overrides.globalCmdCooldownMs ?? 60000;
            if (section === 'general') return {
                cmdCoolDown: overrides.cmdCoolDown ?? 60,
                globalCmdCooldownMs: overrides.globalCmdCooldownMs ?? 60000
            };
            return undefined;
        })
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('blocks repeat VFX command for same user during cooldown window', async () => {
        const service = new VFXCommandService(createConfigService('!one | !two'), null);
        service.commandParser = {
            getVFXConfig: jest.fn((message) => ({
                command: message,
                commandKey: message,
                filename: `${message}.mp4`,
                mediaSource: 'VFX Source',
                vfxFilePath: `${message}.vfx`,
                duration: 5000
            }))
        };

        // First execution succeeds
        const first = await service.executeCommand('!one', {
            username: 'user1',
            userId: '123',
            platform: 'tiktok',
            skipCooldown: false
        });
        expect(first.success).toBe(true);
        expect(runCommand).toHaveBeenCalledTimes(1);

        // Second execution should be blocked by cooldown
        const second = await service.executeCommand('!one', {
            username: 'user1',
            userId: '123',
            platform: 'tiktok',
            skipCooldown: false
        });
        expect(second.success).toBe(false);
        expect(second.error).toBe('Command on cooldown');
        expect(runCommand).toHaveBeenCalledTimes(1);
    });

    it('honors skipCooldown flag for notification-triggered executions', async () => {
        const service = new VFXCommandService(createConfigService('!one | !two'), null);
        service.commandParser = {
            getVFXConfig: jest.fn((message) => ({
                command: message,
                commandKey: message,
                filename: `${message}.mp4`,
                mediaSource: 'VFX Source',
                vfxFilePath: `${message}.vfx`,
                duration: 5000
            }))
        };

        const first = await service.executeCommand('!one', {
            username: 'user1',
            userId: '123',
            platform: 'tiktok',
            skipCooldown: true
        });

        const second = await service.executeCommand('!one', {
            username: 'user1',
            userId: '123',
            platform: 'tiktok',
            skipCooldown: true
        });

        expect(first.success).toBe(true);
        expect(second.success).toBe(true);
        expect(runCommand).toHaveBeenCalledTimes(2);
    });

    it('returns failure when VFX execution throws', async () => {
        const service = new VFXCommandService(createConfigService('!one | !two'), null);
        service.commandParser = {
            getVFXConfig: jest.fn((message) => ({
                command: message,
                commandKey: message,
                filename: `${message}.mp4`,
                mediaSource: 'VFX Source',
                vfxFilePath: `${message}.vfx`,
                duration: 5000
            }))
        };

        runCommand.mockRejectedValueOnce(new Error('vfx failed'));

        const result = await service.executeCommand('!boom', {
            username: 'user1',
            userId: '123',
            platform: 'tiktok',
            skipCooldown: false
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('vfx failed');
        expect(runCommand).toHaveBeenCalledTimes(1);
    });

    it('allows disabling user and global cooldowns via zero config values', async () => {
        const service = new VFXCommandService(createConfigService('!one', {
            cmdCoolDown: 0,
            globalCmdCooldownMs: 0
        }), null);
        service.commandParser = {
            getVFXConfig: jest.fn((message) => ({
                command: message,
                commandKey: message,
                filename: `${message}.mp4`,
                mediaSource: 'VFX Source',
                vfxFilePath: `${message}.vfx`,
                duration: 5000
            }))
        };

        const first = await service.executeCommand('!one', {
            username: 'user1',
            userId: '123',
            platform: 'tiktok',
            skipCooldown: false
        });
        const second = await service.executeCommand('!one', {
            username: 'user1',
            userId: '123',
            platform: 'tiktok',
            skipCooldown: false
        });

        expect(first.success).toBe(true);
        expect(second.success).toBe(true);
        expect(runCommand).toHaveBeenCalledTimes(2);
    });

    it('applies global cooldown across users using configured duration', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date(0));
        try {
            const service = new VFXCommandService(createConfigService('!spark', {
                cmdCoolDown: 0,
                globalCmdCooldownMs: 2000
            }), null);
            service.commandParser = {
                getVFXConfig: jest.fn((message) => ({
                    command: message,
                    commandKey: message,
                    filename: `${message}.mp4`,
                    mediaSource: 'VFX Source',
                    vfxFilePath: `${message}.vfx`,
                    duration: 5000
                }))
            };

            const first = await service.executeCommand('!spark', {
                username: 'user1',
                userId: 'u1',
                platform: 'twitch',
                skipCooldown: false
            });
            expect(first.success).toBe(true);

            const second = await service.executeCommand('!spark', {
                username: 'user2',
                userId: 'u2',
                platform: 'twitch',
                skipCooldown: false
            });
            expect(second.success).toBe(false);
            expect(second.error).toBe('Command on cooldown');

            jest.advanceTimersByTime(2100);

            const third = await service.executeCommand('!spark', {
                username: 'user2',
                userId: 'u2',
                platform: 'twitch',
                skipCooldown: false
            });

            expect(third.success).toBe(true);
            expect(runCommand).toHaveBeenCalledTimes(2);
        } finally {
            jest.useRealTimers();
        }
    });

    it('honors configured cooldown duration from config service', async () => {
        jest.useFakeTimers();
        jest.setSystemTime(new Date(1000)); // ensure cooldown timestamps are truthy
        try {
            const service = new VFXCommandService(createConfigService('!one', {
                cmdCoolDown: 1,
                globalCmdCooldownMs: 1
            }), null);
            service.selectVFXCommand = jest.fn().mockResolvedValue({
                command: '!one',
                commandKey: '!one',
                filename: '!one.mp4',
                mediaSource: 'VFX Source',
                vfxFilePath: '!one.vfx',
                duration: 5000
            });

            const first = await service.executeCommandForKey('gifts', {
                username: 'user1',
                userId: '123',
                platform: 'twitch',
                skipCooldown: false
            });
            expect(first.success).toBe(true);
            expect(runCommand).toHaveBeenCalledTimes(1);
            expect(service.userLastCommand.size).toBe(1);
            expect(service.checkCommandCooldown('123', '!one').allowed).toBe(false);

            const second = await service.executeCommandForKey('gifts', {
                username: 'user1',
                userId: '123',
                platform: 'twitch',
                skipCooldown: false
            });
            expect(second.success).toBe(false);
            expect(second.error).toBe('Command on cooldown');

            jest.advanceTimersByTime(1500);
            expect(service.checkCommandCooldown('123', '!one').allowed).toBe(true);

            const third = await service.executeCommandForKey('gifts', {
                username: 'user1',
                userId: '123',
                platform: 'twitch',
                skipCooldown: false
            });

            expect(third.success).toBe(true);
            expect(runCommand).toHaveBeenCalledTimes(2);
        } finally {
            jest.useRealTimers();
        }
    });
});
