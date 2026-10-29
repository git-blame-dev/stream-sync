import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMockFn } from '../helpers/bun-mock-utils';
import { secrets } from '../../src/core/secrets';
import { getUnifiedLogger } from '../../src/core/logging';
import { TwitchAuth } from '../../src/auth/TwitchAuth';
import { TWITCH_OAUTH_SCOPES } from '../../src/auth/twitch-oauth-scopes';
import { EnhancedHttpClient } from '../../src/utils/enhanced-http-client';
import { TwitchApiClient } from '../../src/utils/api-clients/twitch-api-client';

const transportGet = () => createMockFn<[string, Record<string, unknown>], Promise<{ data: unknown }>>();

describe('Twitch API errors through actual HTTP, retry and diagnostic owners', () => {
  const logger = getUnifiedLogger();
  let get: ReturnType<typeof transportGet>;
  let client: TwitchApiClient;
  let http: EnhancedHttpClient;
  let auth: TwitchAuth | undefined;
  let directory: string | undefined;
  let previous: typeof secrets.twitch;
  let error: ReturnType<typeof spyOn<typeof logger, 'error'>>;
  let warn: ReturnType<typeof spyOn<typeof logger, 'warn'>>;
  let info: ReturnType<typeof spyOn<typeof logger, 'info'>>;
  let debug: ReturnType<typeof spyOn<typeof logger, 'debug'>>;

  beforeEach(() => {
    previous = { ...secrets.twitch };
    secrets.twitch.accessToken = 'synthetic-access-token';
    auth = undefined;
    directory = undefined;
    get = transportGet();
    http = new EnhancedHttpClient({ logger, axios: { get,
      post: async () => ({ data: {} }), put: async () => ({ data: {} }), delete: async () => ({ data: {} }) } });
    error = spyOn(logger, 'error');
    warn = spyOn(logger, 'warn');
    info = spyOn(logger, 'info');
    debug = spyOn(logger, 'debug');
    client = new TwitchApiClient(null, { clientId: 'synthetic-client' }, logger, { enhancedHttpClient: http });
  });

  afterEach(async () => {
    try { await auth?.dispose(); }
    finally {
      try { if (directory) await rm(directory, { recursive: true, force: true }); }
      finally { Object.assign(secrets.twitch, previous); error.mockRestore(); warn.mockRestore(); info.mockRestore(); debug.mockRestore(); }
    }
  });

  it('retains the actual stream error identity and logs the failure', async () => {
    const failure = new Error('Synthetic network failure');
    get.mockRejectedValue(failure);
    await expect(client.getStreamInfo('synthetic-channel')).rejects.toBe(failure);
    expect(get).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
  });

  it('refreshes once on unauthorized lookup without exposing token-bearing errors to the logger', async () => {
    const token = 'synthetic-diagnostic-token';
    const failure = Object.assign(new Error(`access_token=${token}`), { response: { status: 401 } });
    directory = await mkdtemp(join(tmpdir(), 'synthetic-api-auth-'));
    secrets.twitch.clientSecret = 'synthetic-client-secret';
    secrets.twitch.refreshToken = 'synthetic-refresh-token';
    let refreshes = 0;
    auth = new TwitchAuth({ clientId: 'synthetic-client', expectedUsername: 'synthetic-user',
      tokenStorePath: join(directory, 'tokens.json'), logger, httpClient: {
        post: async () => { refreshes++; return { data: { access_token: 'synthetic-new-access', refresh_token: 'synthetic-new-refresh' } }; },
        get: async () => ({ data: { client_id: 'synthetic-client', user_id: 'synthetic-user', login: 'synthetic-user', scopes: [...TWITCH_OAUTH_SCOPES] } }),
      } });
    expect(await auth.refreshTokens()).toBe(true);
    get.mockRejectedValue(failure);
    client = new TwitchApiClient(auth, { clientId: 'synthetic-client' }, logger, { enhancedHttpClient: http });
    await expect(client.getUserInfo('synthetic-user')).resolves.toBeNull();
    expect(get).toHaveBeenCalledTimes(2);
    expect(refreshes).toBe(2);
    const output = JSON.stringify([...warn.mock.calls, ...error.mock.calls, ...info.mock.calls, ...debug.mock.calls]);
    expect(output).not.toContain(token);
    expect(warn.mock.calls).toContainEqual(expect.arrayContaining([expect.any(String), expect.any(String), expect.objectContaining({ status: 401 })]));
    expect(error.mock.calls.map(call => call[0])).toContain('Failed to get user info');
  });

  for (const [method, input, expected] of [
    ['getUserInfo', 'synthetic-user', null],
    ['getChannelInfo', 'synthetic-channel-id', null],
    ['getUserById', 'synthetic-user-id', null],
    ['getCheermotes', 'synthetic-broadcaster-id', []],
  ] as const) {
    it(`${method} reports external failure and accepts a following healthy response`, async () => {
      get.mockRejectedValueOnce(new Error('Synthetic lookup failure'));
      expect(await client[method](input)).toEqual(expected);
      expect(get).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalled();
      get.mockResolvedValueOnce({ data: { data: [{ id: 'synthetic-recovered' }] } });
      expect(await client[method](input)).toEqual(method === 'getCheermotes' ? [{ id: 'synthetic-recovered' }] : { id: 'synthetic-recovered' });
      expect(get).toHaveBeenCalledTimes(2);
    });
  }
});
