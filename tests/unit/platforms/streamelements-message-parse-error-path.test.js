
// Use real implementation (jest.setup mocks the platform by default).
jest.unmock('../../../src/platforms/streamelements');

describe('StreamElementsPlatform message parsing', () => {
    it('routes invalid JSON messages through the error handler without throwing', () => {
        const { StreamElementsPlatform } = require('../../../src/platforms/streamelements');

        const mockLogger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        };

        const platform = new StreamElementsPlatform({ enabled: true }, { logger: mockLogger });

        const errorHandler = {
            handleEventProcessingError: jest.fn()
        };
        platform.errorHandler = errorHandler;

        expect(() => platform.handleMessage(Buffer.from('not-json'))).not.toThrow();
        expect(errorHandler.handleEventProcessingError).toHaveBeenCalledTimes(1);

        const [errorArg, eventType] = errorHandler.handleEventProcessingError.mock.calls[0];
        expect(errorArg).toBeInstanceOf(Error);
        expect(eventType).toBe('message');
    });
});

