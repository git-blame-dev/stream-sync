const { DependencyFactory } = require('../../../src/utils/dependency-factory');

describe('DependencyFactory behavior', () => {
    let factory;

    beforeEach(() => {
        factory = new DependencyFactory();
        jest.spyOn(factory, '_validateConfiguration').mockImplementation(() => {});
        jest.spyOn(factory, '_validateOptions').mockImplementation(() => {});
        jest.spyOn(factory, 'createValidatedLogger').mockReturnValue({
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        });

        factory._createInnertubeFactory = jest.fn().mockReturnValue('innertube-factory');
        factory._createInnertubeService = jest.fn().mockReturnValue('innertube-service');
        factory._createViewerExtractionService = jest.fn().mockReturnValue('viewer-extraction');
        factory._createYouTubeStreamDetectionService = jest.fn().mockReturnValue('stream-detection');
        factory._createYouTubeApiClient = jest.fn().mockReturnValue('api-client');
        factory._createYouTubeConnectionManager = jest.fn().mockReturnValue('connection-manager');
        factory._createTikTokConnectionFactory = jest.fn().mockReturnValue('tiktok-factory');
        factory._createTikTokStateManager = jest.fn().mockReturnValue('tiktok-state');
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
