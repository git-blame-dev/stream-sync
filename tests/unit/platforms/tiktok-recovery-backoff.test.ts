import { afterEach, beforeEach, expect, test, vi } from 'bun:test';
import { createTikTokLifetimeFixture, flushConnectorSetup } from '../../helpers/tiktok-connector-fixture';
let fixture: ReturnType<typeof createTikTokLifetimeFixture>;
let elapsed: number;
beforeEach(() => { vi.useFakeTimers(); elapsed = 0; fixture = createTikTokLifetimeFixture({}, () => elapsed); });
afterEach(async () => { await fixture.cleanup(); vi.useRealTimers(); });

test.each([1000, 60000])('confirmed connection lasting %i ms retains or resets accumulated failures', async duration => {
    fixture.retry.incrementRetryCount('tiktok');
    fixture.retry.incrementRetryCount('tiktok');
    const connected = fixture.platform._connect({});
    await flushConnectorSetup();
    fixture.connectors[0]!.open(); fixture.connectors[0]!.enter();
    await connected;
    expect(fixture.retry.getRetryCount('tiktok')).toBe(2);
    elapsed += duration;
    await fixture.platform.handleConnectionIssue({ code: 1011, reason: 'synthetic upstream failure' });
    await flushConnectorSetup();
    expect(fixture.retry.getRetryCount('tiktok')).toBe(duration === 60000 ? 1 : 3);
    expect(fixture.retry.calculateAdaptiveRetryDelay('tiktok')).toBe(2000 * Math.pow(1.3, duration === 60000 ? 1 : 3));
    expect(Object.keys(fixture.retry.retryTimers)).toEqual(['tiktok']);
    // Retry cleanup must preserve the backoff just observed.
    await fixture.platform.cleanup(false);
    expect(fixture.retry.getRetryCount('tiktok')).toBe(duration === 60000 ? 1 : 3);
});

test.each([4400, 4401, 4403])('does not schedule retries for terminal provider code %i', async code => {
    const result = await fixture.platform.handleConnectionIssue({ code, reason: 'synthetic provider failure' });
    expect(result.retryResult).toEqual({ queued: false, reason: 'terminal-error' });
    expect(fixture.retry.getRetryCount('tiktok')).toBe(0);
    expect(fixture.retry.retryTimers).toEqual({});
});

test.each([4400, 4401, 4403])('retains terminal code %i supplied as an Error', code => {
    expect(fixture.platform.handleRetry(Object.assign(new Error('synthetic provider failure'), { code }))).toEqual({ action: 'skipped', reason: 'non-recoverable' });
    expect(fixture.retry.getRetryCount('tiktok')).toBe(0);
    expect(fixture.retry.retryTimers).toEqual({});
});
