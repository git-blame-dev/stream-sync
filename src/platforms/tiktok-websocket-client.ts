import { EventEmitter } from 'node:events';
import { safeSetTimeout } from '../utils/timeout-validator';
import { createTikTokConnector } from './tiktok/tiktok-connector';
import { adaptTikTokEvent } from './tiktok/tiktok-event-adapter';
import { TIKTOK_EVENTS, TIKTOK_CONTROL_EVENTS } from './tiktok/events/transport-events';

type Connector = {
    on: (name: string, handler: (...args: unknown[]) => void) => unknown;
    connect: () => Promise<unknown>;
    disconnect: () => Promise<void>;
    isConnected: boolean;
    roomId: string;
    wsClient?: { terminate: () => void } | null;
};
type ConnectorFactory = (username: string, apiKey: string | null, signal: AbortSignal) => Promise<Connector>;
type Options = { apiKey?: string | null; logger?: unknown; autoReconnect?: boolean; connectorFactory?: ConnectorFactory; connectTimeoutMs?: number };
type RoomInfo = { roomId: string };

function connectionError(value: unknown): Error & { code?: number; reason?: string } {
    const error = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const nested = error.exception && typeof error.exception === 'object' ? error.exception as Record<string, unknown> : error;
    const name = String((nested.constructor as { name?: string })?.name ?? nested.name ?? '');
    const httpStatus = (nested.response as { status?: number } | undefined)?.status;
    const code = typeof nested.code === 'number' ? nested.code
        : name === 'UserOfflineError' ? 4404
        : name === 'PremiumFeatureError' || httpStatus === 403 ? 4403
        : httpStatus === 401 ? 4401
        : name === 'SignatureRateLimitError' || httpStatus === 429 ? 4429 : 1011;
    // SDK errors can include signed URLs, HTTP headers and raw protobuf. Never forward their text.
    const reason = code === 4404 ? 'TikTok user is not live'
        : code === 4401 ? 'TikTok signing authentication failed'
        : code === 4403 ? 'TikTok signing permission denied'
        : code === 4429 ? 'TikTok signing rate limit reached' : 'TikTok transport connection failed';
    return Object.assign(new Error(reason), { code, reason });
}

/** The SDK owns the wire protocol; TikTokPlatform owns all retry policy. */
class TikTokWebSocketClient extends EventEmitter {
    isConnecting = false;
    isConnected = false;
    roomId: string | null = null;
    lastConnectionError: Error | null = null;
    private attempt: { connector: Connector | null; abort: AbortController; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> | null } | null = null;
    private readonly connectorFactory: ConnectorFactory;
    private readonly timeoutMs: number;
    readonly stats = { connectTime: null as number | null, messageCount: 0, reconnectCount: 0, lastMessageTime: null as number | null };

    constructor(readonly username: string, readonly options: Options = {}) {
        super();
        this.connectorFactory = options.connectorFactory ?? createTikTokConnector as ConnectorFactory;
        this.timeoutMs = options.connectTimeoutMs ?? 45000;
    }

    async connect(): Promise<RoomInfo> {
        if (this.isConnecting) throw new Error('Connection already in progress');
        if (this.isConnected && this.roomId) return { roomId: this.roomId };
        this.isConnecting = true;
        this.lastConnectionError = null;
        this.stats.connectTime = Date.now();
        return new Promise<RoomInfo>((resolve, reject) => {
            const attempt = { connector: null as Connector | null, abort: new AbortController(), reject, timer: null as ReturnType<typeof setTimeout> | null };
            this.attempt = attempt;
            let socketConnected = false;
            let entered = false;
            const current = () => this.attempt === attempt && !attempt.abort.signal.aborted;
            const fail = (error: Error) => {
                if (!current()) return;
                const wasConnected = this.isConnected;
                this.lastConnectionError = error;
                this.retire(attempt);
                if (wasConnected) this.emit(TIKTOK_CONTROL_EVENTS.DISCONNECTED, { code: (error as { code?: number }).code ?? 1011, reason: error.message });
                else reject(error);
            };
            const ready = () => {
                if (!current() || this.isConnected || !socketConnected || !entered) return;
                const connector = attempt.connector;
                if (!connector?.isConnected || !connector.roomId) return;
                this.isConnected = true;
                this.isConnecting = false;
                this.roomId = connector.roomId;
                if (attempt.timer) clearTimeout(attempt.timer);
                attempt.timer = null;
                const room = { roomId: this.roomId };
                resolve(room);
                this.emit(TIKTOK_CONTROL_EVENTS.CONNECTED, room);
            };
            attempt.timer = safeSetTimeout(() => fail(Object.assign(new Error('TikTok room entry timed out'), { code: 1011 })), this.timeoutMs);
            void this.connectorFactory(this.username, this.options.apiKey ?? null, attempt.abort.signal).then(connector => {
                if (!current()) { this.closeConnector(connector); return; }
                attempt.connector = connector;
                connector.on('error', error => fail(connectionError(error)));
                connector.on('disconnected', data => fail(connectionError(data)));
                connector.on('enterRoom', () => { entered = true; ready(); });
                connector.on('streamEnd', () => {
                    if (!current()) return;
                    const wasConnected = this.isConnected;
                    fail(Object.assign(new Error('TikTok stream ended'), { code: 4404 }));
                    if (wasConnected) this.emit(TIKTOK_EVENTS.STREAM_END, { reason: 'TikTok stream ended' });
                });
                const events: Record<string, string> = {
                    chat: TIKTOK_EVENTS.CHAT,
                    emote: TIKTOK_EVENTS.CHAT,
                    gift: TIKTOK_EVENTS.GIFT,
                    follow: TIKTOK_EVENTS.FOLLOW,
                    share: TIKTOK_EVENTS.SHARE,
                    social: TIKTOK_EVENTS.SOCIAL,
                    roomUser: TIKTOK_EVENTS.ROOM_USER,
                    member: TIKTOK_EVENTS.MEMBER,
                    like: TIKTOK_EVENTS.LIKE,
                    envelope: TIKTOK_EVENTS.ENVELOPE,
                    subNotify: TIKTOK_EVENTS.SUBSCRIBE,
                    superFan: TIKTOK_EVENTS.SUPER_FAN
                };
                for (const [source, target] of Object.entries(events)) connector.on(source, data => {
                    if (!current() || !this.isConnected) return;
                    this.stats.messageCount++;
                    this.stats.lastMessageTime = Date.now();
                    this.emit(target, adaptTikTokEvent(target, data));
                });
                void connector.connect().then(() => {
                    if (!current()) { this.closeConnector(connector); return; }
                    socketConnected = true;
                    ready();
                }, error => {
                    if (!current()) { this.closeConnector(connector); return; }
                    fail(connectionError(error));
                });
            }, error => fail(connectionError(error)));
        });
    }

    private closeConnector(connector: Connector) {
        // SDK disconnect() alone does not close a socket while its HTTP/handshake is pending.
        connector.wsClient?.terminate();
        void connector.disconnect().catch(() => {});
    }

    private retire(attempt: NonNullable<TikTokWebSocketClient['attempt']>) {
        if (attempt.timer) clearTimeout(attempt.timer);
        attempt.abort.abort();
        this.attempt = null;
        this.isConnected = false;
        this.isConnecting = false;
        this.roomId = null;
        if (attempt.connector) this.closeConnector(attempt.connector);
    }

    disconnect(): void {
        const attempt = this.attempt;
        if (!attempt) return;
        this.retire(attempt);
        attempt.reject(Object.assign(new Error('Connection cancelled'), { code: 1000 }));
    }

    getState() { return { isConnected: this.isConnected, isConnecting: this.isConnecting, roomId: this.roomId, stats: { ...this.stats } }; }
    async getRoomInfo(): Promise<RoomInfo> {
        if (!this.roomId) throw new Error('Not connected - room info not available');
        return { roomId: this.roomId };
    }
    async fetchIsLive(): Promise<boolean> { return this.isConnected; }
}

export { TikTokWebSocketClient };
export type { Connector, ConnectorFactory };
