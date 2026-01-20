const { describe, test, expect } = require('bun:test');
const { noOpLogger } = require('../../helpers/mock-factories');

const TwitchEventSub = require('../../../src/platforms/twitch-eventsub');
const { StreamElementsPlatform } = require('../../../src/platforms/streamelements');

describe('platform config parsing behavior', () => {

    class MockWebSocket {
        constructor() {
            this.readyState = 0;
        }
        close() {}
    }

    test('TwitchEventSub parses dataLoggingEnabled string values', () => {
        const eventSub = new TwitchEventSub(
            { dataLoggingEnabled: 'true', broadcasterId: 'test-broadcaster-id' },
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

    test('StreamElementsPlatform parses enabled and dataLoggingEnabled string values', () => {
        const platform = new StreamElementsPlatform(
            { enabled: 'true', dataLoggingEnabled: 'false' },
            { logger: noOpLogger }
        );

        expect(platform.config.enabled).toBe(true);
        expect(platform.config.dataLoggingEnabled).toBe(false);
    });

    test('StreamElementsPlatform trims blank secrets and channel IDs', () => {
        const platform = new StreamElementsPlatform(
            {
                enabled: true,
                jwtToken: '   ',
                youtubeChannelId: ' ',
                twitchChannelId: '\n',
                dataLoggingPath: '   '
            },
            { logger: noOpLogger }
        );

        expect(platform.config.jwtToken).toBeUndefined();
        expect(platform.config.youtubeChannelId).toBeUndefined();
        expect(platform.config.twitchChannelId).toBeUndefined();
        expect(platform.config.dataLoggingPath).toBeUndefined();
    });
});
