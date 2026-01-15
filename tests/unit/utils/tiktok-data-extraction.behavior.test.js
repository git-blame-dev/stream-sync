const { describe, test, expect, it } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const {
    extractTikTokUserData,
    extractTikTokGiftData,
    extractTikTokViewerCount,
    formatCoinAmount,
    logTikTokGiftData
} = require('../../../src/utils/tiktok-data-extraction');

describe('logTikTokGiftData behavior', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    it('does not write to disk when gift logging is not explicitly enabled', async () => {
        const writer = createMockFn().mockResolvedValue();

        await logTikTokGiftData(
            {
                giftDetails: { giftName: 'TestGiftAlpha', diamondCount: 1 },
                repeatCount: 3,
                user: { userId: 'test_user_id_alpha', uniqueId: 'testUserAlpha' }
            },
            { username: 'TestUserAlpha', giftType: 'TestGiftAlpha', giftCount: 3, amount: 3, currency: 'coins' },
            'testUserAlpha-TestGiftAlpha',
            { writer }
        );

        expect(writer).not.toHaveBeenCalled();
    });

    it('routes writer errors through platform error handler when logging enabled', async () => {
        const errorHandler = { handleDataLoggingError: createMockFn() };
        const writer = createMockFn().mockRejectedValue(new Error('disk full'));
        const logger = { info: createMockFn(), error: createMockFn(), warn: createMockFn(), debug: createMockFn() };
        const configProvider = () => ({ tiktok: { giftLoggingEnabled: true } });

        await logTikTokGiftData(
            {
                giftDetails: { giftName: 'TestGiftAlpha', diamondCount: 1 },
                repeatCount: 3,
                user: { userId: 'test_user_id_alpha', uniqueId: 'testUserAlpha' }
            },
            { username: 'TestUserAlpha', giftType: 'TestGiftAlpha', giftCount: 3, amount: 3, currency: 'coins' },
            'testUserAlpha-TestGiftAlpha',
            { writer, errorHandler, logger, configProvider }
        );

        expect(writer).toHaveBeenCalledTimes(1);
        expect(errorHandler.handleDataLoggingError).toHaveBeenCalledWith(
            expect.any(Error),
            'tiktok-gift',
            expect.stringContaining('Error logging TikTok gift data')
        );
    });

    it('reports missing gift logging path when enabled without writer', async () => {
        const errorHandler = { handleDataLoggingError: createMockFn() };
        const logger = { info: createMockFn(), error: createMockFn(), warn: createMockFn(), debug: createMockFn() };
        const configProvider = () => ({ tiktok: { giftLoggingEnabled: true } });

        await logTikTokGiftData(
            {
                giftDetails: { giftName: 'TestGiftAlpha', diamondCount: 1 },
                repeatCount: 3,
                user: { userId: 'test_user_id_alpha', uniqueId: 'testUserAlpha' }
            },
            { username: 'TestUserAlpha', giftType: 'TestGiftAlpha', giftCount: 3, amount: 3, currency: 'coins' },
            'testUserAlpha-TestGiftAlpha',
            { errorHandler, logger, configProvider }
        );

        expect(errorHandler.handleDataLoggingError).toHaveBeenCalledWith(
            expect.any(Error),
            'tiktok-gift',
            expect.stringContaining('giftLoggingPath')
        );
    });
});

describe('extractTikTokUserData', () => {
    it('throws when payload is missing', () => {
        expect(() => extractTikTokUserData(null)).toThrow('TikTok user payload');
    });

    it('extracts canonical fields from nested user data', () => {
        const data = { user: { userId: 'test_user_id_nested', uniqueId: 'testUserNested', nickname: 'TestNestedDisplay' } };
        expect(extractTikTokUserData(data)).toEqual({ userId: 'test_user_id_nested', username: 'testUserNested' });
    });
});

describe('extractTikTokGiftData', () => {
    it('throws on invalid payloads', () => {
        expect(() => extractTikTokGiftData(null)).toThrow('gift payload');
    });

    it('detects combo gift type and propagates repeat metadata', () => {
        const result = extractTikTokGiftData({
            giftDetails: { giftName: 'TestGiftLion', diamondCount: 29, giftType: 1 },
            repeatCount: 3,
            groupId: 'test_combo_1',
            repeatEnd: true
        });

        expect(result.giftType).toBe('TestGiftLion');
        expect(result.giftCount).toBe(3);
        expect(result.unitAmount).toBe(29);
        expect(result.amount).toBe(87);
        expect(result.currency).toBe('coins');
        expect(result.combo).toBe(true);
        expect(result.comboType).toBe(1);
        expect(result.groupId).toBe('test_combo_1');
        expect(result.repeatEnd).toBe(true);
    });

    it('throws when giftDetails are missing', () => {
        const build = () => extractTikTokGiftData({
            extendedGiftInfo: { name: 'TestGiftGalaxy', combo: true },
            repeatCount: 4
        });

        expect(build).toThrow('requires giftDetails');
    });

    it('throws when repeatCount is missing', () => {
        const build = () => extractTikTokGiftData({
            giftDetails: { giftName: 'TestGiftNoRepeat', diamondCount: 1, giftType: 0 }
        });

        expect(build).toThrow('requires repeatCount');
    });
});

describe('extractTikTokViewerCount', () => {
    it('returns viewer count or null when missing', () => {
        expect(extractTikTokViewerCount({ viewerCount: 123 })).toBe(123);
        expect(extractTikTokViewerCount({})).toBeNull();
    });
});

describe('formatCoinAmount', () => {
    it('returns formatted coin strings or empty when no coins', () => {
        expect(formatCoinAmount(15)).toBe(' [15 coins]');
        expect(formatCoinAmount(1)).toBe(' [1 coin]');
        expect(formatCoinAmount(0)).toBe('');
    });
});
