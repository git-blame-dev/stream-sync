jest.unmock('../../../src/platforms/youtube');

const { initializeTestLogging, createMockConfig, createMockPlatformDependencies } = require('../../helpers/test-setup');

initializeTestLogging();

const { YouTubePlatform } = require('../../../src/platforms/youtube');

describe('YouTubePlatform connection state reporting', () => {
    let config;
    let dependencies;

    beforeEach(() => {
        config = createMockConfig('youtube', {
            enabled: true,
            username: 'test-channel'
        });
        dependencies = createMockPlatformDependencies('youtube');
    });

    it('returns connection state based on connection manager data', () => {
        const platform = new YouTubePlatform(config, dependencies);
        platform.connectionManager = {
            getConnectionCount: jest.fn(() => 2)
        };
        platform.getActiveYouTubeVideoIds = jest.fn(() => ['video-1', 'video-2']);
        platform.monitoringInterval = { id: 'interval' };
        platform.isAnyYouTubeStreamReady = jest.fn(() => false);

        const state = platform.getConnectionState();

        expect(state).toEqual({
            isConnected: true,
            isMonitoring: true,
            activeConnections: ['video-1', 'video-2'],
            totalConnections: 2
        });
    });

    it('summarizes stats using connection and monitoring status', () => {
        const platform = new YouTubePlatform(config, dependencies);
        platform.connectionManager = {
            getConnectionCount: jest.fn(() => 1)
        };
        platform.getActiveYouTubeVideoIds = jest.fn(() => ['video-1']);
        platform.monitoringInterval = { id: 'interval' };
        platform.isAnyYouTubeStreamReady = jest.fn(() => false);

        const stats = platform.getStats();

        expect(stats).toEqual({
            platform: 'youtube',
            enabled: config.enabled,
            connected: true,
            monitoring: true,
            activeConnections: 1,
            totalConnections: 1
        });
    });
});
