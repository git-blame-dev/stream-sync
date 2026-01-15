const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, spyOn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const { DependencyFactory } = require('../../../src/utils/dependency-factory');

describe('DependencyFactory behavior', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    let factory;

    beforeEach(() => {
        factory = new DependencyFactory();
        spyOn(factory, '_validateConfiguration').mockImplementation(() => {});
        spyOn(factory, '_validateOptions').mockImplementation(() => {});
        spyOn(factory, 'createValidatedLogger').mockReturnValue({
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        });

        factory._createInnertubeFactory = createMockFn().mockReturnValue('innertube-factory');
        factory._createInnertubeService = createMockFn().mockReturnValue('innertube-service');
        factory._createViewerExtractionService = createMockFn().mockReturnValue('viewer-extraction');
        factory._createYouTubeStreamDetectionService = createMockFn().mockReturnValue('stream-detection');
        factory._createYouTubeApiClient = createMockFn().mockReturnValue('api-client');
        factory._createYouTubeConnectionManager = createMockFn().mockReturnValue('connection-manager');
        factory._createTikTokConnectionFactory = createMockFn().mockReturnValue('tiktok-factory');
        factory._createTikTokStateManager = createMockFn().mockReturnValue('tiktok-state');
    });

    it('requires API key when YouTube API is enabled', () => {
        expect(() => factory.createYoutubeDependencies({
            enableAPI: true,
            username: 'channel'
        }, {})).toThrow(/YouTube API key is required/);
    });

    it('creates normalized YouTube dependencies when config is valid', () => {
        const deps = factory.createYoutubeDependencies({
            enableAPI: false,
            username: 'channel',
            apiKey: 'KEY'
        }, { logger: { debug() {}, info() {}, warn() {}, error() {} } });

        expect(deps.apiClient).toBe('api-client');
        expect(deps.connectionManager).toBe('connection-manager');
        expect(deps.innertubeFactory).toBe('innertube-factory');
        expect(factory._createYouTubeApiClient).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'KEY' }), expect.any(Object));
    });

    it('validates TikTok and Twitch required config fields', () => {
        expect(() => factory.createTiktokDependencies({}, {})).toThrow(/TikTok username is required/);

        expect(() => factory.createTwitchDependencies({ apiKey: 'token' }, {})).toThrow(/Twitch channel is required/);
        expect(() => factory.createTwitchDependencies({ channel: 'me' }, {})).toThrow(/Twitch API key is required/);
    });
});
