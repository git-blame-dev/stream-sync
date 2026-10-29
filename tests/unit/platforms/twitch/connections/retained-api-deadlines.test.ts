import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TwitchAuth } from '../../../../../src/auth/TwitchAuth';
import { TWITCH_OAUTH_SCOPES } from '../../../../../src/auth/twitch-oauth-scopes';
import { TwitchApiClient } from '../../../../../src/utils/api-clients/twitch-api-client';
import { EnhancedHttpClient } from '../../../../../src/utils/enhanced-http-client';
import { TwitchEventSub } from '../../../../../src/platforms/twitch-eventsub';
import { secrets } from '../../../../../src/core/secrets';
import { noOpLogger } from '../../../../helpers/mock-factories';
import { useFakeTimers, useRealTimers, advanceTimersByTime, getTimerCount } from '../../../../helpers/bun-timers';

async function fixture() {
    const dir = await mkdtemp(join(tmpdir(), 'synthetic-retained-api-'));
    const saved = { ...secrets.twitch };
    const disabled = process.env.TWITCH_DISABLE_AUTH;
    delete process.env.TWITCH_DISABLE_AUTH;
    secrets.twitch.accessToken = 'synthetic-initial';
    secrets.twitch.refreshToken = 'synthetic-refresh';
    secrets.twitch.clientSecret = 'synthetic-secret';
    const refreshEntered = Promise.withResolvers<void>();
    const refreshResponse = Promise.withResolvers<{ data: { access_token: string; refresh_token: string } }>();
    const tokenStorePath = join(dir, 'synthetic-tokens.json');
    await writeFile(tokenStorePath, JSON.stringify({ twitch: { accessToken: 'synthetic-initial', refreshToken: 'synthetic-refresh' } }), { mode: 0o600 });
    const auth = new TwitchAuth({ clientId: 'synthetic-client', expectedUsername: 'synthetic-user', logger: noOpLogger,
        tokenStorePath, httpClient: {
            post: async () => { refreshEntered.resolve(); return refreshResponse.promise; },
            get: async () => ({ data: { user_id: 'synthetic-user-id', client_id: 'synthetic-client',
                login: 'synthetic-user', scopes: [...TWITCH_OAUTH_SCOPES] } })
        }
    });
    await auth.initialize();
    return { auth, refreshEntered, refreshResponse,
        release() { refreshResponse.resolve({ data: { access_token: 'synthetic-new', refresh_token: 'synthetic-rotated' } }); },
        async close() { refreshResponse.resolve({ data: { access_token: 'synthetic-new', refresh_token: 'synthetic-rotated' } });
            await auth.dispose(); Object.assign(secrets.twitch, saved);
            if (disabled === undefined) delete process.env.TWITCH_DISABLE_AUTH; else process.env.TWITCH_DISABLE_AUTH = disabled;
            await rm(dir, { recursive: true, force: true }); }
    };
}

for (const cancel of ['signal', 'budget'] as const) {
    test(`whole API ${cancel} releases held refresh without replay; shared auth waiter survives`, async () => {
        const f = await fixture();
        let gets = 0;
        const http = new EnhancedHttpClient({ logger: noOpLogger, axios: {
            get: async () => { gets++; throw { response: { status: 401 } }; },
            post: async () => ({}), put: async () => ({}), delete: async () => ({})
        } });
        const api = new TwitchApiClient(f.auth, { clientId: 'synthetic-client' }, noOpLogger, { enhancedHttpClient: http });
        const controller = new AbortController();
        useFakeTimers();
        const baseline = getTimerCount();
        let operation: Promise<unknown> | undefined;
        try {
            operation = api.makeRequest('/synthetic', cancel === 'signal' ? { signal: controller.signal } : { overallBudgetMs: 50 });
            const outcome = operation.catch(error => error);
            await f.refreshEntered.promise;
            const independent = f.auth.refreshTokens();
            if (cancel === 'signal') controller.abort(new Error('synthetic caller cancelled'));
            else advanceTimersByTime(50);
            let settled = false; void outcome.then(() => { settled = true; });
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(settled).toBe(true);
            expect(await outcome).toBeInstanceOf(Error);
            expect(await outcome).toMatchObject({ message: expect.stringContaining(cancel === 'signal' ? 'synthetic caller cancelled' : 'deadline') });
            expect(gets).toBe(1);
            f.release(); expect(await independent).toBe(true);
            expect(gets).toBe(1);
            expect(getTimerCount()).toBe(baseline);
        } finally { f.release(); await operation?.catch(() => {}); useRealTimers(); await f.close(); }
    });
}

for (const boundary of ['refresh', 'post', 'post-cleanup', 'deadline', 'caller'] as const) {
    test(`EventSub fences ${boundary} and never retries an ambiguous POST`, async () => {
        const f = await fixture();
        const postEntered = Promise.withResolvers<void>();
        const postResponse = Promise.withResolvers<{ data: { data: Array<{ is_sent: boolean }> } }>();
        let posts = 0;
        let signal: AbortSignal | undefined;
        let timeout: number | undefined;
        const sender = new TwitchEventSub({ clientId: 'synthetic-client', broadcasterId: 'synthetic-channel' }, {
            logger: noOpLogger, WebSocketCtor: class extends EventTarget {}, twitchAuth: f.auth,
            axios: { post: async (_url: string, _body: unknown, config: { signal: AbortSignal; timeout: number }) => {
                posts++; signal = config.signal; timeout = config.timeout; postEntered.resolve();
                if (boundary === 'refresh') throw { response: { status: 401 } };
                return postResponse.promise;
            } }
        });
        const controller = new AbortController();
        useFakeTimers(); const baseline = getTimerCount();
        let operation: Promise<unknown> | undefined;
        let independent: Promise<boolean> | undefined;
        try {
            if (boundary === 'post-cleanup') await sender.cleanup();
            operation = sender.sendMessage('synthetic message', { signal: controller.signal, overallBudgetMs: 50 });
            const outcome = operation.catch(error => error);
            if (boundary !== 'post-cleanup') {
                await postEntered.promise;
                if (boundary === 'refresh') { await f.refreshEntered.promise; independent = f.auth.refreshTokens(); }
                if (boundary === 'deadline') advanceTimersByTime(50);
                else if (boundary === 'caller') controller.abort(new Error('synthetic send cancelled'));
                else await sender.cleanup();
            }
            let settled = false; void outcome.then(() => { settled = true; });
            await new Promise<void>(resolve => setImmediate(resolve));
            expect(settled).toBe(true);
            expect(await outcome).toBeInstanceOf(Error);
            expect(posts).toBe(boundary === 'post-cleanup' ? 0 : 1);
            if (boundary !== 'post-cleanup') {
                expect(signal?.aborted).toBe(true);
                expect(timeout).toBeGreaterThan(0); expect(timeout).toBeLessThanOrEqual(50);
            }
            postResponse.resolve({ data: { data: [{ is_sent: true }] } });
            f.release(); if (independent) expect(await independent).toBe(true);
            await postResponse.promise;
            expect(posts).toBe(boundary === 'post-cleanup' ? 0 : 1);
            expect(getTimerCount()).toBe(baseline);
        } finally { postResponse.resolve({ data: { data: [{ is_sent: true }] } });
            f.release(); await operation?.catch(() => {}); await sender.cleanup(); useRealTimers(); await f.close(); }
    });
}

test('one API deadline spans initial GET, refresh and held replay', async () => {
    const f = await fixture();
    const firstEntered = Promise.withResolvers<void>();
    const firstRelease = Promise.withResolvers<void>();
    const replayEntered = Promise.withResolvers<void>();
    const replayRelease = Promise.withResolvers<Record<string, unknown>>();
    let gets = 0;
    let replaySignal: AbortSignal | undefined;
    let replayHeaders: unknown;
    const http = new EnhancedHttpClient({ logger: noOpLogger, axios: {
        get: async (_url, config) => {
            if (++gets === 1) { firstEntered.resolve(); await firstRelease.promise; throw { response: { status: 401 } }; }
            replaySignal = config.signal as AbortSignal; replayHeaders = config.headers;
            replayEntered.resolve(); return replayRelease.promise;
        }, post: async () => ({}), put: async () => ({}), delete: async () => ({})
    } });
    const api = new TwitchApiClient(f.auth, { clientId: 'synthetic-client' }, noOpLogger, { enhancedHttpClient: http });
    useFakeTimers(); const baseline = getTimerCount();
    let request: Promise<unknown> | undefined;
    try {
        request = api.makeRequest('/synthetic', { overallBudgetMs: 100 });
        const outcome = request.catch(error => error);
        await firstEntered.promise; advanceTimersByTime(40); firstRelease.resolve();
        await f.refreshEntered.promise; advanceTimersByTime(40); f.release();
        await replayEntered.promise;
        expect(replayHeaders).toMatchObject({ Authorization: 'Bearer synthetic-new', 'Client-Id': 'synthetic-client' });
        advanceTimersByTime(20);
        expect(await outcome).toMatchObject({ message: expect.stringContaining('deadline') });
        expect(replaySignal?.aborted).toBe(true);
        replayRelease.resolve({ data: { data: [] } }); await replayRelease.promise;
        expect(gets).toBe(2); expect(getTimerCount()).toBe(baseline);
    } finally { firstRelease.resolve(); replayRelease.resolve({ data: { data: [] } }); f.release();
        await request?.catch(() => {}); useRealTimers(); await f.close(); }
});
