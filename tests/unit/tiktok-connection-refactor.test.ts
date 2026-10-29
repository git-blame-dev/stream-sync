import { afterEach, beforeEach, expect, test, vi } from 'bun:test';
import { createTikTokLifetimeFixture, flushConnectorSetup } from '../helpers/tiktok-connector-fixture';
let fixture: ReturnType<typeof createTikTokLifetimeFixture>;
beforeEach(() => { vi.useFakeTimers(); fixture = createTikTokLifetimeFixture(); });
afterEach(async () => { await fixture.cleanup(); vi.useRealTimers(); });

test('starts with connectionActive false', () => { expect(fixture.platform.connectionActive).toBe(false); });

test('successful room entry marks real state connected and duplicate success preserves connection time', async () => {
    const pending = fixture.platform._connect({});
    await flushConnectorSetup();
    fixture.connectors[0]!.open(); fixture.connectors[0]!.enter();
    await pending;
    expect(fixture.platform.connectionActive).toBe(true);
    expect(fixture.platform.connectionStateManager.isConnected()).toBe(true);
    const time = fixture.platform.connectionTime;
    vi.advanceTimersByTime(1);
    await fixture.platform.handleConnectionSuccess();
    expect(fixture.platform.connectionTime).toBe(time);
});

test('stream end deactivates real connection and publishes terminal once', async () => {
    const pending = fixture.platform._connect({});
    await flushConnectorSetup();
    fixture.connectors[0]!.open(); fixture.connectors[0]!.enter();
    await pending;
    const statuses: unknown[] = [];
    fixture.platform.handlers.onStreamStatus = payload => { statuses.push(payload); };
    await Promise.all([fixture.platform._handleStreamEnd({ code: 4404 }), fixture.platform._handleStreamEnd({ code: 4404 })]);
    expect(fixture.platform.connectionActive).toBe(false);
    expect(fixture.platform.connectionStateManager.isConnected()).toBe(false);
    expect(statuses).toHaveLength(2); // One terminal and one ordinary disconnection status.
});

test('stores the public viewer-count callback by identity', () => {
    const handler = () => {};
    fixture.platform.handlers.onViewerCount = handler;
    expect(fixture.platform.handlers.onViewerCount).toBe(handler);
});
