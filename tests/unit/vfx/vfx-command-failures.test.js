
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
        getVFXConfig: jest.fn().mockReturnValue(null)
    }));

    return {
        CommandParser,
        runCommand
    };
});

const { VFXCommandService } = require('../../../src/services/VFXCommandService');
const { runCommand } = require('../../../src/chat/commands');

describe('VFXCommandService failure paths', () => {
    const createConfigService = (commandValue = '!hello') => ({
        get: jest.fn((section, key) => {
            if (section === 'commands') return { greetings: commandValue };
            if (section === 'farewell') return {};
            if (section === 'vfx' && key === 'filePath') return '/tmp';
            if (section === 'general') return { cmdCoolDown: 60, globalCmdCooldownMs: 60000 };
            if (section === 'general' && key === 'cmdCoolDown') return 60;
            if (section === 'general' && key === 'globalCmdCooldownMs') return 60000;
            return undefined;
        }),
        getCommand: jest.fn(() => commandValue)
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    it('returns friendly error when parser is missing', async () => {
        const service = new VFXCommandService(createConfigService(), null);
        service.commandParser = null;

        const result = await service.executeCommand('!hello', {
            username: 'user1',
            platform: 'tiktok',
            userId: '123',
            skipCooldown: true
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('VFXCommandService requires commandParser');
        expect(runCommand).not.toHaveBeenCalled();
    });

    it('returns friendly error when parser finds no VFX command', async () => {
        const configService = createConfigService();

        const commandParser = {
            getVFXConfig: jest.fn().mockReturnValue(null)
        };

        jest.doMock('../../../src/chat/commands', () => ({
            CommandParser: jest.fn(() => commandParser),
            runCommand
        }));

        const { VFXCommandService: VFXWithParser } = require('../../../src/services/VFXCommandService');
        const service = new VFXWithParser(configService, null);
        service.commandParser = commandParser;

        const result = await service.executeCommand('not-a-command', {
            username: 'user1',
            platform: 'tiktok',
            userId: '123',
            skipCooldown: true
        });

        expect(result).toEqual(expect.objectContaining({
            success: false,
            error: 'Command not found'
        }));
        expect(runCommand).not.toHaveBeenCalled();
    });

    it('returns friendly error when parser throws while selecting command', async () => {
        jest.resetModules();
        const errorHandler = {
            handleEventProcessingError: jest.fn(),
            logOperationalError: jest.fn()
        };

        jest.doMock('../../../src/utils/platform-error-handler', () => ({
            createPlatformErrorHandler: jest.fn(() => errorHandler)
        }));

        const configService = createConfigService();

        const commandParser = {
            getVFXConfig: jest.fn(() => { throw new Error('parser explode'); })
        };

        jest.doMock('../../../src/chat/commands', () => ({
            CommandParser: jest.fn(() => commandParser),
            runCommand
        }));

        const { VFXCommandService: VFXWithParser } = require('../../../src/services/VFXCommandService');
        const service = new VFXWithParser(configService, null);

        const result = await service.executeCommand('!boom', {
            username: 'user1',
            platform: 'tiktok',
            userId: '123',
            skipCooldown: true
        });

        expect(result).toEqual(expect.objectContaining({
            success: false,
            error: 'parser explode'
        }));
        expect(errorHandler.handleEventProcessingError).toHaveBeenCalled();
        expect(runCommand).not.toHaveBeenCalled();
    });

    it('returns friendly error when command string is empty', async () => {
        const service = new VFXCommandService(createConfigService(), null);

        const result = await service.executeCommand('', {
            username: 'user1',
            platform: 'tiktok',
            userId: '123',
            skipCooldown: true
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('VFXCommandService requires message');
        expect(runCommand).not.toHaveBeenCalled();
    });

    it('returns friendly error when command is whitespace only', async () => {
        const service = new VFXCommandService(createConfigService(), null);
        service.commandParser = { getVFXConfig: jest.fn().mockReturnValue(null) };

        const result = await service.executeCommand('   ', {
            username: 'user1',
            platform: 'tiktok',
            userId: '123',
            skipCooldown: true
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Command not found');
        expect(runCommand).not.toHaveBeenCalled();
    });

    it('returns missing key error when commandKey is absent', async () => {
        const configService = createConfigService(null);

        const service = new VFXCommandService(configService, null);
        const result = await service.executeCommandForKey('', {
            username: 'user1',
            platform: 'twitch',
            userId: 'user1',
            skipCooldown: true
        });

        expect(result).toEqual(expect.objectContaining({
            success: false,
            reason: 'Missing command key'
        }));
        expect(runCommand).not.toHaveBeenCalled();
    });

    it('returns friendly error when config has no command for key', async () => {
        const configService = createConfigService(null);

        const service = new VFXCommandService(configService, null);
        const result = await service.executeCommandForKey('missing', {
            username: 'user1',
            platform: 'twitch',
            userId: 'user1',
            skipCooldown: true
        });

        expect(result.success).toBe(false);
        expect(result.reason).toBe('No VFX configured for missing');
        expect(runCommand).not.toHaveBeenCalled();
    });

    it('returns friendly error for commandKey when ConfigService is missing', async () => {
        expect(() => new VFXCommandService(null, null))
            .toThrow('VFXCommandService requires configService');
    });

    it('returns friendly error when ConfigService throws for commandKey lookup', async () => {
        jest.resetModules();
        const errorHandler = {
            handleEventProcessingError: jest.fn(),
            logOperationalError: jest.fn()
        };

        jest.doMock('../../../src/utils/platform-error-handler', () => ({
            createPlatformErrorHandler: jest.fn(() => errorHandler)
        }));

        const runCommandMock = jest.fn();
        const throwingConfigService = {
            getCommand: jest.fn(() => { throw new Error('config crash'); }),
            get: jest.fn((section, key) => {
                if (section === 'commands') return { gifts: '!gift' };
                if (section === 'farewell') return {};
                if (section === 'vfx' && key === 'filePath') return '/tmp';
                if (section === 'general') return { cmdCoolDown: 60, globalCmdCooldownMs: 60000 };
                if (section === 'general' && key === 'cmdCoolDown') return 60;
                if (section === 'general' && key === 'globalCmdCooldownMs') return 60000;
                return undefined;
            })
        };

        jest.doMock('../../../src/chat/commands', () => ({
            CommandParser: jest.fn().mockImplementation(() => ({
                getVFXConfig: jest.fn(() => null)
            })),
            runCommand: runCommandMock
        }));

        const { VFXCommandService: VFXWithErrors } = require('../../../src/services/VFXCommandService');
        const service = new VFXWithErrors(throwingConfigService, null);

        const result = await service.executeCommandForKey('boom', {
            username: 'user3',
            platform: 'twitch',
            userId: 'user3',
            skipCooldown: true
        });

        expect(result).toEqual(expect.objectContaining({
            success: false,
            reason: 'config crash'
        }));
        expect(runCommandMock).not.toHaveBeenCalled();
        expect(errorHandler.handleEventProcessingError).toHaveBeenCalled();
    });
});
