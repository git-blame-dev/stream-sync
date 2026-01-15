
const { describe, test, expect, afterEach, it } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, resetModules, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

describe('ViewerCountSystem cleanup resilience', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
        restoreAllMocks();
process.env.NODE_ENV = originalEnv;
    
        restoreAllModuleMocks();});

    function createSystem({ cleanupImpl, safeDelayImpl }) {
        process.env.NODE_ENV = 'test';

        const handlerMock = {
            handleEventProcessingError: createMockFn(),
            logOperationalError: createMockFn()
        };

        const logger = {
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        };

        mockModule('../../../src/core/config', () => ({
            configManager: {
                getNumber: createMockFn().mockReturnValue(15)
            }
        }));

        mockModule('../../../src/utils/timeout-validator', () => ({
            safeSetInterval: createMockFn(),
            safeDelay: safeDelayImpl || createMockFn().mockResolvedValue()
        }));

        mockModule('../../../src/core/logging', () => ({
            logger
        }));

        mockModule('../../../src/utils/platform-error-handler', () => ({
            createPlatformErrorHandler: createMockFn(() => handlerMock)
        }));

        const platform = { getViewerCount: createMockFn().mockResolvedValue(5) };
        const { ViewerCountSystem } = require('../../../src/utils/viewer-count');
        const system = new ViewerCountSystem({ platforms: { youtube: platform }, logger });
        system.streamStatus.youtube = true;

        system.addObserver({
            getObserverId: () => 'obs-1',
            cleanup: cleanupImpl || createMockFn().mockRejectedValue(new Error('cleanup fail'))
        });

        return { system, handlerMock, logger };
    }

    it('routes observer cleanup failures through error handler and completes', async () => {
        const { system, handlerMock, logger } = createSystem({});

        await expect(system.cleanup()).resolves.toBeUndefined();

        expect(handlerMock.handleEventProcessingError).toHaveBeenCalledWith(
            expect.any(Error),
            'observer-cleanup',
            expect.objectContaining({ observerId: 'obs-1' }),
            expect.stringContaining('Observer cleanup failed'),
            expect.any(String)
        );
    });

    it('warns and returns when observer cleanup hangs past timeout', async () => {
        const hangingCleanup = createMockFn(() => new Promise(() => {}));
        const { system, handlerMock, logger } = createSystem({
            cleanupImpl: hangingCleanup,
            safeDelayImpl: createMockFn().mockRejectedValue(new Error('timeout'))
        });

        await expect(system.cleanup()).resolves.toBeUndefined();

        expect(handlerMock.handleEventProcessingError).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(
            expect.stringContaining('Observer cleanup timed out or failed'),
            expect.any(String)
        );
    });
});
