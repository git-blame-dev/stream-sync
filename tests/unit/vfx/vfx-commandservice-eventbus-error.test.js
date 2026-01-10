describe('VFXCommandService event emission error handling', () => {
    const { PlatformEvents } = require('../../../src/interfaces/PlatformEvents');
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
        jest.resetModules();
        process.env.NODE_ENV = originalEnv;
    });

    function createServiceWithEventBusError() {
        process.env.NODE_ENV = 'test';

        const errorHandler = {
            handleEventProcessingError: jest.fn(),
            logOperationalError: jest.fn()
        };

        jest.doMock('../../../src/utils/platform-error-handler', () => ({
            createPlatformErrorHandler: jest.fn(() => errorHandler)
        }));

        const mockParser = {
            getVFXConfig: jest.fn(() => ({
                filename: 'clip',
                mediaSource: 'vfx-source',
                vfxFilePath: '/tmp/vfx',
                commandKey: 'clip',
                command: '!clip',
                duration: 5000
            }))
        };

        const mockRunCommand = jest.fn().mockResolvedValue({ success: true });

        jest.doMock('../../../src/chat/commands', () => ({
            CommandParser: jest.fn(() => mockParser),
            runCommand: mockRunCommand
        }));

        jest.doMock('../../../src/core/logging', () => ({
            logger: {
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn()
            }
        }));

        const eventBus = {
            emit: jest.fn(() => { throw new Error('eventbus fail'); })
        };
        const configService = {
            get: jest.fn((section, key) => {
                if (section === 'commands') return { clip: '!clip' };
                if (section === 'farewell') return {};
                if (section === 'vfx' && key === 'filePath') return '/tmp/vfx';
                if (section === 'general') return { cmdCoolDown: 60, globalCmdCooldownMs: 60000 };
                if (section === 'general' && key === 'cmdCoolDown') return 60;
                if (section === 'general' && key === 'globalCmdCooldownMs') return 60000;
                return undefined;
            }),
            getCommand: jest.fn(() => '!clip'),
            getCLIOverrides: jest.fn().mockReturnValue({}),
            getPlatformConfig: jest.fn().mockReturnValue({})
        };

        const { VFXCommandService } = require('../../../src/services/VFXCommandService');
        const service = new VFXCommandService(configService, eventBus);

        return { service, errorHandler };
    }

    it('returns failure and routes through platform error handler when eventBus emit fails', async () => {
        const { service, errorHandler } = createServiceWithEventBusError();

        const result = await service.executeCommand('!clip', {
            username: 'User',
            platform: 'tiktok',
            userId: 'u1',
            skipCooldown: true,
            correlationId: 'corr-1'
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('eventbus fail');
        expect(errorHandler.handleEventProcessingError).toHaveBeenCalled();
        const [error, eventType] = errorHandler.handleEventProcessingError.mock.calls[0];
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('eventbus fail');
        expect(eventType).toBe('event-bus');
    });

    it('emits vfx:command-failed when runCommand rejects', async () => {
        process.env.NODE_ENV = 'test';

        const errorHandler = {
            handleEventProcessingError: jest.fn(),
            logOperationalError: jest.fn()
        };

        jest.doMock('../../../src/utils/platform-error-handler', () => ({
            createPlatformErrorHandler: jest.fn(() => errorHandler)
        }));

        const mockParser = {
            getVFXConfig: jest.fn(() => ({
                filename: 'clip',
                mediaSource: 'vfx-source',
                vfxFilePath: '/tmp/vfx',
                commandKey: 'clip',
                command: '!clip',
                duration: 5000
            }))
        };

        const mockRunCommand = jest.fn().mockRejectedValue(new Error('run fail'));

        jest.doMock('../../../src/chat/commands', () => ({
            CommandParser: jest.fn(() => mockParser),
            runCommand: mockRunCommand
        }));

        jest.doMock('../../../src/core/logging', () => ({
            logger: {
                debug: jest.fn(),
                info: jest.fn(),
                warn: jest.fn(),
                error: jest.fn()
            }
        }));

        const emitted = [];
        const eventBus = {
            emit: jest.fn((event, payload) => emitted.push({ event, payload }))
        };
        const configService = {
            get: jest.fn((section, key) => {
                if (section === 'commands') return { clip: '!clip' };
                if (section === 'farewell') return {};
                if (section === 'vfx' && key === 'filePath') return '/tmp/vfx';
                if (section === 'general') return { cmdCoolDown: 60, globalCmdCooldownMs: 60000 };
                if (section === 'general' && key === 'cmdCoolDown') return 60;
                if (section === 'general' && key === 'globalCmdCooldownMs') return 60000;
                return undefined;
            }),
            getCommand: jest.fn(() => '!clip'),
            getCLIOverrides: jest.fn().mockReturnValue({}),
            getPlatformConfig: jest.fn().mockReturnValue({})
        };

        const { VFXCommandService } = require('../../../src/services/VFXCommandService');
        const service = new VFXCommandService(configService, eventBus);

        const result = await service.executeCommand('!clip', {
            username: 'User',
            platform: 'twitch',
            userId: 'u1',
            skipCooldown: true,
            correlationId: 'corr-2'
        });

        expect(result.success).toBe(false);
        expect(result.error).toBe('run fail');
        expect(eventBus.emit).toHaveBeenCalledWith(PlatformEvents.VFX_COMMAND_FAILED, expect.objectContaining({
            command: '!clip',
            username: 'User',
            platform: 'twitch',
            error: 'run fail'
        }));
        expect(errorHandler.handleEventProcessingError).toHaveBeenCalled();
    });
});
