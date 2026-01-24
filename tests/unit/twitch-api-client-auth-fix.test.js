const { describe, expect, it, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { noOpLogger } = require('../helpers/mock-factories');
const { TwitchApiClient } = require('../../src/utils/api-clients/twitch-api-client');

describe('TwitchApiClient authentication', () => {
    let mockLogger;
    let mockHttpClient;
    let mockAuthManager;
    let apiClient;

    const createMockHttpClient = () => ({
        get: createMockFn(),
        post: createMockFn()
    });

    const createMockAuthManager = (overrides = {}) => ({
        getAccessToken: createMockFn().mockResolvedValue('test-access-token'),
        ensureValidToken: createMockFn().mockResolvedValue(true),
        getState: createMockFn().mockReturnValue('READY'),
        ...overrides
    });

    beforeEach(() => {
        mockLogger = noOpLogger;
        mockHttpClient = createMockHttpClient();
        mockAuthManager = createMockAuthManager();

        apiClient = new TwitchApiClient(
            mockAuthManager,
            { clientId: 'test-client-id', channel: 'test-channel' },
            mockLogger,
            { enhancedHttpClient: mockHttpClient }
        );
    });

    afterEach(() => {
        restoreAllMocks();
    });

    describe('API request authentication', () => {
        it('includes Bearer token and Client-Id in requests', async () => {
            mockHttpClient.get.mockResolvedValue({
                status: 200,
                data: { data: [] }
            });

            await apiClient.makeRequest('/test-endpoint');

            const requestOptions = mockHttpClient.get.mock.calls[0][1];
            expect(requestOptions.authToken).toBe('test-access-token');
            expect(requestOptions.clientId).toBe('test-client-id');
        });

        it('returns stream info when channel is live', async () => {
            mockHttpClient.get.mockResolvedValue({
                status: 200,
                data: {
                    data: [{
                        viewer_count: 42,
                        game_name: 'Test Game'
                    }]
                }
            });

            const result = await apiClient.getStreamInfo('test-channel');

            expect(result.isLive).toBe(true);
            expect(result.viewerCount).toBe(42);
        });

        it('returns offline status when channel is not live', async () => {
            mockHttpClient.get.mockResolvedValue({
                status: 200,
                data: { data: [] }
            });

            const result = await apiClient.getStreamInfo('test-channel');

            expect(result.isLive).toBe(false);
            expect(result.viewerCount).toBe(0);
        });
    });

    describe('getBroadcasterId', () => {
        it('returns user ID from channel name', async () => {
            mockHttpClient.get.mockResolvedValue({
                status: 200,
                data: { data: [{ id: '123456789', login: 'testchannel' }] }
            });

            const broadcasterId = await apiClient.getBroadcasterId('testchannel');

            expect(broadcasterId).toBe('123456789');
        });

        it('throws when channel not found', async () => {
            mockHttpClient.get.mockResolvedValue({
                status: 200,
                data: { data: [] }
            });

            await expect(apiClient.getBroadcasterId('nonexistent')).rejects.toThrow(
                'Could not resolve broadcaster ID for channel: nonexistent'
            );
        });

        it('throws when API returns null user', async () => {
            mockHttpClient.get.mockResolvedValue({
                status: 200,
                data: { data: null }
            });

            await expect(apiClient.getBroadcasterId('badchannel')).rejects.toThrow(
                'Could not resolve broadcaster ID for channel: badchannel'
            );
        });
    });

    describe('401 retry with token refresh', () => {
        it('retries request after refreshing token on 401', async () => {
            mockHttpClient.get
                .mockRejectedValueOnce({ response: { status: 401 } })
                .mockResolvedValueOnce({
                    status: 200,
                    data: { data: [{ id: 'test-user-id', login: 'testuser' }] }
                });

            mockAuthManager.getAccessToken
                .mockResolvedValueOnce('expired-token')
                .mockResolvedValueOnce('refreshed-token');

            const result = await apiClient.getUserInfo('testuser');

            expect(result).toEqual({ id: 'test-user-id', login: 'testuser' });
        });

        it('uses refreshed token in retry request', async () => {
            mockHttpClient.get
                .mockRejectedValueOnce({ response: { status: 401 } })
                .mockResolvedValueOnce({
                    status: 200,
                    data: { data: [{ id: 'user-123' }] }
                });

            mockAuthManager.getAccessToken
                .mockResolvedValueOnce('old-token')
                .mockResolvedValueOnce('new-refreshed-token');

            await apiClient.getUserInfo('testuser');

            const retryRequestOptions = mockHttpClient.get.mock.calls[1][1];
            expect(retryRequestOptions.authToken).toBe('new-refreshed-token');
        });

        it('throws when retry after 401 also fails', async () => {
            mockHttpClient.get
                .mockRejectedValueOnce({ response: { status: 401 } })
                .mockRejectedValueOnce({ response: { status: 401 } });

            await expect(apiClient.makeRequest('/test')).rejects.toMatchObject({
                response: { status: 401 }
            });
        });

        it('does not retry on non-401 errors', async () => {
            mockHttpClient.get.mockRejectedValueOnce({
                response: { status: 500 }
            });

            await expect(apiClient.makeRequest('/test')).rejects.toMatchObject({
                response: { status: 500 }
            });
        });
    });

    describe('auth failure handling', () => {
        it('returns offline status when getAccessToken throws', async () => {
            mockAuthManager.getAccessToken.mockRejectedValue(new Error('Auth failed'));

            const result = await apiClient.getStreamInfo('test-channel');

            expect(result.isLive).toBe(false);
            expect(result.viewerCount).toBe(0);
        });

        it('throws when no access token available', async () => {
            mockAuthManager.getAccessToken.mockResolvedValue(null);

            await expect(apiClient.makeRequest('/test')).rejects.toThrow(
                'No access token available'
            );
        });
    });
});
