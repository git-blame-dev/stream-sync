const { describe, expect, beforeEach, it, afterEach } = require('bun:test');
const { restoreAllMocks, createMockFn } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { DependencyFactory } = require('../../../src/utils/dependency-factory');

describe('DependencyFactory behavior', () => {
    let factory;
    let mockConfigManager;

    beforeEach(() => {
        factory = new DependencyFactory();
        mockConfigManager = {
            getBoolean: createMockFn().mockReturnValue(false),
            getString: createMockFn().mockReturnValue(''),
            getNumber: createMockFn().mockReturnValue(0)
        };
    });

    afterEach(() => {
        restoreAllMocks();
    });

    describe('YouTube dependency validation', () => {
        it('requires API key when YouTube API is enabled', () => {
            expect(() => factory.createYoutubeDependencies({
                enableAPI: true,
                username: 'channel'
            }, { logger: noOpLogger, config: mockConfigManager })).toThrow(/YouTube API key is required/);
        });

        it('creates dependencies object with expected structure when config is valid', () => {
            const deps = factory.createYoutubeDependencies({
                enableAPI: false,
                username: 'channel',
                apiKey: 'testKey'
            }, { logger: noOpLogger, config: mockConfigManager });

            expect(deps).toHaveProperty('apiClient');
            expect(deps).toHaveProperty('connectionManager');
            expect(deps).toHaveProperty('innertubeFactory');
        });
    });

    describe('TikTok dependency validation', () => {
        it('requires TikTok username', () => {
            expect(() => factory.createTiktokDependencies({}, { logger: noOpLogger, config: mockConfigManager }))
                .toThrow(/TikTok username is required/);
        });
    });

    describe('Twitch dependency validation', () => {
        it('requires Twitch channel', () => {
            expect(() => factory.createTwitchDependencies({}, { logger: noOpLogger, config: mockConfigManager }))
                .toThrow(/Twitch channel is required/);
        });

        it('requires Twitch client credentials for auth manager', () => {
            expect(() => factory.createTwitchDependencies({ channel: 'me' }, { logger: noOpLogger, config: mockConfigManager }))
                .toThrow(/missing fields \[clientId, clientSecret\]/);
        });
    });
});
