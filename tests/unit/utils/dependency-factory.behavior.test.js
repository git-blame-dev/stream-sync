const { describe, expect, beforeEach, it, afterEach } = require('bun:test');
const { restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { DependencyFactory } = require('../../../src/utils/dependency-factory');
const { _resetForTesting, initializeStaticSecrets } = require('../../../src/core/secrets');

describe('DependencyFactory behavior', () => {
    let factory;
    let configFixture;

    beforeEach(() => {
        factory = new DependencyFactory();
        configFixture = {
            general: { ignoreSelfMessages: false },
            twitch: { ignoreSelfMessages: false },
            youtube: { ignoreSelfMessages: false },
            tiktok: { ignoreSelfMessages: false }
        };
    });

    afterEach(() => {
        restoreAllMocks();
        _resetForTesting();
        initializeStaticSecrets();
    });

    describe('YouTube dependency validation', () => {
        it('requires API key when YouTube API is enabled', () => {
            _resetForTesting();
            expect(() => factory.createYoutubeDependencies({
                enableAPI: true,
                username: 'channel'
            }, { logger: noOpLogger, config: configFixture })).toThrow(/YouTube API key is required/);
        });

        it('creates dependencies object with expected structure when config is valid', () => {
            const deps = factory.createYoutubeDependencies({
                enableAPI: false,
                username: 'channel'
            }, { logger: noOpLogger, config: configFixture });

            expect(deps).toHaveProperty('apiClient');
            expect(deps).toHaveProperty('connectionManager');
            expect(deps).toHaveProperty('innertubeFactory');
        });
    });

    describe('TikTok dependency validation', () => {
        it('requires TikTok username', () => {
            expect(() => factory.createTiktokDependencies({}, { logger: noOpLogger, config: configFixture }))
                .toThrow(/TikTok username is required/);
        });
    });

    describe('Twitch dependency validation', () => {
        it('requires Twitch channel', () => {
            const twitchAuth = { isReady: () => true };
            expect(() => factory.createTwitchDependencies({}, { logger: noOpLogger, config: configFixture, twitchAuth }))
                .toThrow(/Twitch channel is required/);
        });

        it('requires twitchAuth to be injected', () => {
            expect(() => factory.createTwitchDependencies({ channel: 'me' }, { logger: noOpLogger, config: configFixture }))
                .toThrow(/createTwitchDependencies requires twitchAuth/);
        });
    });
});
