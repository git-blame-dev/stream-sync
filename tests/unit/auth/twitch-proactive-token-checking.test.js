
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, spyOn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');

const testClock = require('../../helpers/test-clock');
const TwitchAuthInitializer = require('../../../src/auth/TwitchAuthInitializer');
const TwitchAuthService = require('../../../src/auth/TwitchAuthService');
const { secrets, _resetForTesting, initializeStaticSecrets } = require('../../../src/core/secrets');

describe('Twitch Proactive Token Checking', () => {
    let mockAxios;
    let authInitializer;
    let authService;

    beforeEach(() => {
        spyOn(Date, 'now').mockImplementation(() => testClock.now());

        mockAxios = {
            get: createMockFn()
        };

        const config = {
            clientId: 'test-client-id',
            accessToken: 'valid-access-token',
            refreshToken: 'valid-refresh-token',
            channel: 'test-channel'
        };

        authService = new TwitchAuthService(config, { logger: noOpLogger });
        authInitializer = new TwitchAuthInitializer({
            logger: noOpLogger,
            axios: mockAxios
        });

        _resetForTesting();
        secrets.twitch.clientSecret = 'test-client-secret';
    });

    afterEach(() => {
        restoreAllMocks();
        _resetForTesting();
        initializeStaticSecrets();
    });

    describe('ensureValidToken (timestamp guard)', () => {
        test('refreshes when token is within near-expiry threshold without calling validate', async () => {
            authService.tokenExpiresAt = testClock.now() + (10 * 60 * 1000); // 10 minutes left

            const mockRefreshToken = spyOn(authInitializer, 'refreshToken').mockResolvedValue(true);

            const result = await authInitializer.ensureValidToken(authService);

            expect(result).toBe(true);
            expect(mockRefreshToken).toHaveBeenCalledTimes(1);
            expect(mockAxios.get).not.toHaveBeenCalled();
        });

        test('skips refresh when token is healthy and avoids validate calls', async () => {
            authService.tokenExpiresAt = testClock.now() + (2 * 60 * 60 * 1000); // 2 hours left

            const mockRefreshToken = spyOn(authInitializer, 'refreshToken').mockResolvedValue(true);

            const result = await authInitializer.ensureValidToken(authService);

            expect(result).toBe(true);
            expect(mockRefreshToken).not.toHaveBeenCalled();
            expect(mockAxios.get).not.toHaveBeenCalled();
        });

        test('returns true when no refresh token is available and does not call validate', async () => {
            authService.config.refreshToken = null;
            authService.tokenExpiresAt = testClock.now() + (30 * 60 * 1000);

            const mockRefreshToken = spyOn(authInitializer, 'refreshToken').mockResolvedValue(true);

            const result = await authInitializer.ensureValidToken(authService);

            expect(result).toBe(true);
            expect(mockRefreshToken).not.toHaveBeenCalled();
            expect(mockAxios.get).not.toHaveBeenCalled();
        });

        test('continues with current token when no expiration metadata is present', async () => {
            authService.tokenExpiresAt = null;

            const mockRefreshToken = spyOn(authInitializer, 'refreshToken').mockResolvedValue(true);

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
