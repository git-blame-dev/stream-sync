const { describe, it, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { secrets, _resetForTesting, initializeStaticSecrets } = require('../../src/core/secrets');
const { TwitchApiClient } = require('../../src/utils/api-clients/twitch-api-client');

describe('TwitchApiClient error handler integration', () => {
    let mockLogger;
    let mockHttpClient;
    let apiClient;

    beforeEach(() => {
        _resetForTesting();
        initializeStaticSecrets();
        secrets.twitch.accessToken = 'test-access-token';

        mockLogger = {
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        };
        mockHttpClient = {
            get: createMockFn(),
            post: createMockFn()
        };
        apiClient = new TwitchApiClient(
            null,
            { clientId: 'test-client-id' },
            mockLogger,
            { enhancedHttpClient: mockHttpClient }
        );
    });

    afterEach(() => {
        restoreAllMocks();
        _resetForTesting();
        initializeStaticSecrets();
    });

    it('routes getStreamInfo API error through error handler', async () => {
        mockHttpClient.get.mockRejectedValue(new Error('network failure'));

        const result = await apiClient.getStreamInfo('test-channel');

        expect(result.isLive).toBe(false);
        expect(mockLogger.error).toHaveBeenCalled();
        const errorCall = mockLogger.error.mock.calls[0];
        expect(errorCall[0]).toContain('stream info');
    });

    it('routes getUserInfo API error through error handler', async () => {
        mockHttpClient.get.mockRejectedValue(new Error('user lookup failed'));

        const result = await apiClient.getUserInfo('test-user');

        expect(result).toBeNull();
        expect(mockLogger.error).toHaveBeenCalled();
        const errorCall = mockLogger.error.mock.calls[0];
        expect(errorCall[0]).toContain('user info');
    });

    it('routes getChannelInfo API error through error handler', async () => {
        mockHttpClient.get.mockRejectedValue(new Error('channel lookup failed'));

        const result = await apiClient.getChannelInfo('test-channel-id');

        expect(result).toBeNull();
        expect(mockLogger.error).toHaveBeenCalled();
        const errorCall = mockLogger.error.mock.calls[0];
        expect(errorCall[0]).toContain('channel info');
    });
});
