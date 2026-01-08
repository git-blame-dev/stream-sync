
const { initializeTestLogging } = require('../../helpers/test-setup');

// Initialize logging for tests
initializeTestLogging();

describe('Centralized Endpoints Configuration', () => {
    let endpoints;

    beforeEach(() => {
        // Import fresh endpoints configuration for each test
        endpoints = require('../../../src/core/endpoints');
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    describe('Twitch Endpoints', () => {
        test('should provide Twitch API base URL', () => {
            expect(endpoints.TWITCH.API_BASE).toBe('https://api.twitch.tv/helix');
        });

        test('should provide Twitch OAuth URLs', () => {
            expect(endpoints.TWITCH.OAUTH.TOKEN).toBe('https://id.twitch.tv/oauth2/token');
            expect(endpoints.TWITCH.OAUTH.VALIDATE).toBe('https://id.twitch.tv/oauth2/validate');
            expect(endpoints.TWITCH.OAUTH.REVOKE).toBe('https://id.twitch.tv/oauth2/revoke');
        });

        test('should provide Twitch EventSub WebSocket URL', () => {
            expect(endpoints.TWITCH.EVENTSUB_WS).toBe('wss://eventsub.wss.twitch.tv/ws');
        });

        test('should provide Twitch GraphQL endpoint', () => {
            expect(endpoints.TWITCH.GRAPHQL).toBe('https://gql.twitch.tv/gql');
        });

        test('should provide method to build Twitch API URLs', () => {
            const userUrl = endpoints.TWITCH.buildApiUrl('users');
            expect(userUrl).toBe('https://api.twitch.tv/helix/users');

            const subscriptionsUrl = endpoints.TWITCH.buildApiUrl('eventsub/subscriptions');
            expect(subscriptionsUrl).toBe('https://api.twitch.tv/helix/eventsub/subscriptions');
        });
    });

    describe('YouTube Endpoints', () => {
        test('should provide YouTube base URLs', () => {
            expect(endpoints.YOUTUBE.BASE).toBe('https://www.youtube.com');
            expect(endpoints.YOUTUBE.API_BASE).toBe('https://youtube.googleapis.com/youtube/v3');
        });

        test('should provide methods to build YouTube channel URLs', () => {
            const channelUrl = endpoints.YOUTUBE.buildChannelUrl('testuser');
            expect(channelUrl).toBe('https://www.youtube.com/@testuser');

            const handleUrl = endpoints.YOUTUBE.buildHandleUrl('testhandle');
            expect(handleUrl).toBe('https://www.youtube.com/testhandle');
        });

        test('should provide methods to build YouTube streaming URLs', () => {
            const streamsUrl = endpoints.YOUTUBE.buildStreamsUrl('testhandle');
            expect(streamsUrl).toBe('https://www.youtube.com/testhandle/streams');

            const liveUrl = endpoints.YOUTUBE.buildLiveUrl('testuser');
            expect(liveUrl).toBe('https://www.youtube.com/@testuser/live');
        });

        test('should provide YouTube API methods', () => {
            const apiKey = 'test-api-key';
            const videosUrl = endpoints.YOUTUBE.buildApiUrl('videos', { key: apiKey, id: 'video123' });
            expect(videosUrl).toBe('https://youtube.googleapis.com/youtube/v3/videos?key=test-api-key&id=video123');

            const channelsUrl = endpoints.YOUTUBE.buildApiUrl('channels', { key: apiKey, forUsername: 'testuser' });
            expect(channelsUrl).toBe('https://youtube.googleapis.com/youtube/v3/channels?key=test-api-key&forUsername=testuser');
        });
    });

    describe('TikTok Endpoints', () => {
        test('should provide TikTok base URL', () => {
            expect(endpoints.TIKTOK.BASE).toBe('https://www.tiktok.com');
        });

        test('should provide method to build TikTok live URLs', () => {
            const liveUrl = endpoints.TIKTOK.buildLiveUrl('testuser');
            expect(liveUrl).toBe('https://www.tiktok.com/@testuser/live');
        });

        test('should provide method to build TikTok profile URLs', () => {
            const profileUrl = endpoints.TIKTOK.buildProfileUrl('testuser');
            expect(profileUrl).toBe('https://www.tiktok.com/@testuser');
        });
    });

    describe('StreamElements Endpoints', () => {
        test('should provide StreamElements WebSocket URL', () => {
            expect(endpoints.STREAMELEMENTS.WEBSOCKET).toBe('wss://astro.streamelements.com/ws');
        });

        test('should provide StreamElements API base', () => {
            expect(endpoints.STREAMELEMENTS.API_BASE).toBe('https://api.streamelements.com/kappa/v2');
        });

        test('should provide method to build StreamElements API URLs', () => {
            const activitiesUrl = endpoints.STREAMELEMENTS.buildApiUrl('activities/channelId');
            expect(activitiesUrl).toBe('https://api.streamelements.com/kappa/v2/activities/channelId');
        });
    });

    describe('URL Building Utilities', () => {
        test('should handle empty path segments gracefully', () => {
            const url = endpoints.TWITCH.buildApiUrl('');
            expect(url).toBe('https://api.twitch.tv/helix');
        });

        test('should handle leading slashes in paths', () => {
            const url = endpoints.TWITCH.buildApiUrl('/users');
            expect(url).toBe('https://api.twitch.tv/helix/users');
        });

        test('should build query parameters correctly', () => {
            const url = endpoints.YOUTUBE.buildApiUrl('search', {
                key: 'api-key',
                channelId: 'UC123',
                type: 'video',
                order: 'date'
            });
            expect(url).toBe('https://youtube.googleapis.com/youtube/v3/search?key=api-key&channelId=UC123&type=video&order=date');
        });

        test('should handle special characters in parameters', () => {
            const url = endpoints.YOUTUBE.buildApiUrl('search', {
                key: 'api-key',
                q: 'search term with spaces'
            });
            expect(url).toBe('https://youtube.googleapis.com/youtube/v3/search?key=api-key&q=search%20term%20with%20spaces');
        });
    });

    describe('Environment-Specific Configuration', () => {
        test('should support environment override for development', () => {
            // This test documents future environment-specific URL support
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'development';
            
            // For now, URLs should remain the same regardless of environment
            // In the future, this could point to dev/staging APIs
            expect(endpoints.TWITCH.API_BASE).toBe('https://api.twitch.tv/helix');
            
            process.env.NODE_ENV = originalEnv;
        });
    });

    describe('Backward Compatibility', () => {
        test('should export individual platform configurations for migration', () => {
            // These exports help with gradual migration from hardcoded URLs
            expect(endpoints.TWITCH).toBeDefined();
            expect(endpoints.YOUTUBE).toBeDefined();
            expect(endpoints.TIKTOK).toBeDefined();
            expect(endpoints.STREAMELEMENTS).toBeDefined();
        });

        test('should provide getAllEndpoints method for debugging', () => {
            const allEndpoints = endpoints.getAllEndpoints();
            expect(allEndpoints).toHaveProperty('TWITCH');
            expect(allEndpoints).toHaveProperty('YOUTUBE');
            expect(allEndpoints).toHaveProperty('TIKTOK');
            expect(allEndpoints).toHaveProperty('STREAMELEMENTS');
        });
    });
});