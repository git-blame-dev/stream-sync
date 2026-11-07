import { expect, test, vi } from 'bun:test';
import { createTikTokLifetimeFixture, flushConnectorSetup } from '../helpers/tiktok-connector-fixture';

test('concurrent orchestrator connects retain the pending real client and its listeners', async () => {
    const fixture = createTikTokLifetimeFixture({ envFileReadEnabled: false, envFileWriteEnabled: false });
    const { platform } = fixture;
    try {
        const first = platform.connectionOrchestrator.connect({});
        const results = [first];
        await flushConnectorSetup();
        const held = platform.connection;
        const second = platform.connectionOrchestrator.connect({});
        results.push(second);
        void Promise.allSettled(results);
        expect(platform.connection).toBe(held);
        expect(fixture.clients).toHaveLength(1);
        fixture.connectors[0]!.open();
        fixture.connectors[0]!.enter();
        await Promise.all(results);
        expect(platform.connectionStatus).toBe(true);
        expect(platform.connectionStateManager.isConnected()).toBe(true);
    } finally { await fixture.cleanup(); }
});

test('a stale held connecting client is retired before replacement and cannot publish late readiness', async () => {
    const fixture = createTikTokLifetimeFixture({ envFileReadEnabled: false, envFileWriteEnabled: false });
    const { platform } = fixture;
    try {
        const stale = fixture.createConnection();
        platform.connection = stale;
        const abandoned = stale.connect().catch(error => error);
        await flushConnectorSetup();
        const oldSdk = fixture.connectors[0]!;
        const connecting = platform.connectionOrchestrator.connect({});
        void connecting.catch(() => {});
        await flushConnectorSetup();
        expect(oldSdk.signal?.aborted).toBe(true);
        expect(oldSdk.disconnects).toBeGreaterThan(0);
        oldSdk.open(); oldSdk.enter();
        await flushConnectorSetup();
        expect(stale.isConnected).toBe(false);
        expect(platform.connection === (fixture.clients[1] as unknown)).toBe(true);
        fixture.connectors[1]!.open(); fixture.connectors[1]!.enter();
        await connecting;
        expect((await abandoned).message).toBe('Connection cancelled');
        expect(platform.connectionStatus).toBe(true);
    } finally { await fixture.cleanup(); }
});

test('disconnect during stale-client retirement cancels replacement admission', async () => {
    const fixture = createTikTokLifetimeFixture({ envFileReadEnabled: false, envFileWriteEnabled: false });
    const { platform } = fixture;
    try {
        const stale = fixture.createConnection();
        platform.connection = stale;
        const abandoned = stale.connect().catch(error => error);
        await flushConnectorSetup();
        const replacing = platform.connectionOrchestrator.connect({});
        const settled = replacing.catch(error => error);
        await platform.connectionOrchestrator.disconnect();
        await flushConnectorSetup();
        expect(fixture.clients).toHaveLength(1);
        await settled;
        await abandoned;
        expect(platform.connection).toBeNull();
        expect(fixture.connectors[0]!.signal?.aborted).toBe(true);
    } finally { await fixture.cleanup(); }
});

for (const cancelRecovery of [true, false]) {
    test(`real platform cleanup(${cancelRecovery}) cancels pending stale replacement and permits a fresh connection`, async () => {
        const fixture = createTikTokLifetimeFixture({ envFileReadEnabled: false, envFileWriteEnabled: false });
        const { platform } = fixture;
        try {
            const stale = fixture.createConnection();
            platform.connection = stale;
            const abandoned = stale.connect().catch(error => error);
            await flushConnectorSetup();
            const replacing = platform.connectionOrchestrator.connect({}).catch(error => error);
            await platform.cleanup(cancelRecovery);
            await flushConnectorSetup();
            expect(fixture.clients).toHaveLength(1);
            await replacing;
            await abandoned;
            expect(platform.connection).toBeNull();
            expect(platform.connectingPromise).toBeNull();
            expect(fixture.connectors[0]!.signal?.aborted).toBe(true);

            const fresh = platform.connectionOrchestrator.connect({});
            void fresh.catch(() => {});
            await flushConnectorSetup();
            fixture.connectors[1]!.open(); fixture.connectors[1]!.enter();
            await fresh;
            expect(platform.connectionStatus).toBe(true);
            expect(platform.connectionStateManager.isConnected()).toBe(true);
        } finally { await fixture.cleanup(); }
    });
}

test('a fresh connection survives real cleanup racing an obsolete pending attempt', async () => {
    const fixture = createTikTokLifetimeFixture({ envFileReadEnabled: false, envFileWriteEnabled: false });
    const { platform } = fixture;
    try {
        const obsolete = platform.connectionOrchestrator.connect({}).catch(error => error);
        await flushConnectorSetup();
        const oldSdk = fixture.connectors[0]!;
        const cleanup = platform.cleanup(false);
        const fresh = platform.connectionOrchestrator.connect({});
        void fresh.catch(() => {});
        await flushConnectorSetup();
        expect(fixture.clients).toHaveLength(2);
        const held = platform.connection;
        const pending = platform.connectingPromise;
        await Promise.all([cleanup, obsolete]);
        oldSdk.open(); oldSdk.enter();
        await flushConnectorSetup();
        expect(platform.connectingPromise).toBe(pending);
        expect(platform.connection).toBe(held);
        expect(platform.connectionStatus).toBe(false);
        fixture.connectors[1]!.open(); fixture.connectors[1]!.enter();
        await fresh;
        expect(oldSdk.signal?.aborted).toBe(true);
        expect(platform.connection).toBe(held);
        expect(platform.connectionStatus).toBe(true);
        expect(platform.connectionStateManager.isConnected()).toBe(true);
        expect(platform.connectingPromise).toBeNull();
    } finally { await fixture.cleanup(); }
});

for (const settle of ['failure', 'late-success'] as const) {
    test(`obsolete real initialize ${settle} cannot retire a fresh transport`, async () => {
        const fixture = createTikTokLifetimeFixture({ envFileReadEnabled: false, envFileWriteEnabled: false });
        const { platform } = fixture;
        try {
            const initializing = platform.initialize({}).catch(error => error);
            await flushConnectorSetup();
            const oldSdk = fixture.connectors[0]!;
            const cleanup = platform.cleanup(false);
            const fresh = platform.connectionOrchestrator.connect({});
            const ready = fresh.catch(error => error);
            await flushConnectorSetup();
            const held = platform.connection;
            expect(held).not.toBeNull();
            if (settle === 'failure') oldSdk.fail(new Error('synthetic obsolete failure'));
            else { oldSdk.open(); oldSdk.enter(); }
            const [, initializationResult] = await Promise.all([cleanup, initializing]);
            expect(initializationResult).toBeInstanceOf(Error);
            await flushConnectorSetup();
            expect(platform.connection).toBe(held);
            expect(fixture.connectors[1]!.signal?.aborted).toBe(false);
            expect(fixture.retry.getRetryCount('tiktok')).toBe(0);
            fixture.connectors[1]!.open(); fixture.connectors[1]!.enter();
            expect(await ready).not.toBeInstanceOf(Error);
            expect(platform.connectionStatus).toBe(true);
        } finally { await fixture.cleanup(); }
    });
}

for (const issue of [{ code: 4404, reason: 'synthetic not live' }, { code: 1011, reason: 'synthetic connection failure' }]) {
    test(`real issue ${issue.code} cannot clear or schedule recovery over an immediate replacement`, async () => {
        const fixture = createTikTokLifetimeFixture({ envFileReadEnabled: false, envFileWriteEnabled: false });
        const { platform } = fixture;
        try {
            const first = platform.initialize({});
            await flushConnectorSetup();
            fixture.connectors[0]!.open(); fixture.connectors[0]!.enter();
            await first;
            const disconnecting = platform.handleConnectionIssue(issue);
            const fresh = platform.connectionOrchestrator.connect({});
            const ready = fresh.catch(error => error);
            await flushConnectorSetup();
            const held = platform.connection;
            expect(held).not.toBeNull();
            await disconnecting;
            expect(platform.connection).toBe(held);
            expect(platform.listenersConfigured).toBe(true);
            expect(fixture.connectors[1]!.signal?.aborted).toBe(false);
            expect(fixture.retry.getRetryCount('tiktok')).toBe(0);
            expect(platform.intervalManager.hasInterval('tiktok-stream-reconnect')).toBe(false);
            fixture.connectors[1]!.open(); fixture.connectors[1]!.enter();
            expect(await ready).not.toBeInstanceOf(Error);
            expect(platform.connectionStatus).toBe(true);
        } finally { await fixture.cleanup(); }
    });
}

test('real initialize retains ownership through its own asynchronous stale retirement and listener setup', async () => {
    const fixture = createTikTokLifetimeFixture({ envFileReadEnabled: false, envFileWriteEnabled: false });
    const { platform } = fixture;
    try {
        const stale = fixture.createConnection();
        platform.connection = stale;
        const abandoned = stale.connect().catch(error => error);
        await flushConnectorSetup();
        const initializing = platform.initialize({});
        await flushConnectorSetup();
        fixture.connectors[1]!.open(); fixture.connectors[1]!.enter();
        await expect(initializing).resolves.toEqual({ state: 'ready' });
        await abandoned;
        expect(fixture.retry.getRetryCount('tiktok')).toBe(0);
        await platform.cleanup(true);
        const restarted = platform.initialize({});
        await flushConnectorSetup();
        fixture.connectors[2]!.open(); fixture.connectors[2]!.enter();
        await expect(restarted).resolves.toEqual({ state: 'ready' });
    } finally { await fixture.cleanup(); }
});

for (const [phase, throws] of [['connected', false], ['connected', true], ['reconnecting', false], ['reconnecting', true]] as const) {
    test(`replacement started by the real ${phase} handler (throws=${throws}) fences remaining status and recovery`, async () => {
        const fixture = createTikTokLifetimeFixture({ envFileReadEnabled: false, envFileWriteEnabled: false });
        const { platform } = fixture;
        const statuses: unknown[] = [];
        let replacement: Promise<unknown> | undefined;
        let retirement: Promise<unknown> | undefined;
        platform.on('platform:event', event => { if (event.type === 'platform:stream-status') statuses.push(event.data); });
        try {
            const initializing = platform.initialize({ onConnection: event => {
                if (!event || typeof event !== 'object' || !('status' in event) || event.status !== phase || replacement) return;
                retirement = platform.cleanup(false);
                replacement = platform.connectionOrchestrator.connect({});
                void replacement.catch(() => {});
                if (throws) throw new Error('synthetic obsolete observer failure');
            } }).catch(error => error);
            await flushConnectorSetup();
            fixture.connectors[0]!.open(); fixture.connectors[0]!.enter();
            const initializationResult = await initializing;
            if (phase === 'connected') expect(initializationResult).toBeInstanceOf(Error);
            if (phase === 'reconnecting') statuses.length = 0;
            if (phase === 'reconnecting') await platform.handleConnectionIssue({ code: 1011, reason: 'synthetic drop' });
            await retirement;
            await flushConnectorSetup();
            expect(replacement).toBeDefined();
            expect(statuses).toHaveLength(0);
            expect(fixture.retry.getRetryCount('tiktok')).toBe(0);
            fixture.connectors[1]!.open(); fixture.connectors[1]!.enter();
            await replacement;
            expect(platform.connectionStatus).toBe(true);
            expect(statuses).toHaveLength(1);
        } finally { await fixture.cleanup(); }
    });
}

test('scheduled and in-flight real retry continuations cannot take ownership from a fresh connection', async () => {
    vi.useFakeTimers();
    const fixture = createTikTokLifetimeFixture({ envFileReadEnabled: false, envFileWriteEnabled: false });
    const { platform } = fixture;
    try {
        platform.queueRetry(new Error('synthetic connection failure'));
        await flushConnectorSetup();
        const delay = fixture.retry.calculateAdaptiveRetryDelay('tiktok');
        const fresh = platform.connectionOrchestrator.connect({});
        await flushConnectorSetup();
        vi.advanceTimersByTime(delay);
        await flushConnectorSetup();
        expect(fixture.clients).toHaveLength(1);
        expect(platform.retryLock).toBe(false);
        fixture.connectors[0]!.open(); fixture.connectors[0]!.enter();
        await fresh;

        await platform.handleConnectionIssue({ code: 1011, reason: 'synthetic retry drop' });
        await flushConnectorSetup();
        vi.advanceTimersByTime(fixture.retry.calculateAdaptiveRetryDelay('tiktok'));
        await flushConnectorSetup();
        expect(fixture.clients).toHaveLength(2);
        const obsolete = platform.connectingPromise?.catch(error => error);
        const cleanup = platform.cleanup(false);
        const replacement = platform.connectionOrchestrator.connect({});
        void replacement.catch(() => {});
        await flushConnectorSetup();
        const held = platform.connection;
        expect(held).not.toBeNull();
        await cleanup;
        await obsolete;
        await flushConnectorSetup();
        expect(platform.connection).toBe(held);
        expect(fixture.connectors[2]!.signal?.aborted).toBe(false);
        expect(fixture.retry.retryTimers).toEqual({});
        fixture.connectors[2]!.open(); fixture.connectors[2]!.enter();
        await replacement;
        expect(platform.connectionStatus).toBe(true);
    } finally { await fixture.cleanup(); vi.useRealTimers(); }
});

test('orchestrator disconnect retirement cannot clean up an immediately admitted replacement', async () => {
    const fixture = createTikTokLifetimeFixture({ envFileReadEnabled: false, envFileWriteEnabled: false });
    const { platform } = fixture;
    try {
        const first = platform.initialize({});
        await flushConnectorSetup();
        fixture.connectors[0]!.open(); fixture.connectors[0]!.enter();
        await first;
        const disconnecting = platform.connectionOrchestrator.disconnect();
        const replacement = platform.connectionOrchestrator.connect({});
        void replacement.catch(() => {});
        await flushConnectorSetup();
        const held = platform.connection;
        expect(held).not.toBeNull();
        await disconnecting;
        expect(platform.connection).toBe(held);
        expect(fixture.connectors[1]!.signal?.aborted).toBe(false);
        fixture.connectors[1]!.open(); fixture.connectors[1]!.enter();
        await replacement;
        expect(platform.connectionStatus).toBe(true);
    } finally { await fixture.cleanup(); }
});

test('real stream-end publication cannot retire a replacement started by its status observer', async () => {
    const fixture = createTikTokLifetimeFixture({ envFileReadEnabled: false, envFileWriteEnabled: false });
    const { platform } = fixture;
    let replacement: Promise<unknown> | undefined;
    let retirement: Promise<unknown> | undefined;
    try {
        const first = platform.initialize({ onStreamStatus: data => {
            if (!data || typeof data !== 'object' || !('status' in data) || data.status !== 'stream-ended' || replacement) return;
            retirement = platform.cleanup(false);
            replacement = platform.connectionOrchestrator.connect({});
            void replacement.catch(() => {});
        } });
        await flushConnectorSetup();
        fixture.connectors[0]!.open(); fixture.connectors[0]!.enter();
        await first;
        await platform._handleStreamEnd({ code: 4404 });
        await retirement;
        await flushConnectorSetup();
        expect(replacement).toBeDefined();
        expect(platform.connection).not.toBeNull();
        expect(platform.intervalManager.hasInterval('tiktok-stream-reconnect')).toBe(false);
        fixture.connectors[1]!.open(); fixture.connectors[1]!.enter();
        await replacement;
        expect(platform.connectionStatus).toBe(true);
    } finally { await fixture.cleanup(); }
});
