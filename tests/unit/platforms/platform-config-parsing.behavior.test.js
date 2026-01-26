const { describe, test, expect } = require('bun:test');
const { noOpLogger } = require('../../helpers/mock-factories');
const { createStreamElementsConfigFixture } = require('../../helpers/config-fixture');

const TwitchEventSub = require('../../../src/platforms/twitch-eventsub');
const { StreamElementsPlatform } = require('../../../src/platforms/streamelements');

describe('platform config parsing behavior', () => {

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
        const platform = new StreamElementsPlatform(
            createStreamElementsConfigFixture({
                jwtToken: 'test-jwt-token',
                youtubeChannelId: 'test-youtube-channel',
                twitchChannelId: 'test-twitch-channel',
                dataLoggingPath: './custom-logs'
            }),
            { logger: noOpLogger }
        );

        expect(platform.config.jwtToken).toBe('test-jwt-token');
        expect(platform.config.youtubeChannelId).toBe('test-youtube-channel');
        expect(platform.config.twitchChannelId).toBe('test-twitch-channel');
        expect(platform.config.dataLoggingPath).toBe('./custom-logs');
    });
});
