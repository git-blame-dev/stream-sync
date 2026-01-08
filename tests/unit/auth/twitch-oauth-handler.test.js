
jest.mock('../../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: jest.fn(() => ({
        handleEventProcessingError: jest.fn(),
        logOperationalError: jest.fn()
    }))
}));

const { createPlatformErrorHandler } = require('../../../src/utils/platform-error-handler');

describe('TwitchOAuthHandler', () => {
    const { TwitchOAuthHandler } = require('../../../src/auth/oauth-handler');

    test('initializes platform error handler with provided logger', () => {
        const mockLogger = {
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn(),
            debug: jest.fn()
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
