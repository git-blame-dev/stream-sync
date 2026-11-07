import { expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { NeuralTtsProcessManager } from '../../src/obs/neural-tts-process-manager';
import { PlatformLifecycleService } from '../../src/services/PlatformLifecycleService';
import { DependencyFactory } from '../../src/utils/dependency-factory';
import { withTimeout } from '../../src/utils/timeout-wrapper';
import { createTestAppRuntime } from '../helpers/runtime-test-harness';
import { noOpLogger } from '../helpers/mock-factories';

test('enabled provider acquires its external connection only after the neural lease, and shutdown releases both owners', async () => {
    const order: string[] = [];
    const acquisition = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const bodies: unknown[] = [];
    class SyntheticProviderConnection extends EventEmitter {
        isConnected = false;
        async connect() { order.push('provider connected'); this.isConnected = true; }
        async disconnect() { order.push('provider disconnected'); this.isConnected = false; }
    }
    const connection = new SyntheticProviderConnection();
    const providerConfig = { enabled: true, username: 'synthetic-startup-creator', dataLoggingEnabled: false };
    const factory = new DependencyFactory();
    const obs = { ttsNotificationsEnabled: true, neuralTtsEndpoint: 'http://127.0.0.1:8765' };
    const neural = new NeuralTtsProcessManager({
        config: { obs }, logger: noOpLogger,
        fetch: async (input, init) => {
            const path = new URL(String(input)).pathname;
            if (path === '/health') return Response.json({});
            bodies.push(JSON.parse(String(init?.body)));
            if (path === '/v1/lease/acquire') {
                order.push('lease requested'); acquisition.resolve();
                await release.promise;
                order.push('lease acquired');
                return Response.json({ active_clients: 1, active_jobs: 0 });
            }
            if (path === '/v1/lease/release') {
                order.push('lease released');
                return Response.json({ active_clients: 0, active_jobs: 0, should_shutdown: false });
            }
            throw new Error(`Unexpected synthetic neural path: ${path}`);
        },
    });
    const h = createTestAppRuntime({ tiktok: providerConfig, obs }, { neuralTtsProcessManager: neural });
    let starting: ReturnType<typeof h.runtime.start> | undefined;
    try {
        const lifecycle = h.runtime.platformLifecycleService;
        if (!(lifecycle instanceof PlatformLifecycleService)) throw new Error('Expected the constructed lifecycle owner');
        lifecycle.dependencyFactory = {
            createTiktokDependencies: config => factory.createTiktokDependencies(config, {
                config: { tiktok: providerConfig }, logger: noOpLogger,
                connectionFactory: { createConnection: () => connection },
            }),
        };
        starting = h.runtime.start();
        await withTimeout(acquisition.promise, 2000);
        expect(order).toEqual(['lease requested']);
        expect(connection.isConnected).toBe(false);
        expect(lifecycle.getPlatform('tiktok')).toBeNull();
        release.resolve();
        await withTimeout(starting, 2000);
        expect(connection.isConnected).toBe(true);
        expect(order).toEqual(['lease requested', 'lease acquired', 'provider connected']);
        await h.runtime.shutdown();
        expect(order.indexOf('provider disconnected')).toBeGreaterThan(order.indexOf('provider connected'));
        expect(order.filter(value => value === 'lease released')).toHaveLength(1);
        expect(bodies).toHaveLength(2);
        expect(bodies[0]).toMatchObject({ client_id: expect.any(String) });
        expect(bodies[1]).toEqual(bodies[0]);
        expect(connection.isConnected).toBe(false);
        expect(connection.eventNames()).toEqual([]);
    } finally {
        release.resolve();
        try { await starting; }
        finally { await h.runtime.shutdown(); }
    }
});
