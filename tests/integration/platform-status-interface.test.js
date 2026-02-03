const { describe, test, expect, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { noOpLogger } = require('../helpers/mock-factories');
const {
    createTikTokConfigFixture,
    createTwitchConfigFixture,
    createYouTubeConfigFixture
} = require('../helpers/config-fixture');

const { TikTokPlatform } = require('../../src/platforms/tiktok');
const { TwitchPlatform } = require('../../src/platforms/twitch');
const { YouTubePlatform } = require('../../src/platforms/youtube');

const createTikTokPlatform = (configOverrides = {}) => {
    const config = createTikTokConfigFixture(configOverrides);

    return new TikTokPlatform(config, {
        logger: noOpLogger,
        notificationManager: {
            emit: createMockFn(),
            on: createMockFn(),
            removeListener: createMockFn(),
            handleNotification: createMockFn().mockResolvedValue()
        },
        TikTokWebSocketClient: createMockFn().mockImplementation(() => ({
            on: createMockFn(),
            off: createMockFn(),
            connect: createMockFn(),
            disconnect: createMockFn(),
            isConnecting: false,
            isConnected: false
        })),
        WebcastEvent: { ERROR: 'error', DISCONNECT: 'disconnect' },
        ControlEvent: {}
    });
};

const createTwitchPlatform = (configOverrides = {}) => {
    const config = createTwitchConfigFixture(configOverrides);

    return new TwitchPlatform(config, {
        logger: noOpLogger,
        twitchAuth: {
            isReady: () => true,
            getUserId: () => 'test-user-id'
        }
    });
};

const createYouTubePlatform = (configOverrides = {}) => {
    const config = createYouTubeConfigFixture(configOverrides);

    return new YouTubePlatform(config, {
        logger: noOpLogger,
        USER_AGENTS: ['test-agent'],
        streamDetectionService: {
            detectLiveStreams: createMockFn().mockResolvedValue({ success: true, videoIds: [] })
        }
    });
};

describe('Platform getStatus() interface standardization', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    describe('TikTok getStatus()', () => {
        test('returns standardized shape { isReady, issues }', () => {
            const platform = createTikTokPlatform();

            const status = platform.getStatus();

            expect(status).toHaveProperty('isReady');
            expect(status).toHaveProperty('issues');
            expect(typeof status.isReady).toBe('boolean');
            expect(Array.isArray(status.issues)).toBe(true);
        });

        test('isReady is true when enabled and connected', () => {
            const platform = createTikTokPlatform({ enabled: true });
            platform.connection = { isConnected: true };

            const status = platform.getStatus();

            expect(status.isReady).toBe(true);
            expect(status.issues).toEqual([]);
        });

        test('isReady is false when disabled with no issues (by design)', () => {
            const platform = createTikTokPlatform({ enabled: false });

            const status = platform.getStatus();

            expect(status.isReady).toBe(false);
            expect(status.issues).toEqual([]);
        });

        test('isReady is false with issue when enabled but not connected', () => {
            const platform = createTikTokPlatform({ enabled: true });
            platform.connection = null;

            const status = platform.getStatus();

            expect(status.isReady).toBe(false);
            expect(status.issues).toContain('Not connected');
        });
    });

    describe('Twitch getStatus()', () => {
        test('returns standardized shape { isReady, issues }', () => {
            const platform = createTwitchPlatform();

            const status = platform.getStatus();

            expect(status).toHaveProperty('isReady');
            expect(status).toHaveProperty('issues');
            expect(typeof status.isReady).toBe('boolean');
            expect(Array.isArray(status.issues)).toBe(true);
        });

        test('isReady is true when enabled and EventSub connected', () => {
            const platform = createTwitchPlatform({ enabled: true });
            platform.eventSub = { isConnected: () => true };

            const status = platform.getStatus();

            expect(status.isReady).toBe(true);
            expect(status.issues).toEqual([]);
        });

        test('isReady is false when disabled with no issues (by design)', () => {
            const platform = createTwitchPlatform({ enabled: false });

            const status = platform.getStatus();

            expect(status.isReady).toBe(false);
            expect(status.issues).toEqual([]);
        });

        test('isReady is false with issue when enabled but not connected', () => {
            const platform = createTwitchPlatform({ enabled: true });
            platform.eventSub = null;

            const status = platform.getStatus();

            expect(status.isReady).toBe(false);
            expect(status.issues).toContain('Not connected');
        });
    });

    describe('YouTube getStatus()', () => {
        test('returns standardized shape { isReady, issues }', () => {
            const platform = createYouTubePlatform();

            const status = platform.getStatus();

            expect(status).toHaveProperty('isReady');
            expect(status).toHaveProperty('issues');
            expect(typeof status.isReady).toBe('boolean');
            expect(Array.isArray(status.issues)).toBe(true);
        });

        test('isReady is true when enabled and has connections', () => {
            const platform = createYouTubePlatform({ enabled: true });
            platform.connectionManager = {
                getConnectionCount: () => 1
            };

            const status = platform.getStatus();

            expect(status.isReady).toBe(true);
            expect(status.issues).toEqual([]);
        });

        test('isReady is false when disabled with no issues (by design)', () => {
            const platform = createYouTubePlatform({ enabled: false });

            const status = platform.getStatus();

            expect(status.isReady).toBe(false);
            expect(status.issues).toEqual([]);
        });

        test('isReady is false with issue when enabled but no connections', () => {
            const platform = createYouTubePlatform({ enabled: true });
            platform.connectionManager = { getConnectionCount: () => 0 };

            const status = platform.getStatus();

            expect(status.isReady).toBe(false);
            expect(status.issues).toContain('Not connected');
        });
    });

    describe('Cross-platform interface consistency', () => {
        test('all platforms return identical getStatus() structure', () => {
            const tiktok = createTikTokPlatform();
            const twitch = createTwitchPlatform();
            const youtube = createYouTubePlatform();

            const tiktokStatus = tiktok.getStatus();
            const twitchStatus = twitch.getStatus();
            const youtubeStatus = youtube.getStatus();

            const expectedKeys = ['isReady', 'issues'];
            expect(Object.keys(tiktokStatus).sort()).toEqual(expectedKeys);
            expect(Object.keys(twitchStatus).sort()).toEqual(expectedKeys);
            expect(Object.keys(youtubeStatus).sort()).toEqual(expectedKeys);
        });
    });
});
