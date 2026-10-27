import { EventEmitter } from 'node:events';
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
