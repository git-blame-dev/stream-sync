jest.unmock('../../../src/platforms/tiktok');

const { EventEmitter } = require('events');

const { TikTokPlatform } = require('../../../src/platforms/tiktok');
const { createMockTikTokPlatformDependencies } = require('../../helpers/mock-factories');

describe('TikTokPlatform initialize failure propagation', () => {
    it('rejects initialize when the initial connection attempt fails', async () => {
        const failingConnection = new EventEmitter();
        failingConnection.isConnecting = false;
        failingConnection.isConnected = false;
        failingConnection.connected = false;
        failingConnection.connect = jest.fn().mockRejectedValue(new Error('room id failure'));
        failingConnection.disconnect = jest.fn().mockResolvedValue();

        const dependencies = createMockTikTokPlatformDependencies({
            controlEvent: { CONNECTED: 'connected', DISCONNECTED: 'disconnected', ERROR: 'error' },
            webcastEvent: {
                CHAT: 'chat',
                GIFT: 'gift',
                FOLLOW: 'follow',
                ROOM_USER: 'roomUser',
                ENVELOPE: 'envelope',
                SUBSCRIBE: 'subscribe',
                SUPER_FAN: 'superfan',
                LIKE: 'like',
                SOCIAL: 'social',
                SHARE: 'share',
                MEMBER: 'member',
                EMOTE: 'emote',
                QUESTION_NEW: 'question',
                ERROR: 'error',
                DISCONNECT: 'disconnect',
                STREAM_END: 'stream_end'
            }
        });

        dependencies.connectionFactory = {
            createConnection: jest.fn().mockReturnValue(failingConnection)
        };
        dependencies.retrySystem = {
            handleConnectionError: jest.fn().mockResolvedValue(),
            resetRetryCount: jest.fn(),
            isConnected: jest.fn()
        };

        const platform = new TikTokPlatform({ enabled: true, username: 'retry_tester' }, dependencies);

        await expect(platform.initialize(platform.handlers)).rejects.toThrow('room id failure');
        expect(dependencies.retrySystem.handleConnectionError).toHaveBeenCalledTimes(1);
        expect(failingConnection.connect).toHaveBeenCalledTimes(1);
    });
});
