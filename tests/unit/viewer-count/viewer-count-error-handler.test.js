const { describe, test, expect, afterEach, it } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, resetModules, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

describe('ViewerCountSystem observer error handling', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
        restoreAllMocks();
process.env.NODE_ENV = originalEnv;
    
        restoreAllModuleMocks();});

    function createSystemWithFailingObserver(handlerMock) {
        process.env.NODE_ENV = 'test';

        mockModule('../../../src/core/config', () => ({
            configManager: {
                getNumber: createMockFn().mockReturnValue(15)
            }
        }));

        mockModule('../../../src/utils/timeout-validator', () => ({
            safeSetInterval: createMockFn(),
            safeDelay: createMockFn()
        }));

        mockModule('../../../src/core/logging', () => ({
            logger: {
                debug: createMockFn(),
                info: createMockFn(),
                warn: createMockFn(),
                error: createMockFn()
            }
        }));

        mockModule('../../../src/utils/platform-error-handler', () => ({
            createPlatformErrorHandler: createMockFn(() => handlerMock)
        }));

        const platform = { getViewerCount: createMockFn().mockResolvedValue(5) };
        const { ViewerCountSystem } = require('../../../src/utils/viewer-count');
        const system = new ViewerCountSystem({ platforms: { youtube: platform } });

        system.streamStatus.youtube = true;

        system.addObserver({
            getObserverId: () => 'bad-observer',
            onViewerCountUpdate: () => { throw new Error('observer boom'); }
        });

        return { system, platform };
    }

    it('routes observer failures through platform error handler without crashing polling', async () => {
        const handlerMock = {
            handleEventProcessingError: createMockFn(),
            logOperationalError: createMockFn()
        };
        const { system, platform } = createSystemWithFailingObserver(handlerMock);

        await expect(system.pollPlatform('youtube')).resolves.toBeUndefined();

        expect(platform.getViewerCount).toHaveBeenCalledTimes(1);
        expect(handlerMock.handleEventProcessingError).toHaveBeenCalledTimes(1);
        const [error, eventType] = handlerMock.handleEventProcessingError.mock.calls[0];
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toContain('observer boom');
        expect(eventType).toBe('observer-update');
    });
});
