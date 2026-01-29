const { describe, test, expect, afterEach } = require('bun:test');
const { noOpLogger } = require('../../helpers/mock-factories');
const { createStreamElementsConfigFixture } = require('../../helpers/config-fixture');
const { secrets, _resetForTesting, initializeStaticSecrets } = require('../../../src/core/secrets');

const TwitchEventSub = require('../../../src/platforms/twitch-eventsub');
const { StreamElementsPlatform } = require('../../../src/platforms/streamelements');

describe('platform config parsing behavior', () => {
    afterEach(() => {
        _resetForTesting();
        initializeStaticSecrets();
    });

    class MockWebSocket {
        constructor() {
            this.readyState = 0;
        }
        close() {}
    }

    test('TwitchEventSub stores normalized config values', () => {
        const eventSub = new TwitchEventSub(
            { dataLoggingEnabled: true, broadcasterId: 'test-broadcaster-id', dataLoggingPath: './logs' },
            { logger: noOpLogger, WebSocketCtor: MockWebSocket }
        );

        try {
            expect(eventSub.config.dataLoggingEnabled).toBe(true);
        } finally {
            if (eventSub.cleanupInterval) {
                clearInterval(eventSub.cleanupInterval);
                eventSub.cleanupInterval = null;
            }
        }
    });

    test('StreamElementsPlatform stores normalized config values', () => {
        const platform = new StreamElementsPlatform(
            createStreamElementsConfigFixture(),
            { logger: noOpLogger }
        );

        expect(platform.config.enabled).toBe(true);
        expect(platform.config.dataLoggingEnabled).toBe(false);
    });

    test('StreamElementsPlatform uses provided channel IDs and paths', () => {
        const jwtToken = 'test-jwt-token';
        secrets.streamelements.jwtToken = jwtToken;
        const platform = new StreamElementsPlatform(
            createStreamElementsConfigFixture({
                youtubeChannelId: 'test-youtube-channel',
                twitchChannelId: 'test-twitch-channel',
                dataLoggingPath: './custom-logs'
            }),
            { logger: noOpLogger }
        );

        expect(platform.config.jwtToken).toBe(jwtToken);
        expect(platform.config.youtubeChannelId).toBe('test-youtube-channel');
        expect(platform.config.twitchChannelId).toBe('test-twitch-channel');
        expect(platform.config.dataLoggingPath).toBe('./custom-logs');
    });
});
