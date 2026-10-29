import { afterEach, beforeEach, expect, test, vi } from 'bun:test';
import { PlatformLifecycleService } from '../../../src/services/PlatformLifecycleService';
import { noOpLogger } from '../../helpers/mock-factories';
import { createTikTokLifetimeFixture, flushConnectorSetup } from '../../helpers/tiktok-connector-fixture';
let fixture: ReturnType<typeof createTikTokLifetimeFixture>;
beforeEach(() => { vi.useFakeTimers(); fixture = createTikTokLifetimeFixture(); });
afterEach(async () => { await fixture.cleanup(); vi.useRealTimers(); });

test.each([
    { label: 'recoverable startup', code: 1011, initialize: false, cancel: false, expected: 1 },
    { label: 'terminal authentication', code: 4401, initialize: false, cancel: false, expected: 0 },
    { label: 'terminal permissions', code: 4403, initialize: false, cancel: false, expected: 0 },
    { label: 'intentional shutdown', code: 1000, initialize: false, cancel: true, expected: 0 },
    { label: 'registered startup recovery', code: 1011, initialize: true, cancel: false, expected: 1 },
])('$label retains exactly one retry owner', async ({ code, initialize, cancel, expected }) => {
    const { platform, retry, connectors } = fixture;
    const lifecycle = new PlatformLifecycleService({ logger: noOpLogger });
    lifecycle.platforms.tiktok = platform;
    const pending = initialize
        ? lifecycle.initializePlatformConnection('tiktok', platform, lifecycle.resolveEventHandlers('tiktok', null), { enabled: true })
        : platform._connect({});
    const result = pending.then(() => null, error => error);
    try {
        await flushConnectorSetup();
        expect(connectors).toHaveLength(1);
        expect(platform.connectionActive).toBe(false);
        if (cancel) await platform.cleanup();
        else connectors[0]!.fail(Object.assign(new Error('synthetic failure'), { code }));
        await result;
        await flushConnectorSetup();
        if (initialize) {
            await lifecycle.backgroundPlatformInits[0]?.promise;
            expect(lifecycle.getPlatform('tiktok')).toBe(platform);
            expect(lifecycle.getStatus().recoveringPlatforms).toEqual([expect.objectContaining({ name: 'tiktok' })]);
        }
        expect(retry.getRetryCount('tiktok')).toBe(expected);
        expect(Object.keys(retry.retryTimers)).toEqual(expected ? ['tiktok'] : []);
        expect(connectors[0]!.signal?.aborted).toBe(true);
    } finally { await fixture.cleanup(); await result; await Promise.all(lifecycle.backgroundPlatformInits.map(entry => entry.promise)); }
});

test.each(['socket-first', 'room-first'])('%s requires both readiness witnesses before publishing connected', async order => {
    const events: string[] = [];
    fixture.platform.on('platform:event', event => { events.push(event.type); });
    const pending = fixture.platform.initialize({});
    await flushConnectorSetup();
    const sdk = fixture.connectors[0]!;
    if (order === 'socket-first') sdk.open(); else sdk.enter();
    await flushConnectorSetup();
    expect(fixture.clients[0]!.isConnected).toBe(false);
    expect(fixture.platform.connectionActive).toBe(false);
    expect(events).not.toContain('platform:chat-connected');
    if (order === 'socket-first') sdk.enter(); else sdk.open();
    await expect(pending).resolves.toEqual({ state: 'ready' });
    expect(fixture.platform.connectionActive).toBe(true);
    expect(fixture.platform.connectionStateManager.getState()).toBe('connected');
    expect(events.filter(type => type === 'platform:chat-connected')).toHaveLength(1);
    expect(fixture.retry.retryTimers).toEqual({});
});
