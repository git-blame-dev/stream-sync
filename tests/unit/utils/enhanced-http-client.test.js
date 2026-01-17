const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { createTestRetrySystem } = require('../../helpers/test-setup');

describe('Enhanced HTTP Client', () => {
    let mockAxios;
    let mockRetrySystem;
    let EnhancedHttpClient;
    let client;

    beforeEach(() => {
        mockAxios = {
            get: createMockFn(),
            post: createMockFn(),
            put: createMockFn(),
            delete: createMockFn()
        };

        mockRetrySystem = createTestRetrySystem();
        EnhancedHttpClient = require('../../../src/utils/enhanced-http-client').EnhancedHttpClient;

        client = new EnhancedHttpClient({
            retrySystem: mockRetrySystem,
            timeout: 10000,
            axios: mockAxios,
            logger: noOpLogger
        });
    });

    afterEach(() => {
        restoreAllMocks();
        clearAllMocks();
    });

    describe('Authentication Header Abstraction', () => {
        test('should build Bearer authentication headers correctly', () => {
            const headers = client.buildAuthHeaders('test-token', 'bearer');
            expect(headers).toEqual({ 'Authorization': 'Bearer test-token' });
        });

        test('should build OAuth authentication headers correctly', () => {
            const headers = client.buildAuthHeaders('oauth-token', 'oauth');
            expect(headers).toEqual({ 'Authorization': 'OAuth oauth-token' });
        });

        test('should default to Bearer when auth type not specified', () => {
            const headers = client.buildAuthHeaders('default-token');
            expect(headers).toEqual({ 'Authorization': 'Bearer default-token' });
        });

        test('should return empty headers when no token provided', () => {
            const headers = client.buildAuthHeaders();
            expect(headers).toEqual({});
        });
    });

    describe('Retry System Integration', () => {
        test('should use retry system for GET requests when platform specified', async () => {
            const mockResponse = { data: 'test', status: 200 };
            mockAxios.get.mockResolvedValue(mockResponse);
            mockRetrySystem.executeWithRetry.mockResolvedValue(mockResponse);

            const result = await client.get('https://api.test.example.invalid/data', {
                authToken: 'token123',
                platform: 'twitch'
            });

            expect(mockRetrySystem.executeWithRetry).toHaveBeenCalledWith(
                'twitch',
                expect.any(Function),
                undefined
            );
            expect(result).toBe(mockResponse);
        });

        test('should make direct request when no platform specified', async () => {
            const mockResponse = { data: 'test', status: 200 };
            mockAxios.get.mockResolvedValue(mockResponse);

            const result = await client.get('https://api.test.example.invalid/data');

            expect(mockRetrySystem.executeWithRetry).not.toHaveBeenCalled();
            expect(mockAxios.get).toHaveBeenCalledWith(
                'https://api.test.example.invalid/data',
                expect.objectContaining({
                    timeout: 10000,
                    headers: expect.objectContaining({
                        'User-Agent': expect.any(String)
                    })
                })
            );
            expect(result).toBe(mockResponse);
        });

        test('should retry failed requests using retry system', async () => {
            const mockResponse = { data: 'success', status: 200 };

            mockRetrySystem.executeWithRetry.mockImplementation(async (_platform, fn) => {
                try {
                    return await fn();
                } catch {
                    return mockResponse;
                }
            });

            await client.get('https://api.test.example.invalid/data', { platform: 'youtube' });

            expect(mockRetrySystem.executeWithRetry).toHaveBeenCalledWith(
                'youtube',
                expect.any(Function),
                undefined
            );
        });

        test('should bypass retry system when disableRetry flag is true', async () => {
            const mockResponse = { data: 'ok', status: 200 };
            mockAxios.post.mockResolvedValue(mockResponse);

            const result = await client.post('https://api.test.example.invalid/token', { grant_type: 'refresh_token' }, {
                platform: 'twitch',
                disableRetry: true
            });

            expect(mockRetrySystem.executeWithRetry).not.toHaveBeenCalled();
            expect(mockAxios.post).toHaveBeenCalledWith(
                'https://api.test.example.invalid/token',
                expect.anything(),
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'User-Agent': expect.any(String)
                    })
                })
            );
            expect(result).toBe(mockResponse);
        });
    });

    describe('User-Agent Configuration', () => {
        test('uses configured user agent list when provided', () => {
            const customClient = new EnhancedHttpClient({
                retrySystem: mockRetrySystem,
                timeout: 10000,
                axios: mockAxios,
                logger: noOpLogger,
                userAgents: ['ExampleAgent/1.0']
            });

            const config = customClient.buildRequestConfig();

            expect(config.headers['User-Agent']).toBe('ExampleAgent/1.0');
        });
    });

    describe('HTTP Method Support', () => {
        test('should support GET requests with auth tokens', async () => {
            mockAxios.get.mockResolvedValue({ data: 'test', status: 200 });

            await client.get('https://api.test.example.invalid/data', {
                authToken: 'bearer-token',
                authType: 'bearer'
            });

            expect(mockAxios.get).toHaveBeenCalledWith(
                'https://api.test.example.invalid/data',
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'Authorization': 'Bearer bearer-token',
                        'User-Agent': expect.any(String)
                    })
                })
            );
        });

        test('should support POST requests with data and auth', async () => {
            const postData = { name: 'test' };
            mockAxios.post.mockResolvedValue({ data: 'created', status: 201 });

            await client.post('https://api.test.example.invalid/create', postData, {
                authToken: 'oauth-token',
                authType: 'oauth'
            });

            expect(mockAxios.post).toHaveBeenCalledWith(
                'https://api.test.example.invalid/create',
                postData,
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'Authorization': 'OAuth oauth-token',
                        'Content-Type': 'application/json',
                        'User-Agent': expect.any(String)
                    })
                })
            );
        });

        test('should support PUT and DELETE methods', async () => {
            mockAxios.put.mockResolvedValue({ data: 'updated', status: 200 });
            mockAxios.delete.mockResolvedValue({ data: 'deleted', status: 204 });

            await client.put('https://api.test.example.invalid/update/1', { name: 'updated' });
            await client.delete('https://api.test.example.invalid/delete/1');

            expect(mockAxios.put).toHaveBeenCalled();
            expect(mockAxios.delete).toHaveBeenCalled();
        });
    });

    describe('User Agent Rotation', () => {
        test('should rotate user agents across requests', async () => {
            mockAxios.get.mockResolvedValue({ data: 'test', status: 200 });

            await client.get('https://test.example.invalid/1');
            await client.get('https://test.example.invalid/2');
            await client.get('https://test.example.invalid/3');

            const calls = mockAxios.get.mock.calls;
            const userAgents = calls.map(call => call[1].headers['User-Agent']);

            expect(new Set(userAgents).size).toBeGreaterThan(1);
        });
    });

    describe('Error Handling', () => {
        test('should preserve original error when not using retry system', async () => {
            mockAxios.get.mockRejectedValue(new Error('API Error'));

            await expect(client.get('https://test.example.invalid/error')).rejects.toThrow('API Error');
        });

        test('should let retry system handle errors when platform specified', async () => {
            mockRetrySystem.executeWithRetry.mockRejectedValue(new Error('Network timeout'));

            await expect(client.get('https://test.example.invalid/error', { platform: 'tiktok' }))
                .rejects.toThrow('Network timeout');
        });
    });

    describe('Configuration Options', () => {
        test('should use custom timeout when specified', async () => {
            mockAxios.get.mockResolvedValue({ data: 'test', status: 200 });

            await client.get('https://test.example.invalid/data', { timeout: 5000 });

            expect(mockAxios.get).toHaveBeenCalledWith(
                'https://test.example.invalid/data',
                expect.objectContaining({ timeout: 5000 })
            );
        });

        test('should merge custom headers with auth headers', async () => {
            mockAxios.get.mockResolvedValue({ data: 'test', status: 200 });

            await client.get('https://test.example.invalid/data', {
                authToken: 'token123',
                headers: {
                    'Custom-Header': 'custom-value',
                    'Accept': 'application/json'
                }
            });

            expect(mockAxios.get).toHaveBeenCalledWith(
                'https://test.example.invalid/data',
                expect.objectContaining({
                    headers: expect.objectContaining({
                        'Authorization': 'Bearer token123',
                        'Custom-Header': 'custom-value',
                        'Accept': 'application/json',
                        'User-Agent': expect.any(String)
                    })
                })
            );
        });
    });
});

describe('Enhanced HTTP Client - Retry System Requirement', () => {
    test('retry system must have executeWithRetry method', () => {
        const mockRetrySystem = createTestRetrySystem();
        expect(typeof mockRetrySystem.executeWithRetry).toBe('function');
    });
});
