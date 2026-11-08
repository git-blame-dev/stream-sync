import { describe, expect, it, spyOn } from 'bun:test';
import { NeuralTtsProcessManager } from '../../../src/obs/neural-tts-process-manager';
import { createMainPresentationFixture } from '../../helpers/main-presentation-fixture';
import { noOpLogger } from '../../helpers/mock-factories';
import { withTimeout } from '../../../src/utils/timeout-wrapper';

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
    it("is a no-op during ensureStarted() when both ttsNotificationsEnabled and ttsChatEnabled are false", async () => {
        let fetchCalled = 0;
        let spawnCalled = 0;
        const { logger } = createTestLogger();
        const manager = new NeuralTtsProcessManager({
            config: {
                obs: {
                    ttsNotificationsEnabled: false,
                    ttsChatEnabled: false,
                    neuralTtsCommand: "neural-tts serve"
                }
            },
            logger,
            fetch: async () => {
                fetchCalled += 1;
                return new Response(null, { status: 200 });
            },
            spawn: () => {
                spawnCalled += 1;
                return { kill: () => true };
            }
        });

        await manager.ensureStarted();

        expect(fetchCalled).toBe(0);
        expect(spawnCalled).toBe(0);
        expect(manager.spawnedByUs).toBe(false);
        expect(manager.hasAcquiredLease).toBe(false);
    });

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
                return new Response(
                    JSON.stringify({ active_clients: 1, active_jobs: 0 }),
                    { status: 200, headers: { 'content-type': 'application/json' } }
                );
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
                return new Response(
                    JSON.stringify({ shutting_down: true }),
                    { status: 200, headers: { 'content-type': 'application/json' } }
                );
            }

            return new Response(null, { status: 404 });
        };

        let currentTime = 0;
        const { logger } = createTestLogger();
        const manager = new NeuralTtsProcessManager({
            config: {
                obs: {
                    ttsNotificationsEnabled: true,
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
        expect(manager.hasAcquiredLease).toBe(true);
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

        expect(manager.hasAcquiredLease).toBe(false);
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
                    return new Response(
                        JSON.stringify({ active_clients: 1, active_jobs: 0 }),
                        { status: 200, headers: { 'content-type': 'application/json' } }
                    );
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
                        ttsNotificationsEnabled: true,
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
            expect(manager.hasAcquiredLease).toBe(true);

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
            if (url.endsWith('/v1/synthesis/session')) return Response.json({ session_id: 'a'.repeat(64) });
            if (url.endsWith('/v1/lease/acquire')) {
                return new Response(
                    JSON.stringify({ active_clients: 1, active_jobs: 0 }),
                    { status: 200, headers: { 'content-type': 'application/json' } }
                );
            }
            if (url.endsWith('/v1/lease/release')) {
                return new Response(
                    JSON.stringify({ active_clients: 0, active_jobs: 0, should_shutdown: true }),
                    { status: 200, headers: { 'content-type': 'application/json' } }
                );
            }
            return new Response(null, { status: 200 });
        };

        const { logger } = createTestLogger();
        const manager = new NeuralTtsProcessManager({
            config: {
                obs: {
                    ttsNotificationsEnabled: true,
                    neuralTtsCommand: 'neural-tts serve'
                }
            },
            logger,
            fetch,
            spawn: () => {
                spawnCalled += 1;
                return { kill: () => true };
            },
            pollIntervalMs: 1,
            warmupTimeoutMs: 100,
            clientId: 'synthetic-external-client'
        });

        await manager.ensureStarted();

        expect(spawnCalled).toBe(0);
        expect(manager.spawnedByUs).toBe(false);
        expect(manager.hasAcquiredLease).toBe(true);
        expect(requests.map((r) => [r.method, r.url])).toEqual([
            ['GET', 'http://127.0.0.1:8765/health'],
            ['POST', 'http://127.0.0.1:8765/v1/lease/acquire'],
            ['POST', 'http://127.0.0.1:8765/v1/synthesis/session'],
            ['GET', 'http://127.0.0.1:8765/health'],
            ['POST', 'http://127.0.0.1:8765/v1/synthesis/release']
        ]);

        await manager.stop();

        expect(requests.slice(5).map((r) => [r.method, r.url])).toEqual([
            ['POST', 'http://127.0.0.1:8765/v1/lease/release']
        ]);
        expect(requests.some((r) => r.url.endsWith('/v1/shutdown'))).toBe(false);
    });

    it('leaves hasAcquiredLease false when lease acquisition fails and prevents stop() from releasing, shutting down, or killing the process', async () => {
        const failureCases: Array<{
            label: string;
            onAcquire: () => Promise<Response>;
        }> = [
            {
                label: 'HTTP 404',
                onAcquire: async () => new Response(null, { status: 404 })
            },
            {
                label: 'HTTP 500',
                onAcquire: async () => new Response('internal error', { status: 500 })
            },
            {
                label: 'malformed JSON missing active_jobs',
                onAcquire: async () => new Response(JSON.stringify({ active_clients: 1 }), { status: 200 })
            },
            {
                label: 'network timeout',
                onAcquire: async () => {
                    throw new Error('Request timed out');
                }
            }
        ];

        for (const failureCase of failureCases) {
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
                    return await failureCase.onAcquire();
                }
                return new Response(null, { status: 200 });
            };

            const { logger, warnings } = createTestLogger();
            const manager = new NeuralTtsProcessManager({
                config: {
                    obs: {
                        ttsNotificationsEnabled: true,
                        neuralTtsCommand: 'neural-tts serve'
                    }
                },
                logger,
                fetch,
                spawn: () => ({
                    pid: 7777,
                    kill: (signal) => {
                        killedSignals.push(signal);
                        return true;
                    }
                }),
                delay: async () => {},
                clientId: `synthetic-acquire-fail-${failureCase.label}`
            });

            await manager.ensureStarted();

            expect(manager.spawnedByUs).toBe(true);
            expect(manager.hasAcquiredLease).toBe(false);
            expect(warnings.length).toBeGreaterThan(0);

            await manager.stop();

            expect(requests.some((r) => r.url.endsWith('/v1/lease/release'))).toBe(false);
            expect(requests.some((r) => r.url.endsWith('/v1/shutdown'))).toBe(false);
            expect(killedSignals).toEqual([]);
        }
    });

    it('keeps the spawned child process alive without calling /v1/shutdown when lease release fails or returns malformed/non-shutdown payloads', async () => {
        const releaseCases: Array<{
            label: string;
            onRelease: () => Promise<Response>;
        }> = [
            {
                label: 'HTTP 500',
                onRelease: async () => new Response('release failed', { status: 500 })
            },
            {
                label: 'network timeout',
                onRelease: async () => {
                    throw new Error('Release request timed out');
                }
            },
            {
                label: 'empty object missing fields',
                onRelease: async () => new Response(JSON.stringify({}), { status: 200 })
            },
            {
                label: 'should_shutdown false',
                onRelease: async () => new Response(
                    JSON.stringify({ active_clients: 0, active_jobs: 0, should_shutdown: false }),
                    { status: 200 }
                )
            }
        ];

        for (const releaseCase of releaseCases) {
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
                    return new Response(
                        JSON.stringify({ active_clients: 1, active_jobs: 0 }),
                        { status: 200 }
                    );
                }
                if (url.endsWith('/v1/lease/release')) {
                    return await releaseCase.onRelease();
                }
                return new Response(null, { status: 200 });
            };

            const { logger, infos } = createTestLogger();
            const manager = new NeuralTtsProcessManager({
                config: {
                    obs: {
                        ttsNotificationsEnabled: true,
                        neuralTtsCommand: 'neural-tts serve'
                    }
                },
                logger,
                fetch,
                spawn: () => ({
                    pid: 8888,
                    kill: (signal) => {
                        killedSignals.push(signal);
                        return true;
                    }
                }),
                delay: async () => {},
                clientId: `synthetic-release-fail-${releaseCase.label}`
            });

            await manager.ensureStarted();
            expect(manager.hasAcquiredLease).toBe(true);

            await manager.stop();

            expect(requests.some((r) => r.url.endsWith('/v1/lease/release'))).toBe(true);
            expect(requests.some((r) => r.url.endsWith('/v1/shutdown'))).toBe(false);
            expect(killedSignals).toEqual([]);
            expect(infos.some((msg) => msg.includes('Keeping Neural TTS service alive'))).toBe(true);
        }
    });

    it('keeps the spawned child process alive when /v1/shutdown returns 409, 500, invalid payload, or throws', async () => {
        const shutdownCases: Array<{
            label: string;
            onShutdown: () => Promise<Response>;
        }> = [
            {
                label: 'HTTP 409 Conflict',
                onShutdown: async () => new Response(JSON.stringify({ shutting_down: false }), { status: 409 })
            },
            {
                label: 'HTTP 500 Internal Server Error',
                onShutdown: async () => new Response('server error', { status: 500 })
            },
            {
                label: 'network timeout',
                onShutdown: async () => {
                    throw new Error('Shutdown request timed out');
                }
            },
            {
                label: 'shutting_down false',
                onShutdown: async () => new Response(JSON.stringify({ shutting_down: false }), { status: 200 })
            }
        ];

        for (const shutdownCase of shutdownCases) {
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
                    return new Response(
                        JSON.stringify({ active_clients: 1, active_jobs: 0 }),
                        { status: 200 }
                    );
                }
                if (url.endsWith('/v1/lease/release')) {
                    return new Response(
                        JSON.stringify({ active_clients: 0, active_jobs: 0, should_shutdown: true }),
                        { status: 200 }
                    );
                }
                if (url.endsWith('/v1/shutdown')) {
                    return await shutdownCase.onShutdown();
                }
                return new Response(null, { status: 200 });
            };

            const { logger } = createTestLogger();
            const manager = new NeuralTtsProcessManager({
                config: {
                    obs: {
                        ttsNotificationsEnabled: true,
                        neuralTtsCommand: 'neural-tts serve'
                    }
                },
                logger,
                fetch,
                spawn: () => ({
                    pid: 9999,
                    kill: (signal) => {
                        killedSignals.push(signal);
                        return true;
                    }
                }),
                delay: async () => {},
                clientId: `synthetic-shutdown-fail-${shutdownCase.label}`
            });

            await manager.ensureStarted();
            expect(manager.hasAcquiredLease).toBe(true);

            await manager.stop();

            expect(requests.some((r) => r.url.endsWith('/v1/shutdown'))).toBe(true);
            expect(killedSignals).toEqual([]);
        }
    });

    it('rejects non-loopback endpoints during ensureStarted() and logs warning on warmup timeout without crashing', async () => {
        const { logger, warnings } = createTestLogger();
        const invalidManager = new NeuralTtsProcessManager({
            config: {
                obs: {
                    ttsNotificationsEnabled: true,
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
                    ttsNotificationsEnabled: true,
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
        h.config.obs.ttsNotificationsEnabled = true;
        h.config.obs.neuralTtsEndpoint = 'http://127.0.0.1:8765';
        const requests: string[] = [];
        const leaseBodies: unknown[] = [];
        let queueRetiredAtRelease = false;
        const syntheticFetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
            const path = new URL(String(input)).pathname;
            requests.push(path);
            if (path.startsWith('/v1/lease/')) leaseBodies.push(JSON.parse(String(init?.body)));
            if (path === '/health') return new Response('{}', { status: 200 });
            if (path === '/v1/lease/acquire') return new Response(JSON.stringify({ active_clients: 1, active_jobs: 0 }), { status: 200 });
            if (path === '/v1/lease/release') {
                try {
                    h.queue.addItem({ type: 'chat', platform: 'twitch', data: { username: 'synthetic-retired-viewer', message: 'synthetic retired row' } });
                } catch (error) {
                    queueRetiredAtRelease = error instanceof Error && error.message === 'Display queue stopped';
                }
                return new Response(JSON.stringify({ active_clients: 0, active_jobs: 0, should_shutdown: false }), { status: 200 });
            }
            throw new Error(`Unexpected synthetic neural request: ${path}`);
        }, { preconnect: globalThis.fetch.preconnect });
        const fetch = spyOn(globalThis, 'fetch').mockImplementation(syntheticFetch);
        const early = new Error('synthetic early exit');
        try {
            await expect((async () => {
                try {
                    await h.start();
                    expect(h.runtime.isStarted).toBe(true);
                    expect(requests).toEqual(['/health', '/v1/lease/acquire']);
                    throw early;
                } finally { await h.dispose(); }
            })()).rejects.toBe(early);
            expect(requests).toEqual(['/health', '/v1/lease/acquire', '/v1/lease/release']);
            expect(leaseBodies).toHaveLength(2);
            expect(leaseBodies[0]).toMatchObject({ client_id: expect.any(String) });
            expect(leaseBodies[1]).toEqual(leaseBodies[0]);
            expect(queueRetiredAtRelease).toBe(true);
            expect(h.runtime.isStarted).toBe(false);
        } finally { fetch.mockRestore(); }
    });

    it('waits for a warming neural service before completing real runtime startup and releases its lease', async () => {
        const h = await createMainPresentationFixture();
        h.config.logging.file.enabled = false;
        h.config.obs.ttsNotificationsEnabled = true;
        h.config.obs.neuralTtsEndpoint = 'http://127.0.0.1:8765';
        const requests: string[] = [];
        const leaseBodies: unknown[] = [];
        let healthCalls = 0;
        let markReadinessProbe!: () => void;
        const readinessProbe = new Promise<void>(resolve => { markReadinessProbe = resolve; });
        let releaseReadiness!: () => void;
        const readinessGate = new Promise<void>(resolve => { releaseReadiness = resolve; });
        const syntheticFetch = Object.assign(async (input: RequestInfo | URL, init?: RequestInit) => {
            const path = new URL(String(input)).pathname;
            requests.push(path);
            if (path.startsWith('/v1/lease/')) leaseBodies.push(JSON.parse(String(init?.body)));
            if (path === '/health') {
                healthCalls += 1;
                if (healthCalls === 1) return new Response(null, { status: 503 });
                markReadinessProbe();
                await readinessGate;
                return new Response(null, { status: 200 });
            }
            if (path === '/v1/synthesis/session') return Response.json({ session_id: 'a'.repeat(64) });
            if (path === '/v1/synthesis/release') return Response.json({ released: true, retired: true });
            if (path === '/v1/lease/acquire') return Response.json({ active_clients: 1, active_jobs: 0 });
            if (path === '/v1/lease/release') return Response.json({ active_clients: 0, active_jobs: 0, should_shutdown: false });
            throw new Error(`Unexpected synthetic neural request: ${path}`);
        }, { preconnect: globalThis.fetch.preconnect });
        const fetch = spyOn(globalThis, 'fetch').mockImplementation(syntheticFetch);
        const starting = h.start();
        try {
            await withTimeout(readinessProbe, 2000);
            expect(requests).toEqual(['/health', '/v1/lease/acquire', '/v1/synthesis/session', '/health']);
            expect(h.runtime.isStarted).toBe(false);
            releaseReadiness();
            await starting;
            expect(h.runtime.isStarted).toBe(true);
            expect(requests).toEqual(['/health', '/v1/lease/acquire', '/v1/synthesis/session', '/health', '/v1/synthesis/release']);
        } finally {
            releaseReadiness();
            try {
                await starting;
            } finally {
                try { await h.dispose(); }
                finally { fetch.mockRestore(); }
            }
        }
        expect(requests).toEqual(['/health', '/v1/lease/acquire', '/v1/synthesis/session', '/health', '/v1/synthesis/release', '/v1/lease/release']);
        expect(leaseBodies).toHaveLength(2);
        expect(leaseBodies[0]).toEqual({ client_id: expect.any(String) });
        expect(leaseBodies[1]).toEqual(leaseBodies[0]);
        expect(h.runtime.isStarted).toBe(false);
    });

    it('retires the real runtime after degraded neural endpoint startup', async () => {
        const h = await createMainPresentationFixture();
        h.config.logging.file.enabled = false;
        h.config.obs.ttsNotificationsEnabled = true;
        h.config.obs.neuralTtsEndpoint = 'https://synthetic.invalid';
        try {
            await h.start();
            expect(h.runtime.isStarted).toBe(true);
        } finally { await h.dispose(); }
        expect(h.runtime.isStarted).toBe(false);
    });
});
