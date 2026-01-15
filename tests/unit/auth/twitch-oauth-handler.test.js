
const { describe, test, expect } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

mockModule('../../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: createMockFn(() => ({
        handleEventProcessingError: createMockFn(),
        logOperationalError: createMockFn()
    }))
}));

const { createPlatformErrorHandler } = require('../../../src/utils/platform-error-handler');

describe('TwitchOAuthHandler', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    const { TwitchOAuthHandler } = require('../../../src/auth/oauth-handler');

    test('initializes platform error handler with provided logger', () => {
        const mockLogger = {
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn(),
            debug: createMockFn()
        };

        const handler = new TwitchOAuthHandler({
            clientId: 'client',
            clientSecret: 'secret',
            channel: 'hero_stream'
        }, {
            logger: mockLogger
        });

        expect(handler).toBeDefined();
        expect(createPlatformErrorHandler).toHaveBeenCalledWith(mockLogger, 'oauth-handler');
        expect(handler.errorHandler).toBe(createPlatformErrorHandler.mock.results[0].value);
    });
});
