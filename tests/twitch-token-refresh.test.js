
// MANDATORY imports
const { 
    initializeTestLogging,
    createTestUser, 
    TEST_TIMEOUTS 
} = require('./helpers/test-setup');

const { 
    createMockNotificationDispatcher,
    createMockLogger,
    createMockConfig
} = require('./helpers/mock-factories');

const { 
    setupAutomatedCleanup
} = require('./helpers/mock-lifecycle');

// Initialize FIRST
initializeTestLogging();

// Setup automated cleanup
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    logPerformanceMetrics: true
});

// Mock dependencies to prevent real external calls first, before requiring anything
jest.mock('fs', () => {
    const originalModule = jest.requireActual('fs');
    const mockPromises = {
        readFile: jest.fn(),
        writeFile: jest.fn(),
        rename: jest.fn()
    };
    return {
        ...originalModule,
        promises: mockPromises,
        existsSync: jest.fn(() => true)
    };
});

const TwitchTokenRefresh = require('../src/utils/twitch-token-refresh');
let fs;

jest.mock('../src/core/logging', () => ({
    getUnifiedLogger: jest.fn(() => ({
        info: jest.fn(),
        debug: jest.fn(),
        error: jest.fn(),
        warn: jest.fn()
    }))
}));

describe('TwitchTokenRefresh', () => {
    let tokenRefresh;
    let mockConfig;
    let mockLogger;

    beforeEach(() => {
        // Reset modules to clear any cached instances
        jest.resetModules();
        fs = require('fs').promises;
        
        mockConfig = {
            clientId: 'test_client_id',
            clientSecret: 'test_client_secret',
            accessToken: 'test_access_token',
            refreshToken: 'test_refresh_token',
            apiKey: 'test_api_key',
            tokenStorePath: '/test/token-store.json'
        };

        // Create fresh instance with injected logger
        const TwitchTokenRefreshClass = require('../src/utils/twitch-token-refresh');
        tokenRefresh = new TwitchTokenRefreshClass(mockConfig);
        
        // Manually inject mock logger to fix undefined issue
        mockLogger = createMockLogger();
        tokenRefresh.logger = mockLogger;
        
        // Reset mocks
        jest.clearAllMocks();
    });

    describe('needsRefresh (timestamp-based)', () => {
        it('returns true when no access token is provided', async () => {
            const result = await tokenRefresh.needsRefresh('');
            expect(result).toBe(true);
        });

        it('returns true when token is within near-expiry threshold without validating remotely', async () => {
            tokenRefresh.config.tokenExpiresAt = Date.now() + (5 * 60 * 1000);
            const mockMakeRequest = jest.spyOn(tokenRefresh, 'makeRequest');

            const result = await tokenRefresh.needsRefresh('valid_token');

            expect(result).toBe(true);
            expect(mockMakeRequest).not.toHaveBeenCalled();
        });

        it('returns false when token expiry is far in the future', async () => {
            tokenRefresh.config.tokenExpiresAt = Date.now() + (2 * 60 * 60 * 1000);
            const mockMakeRequest = jest.spyOn(tokenRefresh, 'makeRequest');

            const result = await tokenRefresh.needsRefresh('valid_token');

            expect(result).toBe(false);
            expect(mockMakeRequest).not.toHaveBeenCalled();
        });
    });

    describe('refreshToken', () => {
        it('should return null when no refresh token provided', async () => {
            const result = await tokenRefresh.refreshToken('');
            expect(result).toBe(null);
        });

        it('should return null when refresh is already in progress', async () => {
            tokenRefresh.isRefreshing = true;
            const result = await tokenRefresh.refreshToken('test_refresh_token');
            expect(result).toBe(null);
        });

        it('should successfully refresh token', async () => {
            const mockMakeRequest = jest.spyOn(tokenRefresh, 'makeRequest');
            mockMakeRequest.mockResolvedValue({
                statusCode: 200,
                body: JSON.stringify({
                    access_token: 'new_access_token',
                    refresh_token: 'new_refresh_token',
                    expires_in: 3600
                })
            });

            const result = await tokenRefresh.refreshToken('test_refresh_token');
            
            expect(result).toEqual({
                access_token: 'new_access_token',
                refresh_token: 'new_refresh_token',
                expires_in: 3600
            });
            expect(tokenRefresh.isRefreshing).toBe(false);
        });

        it('should handle refresh failure', async () => {
            const mockMakeRequest = jest.spyOn(tokenRefresh, 'makeRequest');
            mockMakeRequest.mockResolvedValue({
                statusCode: 400,
                body: '{"error": "invalid_grant"}'
            });

            const result = await tokenRefresh.refreshToken('invalid_refresh_token');
            expect(result).toBe(null);
            expect(tokenRefresh.isRefreshing).toBe(false);
        });
    });

    describe('updateConfig', () => {
        it('should return false when no token data provided', async () => {
            const result = await tokenRefresh.updateConfig(null);
            expect(result).toBe(false);
        });

        it('should return false when no access token in data', async () => {
            const result = await tokenRefresh.updateConfig({ refresh_token: 'test' });
            expect(result).toBe(false);
        });

        it('should update config successfully', async () => {
            const mockPersistTokens = jest.spyOn(tokenRefresh, 'persistTokens');
            mockPersistTokens.mockResolvedValue();

            const tokenData = {
                access_token: 'new_access_token',
                refresh_token: 'new_refresh_token'
            };

            const result = await tokenRefresh.updateConfig(tokenData);
            
            expect(result).toBe(true);
            expect(mockConfig.accessToken).toBe('new_access_token');
            expect(mockConfig.apiKey).toBe('new_access_token');
            expect(mockConfig.refreshToken).toBe('new_refresh_token');
            const callArgs = mockPersistTokens.mock.calls[0][0];
            expect(callArgs).toEqual(tokenData);
        });
    });

    describe('persistTokens', () => {
        it('writes token store data with new tokens', async () => {
            fs.readFile.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }));
            fs.writeFile.mockResolvedValue();

            const tokenData = {
                access_token: 'new_access_token',
                refresh_token: 'new_refresh_token'
            };

            await tokenRefresh.persistTokens(tokenData);

            expect(fs.writeFile).toHaveBeenCalledTimes(1);
            const writeArgs = fs.writeFile.mock.calls[0];
            expect(writeArgs[0]).toBe(`${mockConfig.tokenStorePath}.tmp`);
            const writtenPayload = JSON.parse(writeArgs[1]);
            expect(writtenPayload.twitch.accessToken).toBe('new_access_token');
            expect(writtenPayload.twitch.refreshToken).toBe('new_refresh_token');
            expect(fs.rename).toHaveBeenCalledTimes(1);
            expect(fs.rename.mock.calls[0][0]).toBe(`${mockConfig.tokenStorePath}.tmp`);
            expect(fs.rename.mock.calls[0][1]).toBe(mockConfig.tokenStorePath);
        });
    });

    describe('ensureValidToken', () => {
        it('should return true when token is already valid', async () => {
            const mockNeedsRefresh = jest.spyOn(tokenRefresh, 'needsRefresh');
            mockNeedsRefresh.mockResolvedValue(false);

            const result = await tokenRefresh.ensureValidToken();
            expect(result).toBe(true);
        });

        it('should refresh token when needed and return true on success', async () => {
            const mockNeedsRefresh = jest.spyOn(tokenRefresh, 'needsRefresh');
            const mockRefreshToken = jest.spyOn(tokenRefresh, 'refreshToken');
            const mockUpdateConfig = jest.spyOn(tokenRefresh, 'updateConfig');

            mockNeedsRefresh.mockResolvedValue(true);
            mockRefreshToken.mockResolvedValue({
                access_token: 'new_token',
                refresh_token: 'new_refresh'
            });
            mockUpdateConfig.mockResolvedValue(true);

            const result = await tokenRefresh.ensureValidToken();
            expect(result).toBe(true);
            expect(mockRefreshToken).toHaveBeenCalled();
            expect(mockUpdateConfig).toHaveBeenCalled();
        });

        it('should return true when token refresh fails', async () => {
            const mockNeedsRefresh = jest.spyOn(tokenRefresh, 'needsRefresh');
            const mockRefreshToken = jest.spyOn(tokenRefresh, 'refreshToken');

            mockNeedsRefresh.mockResolvedValue(true);
            mockRefreshToken.mockResolvedValue(null);

            const result = await tokenRefresh.ensureValidToken();
            expect(result).toBe(true);
        });

        it('should return true when config update fails', async () => {
            const mockNeedsRefresh = jest.spyOn(tokenRefresh, 'needsRefresh');
            const mockRefreshToken = jest.spyOn(tokenRefresh, 'refreshToken');
            const mockUpdateConfig = jest.spyOn(tokenRefresh, 'updateConfig');

            mockNeedsRefresh.mockResolvedValue(true);
            mockRefreshToken.mockResolvedValue({
                access_token: 'new_token',
                refresh_token: 'new_refresh'
            });
            mockUpdateConfig.mockResolvedValue(false);

            const result = await tokenRefresh.ensureValidToken();
            expect(result).toBe(true);
        });
    });
});
