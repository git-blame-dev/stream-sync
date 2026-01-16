const { describe, expect, afterEach, it, beforeEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

describe('VFXCommandService failure paths', () => {
    let VFXCommandService;

    const createConfigService = (commandValue = '!hello') => ({
        get: createMockFn((section, key) => {
            if (section === 'commands') return { greetings: commandValue };
            if (section === 'farewell') return {};
            if (section === 'vfx' && key === 'filePath') return '/tmp';
            if (section === 'general') return { cmdCoolDown: 60, globalCmdCooldownMs: 60000 };
            return undefined;
        }),
        getCommand: createMockFn(() => commandValue),
        getCLIOverrides: createMockFn().mockReturnValue({}),
        getPlatformConfig: createMockFn().mockReturnValue({})
    });

    beforeEach(() => {
        ({ VFXCommandService } = require('../../../src/services/VFXCommandService'));
    });

    afterEach(() => {
        restoreAllMocks();
    });

    it('returns friendly error when parser is missing', async () => {
        const service = new VFXCommandService(createConfigService(), null);
        service.commandParser = null;

        const result = await service.executeCommand('!hello', {
            username: 'testUser',
            platform: 'tiktok',
            userId: 'testUserId',
            skipCooldown: true
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('VFXCommandService requires commandParser');
    });

    it('returns friendly error when parser finds no VFX command', async () => {
        const service = new VFXCommandService(createConfigService(), null);
        service.commandParser = {
            getVFXConfig: createMockFn().mockReturnValue(null)
        };

        const result = await service.executeCommand('not-a-command', {
            username: 'testUser',
            platform: 'tiktok',
            userId: 'testUserId',
            skipCooldown: true
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Command not found');
    });

    it('returns friendly error when parser throws while selecting command', async () => {
        const service = new VFXCommandService(createConfigService(), null);
        service.commandParser = {
            getVFXConfig: createMockFn(() => { throw new Error('parser explode'); })
        };

        const result = await service.executeCommand('!boom', {
            username: 'testUser',
            platform: 'tiktok',
            userId: 'testUserId',
            skipCooldown: true
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('parser explode');
    });

    it('returns friendly error when command string is empty', async () => {
        const service = new VFXCommandService(createConfigService(), null);

        const result = await service.executeCommand('', {
            username: 'testUser',
            platform: 'tiktok',
            userId: 'testUserId',
            skipCooldown: true
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('VFXCommandService requires message');
    });

    it('returns friendly error when command is whitespace only', async () => {
        const service = new VFXCommandService(createConfigService(), null);
        service.commandParser = { getVFXConfig: createMockFn().mockReturnValue(null) };

        const result = await service.executeCommand('   ', {
            username: 'testUser',
            platform: 'tiktok',
            userId: 'testUserId',
            skipCooldown: true
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('Command not found');
    });

    it('returns missing key error when commandKey is absent', async () => {
        const service = new VFXCommandService(createConfigService(null), null);

        const result = await service.executeCommandForKey('', {
            username: 'testUser',
            platform: 'twitch',
            userId: 'testUserId',
            skipCooldown: true
        });

        expect(result.success).toBe(false);
        expect(result.reason).toBe('Missing command key');
    });

    it('returns friendly error when config has no command for key', async () => {
        const service = new VFXCommandService(createConfigService(null), null);

        const result = await service.executeCommandForKey('missing', {
            username: 'testUser',
            platform: 'twitch',
            userId: 'testUserId',
            skipCooldown: true
        });

        expect(result.success).toBe(false);
        expect(result.reason).toBe('No VFX configured for missing');
    });

    it('throws when ConfigService is missing', () => {
        expect(() => new VFXCommandService(null, null))
            .toThrow('VFXCommandService requires configService');
    });

    it('returns friendly error when ConfigService throws for commandKey lookup', async () => {
        const throwingConfigService = {
            getCommand: createMockFn(() => { throw new Error('config crash'); }),
            get: createMockFn((section, key) => {
                if (section === 'commands') return { gifts: '!gift' };
                if (section === 'farewell') return {};
                if (section === 'vfx' && key === 'filePath') return '/tmp';
                if (section === 'general') return { cmdCoolDown: 60, globalCmdCooldownMs: 60000 };
                return undefined;
            }),
            getCLIOverrides: createMockFn().mockReturnValue({}),
            getPlatformConfig: createMockFn().mockReturnValue({})
        };

        const service = new VFXCommandService(throwingConfigService, null);

        const result = await service.executeCommandForKey('boom', {
            username: 'testUser',
            platform: 'twitch',
            userId: 'testUserId',
            skipCooldown: true
        });

        expect(result.success).toBe(false);
        expect(result.reason).toBe('config crash');
    });
});
