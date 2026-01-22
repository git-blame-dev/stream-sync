const { describe, it, expect, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const { EventEmitter } = require('events');
const { TikTokPlatform } = require('../../../src/platforms/tiktok');
const { createMockTikTokPlatformDependencies } = require('../../helpers/mock-factories');

describe('TikTokPlatform connection recovery', () => {
    const baseConfig = { enabled: true, username: 'retry_tester' };

    afterEach(() => {
        restoreAllMocks();
    });

    const createConnection = ({ shouldReject, id }) => {
        const connection = new EventEmitter();
        connection.id = id;
        connection.isConnecting = false;
        connection.isConnected = false;
        connection.connected = false;
        connection.connect = createMockFn(() => {
            connection.isConnecting = true;
            if (shouldReject) {
                return Promise.reject(new Error('room id failure'));
            }
            connection.isConnecting = false;
            connection.isConnected = true;
            connection.connected = true;
            return Promise.resolve(true);
        });
        connection.disconnect = createMockFn().mockResolvedValue(true);
        connection.removeAllListeners = connection.removeAllListeners.bind(connection);
        return connection;
    };

    it('drops a stuck connecting instance and retries with a fresh connection', async () => {
        const connection1 = createConnection({ shouldReject: true, id: 'conn-1' });
        const connection2 = createConnection({ shouldReject: false, id: 'conn-2' });

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

        const connectionFactory = {
            createConnection: createMockFn()
                .mockReturnValueOnce(connection1)
                .mockReturnValueOnce(connection2)
        };

        dependencies.connectionFactory = connectionFactory;

        const viewerCounts = [];
        const platform = new TikTokPlatform(baseConfig, dependencies);
        platform.handlers = {
            ...platform.handlers,
            onViewerCount: (payload) => viewerCounts.push(payload)
        };

        await expect(platform.initialize(platform.handlers)).rejects.toThrow('room id failure');

        await platform.initialize(platform.handlers);
        connection2.emit(dependencies.ControlEvent.CONNECTED);
        const viewerTimestamp = Date.parse('2024-01-01T00:00:00Z');
        connection2.emit(dependencies.WebcastEvent.ROOM_USER, {
            viewerCount: 99,
            common: { createTime: viewerTimestamp }
        });

        expect(viewerCounts).toHaveLength(1);
        expect(viewerCounts[0]).toMatchObject({ platform: 'tiktok', count: 99 });
    });
});
