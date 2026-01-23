const { describe, it, expect } = require('bun:test');
const { TikTokWebSocketClient } = require('../../../src/platforms/tiktok-websocket-client');

describe('TikTokWebSocketClient social routing', () => {
    it('emits social without follow for share actionType', () => {
        const client = new TikTokWebSocketClient('share_tester');
        const socialCalls = [];
        const followCalls = [];

        client.on('social', (data) => socialCalls.push(data));
        client.on('follow', (data) => followCalls.push(data));

        client.handleEvent({
            type: 'social',
            data: { actionType: 'share', displayType: 'share', user: { uniqueId: 'sharer' } }
        });

        expect(socialCalls).toHaveLength(1);
        expect(followCalls).toHaveLength(0);
    });

    it('emits follow for social payloads with follow wording but no actionType', () => {
        const client = new TikTokWebSocketClient('follow_tester');
        const socialCalls = [];
        const followCalls = [];

        client.on('social', (data) => socialCalls.push(data));
        client.on('follow', (data) => followCalls.push(data));

        client.handleEvent({
            type: 'social',
            data: {
                displayText: { defaultPattern: '{0:user} followed the LIVE creator' },
                user: { uniqueId: 'example_user_1238' }
            }
        });

        expect(socialCalls).toHaveLength(1);
        expect(followCalls).toHaveLength(1);
    });
});
