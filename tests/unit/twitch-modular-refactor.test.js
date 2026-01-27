
const { describe, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');

const { noOpLogger, createMockAuthManager } = require('../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

const { ConnectionState, ConnectionStateFactory } = require('../../src/utils/platform-connection-state');
const { TwitchApiClient } = require('../../src/utils/api-clients/twitch-api-client');
const { TwitchViewerCountProvider } = require('../../src/utils/viewer-count-providers');

class TwitchPlatform {
    constructor(config, dependencies) {
        this.config = config;
        this.authManager = dependencies.authManager;
        this.eventSub = new dependencies.TwitchEventSub();
        this.enhancedHttpClient = dependencies.enhancedHttpClient;
        this.apiClient = null;
        this.viewerCountProvider = null;
        this.logger = noOpLogger;
    }

    async initialize(handlers) {
        this.apiClient = new TwitchApiClient(this.authManager, { clientId: this.config.clientId }, this.logger, {
            enhancedHttpClient: this.enhancedHttpClient
        });
        this.viewerCountProvider = new TwitchViewerCountProvider(
            this.apiClient,
            ConnectionStateFactory,
            this.config,
            null,
            this.logger
        );
        if (this.eventSub.initialize) {
            await this.eventSub.initialize();
        }
    }

    getConnectionState() {
        return ConnectionStateFactory.createTwitchState(this.config, this.eventSub);
    }

    async getViewerCount() {
        if (!this.viewerCountProvider) {
            return 0;
        }
        return await this.viewerCountProvider.getViewerCount();
    }
}

describe('TwitchPlatform Modular Refactor', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    
    describe('ConnectionState Module', () => {
        describe('when creating connection state', () => {
            it('should provide consistent interface across platforms', () => {
                const params = {
                    isConnected: true,
                    platform: 'twitch',
                    channel: 'test_channel',
                    username: 'test_user'
                };

                const state = new ConnectionState(params);

                expect(state.isConnected).toBe(true);
                expect(state.platform).toBe('twitch');
                expect(state.channel).toBe('test_channel');
                expect(state.username).toBe('test_user');
                expect(state.isApiReady()).toBe(true);
            });

            it('should identify when not ready for API calls', () => {
                const params = {
                    isConnected: false,
                    platform: 'twitch',
                    channel: null,
                    username: 'test_user'
                };

                const state = new ConnectionState(params);

                expect(state.isApiReady()).toBe(false);
            });
        });

        describe('when using ConnectionStateFactory', () => {
            it('should create Twitch state correctly', () => {
                const config = { channel: 'test_channel', username: 'test_user' };
                const mockEventSub = { isActive: () => true };

                const state = ConnectionStateFactory.createTwitchState(config, mockEventSub);

                expect(state.isConnected).toBe(true);
                expect(state.platform).toBe('twitch');
                expect(state.channel).toBe('test_channel');
                expect(state.username).toBe('test_user');
            });

            it('should handle disconnected EventSub', () => {
                const config = { channel: 'test_channel', username: 'test_user' };
                const mockEventSub = { isActive: () => false };

                const state = ConnectionStateFactory.createTwitchState(config, mockEventSub);

                expect(state.isConnected).toBe(false);
                expect(state.isApiReady()).toBe(false);
            });
        });
    });

    describe('TwitchApiClient Module', () => {
        let mockAuthManager;
        let mockHttpClient;
        let mockLogger;
        let apiClient;

        beforeEach(() => {
            mockLogger = noOpLogger;
            mockAuthManager = createMockAuthManager('READY', {
                accessToken: 'test_token',
                clientId: 'test_client_id'
            });
            mockHttpClient = { get: createMockFn() };
            apiClient = new TwitchApiClient(
                mockAuthManager,
                { clientId: 'test_client_id' },
                mockLogger,
                { enhancedHttpClient: mockHttpClient }
            );
        });

        describe('when making API requests', () => {
            it('should include proper authentication headers', async () => {
                const mockAxiosResponse = {
                    data: { data: [] },
                    status: 200,
                    statusText: 'OK',
                    headers: {},
                    config: {}
                };
                mockHttpClient.get.mockResolvedValue(mockAxiosResponse);

                await apiClient.makeRequest('/test');

                expect(mockHttpClient.get).toHaveBeenCalledWith(
                    'https://api.twitch.tv/helix/test',
                    expect.objectContaining({
                        authToken: 'test_token',
                        authType: 'app',
                        clientId: 'test_client_id'
                    })
                );
            });

            it('should handle API errors gracefully', async () => {
                const error = new Error('Request failed with status code 401');
                error.response = {
                    status: 401,
                    statusText: 'Unauthorized'
                };
                mockHttpClient.get.mockRejectedValue(error);

                await expect(apiClient.makeRequest('/test')).rejects.toThrow('Request failed with status code 401');
            });
        });

        describe('when getting stream info', () => {
            it('should return correct stream data for live stream', async () => {
                const mockAxiosResponse = {
                    data: {
                        data: [{
                            viewer_count: 42,
                            user_name: 'test_channel'
                        }]
                    },
                    status: 200,
                    statusText: 'OK',
                    headers: {},
                    config: {}
                };
                mockHttpClient.get.mockResolvedValue(mockAxiosResponse);

                const result = await apiClient.getStreamInfo('test_channel');

                expect(result.isLive).toBe(true);
                expect(result.viewerCount).toBe(42);
                expect(result.stream).toEqual(expect.objectContaining({
                    viewer_count: 42,
                    user_name: 'test_channel'
                }));
            });

            it('should return offline status for no stream data', async () => {
                const mockAxiosResponse = {
                    data: { data: [] },
                    status: 200,
                    statusText: 'OK',
                    headers: {},
                    config: {}
                };
                mockHttpClient.get.mockResolvedValue(mockAxiosResponse);

                const result = await apiClient.getStreamInfo('test_channel');

                expect(result.isLive).toBe(false);
                expect(result.viewerCount).toBe(0);
                expect(result.stream).toBe(null);
            });
        });
    });

    describe('TwitchViewerCountProvider Module', () => {
        let mockApiClient;
        let configFixture;
        let mockLogger;
        let provider;

        beforeEach(() => {
            mockLogger = noOpLogger;
            mockApiClient = {
                getStreamInfo: createMockFn()
            };
            configFixture = {
                channel: 'test_channel',
                eventSub: { isActive: () => true }
            };
            provider = new TwitchViewerCountProvider(mockApiClient, ConnectionStateFactory, configFixture, null, mockLogger);
        });

        describe('when provider is ready', () => {
            it('should return viewer count from API', async () => {
                mockApiClient.getStreamInfo.mockResolvedValue({
                    isLive: true,
                    viewerCount: 123
                });

                const count = await provider.getViewerCount();

                expect(count).toBe(123);
                expect(mockApiClient.getStreamInfo).toHaveBeenCalledWith('test_channel');
            });

            it('should return 0 for offline stream', async () => {
                mockApiClient.getStreamInfo.mockResolvedValue({
                    isLive: false,
                    viewerCount: 0
                });

                const count = await provider.getViewerCount();

                expect(count).toBe(0);
            });
        });

        describe('when provider is not ready', () => {
            beforeEach(() => {
                const notReadyConfig = { ...configFixture, channel: null };
                provider = new TwitchViewerCountProvider(mockApiClient, ConnectionStateFactory, notReadyConfig, null, mockLogger);
            });

            it('should return 0 without making API call', async () => {
                const count = await provider.getViewerCount();

                expect(count).toBe(0);
                expect(mockApiClient.getStreamInfo).not.toHaveBeenCalled();
            });
        });

        describe('when API call fails', () => {
            it('should return 0 and handle error gracefully', async () => {
                mockApiClient.getStreamInfo.mockRejectedValue(new Error('API Error'));

                const count = await provider.getViewerCount();

                expect(count).toBe(0);
            });
        });
    });

    describe('TwitchPlatform Integration', () => {
        let mockAuthManager;
        let mockEventSub;
        let mockHttpClient;
        let twitchPlatform;

        beforeEach(() => {
            mockAuthManager = createMockAuthManager('READY', {
                accessToken: 'test_token',
                clientId: 'test_client_id'
            });
            
            mockEventSub = {
                isActive: () => true,
                initialize: createMockFn().mockResolvedValue()
            };
            mockHttpClient = { get: createMockFn() };

            const config = {
                enabled: true,
                channel: 'test_channel',
                username: 'test_user',
                eventsub_enabled: true
            };

            twitchPlatform = new TwitchPlatform(config, {
                authManager: mockAuthManager,
                enhancedHttpClient: mockHttpClient,
                TwitchEventSub: class MockTwitchEventSub {
                    constructor() { return mockEventSub; }
                }
            });
        });

        describe('when platform initializes', () => {
            it('should create all modular components', async () => {
                await twitchPlatform.initialize({});

                expect(twitchPlatform.apiClient).toBeDefined();
                expect(twitchPlatform.viewerCountProvider).toBeDefined();
                expect(twitchPlatform.eventSub).toBeDefined();
            });
        });

        describe('when getting connection state', () => {
            beforeEach(async () => {
                await twitchPlatform.initialize({});
            });

            it('should use modular connection state factory', () => {
                const state = twitchPlatform.getConnectionState();

                expect(state).toHaveProperty('isConnected', true);
                expect(state).toHaveProperty('platform', 'twitch');
                expect(state).toHaveProperty('channel', 'test_channel');
                expect(state).toHaveProperty('username', 'test_user');
            });
        });

        describe('when getting viewer count', () => {
            beforeEach(async () => {
                await twitchPlatform.initialize({});
                
                mockHttpClient.get.mockResolvedValue({
                    data: {
                        data: [{ viewer_count: 456 }]
                    },
                    status: 200,
                    statusText: 'OK',
                    headers: {},
                    config: {}
                });
            });

            it('should delegate to viewer count provider', async () => {
                const count = await twitchPlatform.getViewerCount();

                expect(count).toBe(456);
            });

            it('should return 0 when provider not initialized', async () => {
                twitchPlatform.viewerCountProvider = null;

                const count = await twitchPlatform.getViewerCount();

                expect(count).toBe(0);
            });
        });
    });

    describe('DRY Principle Validation', () => {
        it('should reuse connection state logic across platforms', () => {
            const config = { channel: 'test', username: 'test' };

            const twitchState = ConnectionStateFactory.createTwitchState(config, { isActive: () => true });
            const youtubeState = ConnectionStateFactory.createYouTubeState(config, { stream1: {} });

            expect(twitchState).toHaveProperty('isConnected');
            expect(twitchState).toHaveProperty('platform');
            expect(youtubeState).toHaveProperty('isConnected');
            expect(youtubeState).toHaveProperty('platform');
            expect(typeof twitchState.isApiReady).toBe('function');
            expect(typeof youtubeState.isApiReady).toBe('function');
        });

        it('should provide consistent viewer count interface', () => {
            const mockApiClient = { getStreamInfo: createMockFn() };
            const config = { channel: 'test', eventSub: { isActive: () => true } };

            const provider = new TwitchViewerCountProvider(mockApiClient, ConnectionStateFactory, config, null, noOpLogger);

            expect(typeof provider.getViewerCount).toBe('function');
            expect(typeof provider.isReady).toBe('function');
            expect(provider.platform).toBe('twitch');
        });
    });
});
