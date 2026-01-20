const { describe, expect, beforeEach, it, afterEach } = require('bun:test');
const { restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { DependencyFactory } = require('../../../src/utils/dependency-factory');

describe('DependencyFactory behavior', () => {
    let factory;

    beforeEach(() => {
        factory = new DependencyFactory();
    });

    afterEach(() => {
        restoreAllMocks();
    });

    describe('YouTube dependency validation', () => {
        it('requires API key when YouTube API is enabled', () => {
            expect(() => factory.createYoutubeDependencies({
                enableAPI: true,
                username: 'channel'
            }, { logger: noOpLogger })).toThrow(/YouTube API key is required/);
        });

        it('creates dependencies object with expected structure when config is valid', () => {
            const deps = factory.createYoutubeDependencies({
                enableAPI: false,
                username: 'channel',
                apiKey: 'testKey'
            }, { logger: noOpLogger });

            expect(deps).toHaveProperty('apiClient');
            expect(deps).toHaveProperty('connectionManager');
            expect(deps).toHaveProperty('innertubeFactory');
        });
    });

    describe('TikTok dependency validation', () => {
        it('requires TikTok username', () => {
            expect(() => factory.createTiktokDependencies({}, { logger: noOpLogger }))
                .toThrow(/TikTok username is required/);
        });
    });

    describe('Twitch dependency validation', () => {
        it('requires Twitch channel', () => {
            expect(() => factory.createTwitchDependencies({}, { logger: noOpLogger }))
                .toThrow(/Twitch channel is required/);
        });

        it('requires Twitch client credentials for auth manager', () => {
            expect(() => factory.createTwitchDependencies({ channel: 'me' }, { logger: noOpLogger }))
                .toThrow(/missing fields \[clientId, clientSecret\]/);
        });
    });
});
