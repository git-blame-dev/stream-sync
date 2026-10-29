import { afterEach, beforeEach, expect, test, vi } from 'bun:test';
import { createTikTokLifetimeFixture, flushConnectorSetup } from '../../helpers/tiktok-connector-fixture';
let fixture: ReturnType<typeof createTikTokLifetimeFixture>;
beforeEach(() => { vi.useFakeTimers(); fixture = createTikTokLifetimeFixture(); });
afterEach(async () => { await fixture.cleanup(); vi.useRealTimers(); });

test('keeps initialization recovering with one real retry owner after acquisition failure', async () => {
    const pending = fixture.platform.initialize(fixture.platform.handlers);
    await flushConnectorSetup();
    fixture.connectors[0]!.fail(new Error('synthetic connection failure'));
    await expect(pending).resolves.toMatchObject({ state: 'recovering', error: expect.objectContaining({ code: 1011 }) });
    await flushConnectorSetup();
    expect(fixture.retry.getRetryCount('tiktok')).toBe(1);
    expect(Object.keys(fixture.retry.retryTimers)).toEqual(['tiktok']);
    expect(fixture.platform.connectionActive).toBe(false);
});

test('reports monitoring when upstream offline failure enters deferred polling', async () => {
    const pending = fixture.platform.initialize(fixture.platform.handlers);
    await flushConnectorSetup();
    fixture.connectors[0]!.fail(Object.assign(new Error('synthetic offline'), { code: 4404 }));
    await expect(pending).resolves.toEqual({ state: 'monitoring' });
    expect(fixture.retry.getRetryCount('tiktok')).toBe(0);
    expect(fixture.retry.retryTimers).toEqual({});
    expect(fixture.platform.intervalManager.hasInterval('tiktok-stream-reconnect')).toBe(true);
    expect(fixture.platform.connectionActive).toBe(false);
});
