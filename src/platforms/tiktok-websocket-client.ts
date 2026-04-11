import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { safeSetTimeout, safeSetInterval } from '../utils/timeout-validator';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';

const nodeRequire = createRequire(__filename);
const defaultWebSocketCtor = nodeRequire('ws');

type UnknownRecord = Record<string, unknown>;

type RoomInfo = {
    roomId: string | null;
    isLive?: unknown;
    status?: unknown;
};

type TikTokWebSocketClientOptions = {
    apiKey?: string | null;
    logger?: unknown;
    WebSocketCtor?: new (url: string, options?: unknown) => {
        on: (eventName: string, handler: (...args: unknown[]) => void) => void;
        ping: () => void;
        close: (code?: number, reason?: string) => void;
        readyState: number;
    };
};

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

class TikTokWebSocketClient extends EventEmitter {
    username: string;
    apiKey: string | null;
    logger: unknown;
    errorHandler: ReturnType<typeof createPlatformErrorHandler>;
    WebSocketCtor: new (url: string, options?: unknown) => {
        on: (eventName: string, handler: (...args: unknown[]) => void) => void;
        ping: () => void;
        close: (code?: number, reason?: string) => void;
        readyState: number;
    };
    ws: {
        on: (eventName: string, handler: (...args: unknown[]) => void) => void;
        ping: () => void;
        close: (code?: number, reason?: string) => void;
        readyState: number;
    } | null;
    isConnecting: boolean;
    isConnected: boolean;
    roomId: string | null;
    reconnectAttempts: number;
    maxReconnectAttempts: number;
    reconnectDelay: number;
    autoReconnect: boolean;
    wsUrl: string;
    pingInterval: ReturnType<typeof setInterval> | null;
    pingIntervalMs: number;
    stats: {
        connectTime: number | null;
        messageCount: number;
        reconnectCount: number;
        lastMessageTime: number | null;
    };

    constructor(username: string, options: TikTokWebSocketClientOptions = {}) {
        super();
        this.username = username;
        this.apiKey = options.apiKey || null;
        this.logger = options.logger || null;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'tiktok-websocket');
        this.WebSocketCtor = options.WebSocketCtor || defaultWebSocketCtor;

        this.ws = null;
        this.isConnecting = false;
        this.isConnected = false;
        this.roomId = null;

        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 3000;
        this.autoReconnect = true;

        this.wsUrl = 'wss://ws.eulerstream.com';
        this.pingInterval = null;
        this.pingIntervalMs = 30000;

        this.stats = {
            connectTime: null,
            messageCount: 0,
            reconnectCount: 0,
            lastMessageTime: null
        };
    }

    async connect(): Promise<RoomInfo> {
        if (this.isConnecting) {
            throw new Error('Connection already in progress');
        }
        if (this.isConnected) {
            return { roomId: this.roomId };
        }
        this.isConnecting = true;
        this.stats.connectTime = Date.now();

        return new Promise<RoomInfo>((resolve, reject) => {
            try {
                const params = new URLSearchParams({ uniqueId: this.username });
                if (this.apiKey) {
                    params.append('apiKey', this.apiKey);
                }
                const wsUrl = `${this.wsUrl}?${params.toString()}`;

                const SocketCtor = this.WebSocketCtor;
                this.ws = new SocketCtor(wsUrl, {
                    handshakeTimeout: 15000,
                    perMessageDeflate: false
                });

                let connectResolved = false;

                this.ws.on('open', () => {
                    this.isConnecting = false;
                    this.isConnected = true;
                    this.reconnectAttempts = 0;
                    this.startPingInterval();
                });

                this.ws.on('message', (data) => {
                    this.stats.messageCount++;
                    this.stats.lastMessageTime = Date.now();
                    try {
                        const payload = JSON.parse(String(data));
                        if (payload.messages && Array.isArray(payload.messages)) {
                            payload.messages.forEach((msg: unknown) => {
                                this.handleEvent(msg, (roomInfo) => {
                                    if (!connectResolved && roomInfo) {
                                        connectResolved = true;
                                        this.roomId = roomInfo.roomId;
                                        resolve(roomInfo);
                                    }
                                });
                            });
                        } else {
                            this.handleEvent(payload, (roomInfo) => {
                                if (!connectResolved && roomInfo) {
                                    connectResolved = true;
                                    this.roomId = roomInfo.roomId;
                                    resolve(roomInfo);
                                }
                            });
                        }
                    } catch (error: unknown) {
                        const parseError = new Error(`Failed to parse message: ${getErrorMessage(error)}`);
                        this._handleClientError('Failed to parse WebSocket message', parseError, 'message-parse');
                        this.emit('error', parseError);
                    }
                });

                this.ws.on('close', (code, reason) => {
                    this.isConnected = false;
                    this.isConnecting = false;
                    this.stopPingInterval();

                    const reasonStr = reason?.toString() || 'No reason provided';
                    this.emit('disconnected', { code, reason: reasonStr });

                    if (code === 4429) {
                        const limitError = new Error('Connection limit exceeded (10 concurrent connections)');
                        this._handleClientError('TikTok connection limit exceeded', limitError, 'connection');
                        this.emit('error', limitError);
                        this.autoReconnect = false;
                    } else if (code === 4404) {
                        this.emit('streamEnd', { reason: 'User is not live' });
                        this.autoReconnect = false;
                    } else if (code === 4401) {
                        const configError = new Error('Invalid configuration');
                        this._handleClientError('TikTok invalid configuration', configError, 'connection');
                        this.emit('error', configError);
                        this.autoReconnect = false;
                    }

                    if (this.autoReconnect && code !== 1000 && code !== 4401 && code !== 4429
                        && this.reconnectAttempts < this.maxReconnectAttempts) {
                        this.scheduleReconnect();
                    }

                    if (!connectResolved) {
                        connectResolved = true;
                        reject(new Error(`Connection closed: ${this.getCloseReason(Number(code))}`));
                    }
                });

                this.ws.on('error', (error: unknown) => {
                    this._handleClientError('TikTok WebSocket error', error, 'connection');
                    this.emit('error', error);
                    if (!connectResolved) {
                        connectResolved = true;
                        this.isConnecting = false;
                        reject(error);
                    }
                });

                safeSetTimeout(() => {
                    if (!connectResolved) {
                        connectResolved = true;
                        this.isConnecting = false;
                        this.disconnect();
                        reject(new Error('Connection timeout - no room info received within 15 seconds'));
                    }
                }, 15000);
            } catch (error: unknown) {
                this.isConnecting = false;
                reject(error);
            }
        });
    }

    handleEvent(message: unknown, connectCallback?: (roomInfo: RoomInfo) => void): void {
        const safeMessage = (message && typeof message === 'object') ? (message as UnknownRecord) : {};
        const eventType = safeMessage.type;
        const eventData = safeMessage.data || safeMessage;

        if (eventType === 'connected' || eventType === 'roomInfo') {
            const typedEventData = (eventData && typeof eventData === 'object') ? (eventData as UnknownRecord) : {};
            const roomInfoData = (typedEventData.roomInfo && typeof typedEventData.roomInfo === 'object')
                ? (typedEventData.roomInfo as UnknownRecord)
                : null;
            const roomId = roomInfoData?.id ||
                typedEventData.roomId ||
                'unknown';

            const roomInfo: RoomInfo = {
                roomId: String(roomId),
                isLive: roomInfoData?.isLive,
                status: roomInfoData?.status
            };

            if (connectCallback) {
                connectCallback(roomInfo);
            }
            this.emit('connected', roomInfo);
            return;
        }

        if (eventType === 'workerInfo') {
            return;
        }

        switch (eventType) {
            case 'chat':
            case 'WebcastChatMessage':
                this.emit('chat', eventData);
                break;
            case 'gift':
            case 'WebcastGiftMessage':
                this.emit('gift', eventData);
                break;
            case 'member':
            case 'join':
            case 'WebcastMemberMessage':
                this.emit('member', eventData);
                break;
            case 'like':
            case 'WebcastLikeMessage':
                this.emit('like', eventData);
                break;
            case 'social':
            case 'WebcastSocialMessage':
                this.emit('social', eventData);
                const socialEventData = (eventData && typeof eventData === 'object') ? (eventData as UnknownRecord) : {};
                const displayText = (socialEventData.displayText && typeof socialEventData.displayText === 'object')
                    ? (socialEventData.displayText as UnknownRecord)
                    : {};
                if (socialEventData.actionType === 'follow'
                    || socialEventData.displayType === 'follow'
                    || String(displayText.defaultPattern || '').toLowerCase().includes('follow')) {
                    this.emit('follow', eventData);
                }
                break;
            case 'follow':
            case 'share':
                this.emit(String(eventType), eventData);
                break;
            case 'roomUser':
            case 'viewerCount':
            case 'viewer_count':
            case 'WebcastRoomUserSeqMessage':
                this.emit('roomUser', eventData);
                break;
            case 'subscribe':
                this.emit('subscribe', eventData);
                break;
            case 'emote':
                this.emit('emote', eventData);
                break;
            case 'envelope':
                this.emit('envelope', eventData);
                break;
            case 'questionNew':
                this.emit('questionNew', eventData);
                break;
            case 'linkMicBattle':
            case 'linkMicArmies':
                this.emit(String(eventType), eventData);
                break;
            case 'liveIntro':
            case 'WebcastLiveIntroMessage':
                this.emit('liveIntro', eventData);
                break;
            case 'error':
                this.emit('error', new Error(String((eventData as UnknownRecord)?.message || 'Unknown error')));
                break;
            default:
                this.emit(String(eventType), eventData);
                this.emit('rawData', { type: String(eventType), data: eventData });
        }
    }

    getCloseReason(code: number): string {
        const reasons: Record<number, string> = {
            1000: 'Normal closure',
            1001: 'Going away',
            1006: 'Abnormal closure',
            1011: 'Internal server error',
            4005: 'TikTok stream ended',
            4006: 'No messages timeout (inactivity)',
            4401: 'Invalid options provided',
            4404: 'User is not live',
            4429: 'Too many connections (exceeded 10 limit)',
            4500: 'TikTok closed connection unexpectedly'
        };
        return reasons[code] || `Unknown close code: ${code}`;
    }

    scheduleReconnect(): void {
        this.reconnectAttempts++;
        this.stats.reconnectCount++;
        const delay = this.reconnectDelay * Math.min(this.reconnectAttempts, 5);

        this.emit('reconnecting', {
            attempt: this.reconnectAttempts,
            maxAttempts: this.maxReconnectAttempts,
            delay
        });

        safeSetTimeout(() => {
            this.connect().catch((error: unknown) => {
                const reconnectError = new Error(`Reconnect attempt ${this.reconnectAttempts} failed: ${getErrorMessage(error)}`);
                this._handleClientError(`TikTok reconnect attempt ${this.reconnectAttempts} failed`, reconnectError, 'connection');
                this.emit('error', reconnectError);
            });
        }, delay);
    }

    startPingInterval(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
        }
        this.pingInterval = safeSetInterval(() => {
            const openState = (this.WebSocketCtor as unknown as { OPEN?: number }).OPEN ?? 1;
            if (this.ws && this.ws.readyState === openState) {
                this.ws.ping();
            }
        }, this.pingIntervalMs);
    }

    stopPingInterval(): void {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    disconnect(reconnect = false): void {
        this.autoReconnect = reconnect;
        if (this.ws) {
            this.stopPingInterval();
            this.ws.close(1000, 'Intentional disconnect');
            this.ws = null;
        }
        this.isConnected = false;
        this.isConnecting = false;
    }

    getState() {
        return {
            isConnected: this.isConnected,
            isConnecting: this.isConnecting,
            roomId: this.roomId,
            reconnectAttempts: this.reconnectAttempts,
            stats: { ...this.stats }
        };
    }

    async getRoomInfo(): Promise<{ roomId: string }> {
        if (this.roomId) {
            return { roomId: this.roomId };
        }
        throw new Error('Not connected - room info not available');
    }

    async fetchIsLive(): Promise<boolean> {
        return this.isConnected;
    }

    _handleClientError(message: string, error: unknown, context: string): void {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleConnectionError(error, context, message);
        } else {
            this.errorHandler?.logOperationalError(message, 'tiktok-websocket', error);
        }
    }
}

export { TikTokWebSocketClient };
