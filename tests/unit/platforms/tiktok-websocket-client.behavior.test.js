const { describe, test, expect, afterEach } = require('bun:test');
const { clearAllMocks, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks, resetModules } = require('../helpers/bun-module-mocks');
const { useFakeTimers, useRealTimers, advanceTimersByTime } = require('../helpers/bun-timers');

// Mock ws to avoid real network connections
const mockSockets = [];
mockModule('ws', () => {
    const { EventEmitter } = require('events');
    class WS extends EventEmitter {
        constructor() {
            super();
            this.readyState = 1;
            this.CONNECTING = 0;
            this.OPEN = 1;
            this.CLOSING = 2;
            this.CLOSED = 3;
            mockSockets.push(this);
        }
        ping() {}
        close(code = 1000, reason = '') {
            this.readyState = this.CLOSED;
            this.emit('close', code, reason);
        }
    }
    WS.OPEN = 1;
    WS.CONNECTING = 0;
    WS.CLOSING = 2;
    WS.CLOSED = 3;
    return WS;
});

const WebSocket = require('ws');

describe('TikTokWebSocketClient (behavior)', () => {
    afterEach(() => {
        mockSockets.length = 0;
        clearAllMocks();
        restoreAllMocks();
        restoreAllModuleMocks();
        resetModules();
        useRealTimers();
    });

    test('resolves connect and emits room info and chat from batched messages', async () => {
        useFakeTimers();
        const { TikTokWebSocketClient } = require('../../../src/platforms/tiktok-websocket-client');
        const client = new TikTokWebSocketClient('xenasosieoff', { apiKey: 'test_key' });

        const chatEvents = [];
        client.on('chat', (data) => chatEvents.push(data));

        const connectPromise = client.connect();
        const ws = mockSockets[0];

        ws.emit('open');
        const payload = {
            messages: [
                { type: 'roomInfo', data: { roomInfo: { id: 'room123', isLive: true, status: 2 } } },
                {
                    type: 'chat',
                    data: { comment: 'hello world', user: { userId: 'user123-id', uniqueId: 'user123' } }
                }
            ]
        };
        ws.emit('message', Buffer.from(JSON.stringify(payload)));

        const roomInfo = await connectPromise;
        expect(roomInfo.roomId).toBe('room123');
        expect(chatEvents).toHaveLength(1);
        expect(chatEvents[0].comment).toBe('hello world');
    });

    test('emits gift events with repeat and group data', async () => {
        const { TikTokWebSocketClient } = require('../../../src/platforms/tiktok-websocket-client');
        const client = new TikTokWebSocketClient('xenasosieoff');
        const gifts = [];
        client.on('gift', (data) => gifts.push(data));

        const connectPromise = client.connect();
        const ws = mockSockets[0];
        ws.emit('open');
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
        ws.emit('message', Buffer.from(JSON.stringify(payload)));
        await connectPromise;

        expect(gifts).toHaveLength(1);
        expect(gifts[0].giftDetails.giftName).toBe('Rose');
        expect(gifts[0].repeatCount).toBe(3);
        expect(gifts[0].groupId).toBe('g123');
        expect(gifts[0].repeatEnd).toBe(0);
    });

    test('emits streamEnd on close code 4404 and rejects connect', async () => {
        useFakeTimers();
        const { TikTokWebSocketClient } = require('../../../src/platforms/tiktok-websocket-client');
        const client = new TikTokWebSocketClient('xenasosieoff');

        const streamEndEvents = [];
        client.on('streamEnd', (data) => streamEndEvents.push(data));

        const connectPromise = client.connect();
        const ws = mockSockets[0];
        ws.emit('open');
        ws.emit('close', 4404, 'offline');

        await expect(connectPromise).rejects.toBeInstanceOf(Error);
        expect(streamEndEvents).toHaveLength(1);
        expect(streamEndEvents[0].reason).toBe('User is not live');
    });

    test('rejects connect when no room info arrives before timeout', async () => {
        useFakeTimers();
        const { TikTokWebSocketClient } = require('../../../src/platforms/tiktok-websocket-client');
        const client = new TikTokWebSocketClient('xenasosieoff');

        const connectPromise = client.connect();
        const ws = mockSockets[0];
        ws.emit('open');

        advanceTimersByTime(16000);

        await expect(connectPromise).rejects.toThrow(/timeout/i);
    });
});
