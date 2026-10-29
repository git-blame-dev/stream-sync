import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { OBSConnectionManager } from '../../../src/obs/connection';
import { advanceTimersByTime, getTimerCount, useFakeTimers, useRealTimers } from '../../helpers/bun-timers';

const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
};
const drain = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
class Transport extends EventEmitter {
    attempts: ReturnType<typeof deferred<Record<string, unknown>>>[] = [];
    closes = 0;
    closing = Promise.resolve();
    connect() { const attempt = deferred<Record<string, unknown>>(); this.attempts.push(attempt); return attempt.promise; }
    disconnect() { this.closes++; return this.closing; }
    async call() { return {}; }
}
let managers: OBSConnectionManager[] = [];
beforeEach(() => { useFakeTimers(); });
afterEach(() => { for (const manager of managers) manager.dispose(); managers = []; useRealTimers(); });
function setup() {
    const obs = new Transport();
    const manager = new OBSConnectionManager({ obs, config: { enabled: true, password: 'synthetic', address: 'ws://synthetic.invalid', connectionTimeoutMs: 5000 } });
    managers.push(manager);
    return { obs, manager };
}
describe('OBS attempt retirement', () => {
    for (const stop of ['disconnect', 'dispose'] as const) {
        for (const late of ['resolve', 'reject'] as const) {
            it(`${stop} settles once and closes before identification with late ${late}`, async () => {
                const { obs, manager } = setup();
                const outcomes: string[] = [];
                const pending = manager.connect().then(() => outcomes.push('ready'), error => outcomes.push(error.message));
                await drain();
                await manager[stop]();
                await drain();
                expect(obs.closes).toBe(1);
                expect(outcomes).toEqual(['OBS connection cancelled']);
                expect(getTimerCount()).toBe(0);
                obs.emit('Identified');
                if (late === 'resolve') obs.attempts[0]!.resolve({});
                else obs.attempts[0]!.reject(new Error('synthetic late error'));
                obs.emit('ConnectionClosed');
                advanceTimersByTime(6000);
                await pending;
                await manager[stop]();
                expect(outcomes).toEqual(['OBS connection cancelled']);
                expect(manager.isConnected()).toBe(false);
                expect(obs.closes).toBe(1);
                expect(getTimerCount()).toBe(0);
            });
        }
    }
    it('serializes new transport admission after stop and ignores old identification/completion', async () => {
        const { obs, manager } = setup();
        const close = deferred<void>();
        obs.closing = close.promise;
        const old = manager.connect().catch(error => error.message);
        await drain();
        const stopping = manager.disconnect();
        const next = manager.connect();
        await drain();
        obs.emit('Identified');
        obs.attempts[0]!.resolve({});
        await drain();
        expect(obs.attempts).toHaveLength(1);
        expect(manager.isConnected()).toBe(false);
        close.resolve();
        await stopping;
        await drain();
        expect(obs.attempts).toHaveLength(2);
        obs.emit('Identified');
        obs.emit('ConnectionClosed');
        await drain();
        expect(manager.isConnected()).toBe(false);
        obs.attempts[1]!.resolve({});
        expect(await next).toBe(true);
        expect(await old).toBe('OBS connection cancelled');
        expect(manager.isConnected()).toBe(true);
        expect(getTimerCount()).toBe(0);
    });
    it('consumes cancellation in the scheduled reconnect owner', async () => {
        const { obs, manager } = setup();
        manager.reconnectIntervalMs = 10;
        manager.scheduleReconnect('synthetic');
        advanceTimersByTime(10);
        await drain();
        expect(obs.attempts).toHaveLength(1);
        await manager.disconnect();
        await drain();
        advanceTimersByTime(60000);
        await drain();
        expect(obs.attempts).toHaveLength(1);
        expect(getTimerCount()).toBe(0);
    });

    it('cancels a queued connect without admitting it after the old close', async () => {
        const { obs, manager } = setup();
        const close = deferred<void>();
        obs.closing = close.promise;
        const first = manager.connect().catch(error => error.message);
        await drain();
        const stopping = manager.disconnect();
        const queued = manager.connect().catch(error => error.message);
        manager.dispose();
        expect(manager.lifecycleState).toBe('disposed');
        expect(obs.listenerCount('Identified')).toBe(0);
        close.resolve();
        await stopping;
        await drain();
        expect(await first).toBe('OBS connection cancelled');
        expect(await queued).toBe('OBS connection cancelled');
        expect(obs.attempts).toHaveLength(1);
        expect(obs.closes).toBe(1);
        expect(getTimerCount()).toBe(0);
    });

    it('reports failed close and blocks reuse of an unretired transport', async () => {
        const { obs, manager } = setup();
        const pending = manager.connect().catch(error => error.message);
        await drain();
        obs.closing = Promise.reject(new Error('synthetic close failure'));
        await expect(manager.disconnect()).rejects.toThrow('synthetic close failure');
        expect(await pending).toBe('OBS connection cancelled');
        await expect(manager.connect()).rejects.toThrow('synthetic close failure');
        expect(obs.attempts).toHaveLength(1);
        manager.dispose();
        await drain();
        expect(getTimerCount()).toBe(0);
    });

});
