const { describe, it, expect, afterEach } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');

const TwitchEventSub = require('../../../src/platforms/twitch-eventsub');

const createAuthManager = () => ({
    getState: () => 'READY',
    getUserId: () => 'test-user-123456',
    authState: { executeWhenReady: async (fn) => fn() },
    getAccessToken: async () => 'test-access-token'
});

describe('TwitchEventSub chat sending', () => {
    let eventSub;

    afterEach(() => {
        if (eventSub?.cleanup) {
            eventSub.cleanup().catch(() => {});
        }
    });

    it('sends chat messages through the EventSub transport', async () => {
        const mockAxios = {
            post: createMockFn().mockResolvedValue({ data: { drop_reason: null } }),
            get: createMockFn().mockResolvedValue({ data: {} }),
            delete: createMockFn().mockResolvedValue({ data: {} })
        };

        eventSub = new TwitchEventSub(
            {
                clientId: 'test-client-id',
                accessToken: 'test-access-token',
                channel: 'teststreamer',
                username: 'teststreamer',
                broadcasterId: 'test-broadcaster-id',
                dataLoggingEnabled: false
            },
            {
                authManager: createAuthManager(),
                logger: noOpLogger,
                axios: mockAxios,
                WebSocketCtor: class { close() {} },
                ChatFileLoggingService: class { logRawPlatformData() {} }
            }
        );

        const result = await eventSub.sendMessage('hello world');

        expect(result).toMatchObject({ success: true, platform: 'twitch' });
        expect(mockAxios.post.mock.calls).toHaveLength(1);
        expect(mockAxios.post.mock.calls[0][0]).toBe('https://api.twitch.tv/helix/chat/messages');
        expect(mockAxios.post.mock.calls[0][1].message).toBe('hello world');
    });

    it('rejects when message is empty', async () => {
        const mockAxios = {
            post: createMockFn().mockResolvedValue({ data: {} }),
            get: createMockFn().mockResolvedValue({ data: {} }),
            delete: createMockFn().mockResolvedValue({ data: {} })
        };

        eventSub = new TwitchEventSub(
            {
                clientId: 'test-client-id',
                accessToken: 'test-access-token',
                channel: 'teststreamer',
                username: 'teststreamer',
                broadcasterId: 'test-broadcaster-id',
                dataLoggingEnabled: false
            },
            {
                authManager: createAuthManager(),
                logger: noOpLogger,
                axios: mockAxios,
                WebSocketCtor: class { close() {} },
                ChatFileLoggingService: class { logRawPlatformData() {} }
            }
        );

        await expect(eventSub.sendMessage('')).rejects.toThrow(/non-empty/i);
        await expect(eventSub.sendMessage('   ')).rejects.toThrow(/non-empty/i);
    });

    it('rejects when auth manager is missing', async () => {
        const mockAxios = {
            post: createMockFn().mockResolvedValue({ data: {} }),
            get: createMockFn().mockResolvedValue({ data: {} }),
            delete: createMockFn().mockResolvedValue({ data: {} })
        };

        eventSub = new TwitchEventSub(
            {
                clientId: 'test-client-id',
                accessToken: 'test-access-token',
                channel: 'teststreamer',
                username: 'teststreamer',
                broadcasterId: 'test-broadcaster-id',
                dataLoggingEnabled: false
            },
            {
                authManager: { getState: () => 'READY', getUserId: () => null },
                logger: noOpLogger,
                axios: mockAxios,
                WebSocketCtor: class { close() {} },
                ChatFileLoggingService: class { logRawPlatformData() {} }
            }
        );

        await expect(eventSub.sendMessage('hello')).rejects.toThrow(/user ID/i);
    });
});
