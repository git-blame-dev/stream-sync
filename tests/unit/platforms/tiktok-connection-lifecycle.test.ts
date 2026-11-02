import { afterEach, beforeEach, expect, test, vi } from 'bun:test';
import { createTikTokLifetimeFixture, flushConnectorSetup } from '../../helpers/tiktok-connector-fixture';
import { noOpLogger } from '../../helpers/mock-factories';
import { PlatformLifecycleService } from '../../../src/services/PlatformLifecycleService';
import testClock from '../../helpers/test-clock';

type PlatformEvent = { type: string; data: { isLive?: boolean; willReconnect?: boolean; status?: string } };
let fixture: ReturnType<typeof createTikTokLifetimeFixture>;
let events: PlatformEvent[];
let infoRecords: Array<{ message: string; scope?: string }>;
beforeEach(() => {
    vi.useFakeTimers();
    infoRecords = [];
    fixture = createTikTokLifetimeFixture({}, undefined, {
        ...noOpLogger,
        info: (message, scope) => { infoRecords.push({ message: String(message), ...(scope !== undefined ? { scope } : {}) }); },
    });
    events = [];
    fixture.platform.on('platform:event', event => { events.push(event); });
});
afterEach(async () => { await fixture.cleanup(); vi.useRealTimers(); });

test('background initialization reports ready once after room entry and preserves chat delivery', async () => {
    const lifecycle = new PlatformLifecycleService({ logger: fixture.platform.logger });
    lifecycle.platforms.tiktok = fixture.platform;
    await lifecycle.initializePlatformConnection('tiktok', fixture.platform, lifecycle.createDefaultEventHandlers('tiktok'), {});
    const background = lifecycle.backgroundPlatformInits.map(entry => entry.promise);
    await flushConnectorSetup();
    expect(infoRecords).toEqual([]);
    expect(events.filter(event => event.type === 'platform:chat-connected')).toEqual([]);
    fixture.connectors[0]!.open();
    await flushConnectorSetup();
    expect(infoRecords).toEqual([]);
    fixture.connectors[0]!.enter();
    await Promise.all(background);
    expect(fixture.platform.connectionActive).toBe(true);
    expect(lifecycle.platformHealth.tiktok?.state).toBe('ready');
    expect(events.filter(event => event.type === 'platform:chat-connected')).toHaveLength(1);
    expect(infoRecords).toHaveLength(1);
    expect(infoRecords[0]!.scope).toBe('tiktok');
    expect(infoRecords[0]!.message).not.toContain('synthetic-streamer');
    await fixture.platform.handleConnectionSuccess();
    expect(infoRecords).toHaveLength(1);
    expect(events.filter(event => event.type === 'platform:chat-connected')).toHaveLength(1);
    fixture.connectors[0]!.emit('chat', {
        user: { uniqueId: 'synthetic-viewer', userId: '9000000000000000002', nickname: 'Synthetic Viewer' },
        comment: 'synthetic message',
        createTime: testClock.now() / 1000,
    });
    await flushConnectorSetup();
    expect(events.filter(event => event.type === 'platform:chat-message')).toHaveLength(1);
});

test('offline initialization reports monitoring and announces readiness only on recovery', async () => {
    const lifecycle = new PlatformLifecycleService({ logger: fixture.platform.logger });
    lifecycle.platforms.tiktok = fixture.platform;
    await lifecycle.initializePlatformConnection('tiktok', fixture.platform, lifecycle.createDefaultEventHandlers('tiktok'), {});
    const background = lifecycle.backgroundPlatformInits.map(entry => entry.promise);
    await flushConnectorSetup();
    fixture.connectors[0]!.fail(Object.assign(new Error('Synthetic stream not live'), { code: 4404 }));
    await Promise.all(background);
    expect(fixture.platform.connectionActive).toBe(false);
    expect(lifecycle.platformHealth.tiktok?.state).toBe('monitoring');
    expect(fixture.platform.initializationStats.getStatistics().successfulAttempts).toBe(1);
    expect(events.filter(event => event.type === 'platform:chat-connected')).toEqual([]);
    expect(infoRecords).toHaveLength(1);
    const monitoringRecord = infoRecords[0]!;
    expect(fixture.platform.intervalManager.hasInterval('tiktok-stream-reconnect')).toBe(true);

    const reconnecting = fixture.platform._connect({});
    await flushConnectorSetup();
    fixture.connectors[1]!.open();
    fixture.connectors[1]!.enter();
    await reconnecting;
    expect(fixture.platform.connectionActive).toBe(true);
    expect(fixture.platform.intervalManager.hasInterval('tiktok-stream-reconnect')).toBe(false);
    expect(events.filter(event => event.type === 'platform:chat-connected')).toHaveLength(1);
    expect(infoRecords).toHaveLength(2);
    expect(infoRecords[1]).not.toEqual(monitoringRecord);
    await fixture.platform.handleConnectionSuccess();
    expect(infoRecords).toHaveLength(2);
});

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
    expect(statuses).toHaveLength(1);
    expect(statuses.every(event => event.data.status === 'stream-ended')).toBe(true);
    expect(statuses.every(event => event.data.isLive === false)).toBe(true);
    expect(fixture.retry.getRetryCount('tiktok')).toBe(0);
});
