import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { TwitchAuth } from '../../../src/auth/TwitchAuth';
import { TWITCH_OAUTH_SCOPES } from '../../../src/auth/twitch-oauth-scopes';
import { secrets, _resetForTesting } from '../../../src/core/secrets';
import { createMockFn } from '../../helpers/bun-mock-utils';
import { noOpLogger } from '../../helpers/mock-factories';
import { useFakeTimers, useRealTimers, advanceTimersByTime } from '../../helpers/bun-timers';
import testClock from '../../helpers/test-clock';

const HOUR = 3_600_000;
const valid = (overrides: Record<string, unknown> = {}) => ({ data: {
    user_id: 'test-user-id', login: 'test-user', client_id: 'test-client', scopes: [...TWITCH_OAUTH_SCOPES], ...overrides
} });
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
const advance = async (ms: number) => { testClock.advance(ms); advanceTimersByTime(ms); await flush(); };

describe('TwitchAuth validation monitoring', () => {
    let directory: string;
    let tokenStorePath: string;
    let auth: TwitchAuth;
    const get = createMockFn<unknown[], Promise<{ data?: unknown }>>();
    const post = createMockFn<unknown[], Promise<{ data?: unknown }>>();
    const oauthFlow = createMockFn<[], Promise<null>>();

    beforeEach(async () => {
        _resetForTesting();
        secrets.twitch.clientSecret = 'test-secret';
        get.mockReset(); post.mockReset(); oauthFlow.mockReset();
        get.mockResolvedValue(valid());
        directory = await fs.mkdtemp('/tmp/opencode/twitch-monitor-');
        tokenStorePath = path.join(directory, 'test-tokens.json');
        await fs.writeFile(tokenStorePath, JSON.stringify({ twitch: { accessToken: 'test-access', refreshToken: 'test-refresh' } }));
        auth = new TwitchAuth({ tokenStorePath, clientId: 'test-client', expectedUsername: 'test-user', logger: noOpLogger,
            httpClient: { get, post }, oauthFlow, monitoringNow: testClock.now });
        await auth.initialize();
        useFakeTimers();
    });

    afterEach(async () => {
        await auth.stopValidationMonitoring();
        useRealTimers();
        await fs.rm(directory, { recursive: true, force: true });
        _resetForTesting();
    });

    it('is inert until explicitly started and validates idle sessions hourly without overlap', async () => {
        await advance(1000);
        expect(get.mock.calls.length).toBe(1);
        let resolve!: (value: ReturnType<typeof valid>) => void;
        get.mockReturnValueOnce(new Promise<ReturnType<typeof valid>>(done => { resolve = done; }));
        const onInvalidated = createMockFn<[], void>();
        auth.startValidationMonitoring({ onInvalidated });
        auth.startValidationMonitoring({ onInvalidated });
        await advance(HOUR - 1001);
        expect(get.mock.calls.length).toBe(1);
        await advance(1);
        expect(get.mock.calls.length).toBe(2);
        resolve(valid()); await flush();
        await advance(HOUR);
        expect(get.mock.calls.length).toBe(3);
        expect(onInvalidated.mock.calls.length).toBe(0);
    });

    it('requires validated readiness and leaves constructor and stop-before-start inert', async () => {
        const uninitialized = new TwitchAuth({ tokenStorePath, clientId: 'test-client', expectedUsername: 'test-user', logger: noOpLogger, httpClient: { get, post } });
        await uninitialized.stopValidationMonitoring();
        expect(() => uninitialized.startValidationMonitoring({ onInvalidated: () => undefined })).toThrow('accepted credentials');
        expect(get.mock.calls.length).toBe(1);
    });

    it('recovers transient validation and starts a fresh grace window on the next outage', async () => {
        const onInvalidated = createMockFn<[], void>();
        get.mockRejectedValueOnce({ response: { status: 503 } }).mockResolvedValueOnce(valid());
        auth.startValidationMonitoring({ onInvalidated });
        await advance(HOUR);
        expect(auth.isReady()).toBe(true);
        await advance(30_000);
        expect(get.mock.calls.length).toBe(3);
        get.mockRejectedValue({ response: { status: 503 } });
        await advance(HOUR);
        expect(auth.isReady()).toBe(true);
        await advance(30_000);
        expect(auth.isReady()).toBe(true);
        expect(onInvalidated.mock.calls.length).toBe(0);
    });

    it.each([
        ['network', Object.assign(new Error('test-network-outage'), { code: 'ECONNRESET' })],
        ['server', { response: { status: 503 } }],
        ['rate-limit', { response: { status: 429 } }],
    ])('bounds %s outages to five minutes, invalidates once and preserves durable credentials', async (_label, failure) => {
        const onInvalidated = createMockFn<unknown[], void>();
        const before = await fs.readFile(tokenStorePath, 'utf8');
        get.mockRejectedValue(failure);
        auth.startValidationMonitoring({ onInvalidated });
        await advance(HOUR);
        for (let i = 0; i < 9; i++) await advance(30_000);
        expect(auth.isReady()).toBe(true);
        expect(onInvalidated.mock.calls.length).toBe(0);
        await advance(30_000);
        expect(auth.isReady()).toBe(false);
        expect(onInvalidated.mock.calls.length).toBe(1);
        expect(onInvalidated.mock.calls[0]?.[0]).toMatchObject({ reason: 'validation-unavailable' });
        expect(auth.getUserId()).toBe('test-user-id');
        expect(secrets.twitch.accessToken).toBe('test-access');
        expect(await fs.readFile(tokenStorePath, 'utf8')).toBe(before);
        await advance(HOUR);
        expect(onInvalidated.mock.calls.length).toBe(1);
        expect(oauthFlow.mock.calls.length).toBe(0);
        expect(post.mock.calls.length).toBe(0);
    });

    it('treats malformed successful validation as bounded unavailability, not revocation', async () => {
        const onInvalidated = createMockFn<[], void>();
        get.mockResolvedValue({ data: { login: 'test-user' } });
        auth.startValidationMonitoring({ onInvalidated });
        await advance(HOUR);
        expect(auth.isReady()).toBe(true);
        for (let i = 0; i < 10; i++) await advance(30_000);
        expect(auth.isReady()).toBe(false);
        expect(onInvalidated.mock.calls.length).toBe(1);
        expect(oauthFlow.mock.calls.length).toBe(0);
    });

    it.each([
        { user_id: 'test-another-id' }, { login: 'test-another-login' },
        { client_id: 'test-another-client' }, { scopes: [] },
    ])('immediately suspends identity/client/scope mismatches: %j', async invalid => {
        const onInvalidated = createMockFn<unknown[], void>();
        get.mockResolvedValue(valid(invalid));
        auth.startValidationMonitoring({ onInvalidated });
        await advance(HOUR);
        expect(auth.isReady()).toBe(false);
        expect(onInvalidated.mock.calls.length).toBe(1);
        expect(onInvalidated.mock.calls[0]?.[0]).toMatchObject({ reason: 'identity-mismatch' });
        expect(post.mock.calls.length).toBe(0);
    });

    it('immediately suspends a confirmed 401 without refresh or interactive fallback', async () => {
        const onInvalidated = createMockFn<unknown[], void>();
        get.mockRejectedValue({ response: { status: 401 } });
        auth.startValidationMonitoring({ onInvalidated });
        await advance(HOUR);
        expect(auth.isReady()).toBe(false);
        expect(onInvalidated.mock.calls.length).toBe(1);
        expect(onInvalidated.mock.calls[0]?.[0]).toMatchObject({ reason: 'invalid-token' });
        expect(post.mock.calls.length).toBe(0);
        expect(oauthFlow.mock.calls.length).toBe(0);
    });

    it('aborts stopped validation and joins its eventual completion without applying stale results', async () => {
        let resolve!: (value: ReturnType<typeof valid>) => void;
        get.mockReturnValueOnce(new Promise<ReturnType<typeof valid>>(done => { resolve = done; }));
        const onInvalidated = createMockFn<[], void>();
        auth.startValidationMonitoring({ onInvalidated });
        await advance(HOUR);
        const config = get.mock.calls[1]?.[1] as { signal: AbortSignal };
        const stopped = auth.stopValidationMonitoring();
        expect(config.signal.aborted).toBe(true);
        resolve(valid({ scopes: [] })); await flush();
        await stopped;
        await advance(HOUR);
        expect(auth.isReady()).toBe(true);
        expect(onInvalidated.mock.calls.length).toBe(0);
        expect(get.mock.calls.length).toBe(2);
    });

    it('bounds hung validations and never overlaps retry requests logically', async () => {
        get.mockReturnValue(new Promise<{ data?: unknown }>(() => undefined));
        const onInvalidated = createMockFn<[], void>();
        auth.startValidationMonitoring({ onInvalidated });
        await advance(HOUR);
        expect(get.mock.calls.length).toBe(2);
        await advance(4999);
        expect(get.mock.calls.length).toBe(2);
        await advance(1);
        const config = get.mock.calls[1]?.[1] as { signal: AbortSignal };
        expect(config.signal.aborted).toBe(true);
        await advance(29_999);
        expect(get.mock.calls.length).toBe(2);
        await advance(1);
        expect(get.mock.calls.length).toBe(3);
        const stopped = auth.stopValidationMonitoring();
        let retired = false;
        void stopped.then(() => { retired = true; });
        await advance(4999);
        expect(retired).toBe(false);
        await advance(1);
        await stopped;
        expect(retired).toBe(true);
        expect(onInvalidated.mock.calls.length).toBe(0);
    });

    it('stops pending callback ownership promptly and supplies cancellation to the callback', async () => {
        let signal!: AbortSignal;
        let finish!: () => void;
        const onInvalidated = createMockFn<[{ signal: AbortSignal }], Promise<void>>().mockImplementation(event => {
            signal = event.signal;
            return new Promise<void>(resolve => { finish = resolve; });
        });
        get.mockRejectedValue({ response: { status: 401 } });
        auth.startValidationMonitoring({ onInvalidated });
        await advance(HOUR);
        expect(auth.isReady()).toBe(false);
        const stopped = auth.stopValidationMonitoring();
        expect(signal.aborted).toBe(true);
        await advance(5000);
        await stopped;
        finish(); await flush();
        await advance(HOUR);
        expect(onInvalidated.mock.calls.length).toBe(1);
    });

    it('joins cooperative invalidation callback finally cleanup before acknowledging stop', async () => {
        let releaseCleanup!: () => void;
        let cleaning = false;
        const cleanup = new Promise<void>(resolve => { releaseCleanup = resolve; });
        const onInvalidated = async ({ signal }: { signal: AbortSignal }) => {
            try {
                await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
            } finally {
                cleaning = true;
                await cleanup;
            }
        };
        get.mockRejectedValue({ response: { status: 401 } });
        auth.startValidationMonitoring({ onInvalidated });
        await advance(HOUR);
        let settled = false;
        const stopped = auth.stopValidationMonitoring();
        void stopped.then(() => { settled = true; });
        await flush();
        expect(cleaning).toBe(true);
        expect(settled).toBe(false);
        expect(auth.stopValidationMonitoring()).toBe(stopped);
        expect(() => auth.startValidationMonitoring({ onInvalidated })).toThrow('still retiring');
        releaseCleanup();
        await stopped;
        expect(settled).toBe(true);
    });

    it('joins original HTTP finally cleanup after cancellation rather than only its raced wrapper', async () => {
        let releaseCleanup!: () => void;
        let cleaning = false;
        const cleanup = new Promise<void>(resolve => { releaseCleanup = resolve; });
        get.mockImplementationOnce(async (_url, config) => {
            const { signal } = config as { signal: AbortSignal };
            try {
                await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
                throw new Error('test-request-cancelled');
            } finally {
                cleaning = true;
                await cleanup;
            }
        });
        const onInvalidated = createMockFn<[], void>();
        auth.startValidationMonitoring({ onInvalidated });
        await advance(HOUR);
        let settled = false;
        const stopped = auth.stopValidationMonitoring();
        void stopped.then(() => { settled = true; });
        await flush();
        expect(cleaning).toBe(true);
        expect(settled).toBe(false);
        expect(auth.stopValidationMonitoring()).toBe(stopped);
        releaseCleanup();
        await stopped;
        expect(settled).toBe(true);
        expect(onInvalidated.mock.calls.length).toBe(0);
        expect(auth.isReady()).toBe(true);
    });

    it('abandons uncooperative callback cleanup only at the five-second retirement deadline', async () => {
        const onInvalidated = async ({ signal }: { signal: AbortSignal }) => {
            try {
                await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
            } finally {
                await new Promise<void>(() => undefined);
            }
        };
        get.mockRejectedValue({ response: { status: 401 } });
        auth.startValidationMonitoring({ onInvalidated });
        await advance(HOUR);
        let settled = false;
        const stopped = auth.stopValidationMonitoring();
        void stopped.then(() => { settled = true; });
        await flush();
        expect(settled).toBe(false);
        await advance(4999);
        expect(settled).toBe(false);
        await advance(1);
        await stopped;
        expect(settled).toBe(true);
    });

    it('safely observes callback rejection even when diagnostic logging throws', async () => {
        await auth.stopValidationMonitoring();
        const failingLogger = { ...noOpLogger, warn: () => { throw new Error('test-logger-failure'); } };
        auth = new TwitchAuth({ tokenStorePath, clientId: 'test-client', expectedUsername: 'test-user', logger: failingLogger, httpClient: { get, post }, monitoringNow: testClock.now });
        await auth.initialize();
        const onInvalidated = createMockFn<[], Promise<void>>().mockRejectedValue(new Error('test-callback-failure'));
        get.mockRejectedValue({ response: { status: 401 } });
        auth.startValidationMonitoring({ onInvalidated });
        await advance(HOUR);
        expect(auth.isReady()).toBe(false);
        await auth.stopValidationMonitoring();
        expect(onInvalidated.mock.calls.length).toBe(1);
    });

    it.each(['invalid', 'valid'])('ignores late %s old-token validation after a new candidate is accepted', async kind => {
        let resolve!: (value: ReturnType<typeof valid>) => void;
        let reject!: (reason: unknown) => void;
        get.mockReturnValueOnce(new Promise<ReturnType<typeof valid>>((done, fail) => { resolve = done; reject = fail; }));
        const onInvalidated = createMockFn<[], void>();
        auth.startValidationMonitoring({ onInvalidated });
        await advance(HOUR);
        await advance(1000);
        get.mockResolvedValue(valid());
        post.mockResolvedValue({ data: { access_token: 'test-new-access', refresh_token: 'test-new-refresh' } });
        // Real candidate persistence uses asynchronous filesystem work, not fake time.
        await auth.refreshTokens();
        await advance(1000);
        if (kind === 'invalid') reject({ response: { status: 401 } }); else resolve(valid());
        await flush();
        expect(auth.isReady()).toBe(true);
        expect(secrets.twitch.accessToken).toBe('test-new-access');
        expect(onInvalidated.mock.calls.length).toBe(0);
        const calls = get.mock.calls.length;
        await advance(HOUR - 1001);
        expect(get.mock.calls.length).toBe(calls);
        await advance(1);
        expect(get.mock.calls.length).toBe(calls + 1);
    });

    it('repeated start/stop clears scheduled work and permits a fresh monitoring lifetime', async () => {
        const onInvalidated = createMockFn<[], void>();
        auth.startValidationMonitoring({ onInvalidated });
        await auth.stopValidationMonitoring();
        await auth.stopValidationMonitoring();
        await advance(HOUR);
        expect(get.mock.calls.length).toBe(1);
        auth.startValidationMonitoring({ onInvalidated }); await flush();
        expect(get.mock.calls.length).toBe(2);
        await auth.stopValidationMonitoring();
        await advance(HOUR);
        expect(get.mock.calls.length).toBe(2);
    });

    it('explicit validated recovery retires old callback admission and requires a fresh monitor start', async () => {
        let signal!: AbortSignal;
        let finish!: () => void;
        const onInvalidated = createMockFn<[{ signal: AbortSignal }], Promise<void>>().mockImplementation(event => {
            signal = event.signal;
            return new Promise<void>(resolve => { finish = resolve; });
        });
        auth.startValidationMonitoring({ onInvalidated });
        get.mockRejectedValueOnce({ response: { status: 401 } });
        await advance(HOUR);
        expect(auth.isReady()).toBe(false);
        post.mockResolvedValue({ data: { access_token: 'test-recovered', refresh_token: 'test-recovered-refresh' } });
        expect(await auth.refreshTokens()).toBe(true);
        expect(signal.aborted).toBe(true);
        expect(auth.isReady()).toBe(true);
        let retired = false;
        const retirement = auth.stopValidationMonitoring();
        void retirement.then(() => { retired = true; });
        await flush();
        expect(retired).toBe(false);
        expect(() => auth.startValidationMonitoring({ onInvalidated })).toThrow('still retiring');
        finish(); await flush();
        await retirement;
        expect(retired).toBe(true);
        const calls = get.mock.calls.length;
        await advance(HOUR);
        expect(get.mock.calls.length).toBe(calls);
        auth.startValidationMonitoring({ onInvalidated }); await flush();
        expect(get.mock.calls.length).toBe(calls + 1);
    });

    it('resets old outage grace when a new credential generation is accepted during retry sleep', async () => {
        const onInvalidated = createMockFn<[], void>();
        auth.startValidationMonitoring({ onInvalidated });
        get.mockRejectedValueOnce({ response: { status: 503 } });
        await advance(HOUR);
        post.mockResolvedValue({ data: { access_token: 'test-new-access', refresh_token: 'test-new-refresh' } });
        await auth.refreshTokens();
        const calls = get.mock.calls.length;
        await advance(30_000);
        expect(get.mock.calls.length).toBe(calls);
        await advance(270_000);
        expect(auth.isReady()).toBe(true);
        expect(onInvalidated.mock.calls.length).toBe(0);
    });

    it('cancels outage retry sleep immediately on stop', async () => {
        const onInvalidated = createMockFn<[], void>();
        get.mockRejectedValue({ response: { status: 503 } });
        auth.startValidationMonitoring({ onInvalidated });
        await advance(HOUR);
        await auth.stopValidationMonitoring();
        await advance(HOUR);
        expect(get.mock.calls.length).toBe(2);
        expect(onInvalidated.mock.calls.length).toBe(0);
        expect(auth.isReady()).toBe(true);
    });

    it('coalesces API refresh while monitor is active and does not own or restart that independent refresh', async () => {
        let resolve!: (value: { data?: unknown }) => void;
        post.mockReturnValue(new Promise<{ data?: unknown }>(done => { resolve = done; }));
        const onInvalidated = createMockFn<[], void>();
        auth.startValidationMonitoring({ onInvalidated });
        const first = auth.refreshTokens();
        const second = auth.refreshTokens();
        expect(post.mock.calls.length).toBe(1);
        await auth.stopValidationMonitoring();
        resolve({ data: { access_token: 'test-new-access', refresh_token: 'test-new-refresh' } });
        expect(await Promise.all([first, second])).toEqual([true, true]);
        const calls = get.mock.calls.length;
        await advance(HOUR);
        expect(get.mock.calls.length).toBe(calls);
        expect(onInvalidated.mock.calls.length).toBe(0);
    });
});
