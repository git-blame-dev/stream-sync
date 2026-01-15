const { describe, test, expect, afterEach, it } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, resetModules, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

describe('VFXCommandService event emission error handling', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
        restoreAllMocks();
process.env.NODE_ENV = originalEnv;
    
        restoreAllModuleMocks();});

    function createServiceWithEventBusError() {
        process.env.NODE_ENV = 'test';

        const errorHandler = {
            handleEventProcessingError: createMockFn(),
            logOperationalError: createMockFn()
        };

        mockModule('../../../src/utils/platform-error-handler', () => ({
            createPlatformErrorHandler: createMockFn(() => errorHandler)
        }));

        const mockParser = {
            getVFXConfig: createMockFn(() => ({
                filename: 'clip',
                mediaSource: 'vfx-source',
                vfxFilePath: '/tmp/vfx',
                commandKey: 'clip',
                command: '!clip',
                duration: 5000
            }))
        };

        const mockRunCommand = createMockFn().mockResolvedValue({ success: true });

        mockModule('../../../src/chat/commands', () => ({
            CommandParser: createMockFn(() => mockParser),
            runCommand: mockRunCommand
        }));

        mockModule('../../../src/core/logging', () => ({
            logger: {
                debug: createMockFn(),
                info: createMockFn(),
                warn: createMockFn(),
                error: createMockFn()
            }
        }));

        const eventBus = {
            emit: createMockFn(() => { throw new Error('eventbus fail'); })
        };
        const configService = {
            get: createMockFn((section, key) => {
                if (section === 'commands') return { clip: '!clip' };
                if (section === 'farewell') return {};
                if (section === 'vfx' && key === 'filePath') return '/tmp/vfx';
                if (section === 'general') return { cmdCoolDown: 60, globalCmdCooldownMs: 60000 };
                if (section === 'general' && key === 'cmdCoolDown') return 60;
                if (section === 'general' && key === 'globalCmdCooldownMs') return 60000;
                return undefined;
            }),
            getCommand: createMockFn(() => '!clip'),
            getCLIOverrides: createMockFn().mockReturnValue({}),
            getPlatformConfig: createMockFn().mockReturnValue({})
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

    it('returns failure when runCommand rejects', async () => {
        process.env.NODE_ENV = 'test';

        const errorHandler = {
            handleEventProcessingError: createMockFn(),
            logOperationalError: createMockFn()
        };

        mockModule('../../../src/utils/platform-error-handler', () => ({
            createPlatformErrorHandler: createMockFn(() => errorHandler)
        }));

        const mockParser = {
            getVFXConfig: createMockFn(() => ({
                filename: 'clip',
                mediaSource: 'vfx-source',
                vfxFilePath: '/tmp/vfx',
                commandKey: 'clip',
                command: '!clip',
                duration: 5000
            }))
        };

        const mockRunCommand = createMockFn().mockRejectedValue(new Error('run fail'));

        mockModule('../../../src/chat/commands', () => ({
            CommandParser: createMockFn(() => mockParser),
            runCommand: mockRunCommand
        }));

        mockModule('../../../src/core/logging', () => ({
            logger: {
                debug: createMockFn(),
                info: createMockFn(),
                warn: createMockFn(),
                error: createMockFn()
            }
        }));

        const eventBus = {
            emit: createMockFn()
        };
        const configService = {
            get: createMockFn((section, key) => {
                if (section === 'commands') return { clip: '!clip' };
                if (section === 'farewell') return {};
                if (section === 'vfx' && key === 'filePath') return '/tmp/vfx';
                if (section === 'general') return { cmdCoolDown: 60, globalCmdCooldownMs: 60000 };
                if (section === 'general' && key === 'cmdCoolDown') return 60;
                if (section === 'general' && key === 'globalCmdCooldownMs') return 60000;
                return undefined;
            }),
            getCommand: createMockFn(() => '!clip'),
            getCLIOverrides: createMockFn().mockReturnValue({}),
            getPlatformConfig: createMockFn().mockReturnValue({})
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
        expect(errorHandler.handleEventProcessingError).toHaveBeenCalled();
    });
});
