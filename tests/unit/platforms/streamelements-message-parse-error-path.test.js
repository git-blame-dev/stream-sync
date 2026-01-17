const { describe, it, expect, afterEach } = require('bun:test');
const { unmockModule, restoreAllModuleMocks, resetModules } = require('../../helpers/bun-module-mocks');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');

unmockModule('../../../src/platforms/streamelements');

afterEach(() => {
    restoreAllMocks();
    restoreAllModuleMocks();
    resetModules();
});

describe('StreamElementsPlatform message parsing', () => {
    it('routes invalid JSON messages through the error handler without throwing', () => {
        const { StreamElementsPlatform } = require('../../../src/platforms/streamelements');

        const platform = new StreamElementsPlatform({ enabled: true }, { logger: noOpLogger });

        const errorHandler = {
            handleEventProcessingError: createMockFn()
        };
        platform.errorHandler = errorHandler;

        expect(() => platform.handleMessage(Buffer.from('not-json'))).not.toThrow();
        expect(errorHandler.handleEventProcessingError).toHaveBeenCalledTimes(1);

        const [errorArg, eventType] = errorHandler.handleEventProcessingError.mock.calls[0];
        expect(errorArg).toBeInstanceOf(Error);
        expect(eventType).toBe('message');
    });
});

