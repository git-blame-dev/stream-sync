import { afterEach, beforeEach, expect, it, spyOn } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as https from 'node:https';
import { EventEmitter } from 'node:events';
import { runOAuthFlow, exchangeCodeForTokens, startCallbackServer } from '../../../src/auth/oauth-flow';
import { TwitchAuth } from '../../../src/auth/TwitchAuth';
import { secrets, _resetForTesting } from '../../../src/core/secrets';
import { noOpLogger } from '../../helpers/mock-factories';

const deferred = <T>() => { let resolve!: (value: T) => void;
    const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
let directory: string;
let tokenStorePath: string;
beforeEach(async () => {
    _resetForTesting(); secrets.twitch.clientSecret = 'test-secret';
    directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'test-oauth-retirement-'));
    tokenStorePath = path.join(directory, 'test-tokens.json');
});
afterEach(async () => { _resetForTesting(); await fs.promises.rm(directory, { recursive: true, force: true }); });

it.each(['before-start', 'starting', 'callback', 'exchange'])('cancels OAuth at %s without late browser/exchange/persistence', async stage => {
    const controller = new AbortController();
    const startup = deferred<void>(); const callback = deferred<string>(); const exchange = deferred<{ accessToken: string; refreshToken: string }>();
    const enteredStartup = deferred<void>(); const enteredExchange = deferred<void>();
    let opened = 0; let closed = 0; let started = 0; let exchanges = 0;
    let exchangeSignal: AbortSignal | undefined;
    if (stage === 'before-start') controller.abort();
    const operation = runOAuthFlow({ clientId: 'test-client', tokenStorePath, logger: noOpLogger, signal: controller.signal }, {
        startCallbackServer: async () => {
            started++; enteredStartup.resolve();
            if (stage === 'starting') await startup.promise;
            return { server: {} as https.Server, cancel: () => { closed++; }, waitForCode: callback.promise,
                port: 443, redirectUri: 'https://test.invalid/callback' };
        },
        openBrowser: () => { opened++; },
        exchangeCodeForTokens: async (_code, options) => {
            exchanges++; exchangeSignal = options.signal; enteredExchange.resolve(); return exchange.promise;
        }
    });
    if (stage !== 'before-start') await enteredStartup.promise;
    if (stage === 'exchange') { callback.resolve('test-code'); await enteredExchange.promise; }
    if (stage === 'callback') await flush();
    controller.abort();
    startup.resolve(); callback.resolve('test-late-code');
    exchange.resolve({ accessToken: 'test-late-access', refreshToken: 'test-late-refresh' });
    expect(await operation).toBe(null);
    expect(started).toBe(stage === 'before-start' ? 0 : 1);
    expect(opened).toBe(['before-start', 'starting'].includes(stage) ? 0 : 1);
    expect(exchanges).toBe(stage === 'exchange' ? 1 : 0);
    expect(closed).toBe(stage === 'before-start' ? 0 : 1);
    if (stage === 'exchange') expect(exchangeSignal?.aborted).toBe(true);
    expect(fs.existsSync(tokenStorePath)).toBe(false);
});

it('callback cancellation promptly cancels the callback owner without waiting for code', async () => {
    const controller = new AbortController(); const opened = deferred<void>();
    let cancelled = false;
    const flow = runOAuthFlow({ clientId: 'test-client', tokenStorePath, logger: noOpLogger, signal: controller.signal }, {
        startCallbackServer: async () => ({ server: {} as https.Server, cancel: () => { cancelled = true; },
            waitForCode: new Promise<string>(() => {}), port: 443, redirectUri: 'https://test.invalid' }),
        openBrowser: () => { opened.resolve(); },
        exchangeCodeForTokens: async () => { throw new Error('test-unexpected-exchange'); }
    });
    await opened.promise; controller.abort();
    expect(await flow).toBe(null); expect(cancelled).toBe(true);
});

it.each(['before-request', 'request', 'response'])('native exchange cancellation at %s destroys admitted transports', async stage => {
    const controller = new AbortController();
    let requests = 0; let requestDestroyed = false; let responseDestroyed = false;
    const response = Object.assign(new EventEmitter(), { destroy: () => { responseDestroyed = true; }, complete: false });
    const request = Object.assign(new EventEmitter(), { destroy: () => { requestDestroyed = true; }, write: () => {}, end: () => {} });
    if (stage === 'before-request') controller.abort(new Error('test-cancelled'));
    const httpsRequest = ((_options: unknown, callback: (response: unknown) => void) => {
        requests++; if (stage === 'response') callback(response); return request;
    }) as unknown as typeof https.request;
    const operation = exchangeCodeForTokens('test-code', { clientId: 'test-client', clientSecret: 'test-secret',
        redirectUri: 'https://test.invalid', logger: noOpLogger, signal: controller.signal, httpsRequest });
    controller.abort(new Error('test-cancelled'));
    await expect(operation).rejects.toThrow(stage === 'before-request' ? 'test-cancelled' : 'cancelled');
    expect(requests).toBe(stage === 'before-request' ? 0 : 1);
    expect(requestDestroyed).toBe(stage !== 'before-request'); expect(responseDestroyed).toBe(stage === 'response');
});

it.each(['before-listen', 'listening'])('callback server cancellation at %s avoids native startup', async stage => {
    const controller = new AbortController(); let listens = 0; let closed = 0;
    const server = Object.assign(new EventEmitter(), {
        close: () => { closed++; return server; }, closeAllConnections: () => {},
        listen: () => { listens++; }, address: () => null
    });
    const create = spyOn(https, 'createServer').mockReturnValue(server as unknown as https.Server);
    try {
        if (stage === 'before-listen') controller.abort(new Error('test-cancelled'));
        const startup = startCallbackServer({ logger: noOpLogger, signal: controller.signal });
        controller.abort(new Error('test-cancelled'));
        await expect(startup).rejects.toThrow(stage === 'before-listen' ? 'test-cancelled' : 'cancelled');
        expect(listens).toBe(stage === 'before-listen' ? 0 : 1);
        expect(closed).toBe(stage === 'before-listen' ? 0 : 1);
        expect(server.listenerCount('listening')).toBe(0); expect(server.listenerCount('error')).toBe(0);
    } finally { create.mockRestore(); }
});

it('auth retirement propagates cancellation to its OAuth runner before monitor acquisition', async () => {
    const previous = process.env.TWITCH_DISABLE_AUTH; delete process.env.TWITCH_DISABLE_AUTH;
    const entered = deferred<AbortSignal>(); const returned = deferred<{ accessToken: string; refreshToken: string }>();
    const auth = new TwitchAuth({ tokenStorePath, clientId: 'test-client', expectedUsername: 'test-user', logger: noOpLogger,
        oauthFlow: async ({ signal }) => { entered.resolve(signal); return returned.promise; } });
    try {
        const initialize = auth.initialize(); const outcome = initialize.catch(error => error);
        const signal = await entered.promise; await auth.dispose();
        expect(signal.aborted).toBe(true); expect((await outcome).message).toContain('disposed');
        returned.resolve({ accessToken: 'test-late', refreshToken: 'test-refresh' }); await flush();
        expect(fs.existsSync(tokenStorePath)).toBe(false); expect(auth.isReady()).toBe(false);
    } finally {
        returned.resolve({ accessToken: 'test-late', refreshToken: 'test-refresh' }); await auth.dispose();
        if (previous === undefined) delete process.env.TWITCH_DISABLE_AUTH; else process.env.TWITCH_DISABLE_AUTH = previous;
    }
});
