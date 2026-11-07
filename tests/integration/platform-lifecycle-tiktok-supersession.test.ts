import { expect, test } from 'bun:test';
import { PlatformLifecycleService, type PlatformConstructor } from '../../src/services/PlatformLifecycleService';
import { PlatformInitializationSupersededError } from '../../src/interfaces/PlatformLifecycle';
import { TikTokPlatform } from '../../src/platforms/tiktok';
import { TikTokWebSocketClient } from '../../src/platforms/tiktok-websocket-client';
import { SyntheticTikTokConnector, flushConnectorSetup } from '../helpers/tiktok-connector-fixture';
import { noOpLogger } from '../helpers/mock-factories';

// The lifecycle constructor contract is broader than TikTok's concrete config/dependency types.
const TikTokModule = TikTokPlatform as unknown as PlatformConstructor;

function createLifecycle() {
    const connectors: SyntheticTikTokConnector[] = [];
    const publications: unknown[] = [];
    class AcquiredClient extends TikTokWebSocketClient {
        constructor(username: string, options: ConstructorParameters<typeof TikTokWebSocketClient>[1]) {
            super(username, { ...options, connectorFactory: async (_username, _key, signal) => {
                const connector = new SyntheticTikTokConnector();
                connector.signal = signal;
                connectors.push(connector);
                return connector;
            } });
        }
    }
    const lifecycle = new PlatformLifecycleService({
        config: { tiktok: { enabled: true, username: 'synthetic-streamer', dataLoggingEnabled: false,
            envFileReadEnabled: false, envFileWriteEnabled: false } },
        logger: noOpLogger,
        eventBus: { emit: (_name, payload) => { publications.push(payload); } },
        dependencyFactory: { createTiktokDependencies: () => ({ logger: noOpLogger, TikTokWebSocketClient: AcquiredClient }) }
    });
    return { lifecycle, connectors, publications };
}

for (const settlement of ['before-readiness', 'after-readiness'] as const) {
    test(`real lifecycle joining obsolete TikTok initialization ${settlement} preserves its replacement`, async () => {
        const { lifecycle, connectors, publications } = createLifecycle();
        try {
            await lifecycle.initializePlatform('tiktok', TikTokModule);
            await flushConnectorSetup();
            const platform = lifecycle.getPlatform('tiktok');
            expect(platform).toBeInstanceOf(TikTokPlatform);
            if (!(platform instanceof TikTokPlatform)) throw new Error('Synthetic platform not registered');
            const obsolete = lifecycle.backgroundPlatformInits[0]!.promise;
            const healthBefore = { ...lifecycle.platformHealth.tiktok! };
            const cleanup = platform.cleanup(false);
            const fresh = platform.connectionOrchestrator.connect({});
            const ready = fresh.catch(error => error);
            await flushConnectorSetup();
            const held = platform.connection;
            expect(held).not.toBeNull();
            if (settlement === 'after-readiness') {
                connectors[1]!.open(); connectors[1]!.enter();
                await ready;
            }
            await Promise.all([cleanup, obsolete]);
            expect(lifecycle.getPlatform('tiktok')).toBe(platform);
            expect(platform.connection).toBe(held);
            expect(connectors[0]!.signal?.aborted).toBe(true);
            expect(connectors[1]!.signal?.aborted).toBe(false);
            expect(lifecycle.platformErrors).toEqual([]);
            expect(publications).not.toContainEqual(expect.objectContaining({ data: expect.objectContaining({ status: 'unavailable' }) }));
            if (settlement === 'before-readiness') {
                expect(lifecycle.platformHealth.tiktok).toEqual(healthBefore);
                expect(lifecycle.platformHealth.tiktok?.state).toBe('initializing');
                connectors[1]!.open(); connectors[1]!.enter();
            }
            expect(await ready).not.toBeInstanceOf(Error);
            expect(platform.connectionStatus).toBe(true);
            expect(platform.connectionStateManager.isConnected()).toBe(true);
            expect(lifecycle.platformHealth.tiktok).toMatchObject({ state: 'ready', lastError: null, failures: 0 });
            expect(lifecycle.backgroundPlatformInits).toEqual([]);
        } finally { await lifecycle.disconnectAll(); }
    });
}

test('real lifecycle still retires a current TikTok terminal initialization failure', async () => {
    const { lifecycle, connectors, publications } = createLifecycle();
    try {
        await lifecycle.initializePlatform('tiktok', TikTokModule);
        await flushConnectorSetup();
        const pending = lifecycle.backgroundPlatformInits[0]!.promise;
        connectors[0]!.fail(Object.assign(new Error('Platform initialization superseded'), { code: 4401, name: 'AbortError' }));
        await pending;
        expect(lifecycle.getPlatform('tiktok')).toBeNull();
        expect(connectors[0]!.signal?.aborted).toBe(true);
        expect(lifecycle.platformHealth.tiktok).toMatchObject({ state: 'failed', failures: 1 });
        expect(lifecycle.platformErrors).toHaveLength(1);
        expect(publications).toContainEqual(expect.objectContaining({ data: expect.objectContaining({ status: 'unavailable' }) }));
    } finally { await lifecycle.disconnectAll(); }
});

for (const superseded of [true, false]) {
    test(`foreground lifecycle consumes only typed supersession (superseded=${superseded})`, async () => {
        const lifecycle = new PlatformLifecycleService({ config: { synthetic: { enabled: true } }, logger: noOpLogger });
        let cleanups = 0;
        const error = superseded
            ? new PlatformInitializationSupersededError()
            : Object.assign(new Error('Platform initialization superseded'), { name: 'AbortError' });
        class SyntheticPlatform {
            async initialize() { throw error; }
            on() {}
            cleanup() { cleanups++; }
        }
        try {
            await lifecycle.initializePlatform('synthetic', SyntheticPlatform);
            expect(cleanups).toBe(superseded ? 0 : 1);
            expect(lifecycle.platformHealth.synthetic?.state).toBe(superseded ? 'initializing' : 'failed');
            expect(lifecycle.platformErrors).toHaveLength(superseded ? 0 : 1);
            expect(lifecycle.isPlatformAvailable('synthetic')).toBe(superseded);
        } finally { await lifecycle.disconnectAll(); }
    });
}
