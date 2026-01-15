
const { describe, test, expect, afterEach, it } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

mockModule('../../../src/chat/commands', () => {
    const runCommand = createMockFn().mockResolvedValue();
    const CommandParser = createMockFn().mockImplementation(() => ({
        getVFXConfig: createMockFn((message) => ({
            command: message,
            commandKey: message,
            filename: `${message}.mp4`,
            mediaSource: 'VFX Source',
            vfxFilePath: `${message}.vfx`,
            duration: 5000
        }))
    }));

    return {
        CommandParser,
        runCommand
    };
});

const crypto = require('crypto');
const { VFXCommandService } = require('../../../src/services/VFXCommandService');
const { runCommand } = require('../../../src/chat/commands');

describe('VFXCommandService random variant selection', () => {
    const originalRandomInt = crypto.randomInt;

    afterEach(() => {
        restoreAllMocks();
        clearAllMocks();
        crypto.randomInt = originalRandomInt;
    
        restoreAllModuleMocks();});

    const createConfigService = (commandValue) => ({
        getCommand: createMockFn().mockReturnValue(commandValue),
        get: createMockFn((section, key) => {
            if (section === 'commands') return { gifts: commandValue };
            if (section === 'farewell') return {};
            if (section === 'vfx' && key === 'filePath') return '/tmp';
            if (section === 'general') return { cmdCoolDown: 60, globalCmdCooldownMs: 60000 };
            if (section === 'general' && key === 'cmdCoolDown') return 60;
            if (section === 'general' && key === 'globalCmdCooldownMs') return 60000;
            return undefined;
        })
    });

    it('selects a single variant based on deterministic random value', async () => {
        const configService = createConfigService('!one | !two | !three');
        crypto.randomInt = createMockFn().mockReturnValue(1); // picks index 1 => !two

        const service = new VFXCommandService(configService, null);
        service.commandParser = {
            getVFXConfig: createMockFn((message) => ({
                command: message,
                commandKey: message,
                filename: `${message}.mp4`,
                mediaSource: 'VFX Source',
                vfxFilePath: `${message}.vfx`,
                duration: 5000
            }))
        };

        const result = await service.executeCommandForKey('gifts', {
            username: 'user1',
            platform: 'tiktok',
            userId: '123',
            skipCooldown: true
        });
        expect(runCommand).toHaveBeenCalledTimes(1);
        expect(result.success).toBe(true);

        const [commandData, filePath] = runCommand.mock.calls[0];
        expect(commandData.vfx.command).toBe('!two');
        expect(filePath).toBe('!two.vfx');
    });

    it('returns friendly failure when command key is missing from config', async () => {
        const configService = createConfigService(null);

        const service = new VFXCommandService(configService, null);
        const result = await service.executeCommandForKey('gifts', {
            username: 'user1',
            platform: 'tiktok',
            userId: 'user1',
            skipCooldown: true
        });

        expect(result.success).toBe(false);
        expect(result.reason).toBe('No VFX configured for gifts');
        expect(runCommand).not.toHaveBeenCalled();
    });
});
