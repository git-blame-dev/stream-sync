import { EventEmitter } from 'node:events';
import { describe, test, beforeEach, afterEach, expect } from 'bun:test';
import { noOpLogger } from '../helpers/mock-factories';
import { getTimerCount, useFakeTimers, useRealTimers } from '../helpers/bun-timers';
import { createEventBus } from '../../src/core/EventBus';
import { createOBSEventService } from '../../src/obs/obs-event-service';
import { OBSConnectionManager } from '../../src/obs/connection';
import { createOBSSourcesManager } from '../../src/obs/sources';

const settings = { text: 'synthetic-old', font: { face: 'synthetic-font', size: 24 }, color: 123 };
type Request = { request: string; payload: Record<string, unknown> };

// The fixture's only deferred work is external RPC promises. Bound microtask
// turns so a dropped request/completion fails instead of hanging the suite.
async function until(observed: () => boolean) {
    for (let turn = 0; turn < 100; turn++) {
        if (observed()) return;
        await Promise.resolve();
    }
    throw new Error('Synthetic OBS pipeline did not reach its completion barrier');
}

class SyntheticSDK extends EventEmitter {
    requests: Request[] = [];
    completed: Request[] = [];
    failures = 0;
    pending = 0;
    held = new Map<string, ReturnType<typeof Promise.withResolvers<void>>>();

    async connect() {
        this.emit('Identified');
        return { obsWebSocketVersion: 'synthetic', negotiatedRpcVersion: 1 };
    }
    async disconnect() {}
    async call(request: string, payload: Record<string, unknown> = {}) {
        const entry = { request, payload };
        this.requests.push(entry);
        if (request === 'GetVersion') return { obsVersion: 'synthetic' };
        if (request === 'GetInputSettings') return { inputSettings: settings };
        if (request !== 'SetInputSettings') throw new Error(`Unexpected synthetic RPC: ${request}`);
        const text = (payload.inputSettings as { text: string }).text;
        this.pending++;
        try {
            await this.held.get(text)?.promise;
            this.completed.push(entry);
            return {};
        } catch (error) {
            this.failures++;
            throw error;
        } finally {
            this.pending--;
        }
    }
}

function setup() {
    const baseline = getTimerCount();
    const sdk = new SyntheticSDK();
    const connection = new OBSConnectionManager({
        obs: sdk,
        config: { enabled: true, address: 'ws://synthetic.invalid', password: 'synthetic', connectionTimeoutMs: 5000 },
    });
    const sources = createOBSSourcesManager(connection, { logger: noOpLogger });
    const bus = createEventBus();
    const service = createOBSEventService({
        eventBus: {
            subscribe: (event, handler) => bus.subscribe(event, payload => handler(payload as Record<string, unknown>)),
            emit: (event, payload) => { bus.emit(event, payload); },
        },
        obsConnection: {
            connect: async () => { await connection.connect(); },
            disconnect: () => connection.disconnect(),
            call: (request, payload) => connection.call(request, payload),
            isReady: () => connection.isReady(),
            isConnected: () => connection.isConnected(),
            addEventListener: (event, handler) => connection.addEventListener(event, handler),
            removeEventListener: (event, handler) => connection.removeEventListener(event, handler),
        },
        obsSources: sources,
        logger: noOpLogger,
    });
    const completions = () => bus.getEventStats()['obs:update-text']?.success ?? 0;
    let admitted = 0;
    const emitText = (text: string) => {
        const delivered = bus.emit('obs:update-text', { sourceName: 'synthetic-source', text });
        if (delivered) admitted++;
        return delivered;
    };
    const dispose = async () => {
        for (const hold of sdk.held.values()) hold.resolve();
        try {
            await until(() => completions() === admitted && sdk.pending === 0);
        } finally {
            service.destroy();
            await connection.disconnect();
            connection.dispose();
            expect(bus.getListenerSummary()).toEqual({});
            expect(sdk.eventNames()).toEqual([]);
            expect(sdk.pending).toBe(0);
            expect(getTimerCount()).toBe(baseline);
            bus.reset();
        }
    };
    return { sdk, connection, bus, service, emitText, completions, dispose, baseline };
}

function expectedSet(text: string): Request {
    return {
        request: 'SetInputSettings',
        payload: { inputName: 'synthetic-source', inputSettings: { ...settings, text }, overlay: false },
    };
}

describe('OBS Event Integration', () => {
    beforeEach(() => useFakeTimers());
    afterEach(() => useRealTimers());

    test('dispatch returns before held output completes and preserves exact source settings', async () => {
        const h = setup();
        const hold = Promise.withResolvers<void>();
        h.sdk.held.set('synthetic-held', hold);
        try {
            await h.service.connect();
            expect(h.service.getConnectionState()).toEqual({ connected: true, ready: true, lastError: null });
            expect(h.emitText('synthetic-held')).toBe(true);
            await until(() => h.sdk.pending === 1);
            expect(h.completions()).toBe(0);
            expect(h.sdk.completed).toEqual([]);
            expect(h.sdk.requests).toEqual([
                { request: 'GetVersion', payload: {} },
                { request: 'GetInputSettings', payload: { inputName: 'synthetic-source' } },
                expectedSet('synthetic-held'),
            ]);
            hold.resolve();
            await until(() => h.completions() === 1);
            expect(h.sdk.completed).toEqual([expectedSet('synthetic-held')]);
            expect(getTimerCount()).toBe(h.baseline);
        } finally {
            await h.dispose();
        }
    });

    test('handles a held RPC failure before later successful text and unrelated delivery', async () => {
        const h = setup();
        const hold = Promise.withResolvers<void>();
        h.sdk.held.set('synthetic-failure', hold);
        const unrelated: unknown[] = [];
        const off = h.bus.subscribe('synthetic:unrelated', payload => { unrelated.push(payload); });
        try {
            await h.service.connect();
            h.emitText('synthetic-failure');
            await until(() => h.sdk.pending === 1);
            expect(h.completions()).toBe(0);
            hold.reject(new Error('synthetic SetInputSettings failure'));
            await until(() => h.completions() === 1);
            expect(h.sdk.failures).toBe(1);
            expect(h.sdk.completed).toEqual([]);
            h.emitText('synthetic-recovered');
            expect(h.bus.emit('synthetic:unrelated', { id: 'synthetic-event' })).toBe(true);
            await until(() => h.completions() === 2);
            expect(h.sdk.completed).toEqual([expectedSet('synthetic-recovered')]);
            expect(h.sdk.requests.filter(entry => entry.request === 'SetInputSettings')).toEqual([
                expectedSet('synthetic-failure'), expectedSet('synthetic-recovered'),
            ]);
            expect(unrelated).toEqual([{ id: 'synthetic-event' }]);
            expect(h.sdk.pending).toBe(0);
        } finally {
            off();
            await h.dispose();
        }
    });

    test('completes every burst output and retires owned listeners and timers', async () => {
        const h = setup();
        try {
            await h.service.connect();
            expect(h.bus.getListenerSummary()).toEqual({
                'obs:update-text': 1, 'obs:clear-text': 1, 'obs:set-visibility': 1, 'obs:switch-scene': 1,
            });
            const listeners = h.sdk.listenerCount('ConnectionClosed');
            for (let index = 0; index < 200; index++) h.emitText(`synthetic-message-${index}`);
            await until(() => h.completions() === 200);
            expect(h.sdk.completed).toEqual(Array.from({ length: 200 }, (_, index) => expectedSet(`synthetic-message-${index}`)));
            expect(h.sdk.pending).toBe(0);
            expect(getTimerCount()).toBe(h.baseline);
            h.service.destroy();
            expect(h.bus.getListenerSummary()).toEqual({});
            expect(h.sdk.listenerCount('ConnectionClosed')).toBe(listeners - 1);
            expect(h.emitText('synthetic-after-destroy')).toBe(false);
            expect(h.sdk.completed).toHaveLength(200);
            const received: unknown[] = [];
            const off = h.bus.subscribe('synthetic:after-destroy', value => { received.push(value); });
            h.bus.emit('synthetic:after-destroy', 'synthetic-delivered');
            expect(received).toEqual(['synthetic-delivered']);
            off();
        } finally {
            await h.dispose();
        }
    });
});
