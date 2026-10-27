import { describe, expect, it } from 'bun:test';
import { NeuralTtsProcessManager } from '../../../src/obs/neural-tts-process-manager';
import { AppRuntime } from '../../../src/runtime/AppRuntime';
import { createMockFn } from '../../helpers/bun-mock-utils';
import { createConfigFixture } from '../../helpers/config-fixture';
import {
    createMockDisplayQueue,
    createMockNotificationManager,
    noOpLogger
} from '../../helpers/mock-factories';

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

    it('integrates with AppRuntime.start() and AppRuntime.shutdown() cleanly, including degraded mode on startup error', async () => {
        const lifecycleOrder: string[] = [];
        const neuralTtsProcessManager = {
            ensureStarted: createMockFn(async () => {
                lifecycleOrder.push('neuralTts:ensureStarted');
            }),
            stop: createMockFn(async () => {
                lifecycleOrder.push('neuralTts:stop');
            })
        };

        const displayQueue = {
            ...createMockDisplayQueue(),
            stop: createMockFn(async () => {
                lifecycleOrder.push('displayQueue:stop');
            })
        };

        const config = createConfigFixture({
            obs: {
                enabled: false,
                ttsTxt: 'test-tts-source',
                ttsMethod: 'neural-tts',
                neuralTtsEndpoint: 'http://127.0.0.1:8765',
                neuralTtsCommand: 'neural-tts serve'
            }
        });

        const runtime = new AppRuntime(config, {
            logging: noOpLogger,
            displayQueue,
            notificationManager: createMockNotificationManager(),
            eventBus: {
                subscribe: createMockFn(),
                emit: createMockFn()
            },
            vfxCommandService: {
                executeCommand: createMockFn(),
                executeCommandForKey: createMockFn(),
                getVFXConfig: createMockFn()
            },
            userTrackingService: {
                isFirstMessage: createMockFn()
            },
            obsEventService: {
                disconnect: createMockFn().mockResolvedValue()
            },
            commandCooldownService: {
                dispose: createMockFn<[], void>(),
                checkUserCooldown: createMockFn().mockReturnValue(true),
                updateUserCooldown: createMockFn(),
                getStatus: createMockFn().mockReturnValue({ commands: {} })
            },
            platformLifecycleService: {
                getAllPlatforms: createMockFn().mockReturnValue({}),
                getStatus: createMockFn().mockReturnValue({ platformHealth: {} }),
                getPlatformConnectionTime: createMockFn().mockReturnValue(null),
                initializeAllPlatforms: createMockFn().mockResolvedValue(),
                disconnectAll: createMockFn(async () => {
                    lifecycleOrder.push('platforms:disconnectAll');
                })
            },
            gracefulExitService: {
                isEnabled: createMockFn().mockReturnValue(false),
                getTargetMessageCount: createMockFn().mockReturnValue(0),
                incrementMessageCount: createMockFn().mockReturnValue(false),
                triggerExit: createMockFn().mockResolvedValue()
            },
            neuralTtsProcessManager,
            obs: {
                goalsManager: { initializeGoalDisplay: async () => {} },
                connectionManager: { isConnected: () => false, call: async () => ({}) }
            }
        });

        Reflect.set(runtime, 'viewerCountSystem', {
            addObserver: createMockFn(),
            initialize: createMockFn().mockResolvedValue(),
            startPolling: createMockFn().mockResolvedValue(),
            stopPolling: createMockFn(),
            cleanup: createMockFn().mockResolvedValue()
        });

        const originalExit = process.exit;
        Reflect.set(process, 'exit', createMockFn());
        try {
            await runtime.start();
            expect(neuralTtsProcessManager.ensureStarted.mock.calls.length).toBe(1);
            expect(runtime.isStarted).toBe(true);

            await runtime.shutdown();
            expect(neuralTtsProcessManager.stop.mock.calls.length).toBe(1);
            expect(lifecycleOrder).toEqual([
                'neuralTts:ensureStarted',
                'displayQueue:stop',
                'neuralTts:stop',
                'platforms:disconnectAll'
            ]);
        } finally {
            Reflect.set(process, 'exit', originalExit);
        }

        // Verify degraded startup when ensureStarted throws
        const failingManager = {
            ensureStarted: createMockFn(async () => {
                throw new Error('Invalid neural TTS endpoint');
            }),
            stop: createMockFn(async () => {})
        };
        const degradedRuntime = new AppRuntime(config, {
            logging: noOpLogger,
            displayQueue: createMockDisplayQueue(),
            notificationManager: createMockNotificationManager(),
            eventBus: { subscribe: createMockFn(), emit: createMockFn() },
            vfxCommandService: {
                executeCommand: createMockFn(),
                executeCommandForKey: createMockFn(),
                getVFXConfig: createMockFn()
            },
            userTrackingService: { isFirstMessage: createMockFn() },
            obsEventService: { disconnect: createMockFn().mockResolvedValue() },
            commandCooldownService: {
                dispose: createMockFn<[], void>(),
                checkUserCooldown: createMockFn().mockReturnValue(true),
                updateUserCooldown: createMockFn(),
                getStatus: createMockFn().mockReturnValue({ commands: {} })
            },
            platformLifecycleService: {
                getAllPlatforms: createMockFn().mockReturnValue({}),
                getStatus: createMockFn().mockReturnValue({ platformHealth: {} }),
                getPlatformConnectionTime: createMockFn().mockReturnValue(null),
                initializeAllPlatforms: createMockFn().mockResolvedValue(),
                disconnectAll: createMockFn().mockResolvedValue()
            },
            gracefulExitService: {
                isEnabled: createMockFn().mockReturnValue(false),
                getTargetMessageCount: createMockFn().mockReturnValue(0),
                incrementMessageCount: createMockFn().mockReturnValue(false),
                triggerExit: createMockFn().mockResolvedValue()
            },
            neuralTtsProcessManager: failingManager,
            obs: {
                goalsManager: { initializeGoalDisplay: async () => {} },
                connectionManager: { isConnected: () => false, call: async () => ({}) }
            }
        });
        Reflect.set(degradedRuntime, 'viewerCountSystem', {
            addObserver: createMockFn(),
            initialize: createMockFn().mockResolvedValue(),
            startPolling: createMockFn().mockResolvedValue(),
            stopPolling: createMockFn(),
            cleanup: createMockFn().mockResolvedValue()
        });

        await expect(degradedRuntime.start()).resolves.toBeUndefined();
        expect(failingManager.ensureStarted.mock.calls.length).toBe(1);
        expect(degradedRuntime.isStarted).toBe(true);
    });
});
