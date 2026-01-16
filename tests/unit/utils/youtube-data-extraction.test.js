const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const { TEST_TIMEOUTS } = require('../../helpers/test-setup');
const { noOpLogger, createMockFileSystem } = require('../../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');
const testClock = require('../../helpers/test-clock');

const {
    YouTubeChannelResolver,
    extractSuperChatData,
    extractMembershipData,
    extractYouTubeUserData,
    formatSuperChatAmount
} = require('../../../src/utils/youtube-data-extraction');

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

describe('YouTube Data Extraction', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    let resolver;
    let mockLogger;
    let mockFileSystem;
    let mockInstanceManager;
    let mockInnertubeFactory;
    let mockChannelResolver;
    const CACHE_PATH = '/path/to/cache.json';

    beforeEach(() => {
        mockLogger = noOpLogger;
        mockFileSystem = createMockFileSystem();

        mockInstanceManager = {
            getInstance: createMockFn().mockReturnValue({
                getInstance: createMockFn()
            })
        };

        mockInnertubeFactory = {
            createWithTimeout: createMockFn()
        };

        mockChannelResolver = {
            normalizeChannelHandle: createMockFn().mockImplementation(handle => {
                if (!handle) return null;
                return handle.replace(/^@/, '').toLowerCase();
            }),
            normalizeHandleForCache: createMockFn().mockImplementation(handle => {
                if (!handle) return null;
                return handle.toLowerCase();
            }),
            resolveChannelId: createMockFn()
        };

        resolver = new YouTubeChannelResolver({
            fileSystem: mockFileSystem,
            logger: mockLogger,
            innertubeInstanceManager: mockInstanceManager,
            innertubeFactory: mockInnertubeFactory,
            channelResolver: mockChannelResolver
        });

        resolver.configureChannelCache({ enabled: true, filePath: CACHE_PATH });
    });

    describe('Channel ID Resolution via YouTube resolveURL', () => {
        test('should successfully resolve channel ID via resolveURL', async () => {
            const manager = mockInstanceManager.getInstance();
            manager.getInstance.mockResolvedValue({});
            mockChannelResolver.resolveChannelId.mockImplementation(async (yt, handle) => {
                return handle === 'testuser' ? 'UC-EXACT-MATCH-ID' : null;
            });

            const channelId = await resolver.getChannelId('testuser');

            expect(channelId).toBe('UC-EXACT-MATCH-ID');
        }, TEST_TIMEOUTS.FAST);

        test('should resolve channel ID when given @handle format', async () => {
            const manager = mockInstanceManager.getInstance();
            manager.getInstance.mockResolvedValue({});
            mockChannelResolver.resolveChannelId.mockImplementation(async (yt, handle) => {
                return handle === 'testuser' ? 'UC-HANDLE-ID' : null;
            });

            const channelId = await resolver.getChannelId('@TestUser');

            expect(channelId).toBe('UC-HANDLE-ID');
        }, TEST_TIMEOUTS.FAST);

        test('should return null when channel resolution fails', async () => {
            const manager = mockInstanceManager.getInstance();
            manager.getInstance.mockResolvedValue({});
            mockChannelResolver.resolveChannelId.mockResolvedValue(null);

            const channelId = await resolver.getChannelId('nonexistentuser');

            expect(channelId).toBeNull();
        }, TEST_TIMEOUTS.FAST);

        test('should handle resolveURL errors gracefully', async () => {
            const manager = mockInstanceManager.getInstance();
            manager.getInstance.mockResolvedValue({});
            mockChannelResolver.resolveChannelId.mockRejectedValue(new Error('YouTube API rate limit exceeded'));

            const channelId = await resolver.getChannelId('erroruser');

            expect(channelId).toBeNull();
        }, TEST_TIMEOUTS.FAST);

        test('should return null when no username provided', async () => {
            mockChannelResolver.normalizeChannelHandle.mockReturnValue(null);

            const channelId = await resolver.getChannelId(null);

            expect(channelId).toBeNull();
        }, TEST_TIMEOUTS.FAST);

        test('should handle resolveURL responses without payload', async () => {
            const manager = mockInstanceManager.getInstance();
            manager.getInstance.mockResolvedValue({});
            mockChannelResolver.resolveChannelId.mockResolvedValue(null);

            const channelId = await resolver.getChannelId('testuser');

            expect(channelId).toBeNull();
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Caching Behavior', () => {
        test('should cache successful channel ID lookups', async () => {
            const manager = mockInstanceManager.getInstance();
            manager.getInstance.mockResolvedValue({});
            mockChannelResolver.resolveChannelId.mockResolvedValue('UC-CACHE-TEST');

            const channelId1 = await resolver.getChannelId('cacheuser');
            expect(channelId1).toBe('UC-CACHE-TEST');
            expect(mockChannelResolver.resolveChannelId).toHaveBeenCalledTimes(1);

            const channelId2 = await resolver.getChannelId('cacheuser');
            expect(channelId2).toBe('UC-CACHE-TEST');
            expect(mockChannelResolver.resolveChannelId).toHaveBeenCalledTimes(1);
        }, TEST_TIMEOUTS.MEDIUM);

        test('should load existing cache on startup', async () => {
            mockFileSystem.existsSync.mockReturnValue(true);
            mockFileSystem.readFileSync.mockReturnValue(JSON.stringify({ existinguser: 'UC-EXISTING-ID' }));

            const freshResolver = new YouTubeChannelResolver({
                fileSystem: mockFileSystem,
                logger: mockLogger,
                innertubeInstanceManager: mockInstanceManager,
                innertubeFactory: mockInnertubeFactory,
                channelResolver: mockChannelResolver
            });
            freshResolver.configureChannelCache({ enabled: true, filePath: CACHE_PATH });

            const channelId = await freshResolver.getChannelId('existinguser');

            expect(channelId).toBe('UC-EXISTING-ID');
        }, TEST_TIMEOUTS.FAST);

        test('should not cache failed lookups', async () => {
            const manager = mockInstanceManager.getInstance();
            manager.getInstance.mockResolvedValue({});
            mockChannelResolver.resolveChannelId.mockResolvedValue(null);

            const channelId1 = await resolver.getChannelId('faileduser');
            expect(channelId1).toBeNull();

            const channelId2 = await resolver.getChannelId('faileduser');
            expect(channelId2).toBeNull();
            expect(mockChannelResolver.resolveChannelId).toHaveBeenCalledTimes(2);
        }, TEST_TIMEOUTS.MEDIUM);

        test('should handle cache file corruption gracefully', async () => {
            mockFileSystem.existsSync.mockReturnValue(true);
            mockFileSystem.readFileSync.mockImplementation(() => { throw new Error('File corrupted'); });

            const manager = mockInstanceManager.getInstance();
            manager.getInstance.mockResolvedValue({});
            mockChannelResolver.resolveChannelId.mockResolvedValue('UC-RECOVERY-ID');

            const channelId = await resolver.getChannelId('recoveryuser');

            expect(channelId).toBe('UC-RECOVERY-ID');
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Error Recovery and Race Conditions', () => {
        test('should handle Innertube creation timeout gracefully', async () => {
            const manager = mockInstanceManager.getInstance();
            manager.getInstance.mockRejectedValue(new Error('Innertube creation timeout (30s)'));

            const channelId = await resolver.getChannelId('timeoutuser');

            expect(channelId).toBeNull();
        }, TEST_TIMEOUTS.FAST);

        test('should handle YouTube API rate limiting gracefully', async () => {
            const manager = mockInstanceManager.getInstance();
            manager.getInstance.mockResolvedValue({});
            mockChannelResolver.resolveChannelId.mockRejectedValue(new Error('Request failed with status code 429'));

            const channelId = await resolver.getChannelId('ratelimituser');

            expect(channelId).toBeNull();
        }, TEST_TIMEOUTS.FAST);

        test('should handle instance manager failures gracefully', async () => {
            const manager = mockInstanceManager.getInstance();
            manager.getInstance.mockRejectedValue(new Error('Instance creation failed'));

            const channelId = await resolver.getChannelId('instancefailuser');

            expect(channelId).toBeNull();
        }, TEST_TIMEOUTS.FAST);

        test('should prevent race conditions with concurrent requests', async () => {
            const manager = mockInstanceManager.getInstance();
            manager.getInstance.mockResolvedValue({});
            mockChannelResolver.resolveChannelId.mockResolvedValue('UC-RACE-TEST');

            const promises = [
                resolver.getChannelId('raceuser'),
                resolver.getChannelId('raceuser'),
                resolver.getChannelId('raceuser')
            ];
            const results = await Promise.all(promises);

            results.forEach(result => expect(result).toBe('UC-RACE-TEST'));
            expect(mockChannelResolver.resolveChannelId).toHaveBeenCalledTimes(1);
        }, TEST_TIMEOUTS.MEDIUM);
    });

    describe('Performance and Cache Efficiency', () => {
        test('should handle rapid successive calls efficiently with race condition prevention', async () => {
            const manager = mockInstanceManager.getInstance();
            manager.getInstance.mockResolvedValue({});
            mockChannelResolver.resolveChannelId.mockResolvedValue('UC-PERF-TEST');

            const startTime = testClock.now();

            const promises = [];
            for (let i = 0; i < 5; i++) {
                promises.push(resolver.getChannelId('perfuser'));
            }

            const results = await Promise.all(promises);
            testClock.advance(25);
            const duration = testClock.now() - startTime;

            results.forEach(result => expect(result).toBe('UC-PERF-TEST'));
            expect(duration).toBeLessThan(100);
            expect(mockChannelResolver.resolveChannelId).toHaveBeenCalledTimes(1);
        }, TEST_TIMEOUTS.FAST);

        test('should maintain cache efficiency across different users', async () => {
            const users = ['user1', 'user2', 'user3'];
            const manager = mockInstanceManager.getInstance();
            manager.getInstance.mockResolvedValue({});
            mockChannelResolver.resolveChannelId.mockResolvedValue('UC-MULTI-TEST');

            for (const user of users) {
                await resolver.getChannelId(user);
            }

            expect(mockChannelResolver.resolveChannelId).toHaveBeenCalledTimes(3);
        }, TEST_TIMEOUTS.FAST);

        test('should complete individual resolves under performance target', async () => {
            const manager = mockInstanceManager.getInstance();
            manager.getInstance.mockResolvedValue({});
            mockChannelResolver.resolveChannelId.mockResolvedValue('UC-SINGLE-PERF');

            const startTime = testClock.now();
            const channelId = await resolver.getChannelId('singleuser');
            testClock.advance(15);
            const duration = testClock.now() - startTime;

            expect(channelId).toBe('UC-SINGLE-PERF');
            expect(duration).toBeLessThan(50);
        }, TEST_TIMEOUTS.FAST);
    });
});

describe('Pure Function Extraction Helpers', () => {
    describe('extractSuperChatData', () => {
        test('extracts superchat metadata', () => {
            const result = extractSuperChatData({
                superchat: { amount: 5, currency: 'USD' },
                message: 'hi',
                author: { name: 'testUser' }
            });

            expect(result).toMatchObject({
                amount: 5,
                currency: 'USD',
                type: 'platform:gift',
                giftType: 'Super Chat',
                giftCount: 1,
                message: 'hi'
            });
        });

        test('extracts supersticker metadata', () => {
            const result = extractSuperChatData({
                supersticker: { amount: 2, currency: 'ARS' },
                author: { name: 'testUser' }
            });

            expect(result.type).toBe('platform:gift');
            expect(result.giftType).toBe('Super Sticker');
            expect(result.amount).toBe(2);
        });

        test('prefers superchat when both present', () => {
            const result = extractSuperChatData({
                superchat: { amount: 9, currency: 'EUR' },
                supersticker: { amount: 1, currency: 'USD' },
                message: 'priority',
                author: { name: 'testDual' }
            });

            expect(result.giftType).toBe('Super Chat');
            expect(result.amount).toBe(9);
        });

        test('returns null when neither superchat nor supersticker present', () => {
            expect(extractSuperChatData({ message: 'hi' })).toBeNull();
        });

        test('throws when superchat currency missing', () => {
            expect(() => extractSuperChatData({
                superchat: { amount: 10 },
                author: { name: 'testUser' }
            })).toThrow('SuperChat requires currency');
        });

        test('throws when supersticker currency missing', () => {
            expect(() => extractSuperChatData({
                supersticker: { amount: 3 }
            })).toThrow('SuperSticker requires currency');
        });
    });

    describe('extractMembershipData', () => {
        test('extracts membership metadata when flag present', () => {
            const result = extractMembershipData({
                isMembership: true,
                author: { name: 'testMember' },
                message: 'welcome',
                timestamp: 123
            });

            expect(result).toMatchObject({
                isMembership: true,
                author: { name: 'testMember' },
                message: 'welcome',
                timestamp: 123
            });
        });

        test('returns null when membership flag absent', () => {
            expect(extractMembershipData({ author: { name: 'testViewer' } })).toBeNull();
        });

        test('throws when author missing', () => {
            expect(() => extractMembershipData({
                isMembership: true,
                timestamp: 123
            })).toThrow('requires author');
        });

        test('throws when timestamp missing', () => {
            expect(() => extractMembershipData({
                isMembership: true,
                author: { name: 'testMember' }
            })).toThrow('requires timestamp');
        });
    });

    describe('extractYouTubeUserData', () => {
        test('extracts user data with privilege flags', () => {
            const result = extractYouTubeUserData({
                author: {
                    channelId: 'UC-TEST-123',
                    name: 'testOwner',
                    isOwner: true,
                    isModerator: true,
                    isVerified: true
                }
            });

            expect(result).toMatchObject({
                userId: 'UC-TEST-123',
                username: 'testOwner',
                isOwner: true,
                isModerator: true,
                isVerified: true
            });
        });

        test('returns null when channelId missing', () => {
            expect(extractYouTubeUserData({
                author: { name: 'testNamedAnon' }
            })).toBeNull();
        });

        test('returns null when name missing', () => {
            expect(extractYouTubeUserData({
                author: { channelId: 'UC-NAMELESS' }
            })).toBeNull();
        });

        test('returns null when author missing', () => {
            expect(extractYouTubeUserData({})).toBeNull();
        });
    });

    describe('formatSuperChatAmount', () => {
        test('formats USD amounts', () => {
            expect(formatSuperChatAmount(5, 'USD')).toBe(' ($5.00)');
        });

        test('formats other currencies with code', () => {
            expect(formatSuperChatAmount(10, 'ARS')).toBe(' (10.00 ARS)');
        });

        test('coerces numeric strings', () => {
            expect(formatSuperChatAmount('7', 'USD')).toBe(' ($7.00)');
        });

        test('returns empty string for zero or negative amounts', () => {
            expect(formatSuperChatAmount(0, 'USD')).toBe('');
            expect(formatSuperChatAmount(-1, 'USD')).toBe('');
        });

        test('returns empty string for non-finite amounts', () => {
            expect(formatSuperChatAmount(NaN, 'USD')).toBe('');
            expect(formatSuperChatAmount(Infinity, 'USD')).toBe('');
        });

        test('throws when currency missing', () => {
            expect(() => formatSuperChatAmount(2)).toThrow('requires currency');
        });
    });
});
