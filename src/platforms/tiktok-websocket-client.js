
const { EventEmitter } = require('events');
const { safeSetTimeout, safeSetInterval } = require('../utils/timeout-validator');

class TikTokWebSocketClient extends EventEmitter {
    constructor(username, options = {}) {
        super();
        this.username = username;
        this.apiKey = options.apiKey || null;
        this.WebSocketCtor = options.WebSocketCtor || require('ws');

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

    async connect() {
        if (this.isConnecting) {
            throw new Error('Connection already in progress');
        }
        if (this.isConnected) {
            return { roomId: this.roomId };
        }
        this.isConnecting = true;
        this.stats.connectTime = Date.now();

        return new Promise((resolve, reject) => {
            try {
                const params = new URLSearchParams({ uniqueId: this.username });
                if (this.apiKey) {
                    params.append('apiKey', this.apiKey);
                }
                const wsUrl = `${this.wsUrl}?${params.toString()}`;

                this.ws = new this.WebSocketCtor(wsUrl, {
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
                        const payload = JSON.parse(data.toString());
                        if (payload.messages && Array.isArray(payload.messages)) {
                            payload.messages.forEach((msg) => {
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
                    } catch (error) {
                        this.emit('error', new Error(`Failed to parse message: ${error.message}`));
                    }
                });

                this.ws.on('close', (code, reason) => {
                    this.isConnected = false;
                    this.isConnecting = false;
                    this.stopPingInterval();

                    const reasonStr = reason?.toString() || 'No reason provided';
                    this.emit('disconnected', { code, reason: reasonStr });

                    if (code === 4429) {
                        this.emit('error', new Error('Connection limit exceeded (10 concurrent connections)'));
                        this.autoReconnect = false;
                    } else if (code === 4404) {
                        this.emit('streamEnd', { reason: 'User is not live' });
                        this.autoReconnect = false;
                    } else if (code === 4401) {
                        this.emit('error', new Error('Invalid configuration'));
                        this.autoReconnect = false;
                    }

                    if (this.autoReconnect && code !== 1000 && code !== 4401 && code !== 4429
                        && this.reconnectAttempts < this.maxReconnectAttempts) {
                        this.scheduleReconnect();
                    }

                    if (!connectResolved) {
                        connectResolved = true;
                        reject(new Error(`Connection closed: ${this.getCloseReason(code)}`));
                    }
                });

                this.ws.on('error', (error) => {
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
            } catch (error) {
                this.isConnecting = false;
                reject(error);
            }
        });
    }

    handleEvent(message, connectCallback) {
        const eventType = message.type;
        const eventData = message.data || message;

        if (eventType === 'connected' || eventType === 'roomInfo') {
            const roomId = eventData.roomInfo?.id ||
                eventData.roomId ||
                'unknown';

            const roomInfo = {
                roomId,
                isLive: eventData.roomInfo?.isLive,
                status: eventData.roomInfo?.status
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
                if (eventData?.actionType === 'follow'
                    || eventData?.displayType === 'follow'
                    || (eventData?.displayText?.defaultPattern || '').toLowerCase().includes('follow')) {
                    this.emit('follow', eventData);
                }
                break;
            case 'follow':
            case 'share':
                this.emit(eventType, eventData);
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
                this.emit(eventType, eventData);
                break;
            case 'liveIntro':
            case 'WebcastLiveIntroMessage':
                this.emit('liveIntro', eventData);
                break;
            case 'error':
                this.emit('error', new Error(eventData.message || 'Unknown error'));
                break;
            default:
                this.emit(eventType, eventData);
                this.emit('rawData', { type: eventType, data: eventData });
        }
    }

    getCloseReason(code) {
        const reasons = {
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

    scheduleReconnect() {
        this.reconnectAttempts++;
        this.stats.reconnectCount++;
        const delay = this.reconnectDelay * Math.min(this.reconnectAttempts, 5);

        this.emit('reconnecting', {
            attempt: this.reconnectAttempts,
            maxAttempts: this.maxReconnectAttempts,
            delay
        });

        safeSetTimeout(() => {
            this.connect().catch((error) => {
                this.emit('error', new Error(`Reconnect attempt ${this.reconnectAttempts} failed: ${error.message}`));
            });
        }, delay);
    }

    startPingInterval() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
        }
        this.pingInterval = safeSetInterval(() => {
            if (this.ws && this.ws.readyState === this.WebSocketCtor.OPEN) {
                this.ws.ping();
            }
        }, this.pingIntervalMs);
    }

    stopPingInterval() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }
    }

    disconnect(reconnect = false) {
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

    async getRoomInfo() {
        if (this.roomId) {
            return { roomId: this.roomId };
        }
        throw new Error('Not connected - room info not available');
    }

    async fetchIsLive() {
        return this.isConnected;
    }
}

module.exports = { TikTokWebSocketClient };
