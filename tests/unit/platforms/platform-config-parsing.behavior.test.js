const { describe, test, expect } = require('bun:test');
const { requireActual } = require('../../helpers/bun-module-mocks');

const TwitchEventSub = requireActual('../../../src/platforms/twitch-eventsub');
const { StreamElementsPlatform } = requireActual('../../../src/platforms/streamelements');

describe('platform config parsing behavior', () => {
    test('TwitchEventSub parses dataLoggingEnabled string values', () => {
        const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
        const eventSub = new TwitchEventSub({ dataLoggingEnabled: 'true' }, { logger: noopLogger });

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
        const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
        const platform = new StreamElementsPlatform(
            { enabled: 'true', dataLoggingEnabled: 'false' },
            { logger: noopLogger }
        );

        expect(platform.config.enabled).toBe(true);
        expect(platform.config.dataLoggingEnabled).toBe(false);
    });

    test('StreamElementsPlatform trims blank secrets and channel IDs', () => {
        const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
        const platform = new StreamElementsPlatform(
            {
                enabled: true,
                jwtToken: '   ',
                youtubeChannelId: ' ',
                twitchChannelId: '\n',
                dataLoggingPath: '   '
            },
            { logger: noopLogger }
        );

        expect(platform.config.jwtToken).toBeUndefined();
        expect(platform.config.youtubeChannelId).toBeUndefined();
        expect(platform.config.twitchChannelId).toBeUndefined();
        expect(platform.config.dataLoggingPath).toBeUndefined();
    });
});
