
const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, resetModules, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

const mockErrorHandler = {
    handleEventProcessingError: createMockFn(),
    logOperationalError: createMockFn()
};

mockModule('../../../src/utils/platform-error-handler', () => ({
    createPlatformErrorHandler: createMockFn(() => mockErrorHandler)
}));

const mockFs = {
    existsSync: createMockFn(),
    readFileSync: createMockFn(),
    writeFileSync: createMockFn()
};

mockModule('fs', () => mockFs);

const mockResolveUrl = createMockFn();
const mockYoutubeInstance = {
    resolveURL: mockResolveUrl
};
const mockManagerInstanceGet = createMockFn(async () => mockYoutubeInstance);
const mockInnertubeManager = {
    getInstance: createMockFn(() => ({
        getInstance: mockManagerInstanceGet
    }))
};

mockModule('../../../src/services/innertube-instance-manager', () => mockInnertubeManager);
mockModule('../../../src/factories/innertube-factory', () => ({
    InnertubeFactory: {
        createWithTimeout: createMockFn(() => ({}))
    }
}));

const { createPlatformErrorHandler } = require('../../../src/utils/platform-error-handler');
const {
    configureChannelCache: initialConfigureChannelCache,
    clearChannelCache: initialClearChannelCache,
    getChannelId: initialGetChannelId,
    extractSuperChatData: initialExtractSuperChatData,
    extractMembershipData: initialExtractMembershipData,
    extractYouTubeUserData: initialExtractYouTubeUserData,
    formatSuperChatAmount: initialFormatSuperChatAmount
} = require('../../../src/utils/youtube-data-extraction');

let configureChannelCache = initialConfigureChannelCache;
let clearChannelCache = initialClearChannelCache;
let getChannelId = initialGetChannelId;
let extractSuperChatData = initialExtractSuperChatData;
let extractMembershipData = initialExtractMembershipData;
let extractYouTubeUserData = initialExtractYouTubeUserData;
let formatSuperChatAmount = initialFormatSuperChatAmount;
const CACHE_PATH = '/path/to/cache.json';

describe('youtube-data-extraction', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    beforeEach(() => {
        resetModules();
        mockResolveUrl.mockReset();
        mockManagerInstanceGet.mockReset();
        mockManagerInstanceGet.mockImplementation(async () => mockYoutubeInstance);
        mockInnertubeManager.getInstance.mockImplementation(() => ({
            getInstance: mockManagerInstanceGet
        }));
        mockFs.existsSync.mockReturnValue(false);
        mockFs.writeFileSync.mockReset();
        createPlatformErrorHandler.mockImplementation(() => mockErrorHandler);
        ({
            configureChannelCache,
            clearChannelCache,
            getChannelId,
            extractSuperChatData,
            extractMembershipData,
            extractYouTubeUserData,
            formatSuperChatAmount
        } = require('../../../src/utils/youtube-data-extraction'));
        configureChannelCache({ enabled: true, filePath: CACHE_PATH });
        clearChannelCache();
        mockErrorHandler.handleEventProcessingError.mockClear();
        mockErrorHandler.logOperationalError.mockClear();
    });

    describe('getChannelId', () => {
        it('returns null and routes error when username missing', async () => {
            const result = await getChannelId('');

            expect(result).toBeNull();
            expect(mockErrorHandler.handleEventProcessingError).toHaveBeenCalled();
        });

        it('returns cached channel ID without issuing resolve', async () => {
            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockReturnValue(JSON.stringify({ cached: 'UC123' }));

            const result = await getChannelId('@cached');

            expect(result).toBe('UC123');
            expect(mockResolveUrl).not.toHaveBeenCalled();
            expect(mockFs.writeFileSync).not.toHaveBeenCalled();
        });

        it('does not write cache files when file cache is disabled', async () => {
            configureChannelCache({ enabled: false });
            clearChannelCache();
            mockResolveUrl.mockResolvedValue({
                payload: { browseId: 'UC123' }
            });

            const result = await getChannelId('Channel');

            expect(result).toBe('UC123');
            expect(mockFs.writeFileSync).not.toHaveBeenCalled();
        });

        it('deduplicates concurrent requests and caches resolved ID', async () => {
            mockResolveUrl.mockResolvedValue({
                payload: { browseId: 'UC999' }
            });

            const [id1, id2] = await Promise.all([
                getChannelId('Channel'),
                getChannelId('Channel')
            ]);

            expect(id1).toBe('UC999');
            expect(id2).toBe('UC999');
            expect(mockResolveUrl).toHaveBeenCalledTimes(1);
            expect(mockFs.writeFileSync).toHaveBeenCalled();
        });

        it('returns null and logs when channel is not found', async () => {
            mockResolveUrl.mockResolvedValue({ payload: {} });

            const result = await getChannelId('missing');

            expect(result).toBeNull();
            expect(mockErrorHandler.handleEventProcessingError).toHaveBeenCalled();
        });

        it('handles cache save failures gracefully', async () => {
            mockResolveUrl.mockResolvedValue({
                payload: { browseId: 'UC123' }
            });
            mockFs.writeFileSync.mockImplementation(() => { throw new Error('disk full'); });

            const result = await getChannelId('Channel');

            expect(result).toBe('UC123');
            expect(mockErrorHandler.handleEventProcessingError).toHaveBeenCalled();
        });

        it('recovers from corrupted cache file and still resolves channel', async () => {
            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockReturnValue('not-json');
            mockResolveUrl.mockResolvedValue({
                payload: { browseId: 'UC777' }
            });

            const result = await getChannelId('Channel');

            expect(result).toBe('UC777');
            expect(mockErrorHandler.handleEventProcessingError).toHaveBeenCalled();
            expect(mockResolveUrl).toHaveBeenCalled();
        });

        it('logs and returns null when resolveURL throws', async () => {
            mockResolveUrl.mockRejectedValue(new Error('yt fail'));

            const result = await getChannelId('Channel');

            expect(result).toBeNull();
            expect(mockErrorHandler.handleEventProcessingError).toHaveBeenCalled();
        });

        it('clears ongoing request tracker after failures to allow retries', async () => {
            mockResolveUrl
                .mockRejectedValueOnce(new Error('temporary fail'))
                .mockResolvedValueOnce({
                    payload: { browseId: 'UC321' }
                });

            const first = await getChannelId('RetryChannel');
            const second = await getChannelId('RetryChannel');

            expect(first).toBeNull();
            expect(second).toBe('UC321');
            expect(mockResolveUrl).toHaveBeenCalledTimes(2);
        });

        it('logs and recovers when cache file read throws', async () => {
            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockImplementation(() => { throw new Error('read boom'); });
            mockResolveUrl.mockResolvedValue({
                payload: { browseId: 'UC654' }
            });

            const result = await getChannelId('Channel');

            expect(result).toBe('UC654');
            expect(mockErrorHandler.handleEventProcessingError).toHaveBeenCalled();
        });

        it('returns null when innertube manager fails to resolve instance', async () => {
            mockInnertubeManager.getInstance.mockImplementation(() => {
                throw new Error('manager boom');
            });

            const result = await getChannelId('Channel');

            expect(result).toBeNull();
            expect(mockErrorHandler.handleEventProcessingError).toHaveBeenCalled();
        });

        it('returns null when resolveURL payload missing browseId', async () => {
            mockResolveUrl.mockResolvedValue({ payload: {} });

            const result = await getChannelId('Channel');

            expect(result).toBeNull();
            expect(mockErrorHandler.handleEventProcessingError).toHaveBeenCalled();
        });

        it('allows retry after missing browseId in payload', async () => {
            mockResolveUrl
                .mockResolvedValueOnce({ payload: {} })
                .mockResolvedValueOnce({ payload: { browseId: 'UCRETRY' } });

            const first = await getChannelId('Channel');
            const second = await getChannelId('Channel');

            expect(first).toBeNull();
            expect(second).toBe('UCRETRY');
            expect(mockResolveUrl).toHaveBeenCalledTimes(2);
        });

        it('returns null when resolveURL payload is missing', async () => {
            mockResolveUrl.mockResolvedValue({});

            const result = await getChannelId('Channel');

            expect(result).toBeNull();
            expect(mockErrorHandler.handleEventProcessingError).toHaveBeenCalled();
        });

        it('returns null when resolveURL payload is empty', async () => {
            mockResolveUrl.mockResolvedValue({ payload: {} });

            const result = await getChannelId('Missing');

            expect(result).toBeNull();
            expect(mockErrorHandler.handleEventProcessingError).toHaveBeenCalled();
        });

        it('returns null when resolveURL response is invalid', async () => {
            mockResolveUrl.mockResolvedValue(null);

            const result = await getChannelId('Broken');

            expect(result).toBeNull();
            expect(mockErrorHandler.handleEventProcessingError).toHaveBeenCalled();
        });

        it('allows retry after empty payload to resolve on next attempt', async () => {
            mockResolveUrl
                .mockResolvedValueOnce({ payload: {} })
                .mockResolvedValueOnce({ payload: { browseId: 'UCRETRY' } });

            const first = await getChannelId('Retry');
            const second = await getChannelId('Retry');

            expect(first).toBeNull();
            expect(second).toBe('UCRETRY');
            expect(mockResolveUrl).toHaveBeenCalledTimes(2);
        });

        it('routes errors when youtube instance resolution rejects', async () => {
            mockManagerInstanceGet.mockRejectedValue(new Error('instance fail'));

            const result = await getChannelId('Channel');

            expect(result).toBeNull();
            expect(mockErrorHandler.handleEventProcessingError).toHaveBeenCalled();
        });

        it('clears ongoing request after instance failure to allow retry', async () => {
            mockManagerInstanceGet
                .mockRejectedValueOnce(new Error('instance fail'))
                .mockResolvedValueOnce(mockYoutubeInstance);
            mockResolveUrl.mockResolvedValueOnce({
                payload: { browseId: 'UCABC' }
            });

            const first = await getChannelId('Channel');
            const second = await getChannelId('Channel');

            expect(first).toBeNull();
            expect(second).toBe('UCABC');
            expect(mockResolveUrl).toHaveBeenCalledTimes(1);
        });

        it('recovers after manager returns null instance and allows retry', async () => {
            mockManagerInstanceGet
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce(mockYoutubeInstance);
            mockResolveUrl.mockResolvedValueOnce({
                payload: { browseId: 'UCNULL' }
            });

            const first = await getChannelId('NullResult');
            const second = await getChannelId('NullResult');

            expect(first).toBeNull();
            expect(second).toBe('UCNULL');
            expect(mockResolveUrl).toHaveBeenCalledTimes(1);
            expect(mockErrorHandler.handleEventProcessingError).toHaveBeenCalled();
        });

        it('returns null when cache load throws synchronously', async () => {
            mockFs.existsSync.mockImplementation(() => { throw new Error('fs explode'); });

            const result = await getChannelId('Channel');

            expect(result).toBeNull();
            expect(mockErrorHandler.handleEventProcessingError).toHaveBeenCalled();
        });

        it('recovers when InnertubeFactory creation throws and clears ongoing tracker', async () => {
            mockManagerInstanceGet
                .mockImplementationOnce(async (id, factoryFn) => {
                    factoryFn();
                    throw new Error('factory fail');
                })
                .mockResolvedValueOnce(mockYoutubeInstance);
            mockResolveUrl.mockResolvedValueOnce({
                payload: { browseId: 'UCFACT' }
            });

            const first = await getChannelId('Factory');
            const second = await getChannelId('Factory');

            expect(first).toBeNull();
            expect(second).toBe('UCFACT');
            expect(mockResolveUrl).toHaveBeenCalledTimes(1);
            expect(mockErrorHandler.handleEventProcessingError).toHaveBeenCalled();
        });

        it('normalizes handle input before resolveURL', async () => {
            mockResolveUrl.mockResolvedValue({
                payload: { browseId: 'UCEXACT' }
            });

            const channelId = await getChannelId('@Exact');

            expect(channelId).toBe('UCEXACT');
            expect(mockResolveUrl).toHaveBeenCalledWith('https://www.youtube.com/@exact');
        });

        it('keeps in-memory cache even when cache save fails', async () => {
            mockResolveUrl.mockResolvedValue({
                payload: { browseId: 'UCFAIL' }
            });
            mockFs.writeFileSync.mockImplementation(() => { throw new Error('disk full'); });

            const first = await getChannelId('Channel');
            const second = await getChannelId('Channel');

            expect(first).toBe('UCFAIL');
            expect(second).toBe('UCFAIL');
            expect(mockResolveUrl).toHaveBeenCalledTimes(1);
        });

        it('allows refresh after clearing the in-memory cache', async () => {
            mockResolveUrl
                .mockResolvedValueOnce({
                    payload: { browseId: 'UCONE' }
                })
                .mockResolvedValueOnce({
                    payload: { browseId: 'UCTWO' }
                });

            const first = await getChannelId('Refresh');
            clearChannelCache();
            const second = await getChannelId('Refresh');

            expect(first).toBe('UCONE');
            expect(second).toBe('UCTWO');
            expect(mockResolveUrl).toHaveBeenCalledTimes(2);
        });

        it('returns null when resolveURL response has no payload', async () => {
            mockResolveUrl.mockResolvedValue({ payload: null });

            const channelId = await getChannelId('missing-payload');

            expect(channelId).toBeNull();
            expect(mockErrorHandler.handleEventProcessingError).toHaveBeenCalled();
        });

        it('saves resolved channel id to cache on cache miss', async () => {
            let writtenCache = null;
            mockFs.writeFileSync.mockImplementation((_, data) => { writtenCache = JSON.parse(data); });
            mockResolveUrl.mockResolvedValue({
                payload: { browseId: 'UCCACHE' }
            });

            const channelId = await getChannelId('CacheTest');

            expect(channelId).toBe('UCCACHE');
            expect(writtenCache).toMatchObject({ cachetest: 'UCCACHE' });
        });

        it('keeps separate ongoing requests per username', async () => {
            mockResolveUrl
                .mockResolvedValueOnce({ payload: { browseId: 'UCONE' } })
                .mockResolvedValueOnce({ payload: { browseId: 'UCTWO' } });

            const [one, two] = await Promise.all([
                getChannelId('One'),
                getChannelId('Two')
            ]);

            expect(one).toBe('UCONE');
            expect(two).toBe('UCTWO');
            expect(mockResolveUrl).toHaveBeenCalledTimes(2);
        });

        it('returns channel id when cache file absent without reading file', async () => {
            mockFs.existsSync.mockReturnValue(false);
            mockResolveUrl.mockResolvedValue({
                payload: { browseId: 'UCMISS' }
            });

            const channelId = await getChannelId('MissingCache');

            expect(channelId).toBe('UCMISS');
            expect(mockFs.readFileSync).not.toHaveBeenCalled();
        });

        it('allows retry after missing resolve payload to resolve on next attempt', async () => {
            mockResolveUrl
                .mockResolvedValueOnce({})
                .mockResolvedValueOnce({ payload: { browseId: 'UCNEXT' } });

            const first = await getChannelId('Next');
            const second = await getChannelId('Next');

            expect(first).toBeNull();
            expect(second).toBe('UCNEXT');
            expect(mockResolveUrl).toHaveBeenCalledTimes(2);
        });
    });

    describe('chat item extraction helpers', () => {
        it('extracts superchat and supersticker metadata', () => {
            const sc = extractSuperChatData({
                superchat: { amount: 5, currency: 'USD' },
                message: 'hi',
                author: { name: 'User' }
            });
            expect(sc).toMatchObject({ amount: 5, currency: 'USD', type: 'platform:gift', giftType: 'Super Chat', giftCount: 1, message: 'hi' });

            const sticker = extractSuperChatData({
                supersticker: { amount: 2, currency: 'ARS' },
                author: { name: 'User' }
            });
            expect(sticker.type).toBe('platform:gift');
            expect(sticker.giftType).toBe('Super Sticker');
            expect(sticker.amount).toBe(2);
        });

        it('prefers superchat when both superchat and supersticker are present', () => {
            const data = extractSuperChatData({
                superchat: { amount: 9, currency: 'EUR' },
                supersticker: { amount: 1, currency: 'USD' },
                message: 'priority',
                author: { name: 'Dual' }
            });

            expect(data.type).toBe('platform:gift');
            expect(data.giftType).toBe('Super Chat');
            expect(data.amount).toBe(9);
            expect(data.currency).toBe('EUR');
            expect(data.message).toBe('priority');
        });

        it('extracts membership metadata when flag present', () => {
            const data = extractMembershipData({
                isMembership: true,
                author: { name: 'Member' },
                message: 'welcome',
                timestamp: 123
            });
            expect(data).toMatchObject({ isMembership: true, author: { name: 'Member' }, message: 'welcome', timestamp: 123 });
        });

        it('returns null when membership flag is absent', () => {
            expect(extractMembershipData({ author: { name: 'Viewer' } })).toBeNull();
        });

        it('returns null when author data is missing', () => {
            expect(extractYouTubeUserData({ author: {} })).toBeNull();
            expect(extractYouTubeUserData({})).toBeNull();
        });

        it('preserves author privilege flags when present', () => {
            const user = extractYouTubeUserData({
                author: {
                    channelId: 'UC123',
                    name: 'Owner',
                    isOwner: true,
                    isModerator: true,
                    isVerified: true
                }
            });

            expect(user).toMatchObject({
                userId: 'UC123',
                username: 'Owner',
                isOwner: true,
                isModerator: true,
                isVerified: true
            });
        });

        it('returns null when channelId is missing', () => {
            const user = extractYouTubeUserData({
                author: {
                    name: 'NamedAnon'
                }
            });

            expect(user).toBeNull();
        });

        it('returns null when name is missing', () => {
            const user = extractYouTubeUserData({
                author: {
                    channelId: 'UCNAMELESS'
                }
            });

            expect(user).toBeNull();
        });

        it('returns null when chat item lacks superchat or supersticker data', () => {
            const result = extractSuperChatData({ message: 'hi' });

            expect(result).toBeNull();
        });

        it('omits superchat message when missing', () => {
            const data = extractSuperChatData({
                superchat: { amount: 7, currency: 'USD' },
                author: { name: 'User' }
            });

            expect(data.message).toBeUndefined();
        });

        it('throws when supersticker currency or author are missing', () => {
            const build = () => extractSuperChatData({
                supersticker: { amount: 3 }
            });

            expect(build).toThrow('SuperSticker requires currency');
        });

        it('throws when membership author is missing', () => {
            const build = () => extractMembershipData({
                isMembership: true,
                message: 'hello',
                timestamp: 123
            });

            expect(build).toThrow('requires author');
        });

        it('omits membership message when missing', () => {
            const membership = extractMembershipData({
                isMembership: true,
                author: { name: 'Member' },
                timestamp: 1700000000000
            });

            expect(membership.message).toBeUndefined();
        });

        it('throws when superchat currency is missing', () => {
            const build = () => extractSuperChatData({
                superchat: { amount: 10 },
                message: 'hello',
                author: { name: 'User' }
            });

            expect(build).toThrow('SuperChat requires currency');
        });

        it('throws when membership timestamp is missing', () => {
            const build = () => extractMembershipData({
                isMembership: true,
                author: { name: 'Member' }
            });

            expect(build).toThrow('requires timestamp');
        });
    });

    describe('formatSuperChatAmount', () => {
        it('formats USD and other currencies with amount', () => {
            expect(formatSuperChatAmount(5, 'USD')).toBe(' ($5.00)');
            expect(formatSuperChatAmount(10, 'ARS')).toBe(' (10.00 ARS)');
        });

        it('coerces numeric strings and ignores non-numeric values', () => {
            expect(formatSuperChatAmount('7', 'USD')).toBe(' ($7.00)');
            expect(formatSuperChatAmount('3.5', 'JPY')).toBe(' (3.50 JPY)');
            expect(formatSuperChatAmount('abc', 'USD')).toBe('');
        });

        it('returns empty string for zero or negative amounts', () => {
            expect(formatSuperChatAmount(0, 'USD')).toBe('');
            expect(formatSuperChatAmount(-1, 'USD')).toBe('');
        });

        it('returns empty string for non-finite amounts', () => {
            expect(formatSuperChatAmount(NaN, 'USD')).toBe('');
            expect(formatSuperChatAmount(Infinity, 'USD')).toBe('');
        });

        it('throws when currency is missing', () => {
            expect(() => formatSuperChatAmount(2)).toThrow('requires currency');
        });
    });
});
