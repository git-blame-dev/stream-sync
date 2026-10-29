import { afterEach, beforeEach, expect, test, vi } from 'bun:test';
import { createTikTokLifetimeFixture, flushConnectorSetup } from '../../helpers/tiktok-connector-fixture';
let fixture: ReturnType<typeof createTikTokLifetimeFixture>;
beforeEach(() => { vi.useFakeTimers(); fixture = createTikTokLifetimeFixture(); });
afterEach(async () => { await fixture.cleanup(); vi.useRealTimers(); });

async function admitRetry() {
    const delay = fixture.retry.calculateAdaptiveRetryDelay('tiktok');
    await flushConnectorSetup();
    expect(Object.keys(fixture.retry.retryTimers)).toEqual(['tiktok']);
    vi.advanceTimersByTime(delay - 1);
    await flushConnectorSetup();
    const previous = fixture.connectors.length;
    vi.advanceTimersByTime(1);
    await flushConnectorSetup();
    expect(fixture.connectors).toHaveLength(previous + 1);
    return fixture.connectors.at(-1)!;
}

test('only schedules one retry before a reconnect starts and then recovers', async () => {
    expect(fixture.platform.queueRetry(new Error('synthetic first'))).toEqual({ queued: true });
    expect(fixture.platform.queueRetry(new Error('synthetic duplicate'))).toEqual({ queued: false, reason: 'locked' });
    expect(fixture.retry.getRetryCount('tiktok')).toBe(1);
    const sdk = await admitRetry();
    const pending = fixture.platform.connectingPromise;
    sdk.open(); sdk.enter();
    await pending;
    expect(fixture.platform.connectionActive).toBe(true);
    expect(fixture.clients).toHaveLength(1);
    expect(fixture.retry.retryTimers).toEqual({});
    expect(fixture.platform.retryLock).toBe(false);
});

test('requeues one retry after retry-owned cleanup and failed replacement, then succeeds', async () => {
    const connecting = fixture.platform._connect({});
    await flushConnectorSetup();
    fixture.connectors[0]!.open(); fixture.connectors[0]!.enter();
    await connecting;
    await fixture.platform.handleConnectionIssue({ code: 1011, reason: 'synthetic initial drop' });
    expect(fixture.connectors[0]!.signal?.aborted).toBe(true);
    expect(fixture.retry.getRetryCount('tiktok')).toBe(1);
    const failed = await admitRetry();
    const pending = fixture.platform.connectingPromise?.catch(error => error);
    failed.fail(new Error('synthetic replacement failure'));
    await pending;
    await flushConnectorSetup();
    expect(fixture.retry.getRetryCount('tiktok')).toBe(2);
    expect(failed.signal?.aborted).toBe(true);
    const recovered = await admitRetry();
    const recovery = fixture.platform.connectingPromise;
    recovered.open(); recovered.enter();
    await recovery;
    expect(fixture.platform.connectionActive).toBe(true);
    expect<unknown>(fixture.platform.connection).toBe(fixture.clients[2]!);
    expect(fixture.retry.retryTimers).toEqual({});
});

test.each([false, true])('lifecycle cleanup cancels recovery with in-flight acquisition=%s', async inFlight => {
    fixture.platform.queueRetry(new Error('synthetic temporary failure'));
    await flushConnectorSetup();
    let pending: Promise<unknown> | undefined;
    if (inFlight) {
        await admitRetry();
        pending = fixture.platform.connectingPromise?.catch(error => error);
    }
    await fixture.platform.cleanup();
    await pending;
    expect(fixture.retry.retryTimers).toEqual({});
    expect(fixture.retry.getRetryCount('tiktok')).toBe(0);
    const attempts = fixture.connectors.length;
    vi.advanceTimersByTime(60000);
    await flushConnectorSetup();
    expect(fixture.connectors).toHaveLength(attempts);
    expect(fixture.platform.connection).toBeNull();
    expect(fixture.platform.retryLock).toBe(false);
    if (inFlight) {
        fixture.connectors[0]!.open(); fixture.connectors[0]!.enter();
        await flushConnectorSetup();
        expect(fixture.connectors[0]!.signal?.aborted).toBe(true);
        expect(fixture.platform.connectionActive).toBe(false);
    }
});
