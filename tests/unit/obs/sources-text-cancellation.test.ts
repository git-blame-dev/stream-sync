import { describe, expect, it } from 'bun:test';
import { createOBSSourcesManager } from '../../../src/obs/sources';
import { noOpLogger } from '../../helpers/mock-factories';

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => { resolve = done; });
    return { promise, resolve };
}

type Method = 'update' | 'clear';
type Boundary = 'ready' | 'ensure' | 'get' | 'set';

function harness(boundary?: Boundary) {
    const entered = deferred();
    const release = deferred();
    const requests: Array<{ request: string; payload: Record<string, unknown> }> = [];
    const pause = async (stage: Boundary) => {
        if (stage === boundary) { entered.resolve(); await release.promise; }
    };
    const manager = createOBSSourcesManager({
        ensureConnected: () => pause('ensure'),
        isConnected: () => true,
        isReady: async () => { await pause('ready'); return true; },
        call: async (request, payload = {}) => {
            requests.push({ request, payload });
            await pause(request === 'GetInputSettings' ? 'get' : 'set');
            return { inputSettings: { text: 'synthetic-old', font: { face: 'synthetic-font' }, color: 123 } };
        }
    }, { logger: noOpLogger });
    const invoke = (method: Method, signal?: AbortSignal) => method === 'update'
        ? manager.updateTextSource('synthetic-source', 'synthetic-new', signal)
        : manager.clearTextSource('synthetic-source', signal);
    return { entered, release, requests, invoke };
}

describe('OBS source text operation cancellation', () => {
    for (const method of ['update', 'clear'] as const) {
        for (const boundary of ['ready', 'ensure', 'get'] as const) {
            it(`${method} fences later requests after cancellation during ${boundary}`, async () => {
                const { entered, release, requests, invoke } = harness(boundary);
                const controller = new AbortController();
                const running = invoke(method, controller.signal);
                await entered.promise;
                controller.abort();
                release.resolve();
                await expect(running).rejects.toBe(controller.signal.reason);
                expect(requests.map(({ request }) => request)).toEqual(boundary === 'get' ? ['GetInputSettings'] : []);
            });
        }

        for (const withSignal of [false, true]) {
            it(`${method} preserves source names and merged settings with a ${withSignal ? 'live' : 'missing'} signal`, async () => {
                const { requests, invoke } = harness();
                await invoke(method, withSignal ? new AbortController().signal : undefined);
                expect(requests).toEqual([
                    { request: 'GetInputSettings', payload: { inputName: 'synthetic-source' } },
                    { request: 'SetInputSettings', payload: {
                        inputName: 'synthetic-source', overlay: false,
                        inputSettings: { text: method === 'update' ? 'synthetic-new' : '', font: { face: 'synthetic-font' }, color: 123 }
                    } }
                ]);
            });
        }

        it(`${method} joins an already-issued Set without claiming to retract it`, async () => {
            const { entered, release, requests, invoke } = harness('set');
            const controller = new AbortController();
            let retired = false;
            const running = invoke(method, controller.signal);
            void running.then(() => { retired = true; }, () => { retired = true; });
            await entered.promise;
            controller.abort();
            expect(retired).toBe(false);
            expect(requests.map(({ request }) => request)).toEqual(['GetInputSettings', 'SetInputSettings']);
            release.resolve();
            await expect(running).rejects.toBe(controller.signal.reason);
            expect(retired).toBe(true);
        });

        it(`${method} rejects a pre-aborted signal without dispatching OBS requests`, async () => {
            const { requests, invoke } = harness();
            const controller = new AbortController();
            controller.abort();
            await expect(invoke(method, controller.signal)).rejects.toBe(controller.signal.reason);
            expect(requests).toEqual([]);
        });

        it(`${method} preserves a real OBS failure even if cancellation also occurs`, async () => {
            const entered = deferred();
            const release = deferred();
            const failure = new Error('synthetic OBS read failure');
            const manager = createOBSSourcesManager({
                ensureConnected: async () => {}, isConnected: () => true, isReady: async () => true,
                call: async () => { entered.resolve(); await release.promise; throw failure; }
            }, { logger: noOpLogger });
            const controller = new AbortController();
            const running = method === 'update'
                ? manager.updateTextSource('synthetic-source', 'synthetic-new', controller.signal)
                : manager.clearTextSource('synthetic-source', controller.signal);
            const outcome = running.then(() => null, (error: unknown) => error);
            await entered.promise;
            controller.abort();
            release.resolve();
            expect(await outcome).toBe(failure);
        });

    }
});
