
const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');
const testClock = require('../../helpers/test-clock');

describe('Twitch Proactive Token Checking', () => {
    let TwitchAuthInitializer;
    let TwitchAuthService;
    let mockLogger;
    let mockAxios;
    let authInitializer;
    let authService;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        jest.spyOn(Date, 'now').mockImplementation(() => testClock.now());

        // Mock logger
        mockLogger = {
            info: jest.fn(),
            debug: jest.fn(),
            error: jest.fn(),
            warn: jest.fn()
        };

        // Mock axios
        mockAxios = {
            get: jest.fn()
        };

        // Load modules
        TwitchAuthInitializer = require('../../../src/auth/TwitchAuthInitializer');
        TwitchAuthService = require('../../../src/auth/TwitchAuthService');

        // Create test instances
        const config = {
            clientId: 'test-client-id',
            clientSecret: 'test-client-secret',
            accessToken: 'valid-access-token',
            refreshToken: 'valid-refresh-token',
            channel: 'test-channel'
        };

        authService = new TwitchAuthService(config, { logger: mockLogger });
        authInitializer = new TwitchAuthInitializer({
            logger: mockLogger,
            axios: mockAxios
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('ensureValidToken (timestamp guard)', () => {
        test('refreshes when token is within near-expiry threshold without calling validate', async () => {
            authService.tokenExpiresAt = testClock.now() + (10 * 60 * 1000); // 10 minutes left

            const mockRefreshToken = jest.spyOn(authInitializer, 'refreshToken').mockResolvedValue(true);

            const result = await authInitializer.ensureValidToken(authService);

            expect(result).toBe(true);
            expect(mockRefreshToken).toHaveBeenCalledTimes(1);
            expect(mockAxios.get).not.toHaveBeenCalled();
        });

        test('skips refresh when token is healthy and avoids validate calls', async () => {
            authService.tokenExpiresAt = testClock.now() + (2 * 60 * 60 * 1000); // 2 hours left

            const mockRefreshToken = jest.spyOn(authInitializer, 'refreshToken').mockResolvedValue(true);

            const result = await authInitializer.ensureValidToken(authService);

            expect(result).toBe(true);
            expect(mockRefreshToken).not.toHaveBeenCalled();
            expect(mockAxios.get).not.toHaveBeenCalled();
        });

        test('returns true when no refresh token is available and does not call validate', async () => {
            authService.config.refreshToken = null;
            authService.tokenExpiresAt = testClock.now() + (30 * 60 * 1000);

            const mockRefreshToken = jest.spyOn(authInitializer, 'refreshToken').mockResolvedValue(true);

            const result = await authInitializer.ensureValidToken(authService);

            expect(result).toBe(true);
            expect(mockRefreshToken).not.toHaveBeenCalled();
            expect(mockAxios.get).not.toHaveBeenCalled();
        });

        test('continues with current token when no expiration metadata is present', async () => {
            authService.tokenExpiresAt = null;

            const mockRefreshToken = jest.spyOn(authInitializer, 'refreshToken').mockResolvedValue(true);

            const result = await authInitializer.ensureValidToken(authService);

            expect(result).toBe(true);
            expect(mockRefreshToken).not.toHaveBeenCalled();
            expect(mockAxios.get).not.toHaveBeenCalled();
        });
    });

    describe('integration with initializeAuthentication', () => {
        test('initialization sets expiration metadata', async () => {
            authService.tokenExpiresAt = null;

            mockAxios.get.mockResolvedValue({
                data: {
                    user_id: '123456789',
                    login: 'test-channel',
                    expires_in: 3600
                }
            });

            const success = await authInitializer.initializeAuthentication(authService);

            expect(success).toBe(true);
            expect(authService.tokenExpiresAt).toBeGreaterThan(testClock.now());
        });
    });
});
