const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { EventEmitter } = require('events');
const { useFakeTimers, useRealTimers, advanceTimersByTime } = require('../../helpers/bun-timers');

class MockWebSocket extends EventEmitter {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor() {
        super();
        this.readyState = MockWebSocket.OPEN;
    }

    ping() {}

    close(code = 1000, reason = '') {
        this.readyState = MockWebSocket.CLOSED;
        this.emit('close', code, reason);
    }
}

describe('TikTokWebSocketClient (behavior)', () => {
    let TikTokWebSocketClient;
    let mockWs;
    let client;

    beforeEach(() => {
        useFakeTimers();
        ({ TikTokWebSocketClient } = require('../../../src/platforms/tiktok-websocket-client'));
        mockWs = null;
        const CapturingWebSocket = class extends MockWebSocket {
            constructor(...args) {
                super(...args);
                mockWs = this;
            }
        };
        client = new TikTokWebSocketClient('testuser123', { WebSocketCtor: CapturingWebSocket });
    });

    afterEach(() => {
        useRealTimers();
        if (client && client.disconnect) {
            client.disconnect();
        }
    });

    test('resolves connect and emits room info and chat from batched messages', async () => {
        const chatEvents = [];
        client.on('chat', (data) => chatEvents.push(data));

        const connectPromise = client.connect();
        mockWs.emit('open');

        const payload = {
            messages: [
                { type: 'roomInfo', data: { roomInfo: { id: 'room123', isLive: true, status: 2 } } },
                { type: 'chat', data: { comment: 'hello world', user: { userId: 'user123-id', uniqueId: 'user123' } } }
            ]
        };
        mockWs.emit('message', Buffer.from(JSON.stringify(payload)));

        const roomInfo = await connectPromise;
        expect(roomInfo.roomId).toBe('room123');
        expect(chatEvents).toHaveLength(1);
        expect(chatEvents[0].comment).toBe('hello world');
    });

    test('emits gift events with repeat and group data', async () => {
        const gifts = [];
        client.on('gift', (data) => gifts.push(data));

        const connectPromise = client.connect();
        mockWs.emit('open');

        const payload = {
            messages: [
                { type: 'roomInfo', data: { roomInfo: { id: 'room123', isLive: true, status: 2 } } },
                {
                    type: 'gift',
                    data: {
                        giftDetails: { giftName: 'Rose', diamondCount: 1, giftType: 1 },
                        repeatCount: 3,
                        groupId: 'g123',
                        repeatEnd: 0
                    }
                }
            ]
        };
        mockWs.emit('message', Buffer.from(JSON.stringify(payload)));
        await connectPromise;

        expect(gifts).toHaveLength(1);
        expect(gifts[0].giftDetails.giftName).toBe('Rose');
        expect(gifts[0].repeatCount).toBe(3);
        expect(gifts[0].groupId).toBe('g123');
        expect(gifts[0].repeatEnd).toBe(0);
    });

    test('emits streamEnd on close code 4404 and rejects connect', async () => {
        const streamEndEvents = [];
        client.on('streamEnd', (data) => streamEndEvents.push(data));

        const connectPromise = client.connect();
        mockWs.emit('open');
        mockWs.emit('close', 4404, 'offline');

        await expect(connectPromise).rejects.toBeInstanceOf(Error);
        expect(streamEndEvents).toHaveLength(1);
        expect(streamEndEvents[0].reason).toBe('User is not live');
    });

    test('rejects connect when no room info arrives before timeout', async () => {
        const connectPromise = client.connect();
        mockWs.emit('open');

        advanceTimersByTime(16000);

        await expect(connectPromise).rejects.toThrow(/timeout/i);
    });
});
