const { describe, expect, it, beforeEach } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const PlatformEventRouter = require('../../../src/services/PlatformEventRouter');

describe('PlatformEventRouter error handling', () => {
    let mockLogger;
    let mockEventBus;
    let mockRuntime;
    let mockNotificationManager;
    let mockConfigService;
    let subscriber;

    const baseEvent = {
        platform: 'twitch',
        type: 'platform:chat-message',
        data: {
            username: 'testUser',
            message: { text: 'test message' },
            userId: 'test-user-1',
            timestamp: new Date().toISOString(),
            metadata: {}
        }
    };

    beforeEach(() => {
        mockLogger = noOpLogger;

        subscriber = null;
        mockEventBus = {
            subscribe: createMockFn((event, handler) => {
                subscriber = handler;
                return () => {};
            }),
            emit: async (event, payload) => {
                if (subscriber) {
                    await subscriber(payload);
                }
            }
        };

        mockRuntime = {
            handleChatMessage: createMockFn().mockResolvedValue()
        };

        mockNotificationManager = {
            handleNotification: createMockFn()
        };

        mockConfigService = {
            areNotificationsEnabled: createMockFn().mockReturnValue(true)
        };
    });

    it('continues processing events after handler throws an error', async () => {
        mockRuntime.handleChatMessage
            .mockRejectedValueOnce(new Error('first call fails'))
            .mockResolvedValueOnce();

        new PlatformEventRouter({
            eventBus: mockEventBus,
            runtime: mockRuntime,
            notificationManager: mockNotificationManager,
            configService: mockConfigService,
            logger: mockLogger
        });

        await mockEventBus.emit('platform:event', baseEvent);
        await mockEventBus.emit('platform:event', baseEvent);

        expect(mockRuntime.handleChatMessage).toHaveBeenCalledTimes(2);
    });

    it('does not crash when handler throws non-Error value', async () => {
        mockRuntime.handleChatMessage.mockRejectedValueOnce('string error');

        new PlatformEventRouter({
            eventBus: mockEventBus,
            runtime: mockRuntime,
            notificationManager: mockNotificationManager,
            configService: mockConfigService,
            logger: mockLogger
        });

        await expect(mockEventBus.emit('platform:event', baseEvent)).resolves.toBeUndefined();
    });
});
