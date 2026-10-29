import { afterEach, beforeEach, expect, test, vi } from 'bun:test';
import { createTikTokLifetimeFixture, flushConnectorSetup } from '../../helpers/tiktok-connector-fixture';

type PlatformEvent = { type: string; data: { isLive?: boolean; willReconnect?: boolean; status?: string } };
let fixture: ReturnType<typeof createTikTokLifetimeFixture>;
let events: PlatformEvent[];
beforeEach(() => {
    vi.useFakeTimers();
    fixture = createTikTokLifetimeFixture();
    events = [];
    fixture.platform.on('platform:event', event => { events.push(event); });
});
afterEach(async () => { await fixture.cleanup(); vi.useRealTimers(); });

test.each(['handleGift', 'handleFollow', 'handleConnection'])('%s error emits exactly its connection status contract', async operation => {
    await fixture.platform._handleError(new Error('synthetic processing failure'), { operation, recoverable: operation !== 'handleConnection' });
    const statuses = events.filter(event => event.type === 'platform:stream-status');
    if (operation === 'handleConnection') {
        expect(statuses).toHaveLength(1);
        expect(statuses[0]!.data.isLive).toBe(false);
    } else expect(statuses).toEqual([]);
});

test.each([true, false])('enabled=%s publishes both exact willReconnect outcomes', async enabled => {
    // First prove a real upstream connection, then change the public configuration.
    const connecting = fixture.platform._connect({});
    await flushConnectorSetup();
    fixture.connectors[0]!.open(); fixture.connectors[0]!.enter();
    await connecting;
    fixture.platform.config.enabled = enabled;
    events.length = 0;
    await fixture.platform.handleConnectionIssue({ code: 1011, reason: 'synthetic drop' });
    const disconnected = events.filter(event => ['platform:chat-disconnected', 'platform:stream-status'].includes(event.type));
    expect(disconnected.map(event => event.type)).toEqual(['platform:chat-disconnected', 'platform:stream-status']);
    expect(disconnected.map(event => event.data.willReconnect)).toEqual([enabled, enabled]);
    expect(disconnected[1]!.data.isLive).toBe(false);
    await flushConnectorSetup();
    expect(fixture.retry.getRetryCount('tiktok')).toBe(enabled ? 1 : 0);
    expect(!!fixture.retry.retryTimers.tiktok).toBe(enabled);
});

test('concurrent disconnection handlers emit each distinct status once', async () => {
    await Promise.all([
        fixture.platform.handleConnectionIssue({ code: 4404, message: 'Stream not live' }),
        fixture.platform._handleStreamEnd(),
    ]);
    expect(events.filter(event => event.type === 'platform:chat-disconnected')).toHaveLength(1);
    const statuses = events.filter(event => event.type === 'platform:stream-status');
    expect(statuses).toHaveLength(2);
    expect(statuses.filter(event => event.data.status === 'stream-ended')).toHaveLength(1);
    expect(statuses.every(event => event.data.isLive === false)).toBe(true);
    expect(fixture.retry.getRetryCount('tiktok')).toBe(0);
});
