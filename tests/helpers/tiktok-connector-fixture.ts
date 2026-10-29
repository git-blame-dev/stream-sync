import { EventEmitter } from 'node:events';
import { TikTokPlatform } from '../../src/platforms/tiktok';
import { RetrySystem } from '../../src/utils/retry-system';
import { noOpLogger } from './mock-factories';
import { TikTokWebSocketClient } from '../../src/platforms/tiktok-websocket-client';
import type { Connector } from '../../src/platforms/tiktok-websocket-client';

/** Only the external SDK boundary is simulated; application classes remain real. */
class SyntheticTikTokConnector extends EventEmitter implements Connector {
    isConnected = false;
    roomId = '9000000000000000001';
    terminated = 0;
    disconnects = 0;
    signal: AbortSignal | null = null;
    private resolveConnect: () => void = () => {};
    private rejectConnect: (error: Error) => void = () => {};
    wsClient = { terminate: () => { this.terminated++; this.isConnected = false; } };
    connect() { return new Promise<void>((resolve, reject) => { this.resolveConnect = resolve; this.rejectConnect = reject; }); }
    open() { this.isConnected = true; this.resolveConnect(); }
    enter() { this.emit('enterRoom'); }
    fail(error: Error) { this.rejectConnect(error); }
    async disconnect() { this.disconnects++; this.isConnected = false; }
}
async function flushConnectorSetup() { for (let step = 0; step < 12; step++) await Promise.resolve(); }
export { SyntheticTikTokConnector, flushConnectorSetup };

/** Real application owners; the subclass configures only external SDK acquisition. */
function createTikTokLifetimeFixture(
    config: ConstructorParameters<typeof TikTokPlatform>[0] = {},
    monotonicNow?: () => number,
) {
    const connectors: SyntheticTikTokConnector[] = [];
    const clients: TikTokWebSocketClient[] = [];
    // Public connection-state callback; TikTokPlatform installs its live callback on construction.
    const retry = Object.assign(new RetrySystem({ logger: noOpLogger }), { isConnected: (_platform: string) => false });
    class AcquiredTikTokClient extends TikTokWebSocketClient {
        constructor(username: string, options: ConstructorParameters<typeof TikTokWebSocketClient>[1]) {
            super(username, { ...options, connectorFactory: async (_username, _key, signal) => {
                const connector = new SyntheticTikTokConnector();
                connector.signal = signal;
                connectors.push(connector);
                return connector;
            } });
            clients.push(this);
        }
    }
    const dependencies = {
        logger: noOpLogger,
        TikTokWebSocketClient: AcquiredTikTokClient,
        WebcastEvent: { CHAT: 'chat', GIFT: 'gift', FOLLOW: 'follow', SOCIAL: 'social', ROOM_USER: 'roomUser', ERROR: 'webcast-error', DISCONNECT: 'disconnect', STREAM_END: 'streamEnd' },
        ControlEvent: { CONNECTED: 'connected', DISCONNECTED: 'disconnected', ERROR: 'error' },
        retrySystem: retry,
        ...(monotonicNow ? { monotonicNow } : {}),
    };
    const platform = new TikTokPlatform({ enabled: true, username: 'synthetic-streamer', dataLoggingEnabled: false, ...config }, dependencies);
    return {
        platform, retry, clients, connectors,
        createConnection() {
            // The platform's legacy connection type requires async disconnect; the real
            // client's synchronous disconnect is safely awaited by the production owners.
            return platform.connectionFactory.createConnection('tiktok', platform.config, dependencies) as TikTokWebSocketClient & NonNullable<TikTokPlatform['connection']>;
        },
        async cleanup() {
            const connecting = platform.connectingPromise?.catch(() => {});
            await platform.cleanup();
            retry.dispose();
            for (const client of clients) client.disconnect();
            // Drain cancellation observers and retry-owned cleanup before timer restoration.
            await flushConnectorSetup();
            await connecting;
            await flushConnectorSetup();
            platform.removeAllListeners();
        },
    };
}
export { createTikTokLifetimeFixture };
