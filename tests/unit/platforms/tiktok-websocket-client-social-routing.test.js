const { describe, it, expect } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { TikTokWebSocketClient } = require('../../../src/platforms/tiktok-websocket-client');

describe('TikTokWebSocketClient social routing', () => {
    it('emits social without follow for share actionType', () => {
        const client = new TikTokWebSocketClient('share_tester');
        const socialHandler = createMockFn();
        const followHandler = createMockFn();

        client.on('social', socialHandler);
        client.on('follow', followHandler);

        client.handleEvent({
            type: 'social',
            data: { actionType: 'share', displayType: 'share', user: { uniqueId: 'sharer' } }
        });

        expect(socialHandler).toHaveBeenCalledTimes(1);
        expect(followHandler).not.toHaveBeenCalled();
    });

    it('emits follow for social payloads with follow wording but no actionType', () => {
        const client = new TikTokWebSocketClient('follow_tester');
        const socialHandler = createMockFn();
        const followHandler = createMockFn();

        client.on('social', socialHandler);
        client.on('follow', followHandler);

        client.handleEvent({
            type: 'social',
            data: {
                displayText: { defaultPattern: '{0:user} followed the LIVE creator' },
                user: { uniqueId: 'example_user_1238' }
            }
        });

        expect(socialHandler).toHaveBeenCalledTimes(1);
        expect(followHandler).toHaveBeenCalledTimes(1);
    });
});
