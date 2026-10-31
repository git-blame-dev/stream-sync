import { EventEmitter } from 'node:events';
import { PlatformLifecycleService } from '../../src/services/PlatformLifecycleService';
import { TikTokPlatform } from '../../src/platforms/tiktok';
import { TikTokWebSocketClient } from '../../src/platforms/tiktok-websocket-client';
import { noOpLogger } from '../helpers/mock-factories';

export function createHeldTikTokLifecycle() {
    let entered!: () => void;
    const connecting = new Promise<void>(resolve => { entered = resolve; });
    const counters = { initialized: 0, cleanups: 0, retries: 0 };
    class HeldConnector extends EventEmitter {
        isConnected = false;
        roomId = '9000000000000000001';
        terminated = 0;
        disconnects = 0;
        signal: AbortSignal | undefined;
        wsClient = { terminate: () => { this.terminated++; } };
        connect() { entered(); return new Promise<void>(() => {}); }
        async disconnect() { this.disconnects++; }
    }
    const connector = new HeldConnector();
    const client = new TikTokWebSocketClient('synthetic-streamer', {
        connectorFactory: async (_name, _key, signal) => { connector.signal = signal; return connector; }
    });
    const platform = new TikTokPlatform({ enabled: true, username: 'synthetic-streamer', dataLoggingEnabled: false }, {
        logger: noOpLogger,
        TikTokWebSocketClient,
        connectionFactory: { createConnection: () => client }
    });
    const retrySystem = platform.retrySystem;
    if (!retrySystem) throw new Error('Synthetic fixture requires the real retry owner');
    const handleConnectionError = retrySystem.handleConnectionError.bind(retrySystem);
    retrySystem.handleConnectionError = (...args) => {
        counters.retries++;
        return handleConnectionError(...args);
    };
    const initialize = platform.initialize.bind(platform);
    platform.initialize = (...args) => { counters.initialized++; return initialize(...args); };
    const cleanup = platform.cleanup.bind(platform);
    platform.cleanup = async () => { counters.cleanups++; await cleanup(); };
    const lifecycle = new PlatformLifecycleService({ config: { tiktok: { enabled: true } }, logger: noOpLogger });
    // Construction returns the real platform so lifecycle owns its actual initialization and cleanup.
    const Platform = class { constructor() { return platform; } } as unknown as Parameters<typeof lifecycle.initializePlatform>[1];
    return { lifecycle, platform, client, connector, counters, connecting, Platform };
}
