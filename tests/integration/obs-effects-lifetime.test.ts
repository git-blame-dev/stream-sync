import { afterEach, beforeEach, expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { OBSEffectsManager } from '../../src/obs/effects';
import { noOpLogger } from '../helpers/mock-factories';
import { advanceTimersByTime, getTimerCount, useFakeTimers, useRealTimers } from '../helpers/bun-timers';

const endEvent = 'MediaInputPlaybackEnded';
const config = (mediaSource = 'test-vfx') => ({ mediaSource, filename: 'test-clip', vfxFilePath: '/test/media' });
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
function deferred() {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
class TestOBS extends EventEmitter {
    calls: { type: string; source: unknown }[] = [];
    connect: () => Promise<void> = async () => {};
    dispatch: (type: string, source: unknown) => Promise<unknown> = async () => ({});
    ensureConnected() { return this.connect(); }
    call(type: string, payload?: Record<string, unknown>) {
        this.calls.push({ type, source: payload?.inputName });
        return this.dispatch(type, payload?.inputName);
    }
    addEventListener(event: string, handler: (data?: Record<string, unknown>) => void) { this.on(event, handler); }
    removeEventListener(event: string, handler: (data?: Record<string, unknown>) => void) { this.off(event, handler); }
    end(source = 'test-vfx') { this.emit(endEvent, { inputName: source }); }
}
let obs: TestOBS;
let manager: OBSEffectsManager;
beforeEach(() => { useFakeTimers(); obs = new TestOBS(); manager = new OBSEffectsManager(obs, { logger: noOpLogger }); });
afterEach(() => { manager.dispose(); useRealTimers(); });
function clean() { expect(obs.listenerCount(endEvent)).toBe(0); expect(getTimerCount()).toBe(0); }
function observe(promise: Promise<unknown>) { return promise.then(() => 'completed', error => error as Error); }

test('captures an end delivered during restart acknowledgement and clears its timer', async () => {
    const ack = deferred();
    obs.dispatch = async type => { if (type === 'TriggerMediaInputAction') { obs.end(); await ack.promise; } };
    const pending = observe(manager.playMediaInOBS(config()));
    await flush();
    clean();
    ack.resolve();
    expect(await pending).toBe('completed');
    clean();
});

test('ordinary completion ignores unrelated source events and direct waits remain compatible', async () => {
    let finished = false;
    const pending = manager.playMediaInOBS(config()).then(() => { finished = true; });
    await flush();
    obs.end('test-unrelated'); await flush();
    expect(finished).toBe(false);
    expect(obs.listenerCount(endEvent)).toBe(1);
    obs.end(); await pending; clean();
    const direct = manager.waitForMediaCompletion('test-direct');
    obs.end('test-direct'); await direct; clean();
});

for (const boundary of ['SetInputSettings', 'TriggerMediaInputAction']) test(`${boundary} failure releases listeners and timer`, async () => {
    obs.dispatch = async type => { if (type === boundary) throw new Error('test dispatch failure'); };
    await expect(manager.playMediaInOBS(config())).rejects.toThrow('test dispatch failure');
    clean();
});

test('completion timeout counts from dispatch while restart acknowledgement is held', async () => {
    const ack = deferred();
    obs.dispatch = async type => { if (type === 'TriggerMediaInputAction') await ack.promise; };
    const pending = observe(manager.playMediaInOBS(config()));
    await flush();
    expect(getTimerCount()).toBe(1);
    await advanceTimersByTime(10000); await flush();
    clean();
    ack.resolve();
    expect(await pending).toBe('completed'); clean();
});

for (const boundary of ['connect', 'SetInputSettings', 'TriggerMediaInputAction']) {
    for (const rejectLate of [false, true]) test(`dispose fences held ${boundary} with late ${rejectLate ? 'failure' : 'success'}`, async () => {
        const held = deferred();
        if (boundary === 'connect') obs.connect = () => held.promise;
        else obs.dispatch = async type => { if (type === boundary) await held.promise; };
        const pending = observe(manager.playMediaInOBS(config()));
        await flush();
        const calls = obs.calls.length;
        manager.dispose(); manager.dispose();
        expect(await pending).toMatchObject({ name: 'AbortError' }); clean();
        if (rejectLate) held.reject(new Error('test late failure')); else held.resolve();
        await flush();
        expect(obs.calls).toHaveLength(calls); clean();
        await expect(manager.playMediaInOBS(config())).rejects.toThrow('disposed');
        await expect(manager.waitForMediaCompletion('test-direct')).rejects.toThrow('disposed');
        await expect(manager.triggerMediaAction('test-vfx', 'test-action')).rejects.toThrow('disposed');
    });
}

test('retirement settles direct and active playback waits without unhandled cancellation', async () => {
    const direct = observe(manager.waitForMediaCompletion('test-direct'));
    const playback = observe(manager.playMediaInOBS(config()));
    await flush(); manager.dispose();
    expect(await direct).toMatchObject({ name: 'AbortError' });
    expect(await playback).toMatchObject({ name: 'AbortError' }); clean();
});

test('latest same-source request cancels the old waiter while unrelated sources proceed', async () => {
    const firstAck = deferred();
    let triggers = 0;
    obs.dispatch = async type => { if (type === 'TriggerMediaInputAction' && ++triggers === 1) await firstAck.promise; };
    const first = observe(manager.playMediaInOBS(config())); await flush();
    const other = observe(manager.playMediaInOBS(config('test-other'))); await flush();
    const latest = observe(manager.playMediaInOBS(config())); await flush();
    expect(await first).toMatchObject({ name: 'AbortError' });
    expect(obs.listenerCount(endEvent)).toBe(2);
    obs.end(); expect(await latest).toBe('completed');
    expect(obs.listenerCount(endEvent)).toBe(1);
    obs.end('test-other'); expect(await other).toBe('completed');
    firstAck.reject(new Error('test obsolete ack')); await flush(); clean();
});

test('supersession during settings prevents stale restart dispatch, including fire-and-forget', async () => {
    const settings = deferred(); let first = true;
    obs.dispatch = async type => { if (type === 'SetInputSettings' && first) { first = false; await settings.promise; } };
    const old = observe(manager.playMediaInOBS(config())); await flush();
    await manager.playMediaInOBS(config(), false);
    expect(await old).toMatchObject({ name: 'AbortError' });
    settings.resolve(); await flush();
    expect(obs.calls.filter(call => call.type === 'TriggerMediaInputAction')).toHaveLength(1); clean();
});

test('direct wait timeout cleans up and media actions fence retirement', async () => {
    const direct = manager.waitForMediaCompletion('test-direct', 20);
    await advanceTimersByTime(20); await direct; clean();
    const connect = deferred(); obs.connect = () => connect.promise;
    const action = observe(manager.triggerMediaAction('test-vfx', 'test-action')); await flush();
    manager.dispose(); expect(await action).toMatchObject({ name: 'AbortError' });
    connect.resolve(); await flush(); expect(obs.calls).toHaveLength(0); clean();
});

test('ends during settings are not captured; delayed old ends after dispatch remain indistinguishable', async () => {
    const settings = deferred();
    obs.dispatch = async type => { if (type === 'SetInputSettings') await settings.promise; };
    let finished = false;
    const pending = manager.playMediaInOBS(config()).then(() => { finished = true; });
    await flush();
    obs.end(); // Previous playback ending before restart dispatch has no waiter.
    expect(obs.listenerCount(endEvent)).toBe(0);
    settings.resolve(); await flush();
    expect(finished).toBe(false);
    expect(obs.listenerCount(endEvent)).toBe(1);
    // OBS provides no playback ID: this could be either a delayed old or current end.
    obs.end(); await pending; clean();
});

test('same-source supersession during connect prevents stale settings dispatch', async () => {
    const connect = deferred(); let first = true;
    obs.connect = () => { if (first) { first = false; return connect.promise; } return Promise.resolve(); };
    const old = observe(manager.playMediaInOBS(config())); await flush();
    await manager.playMediaInOBS(config(), false);
    expect(await old).toMatchObject({ name: 'AbortError' });
    connect.resolve(); await flush();
    expect(obs.calls.map(call => call.type)).toEqual(['SetInputSettings', 'TriggerMediaInputAction']); clean();
});

test('retirement between a resolved RPC and its continuation fences the next dispatch', async () => {
    const connect = deferred(); obs.connect = () => connect.promise;
    const pending = observe(manager.playMediaInOBS(config()));
    connect.resolve();
    queueMicrotask(() => manager.dispose());
    expect(await pending).toMatchObject({ name: 'AbortError' });
    expect(obs.calls).toHaveLength(0); clean();
});
