import { afterEach, beforeEach, expect, test } from 'bun:test';
import { TikTokWebSocketClient } from '../../src/platforms/tiktok-websocket-client';
import { createTikTokLifetimeFixture, flushConnectorSetup } from '../helpers/tiktok-connector-fixture';
let fixture: ReturnType<typeof createTikTokLifetimeFixture>;
beforeEach(() => { fixture = createTikTokLifetimeFixture(); });
afterEach(async () => { await fixture.cleanup(); });

test('real state manager and factory begin disconnected with no connection', () => {
    expect(fixture.platform.connectionStateManager).toBeDefined();
    expect(fixture.platform.connectionFactory).toBeDefined();
    expect(fixture.platform.connectionStateManager.getState()).toBe('disconnected');
    expect(fixture.platform.connectionStateManager.isConnected()).toBe(false);
    expect(fixture.platform.connectionStateManager.getConnectionInfo()).toMatchObject({ platform: 'tiktok', state: 'disconnected', hasConnection: false });
});

test('real factory creates a real client with required methods', () => {
    const connection = fixture.createConnection();
    expect(connection).toBeInstanceOf(TikTokWebSocketClient);
    expect(typeof connection.connect).toBe('function');
    expect(typeof connection.disconnect).toBe('function');
});

test('cleanup clears real active connection and state and retires external SDK', async () => {
    const pending = fixture.platform._connect({});
    await flushConnectorSetup();
    fixture.connectors[0]!.open(); fixture.connectors[0]!.enter();
    await pending;
    expect<unknown>(fixture.platform.connection).toBe(fixture.clients[0]!);
    expect(fixture.platform.connectionStateManager.isConnected()).toBe(true);
    await fixture.platform.cleanup();
    expect(fixture.platform.connection).toBeNull();
    expect(fixture.platform.connectionStateManager.getConnectionInfo()).toMatchObject({ state: 'disconnected', hasConnection: false });
    expect(fixture.connectors[0]!.signal?.aborted).toBe(true);
    expect(fixture.connectors[0]!.disconnects).toBeGreaterThan(0);
});
