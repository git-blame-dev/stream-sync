const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { secrets, _resetForTesting, initializeStaticSecrets } = require('../../../src/core/secrets');
const TwitchAuth = require('../../../src/auth/TwitchAuth');

const requiredScopes = [
    'user:read:chat',
    'chat:edit',
    'channel:read:subscriptions',
    'bits:read',
    'channel:read:redemptions',
    'moderator:read:followers'
];

const buildValidationResponse = (overrides = {}) => ({
    data: {
        user_id: 'test-user-id',
        login: 'test-user',
        scopes: requiredScopes,
        expires_in: 3600,
        ...overrides
    }
});

describe('TwitchAuth behavior', () => {
    let tempDir;
    let tokenStorePath;
    const originalEnv = { ...process.env };

    beforeEach(async () => {
        _resetForTesting();
        secrets.twitch.clientSecret = 'test-client-secret';
        delete process.env.TWITCH_DISABLE_AUTH;
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'twitch-auth-'));
        tokenStorePath = path.join(tempDir, 'token-store.json');
    });

    afterEach(async () => {
        restoreAllMocks();
        _resetForTesting();
        initializeStaticSecrets();
        process.env = { ...originalEnv };
        if (tempDir) {
            await fs.promises.rm(tempDir, { recursive: true, force: true });
        }
    });

    const writeTokenStore = async (payload) => {
        const content = JSON.stringify(payload, null, 2);
        await fs.promises.writeFile(tokenStorePath, content, 'utf8');
    };

    const createAuth = ({ clientId = 'test-client-id', expectedUsername = 'test-user', httpClient, oauthFlow } = {}) => {
        return new TwitchAuth({
            tokenStorePath,
            clientId,
            expectedUsername,
            logger: noOpLogger,
            httpClient,
            oauthFlow
        });
    };

    it('throws when expectedUsername is missing', async () => {
        const httpClient = { get: createMockFn(), post: createMockFn() };
        const oauthFlow = { runOAuthFlow: createMockFn() };
        const auth = createAuth({ expectedUsername: null, httpClient, oauthFlow });

        await expect(auth.initialize()).rejects.toThrow('expectedUsername');
    });

    it('throws when clientId is missing', async () => {
        const httpClient = { get: createMockFn(), post: createMockFn() };
        const oauthFlow = { runOAuthFlow: createMockFn() };
        const auth = createAuth({ clientId: null, httpClient, oauthFlow });

        await expect(auth.initialize()).rejects.toThrow('clientId');
    });

    it('throws when clientSecret is missing', async () => {
        secrets.twitch.clientSecret = null;
        const httpClient = { get: createMockFn(), post: createMockFn() };
        const oauthFlow = { runOAuthFlow: createMockFn() };
        const auth = createAuth({ httpClient, oauthFlow });

        await expect(auth.initialize()).rejects.toThrow('clientSecret');
    });

    it('loads token store tokens and validates successfully', async () => {
        await writeTokenStore({
            twitch: {
                accessToken: 'test-access-token',
                refreshToken: 'test-refresh-token'
            }
        });

        const httpClient = {
            get: createMockFn().mockResolvedValue(buildValidationResponse()),
            post: createMockFn()
        };
        const oauthFlow = { runOAuthFlow: createMockFn() };
        const auth = createAuth({ httpClient, oauthFlow });

        const userId = await auth.initialize();

        expect(userId).toBe('test-user-id');
        expect(auth.isReady()).toBe(true);
        expect(auth.getUserId()).toBe('test-user-id');
        expect(secrets.twitch.accessToken).toBe('test-access-token');
        expect(secrets.twitch.refreshToken).toBe('test-refresh-token');
        expect(oauthFlow.runOAuthFlow.mock.calls.length).toBe(0);
    });

    it('runs OAuth flow when tokens are missing', async () => {
        const httpClient = {
            get: createMockFn().mockResolvedValue(buildValidationResponse()),
            post: createMockFn()
        };
        const oauthFlow = {
            runOAuthFlow: createMockFn().mockResolvedValue({
                accessToken: 'test-oauth-access-token',
                refreshToken: 'test-oauth-refresh-token',
                expiresIn: 3600
            })
        };
        const auth = createAuth({ httpClient, oauthFlow });

        const userId = await auth.initialize();

        expect(userId).toBe('test-user-id');
        expect(auth.isReady()).toBe(true);
        expect(secrets.twitch.accessToken).toBe('test-oauth-access-token');
        expect(secrets.twitch.refreshToken).toBe('test-oauth-refresh-token');
        expect(oauthFlow.runOAuthFlow.mock.calls.length).toBe(1);
    });

    it('throws when OAuth flow returns snake_case tokens', async () => {
        const httpClient = {
            get: createMockFn().mockResolvedValue(buildValidationResponse()),
            post: createMockFn()
        };
        const oauthFlow = {
            runOAuthFlow: createMockFn().mockResolvedValue({
                access_token: 'test-oauth-access-token',
                refresh_token: 'test-oauth-refresh-token',
                expires_in: 3600
            })
        };
        const auth = createAuth({ httpClient, oauthFlow });

        await expect(auth.initialize()).rejects.toThrow('OAuth flow must return camelCase token fields');
    });

    it('re-authenticates when scopes are missing', async () => {
        await writeTokenStore({
            twitch: {
                accessToken: 'test-access-token',
                refreshToken: 'test-refresh-token'
            }
        });

        const httpClient = {
            get: createMockFn()
                .mockResolvedValueOnce(buildValidationResponse({ scopes: ['chat:edit'] }))
                .mockResolvedValueOnce(buildValidationResponse()),
            post: createMockFn()
        };
        const oauthFlow = {
            runOAuthFlow: createMockFn().mockResolvedValue({
                accessToken: 'test-oauth-access-token',
                refreshToken: 'test-oauth-refresh-token',
                expiresIn: 3600
            })
        };
        const auth = createAuth({ httpClient, oauthFlow });

        const userId = await auth.initialize();

        expect(userId).toBe('test-user-id');
        expect(oauthFlow.runOAuthFlow.mock.calls.length).toBe(1);
        expect(auth.isReady()).toBe(true);
    });

    it('deduplicates concurrent refresh requests', async () => {
        secrets.twitch.refreshToken = 'test-refresh-token';

        let resolvePost;
        const postPromise = new Promise((resolve) => {
            resolvePost = resolve;
        });

        const httpClient = {
            get: createMockFn(),
            post: createMockFn().mockReturnValue(postPromise)
        };
        const oauthFlow = { runOAuthFlow: createMockFn() };
        const auth = createAuth({ httpClient, oauthFlow });

        const first = auth.refreshTokens();
        const second = auth.refreshTokens();

        expect(httpClient.post.mock.calls.length).toBe(1);

        resolvePost({
            data: {
                access_token: 'test-new-access-token',
                refresh_token: 'test-new-refresh-token',
                expires_in: 3600
            }
        });

        const results = await Promise.all([first, second]);

        expect(results).toEqual([true, true]);
    });

    it('keeps refresh token when refresh response omits refresh_token', async () => {
        secrets.twitch.refreshToken = 'test-refresh-token';

        const httpClient = {
            get: createMockFn(),
            post: createMockFn().mockResolvedValue({
                data: {
                    access_token: 'test-new-access-token',
                    expires_in: 3600
                }
            })
        };
        const oauthFlow = { runOAuthFlow: createMockFn() };
        const auth = createAuth({ httpClient, oauthFlow });

        const result = await auth.refreshTokens();

        expect(result).toBe(true);
        expect(secrets.twitch.accessToken).toBe('test-new-access-token');
        expect(secrets.twitch.refreshToken).toBe('test-refresh-token');

        const stored = JSON.parse(await fs.promises.readFile(tokenStorePath, 'utf8'));
        expect(stored.twitch.accessToken).toBe('test-new-access-token');
        expect(stored.twitch.refreshToken).toBe('test-refresh-token');
    });

    it('falls back to OAuth when refresh is terminal', async () => {
        secrets.twitch.refreshToken = 'test-refresh-token';

        const httpClient = {
            get: createMockFn(),
            post: createMockFn().mockRejectedValue({
                response: { status: 400, data: { error: 'invalid_grant' } }
            })
        };
        const oauthFlow = {
            runOAuthFlow: createMockFn().mockResolvedValue({
                accessToken: 'test-oauth-access-token',
                refreshToken: 'test-oauth-refresh-token',
                expiresIn: 3600
            })
        };
        const auth = createAuth({ httpClient, oauthFlow });

        const result = await auth.refreshTokens();

        expect(result).toBe(true);
        expect(oauthFlow.runOAuthFlow.mock.calls.length).toBe(1);
        expect(secrets.twitch.accessToken).toBe('test-oauth-access-token');
        expect(secrets.twitch.refreshToken).toBe('test-oauth-refresh-token');
    });
});
