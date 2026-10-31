import { vi, describe, expect, test, spyOn } from 'bun:test';
import { createRequire } from 'node:module';
import { createServer, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { getEventListeners } from 'node:events';
import * as deadlines from '../../../src/utils/timeout-wrapper';
import { safeDelay } from '../../../src/utils/timeout-validator';
import { HttpRetryExecutor } from '../../../src/utils/http-retry-executor';
import { EnhancedHttpClient } from '../../../src/utils/enhanced-http-client';

import testClock from '../../helpers/test-clock';
import { noOpLogger } from '../../helpers/mock-factories';

const retryError = (headers = { 'retry-after': '120' }) => ({ response: { status: 429, headers } });
const nodeRequire = createRequire(import.meta.url);
type HttpAdapter = NonNullable<ConstructorParameters<typeof EnhancedHttpClient>[0]>['axios'];
// Load the installed transport directly: the suite preload mocks the package entry.
const realAxios = nodeRequire('../../../node_modules/axios/dist/node/axios.cjs') as NonNullable<HttpAdapter>;

describe('operation deadlines', () => {
    test('pre-aborted parents preserve their reason and never invoke work', async () => {
        const parent = new AbortController();
        const reason = new Error('synthetic parent retired');
        parent.abort(reason);
        const operation = vi.fn(async () => 'late');
        await expect(deadlines.withOperationDeadline(operation, { budgetMs: 100, parentAbortSignal: parent.signal })).rejects.toBe(reason);
        expect(operation).not.toHaveBeenCalled();
    });

    test('deadline aborts owned work and rejects when work ignores cancellation', async () => {
        let ownedSignal: AbortSignal | undefined;
        await expect(deadlines.withOperationDeadline(({ signal, remainingBudgetMs }) => {
            ownedSignal = signal;
            expect(remainingBudgetMs()).toBeGreaterThan(0);
            expect(remainingBudgetMs()).toBeLessThanOrEqual(20);
            return new Promise<never>(() => {});
        }, { budgetMs: 20, operationName: 'synthetic request' })).rejects.toThrow('synthetic request deadline exceeded after 20ms');
        expect(ownedSignal?.aborted).toBe(true);
        expect(getEventListeners(ownedSignal!, 'abort')).toHaveLength(0);
    });

    test('budget validation never invokes work and rejects unsupported timer durations', async () => {
        const operation = vi.fn(async () => 'late');
        for (const budgetMs of [0, -1, Infinity, Number.NaN, 2_147_483_648]) {
            await expect(deadlines.withOperationDeadline(operation, { budgetMs })).rejects.toBeInstanceOf(RangeError);
        }
        expect(operation).not.toHaveBeenCalled();
    });

    test('remaining budget uses elapsed monotonic time and ignores wall clock changes', async () => {
        try {
            await deadlines.withOperationDeadline(async ({ remainingBudgetMs }) => {
                const before = remainingBudgetMs();
                testClock.advance(1_000_000);
                await safeDelay(10);
                const after = remainingBudgetMs();
                expect(after).toBeLessThan(before);
                expect(after).toBeGreaterThan(500);
            }, { budgetMs: 1000 });
        } finally {
            testClock.useRealTime();
        }
    });

    test('sync throws and promise rejections remove deadline resources', async () => {
        for (const synchronous of [true, false]) {
            const parent = new AbortController();
            const reason = new Error('synthetic operation failure');
            const schedule = spyOn(globalThis, 'setTimeout');
            const clear = spyOn(globalThis, 'clearTimeout');
            try {
                await expect(deadlines.withOperationDeadline(() => {
                    if (synchronous) throw reason;
                    return Promise.reject(reason);
                }, { budgetMs: 1000, parentAbortSignal: parent.signal })).rejects.toBe(reason);
                const handle = schedule.mock.results.at(-1)?.value;
                expect(clear.mock.calls.some(([timer]) => timer === handle)).toBe(true);
                expect(getEventListeners(parent.signal, 'abort')).toHaveLength(0);
            } finally {
                schedule.mockRestore();
                clear.mockRestore();
            }
        }
    });

    test('parent cancellation wins when the operation aborts then resolves immediately', async () => {
        const parent = new AbortController();
        const reason = new Error('synthetic synchronous retirement');
        await expect(deadlines.withOperationDeadline(() => {
            parent.abort(reason);
            return Promise.resolve('late success');
        }, { parentAbortSignal: parent.signal })).rejects.toBe(reason);
    });

    test('parent abort rejects ignoring work and removes listeners', async () => {
        const parent = new AbortController();
        const reason = new Error('synthetic stop');
        let started!: () => void;
        const began = new Promise<void>((resolve) => { started = resolve; });
        const pending = deadlines.withOperationDeadline(() => {
            started();
            return new Promise<never>(() => {});
        }, { budgetMs: 1000, parentAbortSignal: parent.signal });
        await began;
        parent.abort(reason);
        await expect(pending).rejects.toBe(reason);
        expect(getEventListeners(parent.signal, 'abort')).toHaveLength(0);
    });

    test('settlement removes the owned timer and parent listener independently', async () => {
        const parent = new AbortController();
        const schedule = spyOn(globalThis, 'setTimeout');
        const clear = spyOn(globalThis, 'clearTimeout');
        try {
            await expect(deadlines.withOperationDeadline(async () => 'ok', { budgetMs: 1000, parentAbortSignal: parent.signal })).resolves.toBe('ok');
            const handle = schedule.mock.results.at(-1)?.value;
            expect(handle).toBeDefined();
            expect(clear.mock.calls.some(([timer]) => timer === handle)).toBe(true);
            expect(getEventListeners(parent.signal, 'abort')).toHaveLength(0);
        } finally {
            schedule.mockRestore();
            clear.mockRestore();
        }
    });
});

describe('retry lifetime policy', () => {
    test('server minimum is 120 seconds and a short budget fails with the original error', async () => {
        const sleep = vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined);
        const retry = new HttpRetryExecutor({ logger: noOpLogger, safeDelay: sleep });
        const error = retryError();
        const call = vi.fn<(...args: []) => Promise<string>>().mockRejectedValueOnce(error).mockResolvedValue('ok');
        await expect(retry.executeWithRetry('synthetic', call, 2)).resolves.toBe('ok');
        expect(sleep.mock.calls[0]?.[0]).toBe(120000);
        call.mockReset();
        call.mockRejectedValue(error);
        sleep.mockClear();
        await expect(retry.executeWithRetry('synthetic', call, 2, { remainingBudgetMs: () => 500 })).rejects.toBe(error);
        expect(call).toHaveBeenCalledTimes(1);
        expect(sleep).not.toHaveBeenCalled();
    });

    test('cancellation takes precedence over retryable status', async () => {
        const sleep = vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined);
        const retry = new HttpRetryExecutor({ logger: noOpLogger, safeDelay: sleep });
        const error = Object.assign(new Error('synthetic cancelled'), { code: 'ERR_CANCELED', response: { status: 503 } });
        const call = vi.fn<(...args: []) => Promise<never>>().mockRejectedValue(error);
        await expect(retry.executeWithRetry('synthetic', call, 2)).rejects.toBe(error);
        expect(call).toHaveBeenCalledTimes(1);
    });

    test('parent abort during real backoff removes timer and prevents retry', async () => {
        const parent = new AbortController();
        const reason = new Error('synthetic backoff stopped');
        const call = vi.fn<(...args: []) => Promise<never>>().mockRejectedValue(retryError({ 'retry-after': '0.02' }));
        const schedule = spyOn(globalThis, 'setTimeout');
        const clear = spyOn(globalThis, 'clearTimeout');
        try {
            const retry = new HttpRetryExecutor({ logger: noOpLogger });
            const pending = retry.executeWithRetry('synthetic', call, 2, { signal: parent.signal });
            await Promise.resolve();
            const handle = schedule.mock.results.at(-1)?.value;
            parent.abort(reason);
            await expect(pending).rejects.toBe(reason);
            expect(call).toHaveBeenCalledTimes(1);
            expect(handle).toBeDefined();
            expect(clear.mock.calls.some(([timer]) => timer === handle)).toBe(true);
            expect(getEventListeners(parent.signal, 'abort')).toHaveLength(0);
        } finally {
            schedule.mockRestore();
            clear.mockRestore();
        }
    });

    test('pre-abort and exhausted budgets never attempt work', async () => {
        const parent = new AbortController();
        parent.abort(new Error('synthetic retired'));
        const call = vi.fn(async () => 'late');
        const retry = new HttpRetryExecutor({ logger: noOpLogger });
        await expect(retry.executeWithRetry('synthetic', call, 2, { signal: parent.signal })).rejects.toBe(parent.signal.reason);
        await expect(retry.executeWithRetry('synthetic', call, 2, { remainingBudgetMs: () => 0 })).rejects.toThrow('budget exhausted');
        expect(call).not.toHaveBeenCalled();
    });

    test('cancellation and budget exhaustion after awaits cannot start another attempt', async () => {
        const parent = new AbortController();
        const reason = new Error('synthetic cancelled during request');
        const retry = new HttpRetryExecutor({ logger: noOpLogger });
        await expect(retry.executeWithRetry('synthetic', async () => {
            parent.abort(reason);
            return 'late';
        }, 2, { signal: parent.signal })).rejects.toBe(reason);
        let budget = 10000;
        const call = vi.fn<(...args: []) => Promise<never>>().mockRejectedValue(retryError({ 'retry-after': '1' }));
        const sleep = vi.fn(async () => { budget = 0; });
        const budgetRetry = new HttpRetryExecutor({ logger: noOpLogger, safeDelay: sleep });
        await expect(budgetRetry.executeWithRetry('synthetic', call, 2, { remainingBudgetMs: () => budget })).rejects.toThrow('budget exhausted');
        expect(call).toHaveBeenCalledTimes(1);
    });

    test('Retry-After on 503, dates and reset epochs retain server minima beyond the backoff cap', async () => {
        const sleep = vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined);
        const retry = new HttpRetryExecutor({ logger: noOpLogger, safeDelay: sleep });
        const now = testClock.now();
        testClock.set(now);
        try {
            for (const headers of [
                { 'retry-after': '120' },
                { 'retry-after': new Date(now + 120000).toUTCString() },
                { 'ratelimit-reset': String((now + 120000) / 1000) }
            ]) {
                sleep.mockClear();
                const call = vi.fn<(...args: []) => Promise<string>>()
                    .mockRejectedValueOnce({ response: { status: 503, headers } }).mockResolvedValue('ok');
                await expect(retry.executeWithRetry('synthetic', call, 2)).resolves.toBe('ok');
                expect(sleep.mock.calls[0]?.[0]).toBe(120000);
            }
        } finally {
            testClock.useRealTime();
        }
    });

    test('unsupported server timer delays are rejected before sleeping or retrying', async () => {
        const sleep = vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined);
        const retry = new HttpRetryExecutor({ logger: noOpLogger, safeDelay: sleep });
        for (const value of ['3000000', '9'.repeat(400)]) {
            const call = vi.fn<(...args: []) => Promise<never>>().mockRejectedValue(retryError({ 'retry-after': value }));
            await expect(retry.executeWithRetry('synthetic', call, 2)).rejects.toThrow('supported timer range');
            expect(call).toHaveBeenCalledTimes(1);
            expect(sleep).not.toHaveBeenCalled();
        }
    });
});

describe('HTTP operation budgets', () => {
    test('normalized timeout and owner options do not leak to Axios', () => {
        const client = new EnhancedHttpClient({ logger: noOpLogger, timeout: 3000 });
        const config = client.buildRequestConfig({ timeout: '15', overallBudgetMs: 100, parentAbortSignal: new AbortController().signal });
        expect(config.timeout).toBe(15);
        for (const timeout of [undefined, Number.NaN, 0, 'invalid']) {
            expect(client.buildRequestConfig({ timeout }).timeout).toBe(3000);
        }
        expect(config).not.toHaveProperty('overallBudgetMs');
        expect(config).not.toHaveProperty('parentAbortSignal');
    });

    test('streaming responses are rejected before any transport or deadline resources start', async () => {
        const parent = new AbortController();
        const request = new AbortController();
        const adapter = {
            get: vi.fn<(...args: unknown[]) => Promise<{ status: number; }>>().mockResolvedValue({ status: 200 }),
            post: vi.fn<(...args: unknown[]) => Promise<{ status: number; }>>().mockResolvedValue({ status: 200 }),
            put: vi.fn<(...args: unknown[]) => Promise<{ status: number; }>>().mockResolvedValue({ status: 200 }),
            delete: vi.fn<(...args: unknown[]) => Promise<{ status: number; }>>().mockResolvedValue({ status: 200 })
        };
        const client = new EnhancedHttpClient({ logger: noOpLogger, axios: adapter });
        const schedule = spyOn(globalThis, 'setTimeout');
        try {
            for (const method of ['GET', 'POST', 'PUT', 'DELETE'] as const) {
                await expect(client.executeRequest(method, 'http://synthetic.invalid', null, {
                    responseType: 'stream', overallBudgetMs: 1000,
                    parentAbortSignal: parent.signal, signal: request.signal, retryScope: 'synthetic'
                })).rejects.toThrow("EnhancedHttpClient does not support responseType 'stream': its operation lifetime must include response body consumption");
            }
            for (const call of Object.values(adapter)) expect(call).not.toHaveBeenCalled();
            expect(schedule).not.toHaveBeenCalled();
            expect(parent.signal.aborted).toBe(false);
            expect(request.signal.aborted).toBe(false);
            expect(getEventListeners(parent.signal, 'abort')).toHaveLength(0);
            expect(getEventListeners(request.signal, 'abort')).toHaveLength(0);
        } finally {
            schedule.mockRestore();
        }
    });

    test('pre-aborted caller signals retain cancellation precedence over unsupported response mode', async () => {
        for (const source of ['parent', 'request'] as const) {
            const parent = new AbortController();
            const request = new AbortController();
            const reason = new Error(`synthetic ${source} cancellation`);
            (source === 'parent' ? parent : request).abort(reason);
            const get = vi.fn<(...args: unknown[]) => Promise<{ status: number; }>>().mockResolvedValue({ status: 200 });
            const client = new EnhancedHttpClient({ logger: noOpLogger, axios: { ...realAxios, get } });
            await expect(client.get('http://synthetic.invalid', {
                responseType: 'stream', parentAbortSignal: parent.signal, signal: request.signal
            })).rejects.toBe(reason);
            expect(get).not.toHaveBeenCalled();
            expect(getEventListeners(parent.signal, 'abort')).toHaveLength(0);
            expect(getEventListeners(request.signal, 'abort')).toHaveLength(0);
        }
    });

    test('pre-abort never calls the HTTP transport', async () => {
        const parent = new AbortController();
        const reason = new Error('synthetic HTTP stopped');
        parent.abort(reason);
        const get = vi.fn<(...args: unknown[]) => Promise<{ status: number; }>>().mockResolvedValue({ status: 200 });
        const client = new EnhancedHttpClient({ logger: noOpLogger, axios: { ...realAxios, get } });
        await expect(client.get('http://synthetic.invalid', { parentAbortSignal: parent.signal })).rejects.toBe(reason);
        expect(get).not.toHaveBeenCalled();
    });

    for (const transport of ['fetch', 'axios'] as const) {
        for (const phase of ['headers', 'body'] as const) {
            for (const cancellation of ['parent', 'deadline'] as const) {
                test(`${transport} ${cancellation} cancellation closes stalled ${phase} on synthetic loopback`, async () => {
                    let started!: () => void;
                    const accepted = new Promise<void>((resolve) => { started = resolve; });
                    let closed!: () => void;
                    const disconnected = new Promise<void>((resolve) => { closed = resolve; });
                    const sockets = new Set<Socket>();
                    const server = createServer((socket) => {
                        sockets.add(socket);
                        socket.on('close', () => {
                            sockets.delete(socket);
                            closed();
                        });
                        socket.once('data', () => {
                            if (phase === 'body') {
                                socket.write('HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 100000\r\n\r\nsynthetic incomplete body');
                            }
                            started();
                        });
                    });
                    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
                    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/synthetic-stall`;
                    const parent = new AbortController();
                    const reason = new Error('synthetic loopback stopped');
                    try {
                        const pending = transport === 'fetch'
                            ? deadlines.withOperationDeadline(async ({ signal }) => (await fetch(url, { signal })).text(), { budgetMs: cancellation === 'deadline' ? 50 : 1000, parentAbortSignal: parent.signal })
                            : new EnhancedHttpClient({ logger: noOpLogger, axios: realAxios, timeout: 5000 }).get(url, { overallBudgetMs: cancellation === 'deadline' ? 50 : 1000, parentAbortSignal: parent.signal, proxy: false });
                        const outcome = pending.catch((error: unknown) => error);
                        await accepted;
                        if (cancellation === 'parent') {
                            parent.abort(reason);
                            expect(await outcome).toBe(reason);
                        } else {
                            expect(await outcome).toBeInstanceOf(Error);
                            expect((await outcome as Error).message).toContain('deadline exceeded after 50ms');
                        }
                        await deadlines.withOperationDeadline(() => disconnected, { budgetMs: 1000 });
                    } finally {
                        parent.abort();
                        for (const socket of sockets) socket.destroy();
                        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
                    }
                });
            }
        }
    }

    test('overall budget covers retry sleep and the next attempt, with an owned Axios signal', async () => {
        const parent = new AbortController();
        let signal: AbortSignal | undefined;
        let attempts = 0;
        const get = vi.fn(async (_url: string, config: Record<string, unknown>) => {
            signal = config.signal as AbortSignal;
            expect(config).not.toHaveProperty('overallBudgetMs');
            expect(config).not.toHaveProperty('parentAbortSignal');
            attempts += 1;
            if (attempts === 1) throw retryError({ 'retry-after': '0.005' });
            return new Promise<Record<string, unknown>>(() => {});
        });
        const client = new EnhancedHttpClient({ logger: noOpLogger, axios: { ...realAxios, get } });
        await expect(client.get('http://synthetic.invalid', { retryScope: 'synthetic', overallBudgetMs: 50, parentAbortSignal: parent.signal })).rejects.toThrow('HTTP GET deadline exceeded after 50ms');
        expect(get).toHaveBeenCalledTimes(2);
        expect(signal?.aborted).toBe(true);
        expect(getEventListeners(parent.signal, 'abort')).toHaveLength(0);
    });

    test('safeDelay success removes the abort listener', async () => {
        const parent = new AbortController();
        await safeDelay(1, 1, 'synthetic delay', parent.signal);
        expect(getEventListeners(parent.signal, 'abort')).toHaveLength(0);
    });

    test('safeDelay pre-abort never schedules a timer', async () => {
        const parent = new AbortController();
        parent.abort(new Error('synthetic delay stopped'));
        const schedule = spyOn(globalThis, 'setTimeout');
        try {
            await expect(safeDelay(100, 100, 'synthetic', parent.signal)).rejects.toBe(parent.signal.reason);
            expect(schedule).not.toHaveBeenCalled();
        } finally {
            schedule.mockRestore();
        }
    });
});
