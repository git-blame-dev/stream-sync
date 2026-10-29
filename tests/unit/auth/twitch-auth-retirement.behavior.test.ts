import { afterEach, beforeEach, expect, it, spyOn } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { TwitchAuth } from '../../../src/auth/TwitchAuth';
import { secrets, _resetForTesting } from '../../../src/core/secrets';
import { TWITCH_OAUTH_SCOPES } from '../../../src/auth/twitch-oauth-scopes';
import { useFakeTimers, useRealTimers, advanceTimersByTime } from '../../helpers/bun-timers';
import { noOpLogger } from '../../helpers/mock-factories';

const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const valid = () => ({ data: { user_id: 'test-user-id', client_id: 'test-client', login: 'test-user', scopes: [...TWITCH_OAUTH_SCOPES] } });
const originalDisableAuth = process.env.TWITCH_DISABLE_AUTH;
let directory: string;
let tokenStorePath: string;
beforeEach(async () => {
    delete process.env.TWITCH_DISABLE_AUTH;
    _resetForTesting(); secrets.twitch.clientSecret = 'test-secret'; secrets.twitch.refreshToken = 'test-refresh';
    directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'test-auth-retirement-'));
    tokenStorePath = path.join(directory, 'test-tokens.json');
});
afterEach(async () => {
    if (originalDisableAuth === undefined) delete process.env.TWITCH_DISABLE_AUTH;
    else process.env.TWITCH_DISABLE_AUTH = originalDisableAuth;
    _resetForTesting(); await fs.promises.rm(directory, { recursive: true, force: true }); });
const createAuth = (options: Partial<ConstructorParameters<typeof TwitchAuth>[0]> = {}) => new TwitchAuth({
    tokenStorePath, clientId: 'test-client', expectedUsername: 'test-user', logger: noOpLogger,
    httpClient: { get: async () => valid(), post: async () => ({ data: { access_token: 'test-new', refresh_token: 'test-rotated' } }) }, ...options
});

it('irreversibly retires before any monitor was acquired', async () => {
    const auth = createAuth();
    const retirement = auth.dispose();
    expect(auth.dispose()).toBe(retirement);
    await retirement;
    await expect(auth.initialize()).rejects.toThrow('disposed');
    await expect(auth.refreshTokens()).rejects.toThrow('disposed');
    expect(() => auth.startValidationMonitoring({ onInvalidated: () => {} })).toThrow('disposed');
    expect(auth.isReady()).toBe(false);
});

it.each(['success', 'terminal-error'])('fences abort-ignoring refresh %s after retirement', async outcome => {
    const request = deferred<{ data: unknown }>(); const entered = deferred<void>();
    let validations = 0; let oauths = 0; let requestSignal: AbortSignal | undefined;
    const auth = createAuth({ httpClient: { get: async () => { validations++; return valid(); }, post: async (_url, _body, options) => {
        requestSignal = options?.signal as AbortSignal; entered.resolve(); return request.promise;
    } }, oauthFlow: async () => { oauths++; return null; } });
    const refresh = auth.refreshTokens(); await entered.promise;
    await auth.dispose();
    expect(await refresh).toBe(false); expect(requestSignal?.aborted).toBe(true);
    if (outcome === 'success') request.resolve({ data: { access_token: 'test-late' } });
    else request.reject({ response: { data: { error: 'invalid_grant' } } });
    await request.promise.catch(() => {});
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(validations).toBe(0); expect(oauths).toBe(0); expect(fs.existsSync(tokenStorePath)).toBe(false);
    expect(secrets.twitch.accessToken).toBe(null);
});

it('caller cancellation leaves a coalesced refresh available to another waiter', async () => {
    const request = deferred<{ data: unknown }>(); let posts = 0;
    const auth = createAuth({ httpClient: { get: async () => valid(), post: async () => { posts++; return request.promise; } } });
    const caller = new AbortController();
    const cancelled = auth.refreshTokens(caller.signal);
    const remaining = auth.refreshTokens();
    caller.abort(new Error('test-caller-cancelled'));
    await expect(cancelled).rejects.toThrow('test-caller-cancelled');
    expect(posts).toBe(1);
    request.resolve({ data: { access_token: 'test-new', refresh_token: 'test-rotated' } });
    expect(await remaining).toBe(true); expect(auth.isReady()).toBe(true);
    await auth.dispose();
});

it('retirement after validation started prevents commit admission even for ignored abort', async () => {
    const validation = deferred<ReturnType<typeof valid>>(); const entered = deferred<void>();
    const auth = createAuth({ httpClient: { post: async () => ({ data: { access_token: 'test-new' } }),
        get: async () => { entered.resolve(); return validation.promise; } } });
    const refresh = auth.refreshTokens(); await entered.promise;
    await auth.dispose(); expect(await refresh).toBe(false);
    validation.resolve(valid()); await validation.promise;
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(fs.existsSync(tokenStorePath)).toBe(false); expect(auth.isReady()).toBe(false);
});


it.each(['resolve', 'reject'])('finite refresh deadline releases shared waiters before late %s', async outcome => {
    const request = deferred<{ data: unknown }>(); let posts = 0; let validations = 0; let oauths = 0;
    let signal: AbortSignal | undefined;
    const auth = createAuth({ networkTimeoutMs: 50, oauthFlow: async () => { oauths++; return null; },
        httpClient: { get: async () => { validations++; return valid(); }, post: async (_url, _body, config) => {
            posts++; signal = config?.signal as AbortSignal; return request.promise;
        } } });
    useFakeTimers();
    try {
        const first = auth.refreshTokens(); const second = auth.refreshTokens();
        for (let i = 0; i < 10; i++) await Promise.resolve();
        advanceTimersByTime(50);
        expect(await Promise.all([first, second])).toEqual([false, false]);
        expect(signal?.aborted).toBe(true); expect(posts).toBe(1);
        if (outcome === 'resolve') request.resolve({ data: { access_token: 'test-late' } });
        else request.reject({ response: { data: { error: 'invalid_grant' } } });
        await request.promise.catch(() => {});
        for (let i = 0; i < 20; i++) await Promise.resolve();
        expect(validations).toBe(0); expect(oauths).toBe(0);
        expect(fs.existsSync(tokenStorePath)).toBe(false);
        await auth.dispose();
    } finally { useRealTimers(); }
});

it.each(['directory', 'write', 'rename-before', 'rename-after', 'post-rename'])('joins real token-store %s completion and rejects queued candidates', async boundary => {
    const entered = deferred<void>(); const release = deferred<void>();
    let reached = false; let writes = 0; let candidates = 0; let validations = 0;
    const pause = async () => { if (!reached) { reached = true; entered.resolve(); await release.promise; } };
    const io = fs.promises;
    const original = { mkdir: io.mkdir.bind(io), writeFile: io.writeFile.bind(io), rename: io.rename.bind(io), chmod: io.chmod.bind(io) };
    const spies = [
        spyOn(io, 'mkdir').mockImplementation((async (...args: Parameters<typeof io.mkdir>) => {
            if (boundary === 'directory' && args[0] === directory) await pause();
            return original.mkdir(...args);
        }) as typeof io.mkdir),
        spyOn(io, 'writeFile').mockImplementation(async (...args) => {
            if (String(args[0]).startsWith(tokenStorePath + '.')) { writes++; if (boundary === 'write') await pause(); }
            return original.writeFile(...args);
        }),
        spyOn(io, 'rename').mockImplementation(async (...args) => {
            if (args[1] === tokenStorePath && boundary === 'rename-before') await pause();
            await original.rename(...args);
            if (args[1] === tokenStorePath && boundary === 'rename-after') await pause();
        }),
        spyOn(io, 'chmod').mockImplementation(async (...args) => {
            if (args[0] === tokenStorePath && boundary === 'post-rename') await pause();
            return original.chmod(...args);
        })
    ];
    const secondValidation = deferred<void>();
    const auth = createAuth({ oauthFlow: async () => ({ accessToken: `test-candidate-${++candidates}`, refreshToken: 'test-rotated' }),
        httpClient: { get: async () => { if (++validations === 2) secondValidation.resolve(); return valid(); }, post: async () => ({}) } });
    try {
        const first = auth.initialize(); const firstResult = first.catch(error => error);
        await entered.promise;
        const queued = auth.initialize(); const queuedResult = queued.catch(error => error);
        await secondValidation.promise;
        for (let i = 0; i < 20; i++) await Promise.resolve();
        let drained = false;
        const retirement = auth.dispose(); void retirement.then(() => { drained = true; });
        for (let i = 0; i < 20; i++) await Promise.resolve();
        expect(drained).toBe(false); expect(auth.isReady()).toBe(false);
        release.resolve();
        await retirement;
        expect((await firstResult).message).toContain('disposed');
        expect((await queuedResult).message).toContain('disposed');
        expect(writes).toBe(1);
        expect(JSON.parse(await io.readFile(tokenStorePath, 'utf8')).twitch.accessToken).toBe('test-candidate-1');
        expect(secrets.twitch.accessToken).toBe(null); expect(auth.isReady()).toBe(false);
        // A replacement owner is permitted only after this actual join.
        const replacement = createAuth(); await replacement.initialize();
        expect(replacement.isReady()).toBe(true); await replacement.dispose();
    } finally { release.resolve(); for (const spy of spies.reverse()) spy.mockRestore(); await auth.dispose(); }
});

it('bounds an abort-ignoring candidate validation and never admits its late result', async () => {
    const validation = deferred<ReturnType<typeof valid>>(); let signal: AbortSignal | undefined;
    const auth = createAuth({ httpClient: { post: async () => ({ data: { access_token: 'test-new' } }),
        get: async (_url, config) => { signal = config?.signal as AbortSignal; return validation.promise; } } });
    useFakeTimers();
    try {
        const refresh = auth.refreshTokens();
        for (let i = 0; i < 30; i++) await Promise.resolve();
        expect(signal?.aborted).toBe(false);
        advanceTimersByTime(5000);
        expect(await refresh).toBe(false); expect(signal?.aborted).toBe(true);
        validation.resolve(valid()); await validation.promise;
        for (let i = 0; i < 20; i++) await Promise.resolve();
        expect(fs.existsSync(tokenStorePath)).toBe(false); expect(auth.isReady()).toBe(false);
        await auth.dispose();
    } finally { useRealTimers(); }
});

it('retirement joins failed persistence finally cleanup and preserves the original failure', async () => {
    const enteredCleanup = deferred<void>(); const releaseCleanup = deferred<void>();
    const failure = new Error('test-filesystem-rename-failed');
    const io = fs.promises; const originalUnlink = io.unlink.bind(io);
    const rename = spyOn(io, 'rename').mockImplementation(async (_from, to) => {
        if (to === tokenStorePath) throw failure;
        throw new Error('test-unexpected-rename');
    });
    const unlink = spyOn(io, 'unlink').mockImplementation(async target => {
        if (String(target).startsWith(tokenStorePath + '.')) { enteredCleanup.resolve(); await releaseCleanup.promise; }
        await originalUnlink(target);
    });
    const auth = createAuth({ oauthFlow: async () => ({ accessToken: 'test-new', refreshToken: 'test-rotated' }) });
    try {
        const initialize = auth.initialize(); const result = initialize.catch(error => error);
        await enteredCleanup.promise;
        let drained = false; const retirement = auth.dispose(); void retirement.then(() => { drained = true; });
        for (let i = 0; i < 20; i++) await Promise.resolve();
        expect(drained).toBe(false);
        releaseCleanup.resolve(); await retirement;
        expect(await result).toBe(failure); expect(await io.readdir(directory)).toEqual([]);
        expect(auth.isReady()).toBe(false); expect(secrets.twitch.accessToken).toBe(null);
    } finally { releaseCleanup.resolve(); await auth.dispose(); unlink.mockRestore(); rename.mockRestore(); }
});
