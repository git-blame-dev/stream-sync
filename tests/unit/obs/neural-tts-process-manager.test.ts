import { describe, expect, it, spyOn } from 'bun:test';
import { NeuralTtsProcessManager } from '../../../src/obs/neural-tts-process-manager';
import { createMainPresentationFixture } from '../../helpers/main-presentation-fixture';
import { noOpLogger } from '../../helpers/mock-factories';

type RecordedRequest = {
    url: string;
    method: string;
    body?: unknown;
};

function createTestLogger() {
    const warnings: string[] = [];
    const infos: string[] = [];
    const errors: string[] = [];
    return {
        logger: {
            ...noOpLogger,
            info: (msg: unknown) => { infos.push(String(msg)); },
            warn: (msg: unknown) => { warnings.push(String(msg)); },
            error: (msg: unknown) => { errors.push(String(msg)); },
            debug: () => {}
        },
        warnings,
        infos,
        errors
    };
}

describe('NeuralTtsProcessManager', () => {
    it('spawns neuralTtsCommand when /health is unreachable, waits for 200 OK, acquires lease, and tears down on stop() when should_shutdown is true', async () => {
        const requests: RecordedRequest[] = [];
        const spawnedCommands: Array<{ command: string; options: unknown }> = [];
        const killedSignals: Array<NodeJS.Signals | number | undefined> = [];
        let healthCallCount = 0;

        const mockChild = {
            pid: 4242,
            kill: (signal?: NodeJS.Signals | number) => {
                killedSignals.push(signal);
                return true;
            }
        };

        const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const url = String(input);
            const method = init?.method || 'GET';
            const body = init?.body ? JSON.parse(String(init.body)) : undefined;
            requests.push({ url, method, ...(body !== undefined ? { body } : {}) });

            if (url.endsWith('/health')) {
                healthCallCount += 1;
                if (healthCallCount === 1) {
                    throw new Error('ECONNREFUSED');
                }
                if (healthCallCount === 2) {
                    return new Response(JSON.stringify({ ready: false }), { status: 503 });
                }
                return new Response(JSON.stringify({ ready: true }), { status: 200 });
            }

            if (url.endsWith('/v1/lease/acquire')) {
                return new Response(JSON.stringify({ active_clients: 1 }), { status: 200 });
            }

            if (url.endsWith('/v1/lease/release')) {
                return new Response(
                    JSON.stringify({
                        active_clients: 0,
                        active_jobs: 0,
                        should_shutdown: true
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } }
                );
            }

            if (url.endsWith('/v1/shutdown')) {
                return new Response(JSON.stringify({ status: 'shutting_down' }), { status: 200 });
            }

            return new Response(null, { status: 404 });
        };

        let currentTime = 0;
        const { logger } = createTestLogger();
        const manager = new NeuralTtsProcessManager({
            config: {
                obs: {
                    ttsMethod: 'neural-tts',
                    neuralTtsEndpoint: 'http://127.0.0.1:8765',
                    neuralTtsCommand: 'neural-tts serve --port 8765'
                }
            },
            logger,
            fetch,
            spawn: (command, options) => {
                spawnedCommands.push({ command, options });
                return mockChild;
            },
            delay: async (ms) => { currentTime += ms; },
            now: () => currentTime,
            clientId: 'synthetic-client-1',
            pollIntervalMs: 100,
            warmupTimeoutMs: 5_000
        });

        await manager.ensureStarted();

        expect(manager.spawnedByUs).toBe(true);
        expect(spawnedCommands).toEqual([
            {
                command: 'neural-tts serve --port 8765',
                options: { shell: true, stdio: 'ignore', detached: false }
            }
        ]);
        expect(requests.map((r) => [r.method, r.url])).toEqual([
            ['GET', 'http://127.0.0.1:8765/health'],
            ['GET', 'http://127.0.0.1:8765/health'],
            ['GET', 'http://127.0.0.1:8765/health'],
            ['POST', 'http://127.0.0.1:8765/v1/lease/acquire']
        ]);
        expect(requests[3]?.body).toEqual({ client_id: 'synthetic-client-1' });

        await manager.stop();

        expect(requests.slice(4).map((r) => [r.method, r.url])).toEqual([
            ['POST', 'http://127.0.0.1:8765/v1/lease/release'],
            ['POST', 'http://127.0.0.1:8765/v1/shutdown']
        ]);
        expect(requests[4]?.body).toEqual({ client_id: 'synthetic-client-1' });
        expect(killedSignals).toEqual(['SIGTERM']);
    });

    it('does NOT kill neural-tts on stop() when another app has an active client lease or active job', async () => {
        for (const releasePayload of [
            { active_clients: 1, active_jobs: 0, should_shutdown: false },
            { active_clients: 0, active_jobs: 1, should_shutdown: false },
            { active_clients: 2, active_jobs: 0, should_shutdown: true }
        ]) {
            const requests: RecordedRequest[] = [];
            const killedSignals: Array<NodeJS.Signals | number | undefined> = [];
            let healthCalls = 0;

            const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
                const url = String(input);
                const method = init?.method || 'GET';
                requests.push({ url, method });

                if (url.endsWith('/health')) {
                    healthCalls += 1;
                    if (healthCalls === 1) {
                        throw new Error('ECONNREFUSED');
                    }
                    return new Response(JSON.stringify({ ready: true }), { status: 200 });
                }
                if (url.endsWith('/v1/lease/acquire')) {
                    return new Response(JSON.stringify({ active_clients: 1 }), { status: 200 });
                }
                if (url.endsWith('/v1/lease/release')) {
                    return new Response(JSON.stringify(releasePayload), {
                        status: 200,
                        headers: { 'content-type': 'application/json' }
                    });
                }
                return new Response(null, { status: 200 });
            };

            const { logger, infos } = createTestLogger();
            const manager = new NeuralTtsProcessManager({
                config: {
                    obs: {
                        ttsMethod: 'neural-tts',
                        neuralTtsCommand: 'neural-tts serve'
                    }
                },
                logger,
                fetch,
                spawn: () => ({
                    pid: 5555,
                    kill: (signal) => {
                        killedSignals.push(signal);
                        return true;
                    }
                }),
                delay: async () => {},
                clientId: 'synthetic-client-shared'
            });

            await manager.ensureStarted();
            expect(manager.spawnedByUs).toBe(true);

            await manager.stop();

            expect(killedSignals).toEqual([]);
            expect(requests.some((r) => r.url.endsWith('/v1/shutdown'))).toBe(false);
            expect(infos.some((msg) => msg.includes('Keeping Neural TTS service alive'))).toBe(true);
        }
    });

    it('does NOT spawn or kill neural-tts when /health was already reachable before ensureStarted() (even if warming up with 503)', async () => {
        const requests: RecordedRequest[] = [];
        let spawnCalled = 0;
        let healthCalls = 0;

        const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
            const url = String(input);
            const method = init?.method || 'GET';
            const body = init?.body ? JSON.parse(String(init.body)) : undefined;
            requests.push({ url, method, ...(body !== undefined ? { body } : {}) });

            if (url.endsWith('/health')) {
                healthCalls += 1;
                if (healthCalls === 1) {
                    return new Response(JSON.stringify({ ready: false }), { status: 503 });
                }
                return new Response(JSON.stringify({ ready: true }), { status: 200 });
            }
            if (url.endsWith('/v1/lease/acquire')) {
                return new Response(null, { status: 404 }); // Also verifies 404 on older servers is ignored gracefully
            }
            if (url.endsWith('/v1/lease/release')) {
                return new Response(
                    JSON.stringify({ active_clients: 0, active_jobs: 0, should_shutdown: true }),
                    { status: 200 }
                );
            }
            return new Response(null, { status: 200 });
        };

        let currentTime = 0;
        const { logger } = createTestLogger();
        const manager = new NeuralTtsProcessManager({
            config: {
                obs: {
                    ttsMethod: 'neural-tts',
                    neuralTtsCommand: 'neural-tts serve'
                }
            },
            logger,
            fetch,
            spawn: () => {
                spawnCalled += 1;
                return { kill: () => true };
            },
            delay: async (ms) => { currentTime += ms; },
            now: () => currentTime,
            clientId: 'synthetic-external-client'
        });

        await manager.ensureStarted();

        expect(spawnCalled).toBe(0);
        expect(manager.spawnedByUs).toBe(false);
        expect(requests.map((r) => [r.method, r.url])).toEqual([
            ['GET', 'http://127.0.0.1:8765/health'],
            ['POST', 'http://127.0.0.1:8765/v1/lease/acquire'],
            ['GET', 'http://127.0.0.1:8765/health']
        ]);

        await manager.stop();

        expect(requests.slice(3).map((r) => [r.method, r.url])).toEqual([
            ['POST', 'http://127.0.0.1:8765/v1/lease/release']
        ]);
        expect(requests.some((r) => r.url.endsWith('/v1/shutdown'))).toBe(false);
    });

    it('rejects non-loopback endpoints during ensureStarted() and logs warning on warmup timeout without crashing', async () => {
        const { logger, warnings } = createTestLogger();
        const invalidManager = new NeuralTtsProcessManager({
            config: {
                obs: {
                    ttsMethod: 'neural-tts',
                    neuralTtsEndpoint: 'http://example.test:8765'
                }
            },
            logger
        });

        await expect(invalidManager.ensureStarted()).rejects.toThrow('must use HTTP on loopback');

        let currentTime = 0;
        const timeoutManager = new NeuralTtsProcessManager({
            config: {
                obs: {
                    ttsMethod: 'neural-tts',
                    neuralTtsEndpoint: 'http://127.0.0.1:8765',
                    neuralTtsCommand: 'neural-tts serve'
                }
            },
            logger,
            fetch: async () => {
                throw new Error('ECONNREFUSED');
            },
            spawn: () => ({ kill: () => true }),
            delay: async (ms) => { currentTime += ms; },
            now: () => currentTime,
            warmupTimeoutMs: 1_000,
            pollIntervalMs: 500
        });

        await timeoutManager.ensureStarted();
        expect(warnings.some((w) => w.includes('warmup timed out'))).toBe(true);
    });

    it('releases a real runtime neural lease on an early exit after startup', async () => {
        const h = await createMainPresentationFixture();
        h.config.logging.file.enabled = false;
        h.config.logging.chat.enabled = false;
        h.config.obs.ttsMethod = 'neural-tts';
        h.config.obs.neuralTtsEndpoint = 'http://127.0.0.1:8765';
        const requests: string[] = [];
        const leaseBodies: unknown[] = [];
        const lifecycle: string[] = [];
        let restoreObservers = () => {};
        const syntheticFetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
            const path = new URL(String(input)).pathname;
            requests.push(path);
            if (path.startsWith('/v1/lease/')) leaseBodies.push(JSON.parse(String(init?.body)));
            if (path === '/health') return new Response('{}', { status: 200 });
            if (path === '/v1/lease/acquire') return new Response('{}', { status: 200 });
            if (path === '/v1/lease/release') lifecycle.push('lease released');
            if (path === '/v1/lease/release') return new Response(JSON.stringify({ active_clients: 0, active_jobs: 0, should_shutdown: false }), { status: 200 });
            throw new Error(`Unexpected synthetic neural request: ${path}`);
        }, { preconnect: globalThis.fetch.preconnect });
        const fetch = spyOn(globalThis, 'fetch').mockImplementation(syntheticFetch);
        const early = new Error('synthetic early exit');
        try {
            await expect((async () => {
                try {
                    await h.start();
                    const queueStop = h.queue.stop.bind(h.queue);
                    const queueObserver = spyOn(h.queue, 'stop').mockImplementation(async () => { await queueStop(); lifecycle.push('queue stopped'); });
                    const platforms = h.runtime.platformLifecycleService;
                    const disconnect = platforms.disconnectAll.bind(platforms);
                    const platformObserver = spyOn(platforms, 'disconnectAll').mockImplementation(async () => { await disconnect(); lifecycle.push('platforms disconnected'); });
                    restoreObservers = () => { queueObserver.mockRestore(); platformObserver.mockRestore(); };
                    expect(h.runtime.isStarted).toBe(true);
                    expect(requests).toEqual(['/health', '/v1/lease/acquire']);
                    throw early;
                } finally { await h.dispose(); }
            })()).rejects.toBe(early);
            expect(requests).toEqual(['/health', '/v1/lease/acquire', '/v1/lease/release']);
            expect(leaseBodies).toHaveLength(2);
            expect(leaseBodies[0]).toMatchObject({ client_id: expect.any(String) });
            expect(leaseBodies[1]).toEqual(leaseBodies[0]);
            expect(lifecycle).toEqual(['queue stopped', 'lease released', 'platforms disconnected']);
            expect(h.runtime.isStarted).toBe(false);
        } finally { restoreObservers(); fetch.mockRestore(); }
    });

    it('retires the real runtime after degraded neural endpoint startup', async () => {
        const h = await createMainPresentationFixture();
        h.config.logging.file.enabled = false;
        h.config.logging.chat.enabled = false;
        h.config.obs.ttsMethod = 'neural-tts';
        h.config.obs.neuralTtsEndpoint = 'https://synthetic.invalid';
        try {
            await h.start();
            expect(h.runtime.isStarted).toBe(true);
        } finally { await h.dispose(); }
        expect(h.runtime.isStarted).toBe(false);
    });
});
