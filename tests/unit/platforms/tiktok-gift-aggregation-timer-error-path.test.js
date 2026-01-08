
jest.unmock('../../../src/platforms/tiktok');

let scheduledAggregationCallback = null;

jest.mock('../../../src/utils/timeout-validator', () => {
    const actual = jest.requireActual('../../../src/utils/timeout-validator');
    return {
        ...actual,
        safeSetTimeout: jest.fn((callback, delay, ...args) => {
            scheduledAggregationCallback = () => callback(...args);
            return { ref: 'test-timer' };
        })
    };
});

describe('TikTok gift aggregation timer error handling', () => {
    beforeEach(() => {
        scheduledAggregationCallback = null;
        jest.clearAllMocks();
    });

    it('routes aggregation timer failures through the error handler without crashing', async () => {
        const { TikTokPlatform } = require('../../../src/platforms/tiktok');

        const mockLogger = {
            debug: jest.fn(),
            info: jest.fn(() => {
                throw new Error('logger failure');
            }),
            warn: jest.fn(),
            error: jest.fn()
        };

        const errorHandler = {
            handleEventProcessingError: jest.fn()
        };

        const platform = new TikTokPlatform(
            { enabled: true, username: 'gift_tester', giftAggregationEnabled: true },
            {
                TikTokWebSocketClient: jest.fn(() => ({})),
                WebcastEvent: {},
                ControlEvent: {},
                logger: mockLogger
            }
        );
        platform.errorHandler = errorHandler;

        await platform.handleStandardGift(
            'user1',
            'User One',
            'Rose',
            2,
            1,
            'coins',
            {
                user: { userId: 'tt-user1', uniqueId: 'user1' },
                repeatCount: 2,
                giftDetails: { giftName: 'Rose', diamondCount: 1 }
            }
        );

        expect(typeof scheduledAggregationCallback).toBe('function');
        await expect(scheduledAggregationCallback()).resolves.toBeUndefined();

        expect(errorHandler.handleEventProcessingError).toHaveBeenCalledTimes(1);
        const [errorArg, eventType] = errorHandler.handleEventProcessingError.mock.calls[0];
        expect(errorArg).toBeInstanceOf(Error);
        expect(eventType).toBe('gift-aggregation');

        expect(platform.giftAggregation['user1-Rose']).toBeUndefined();
    });
});
