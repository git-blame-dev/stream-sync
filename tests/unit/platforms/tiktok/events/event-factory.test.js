const { PlatformEvents } = require('../../../../../src/interfaces/PlatformEvents');

describe('TikTok event factory behavior', () => {
    it('includes boolean fields in chat message events', () => {
        const { createTikTokEventFactory } = require('../../../../../src/platforms/tiktok/events/event-factory');

        const eventFactory = createTikTokEventFactory({
            platformName: 'tiktok',
            generateCorrelationId: () => 'corr-chat-123'
        });

        const event = eventFactory.createChatMessage({}, {
            normalizedData: {
                userId: 'test-user-id',
                username: 'test-username',
                message: 'test message',
                timestamp: '2026-01-30T12:00:00.000Z',
                isMod: true,
                isSubscriber: false,
                isBroadcaster: true
            }
        });

        expect(event.type).toBe(PlatformEvents.CHAT_MESSAGE);
        expect(event.platform).toBe('tiktok');
        expect(event.isMod).toBe(true);
        expect(event.isSubscriber).toBe(false);
        expect(event.isBroadcaster).toBe(true);
    });

    it('defaults boolean fields to false when not provided', () => {
        const { createTikTokEventFactory } = require('../../../../../src/platforms/tiktok/events/event-factory');

        const eventFactory = createTikTokEventFactory({
            platformName: 'tiktok',
            generateCorrelationId: () => 'corr-chat-456'
        });

        const event = eventFactory.createChatMessage({}, {
            normalizedData: {
                userId: 'test-user-id',
                username: 'test-username',
                message: 'test message',
                timestamp: '2026-01-30T12:00:00.000Z'
            }
        });

        expect(event.isMod).toBe(false);
        expect(event.isSubscriber).toBe(false);
        expect(event.isBroadcaster).toBe(false);
    });

    it('builds error events with top-level timestamp', () => {
        const { createTikTokEventFactory } = require('../../../../../src/platforms/tiktok/events/event-factory');

        const eventFactory = createTikTokEventFactory({
            platformName: 'tiktok',
            generateCorrelationId: () => 'corr-error-123'
        });

        const error = new Error('Connection failed');
        error.name = 'ConnectionError';

        const event = eventFactory.createError(error, { operation: 'connect' });

        expect(event.type).toBe(PlatformEvents.ERROR);
        expect(event.platform).toBe('tiktok');
        expect(event.error).toEqual({
            message: 'Connection failed',
            name: 'ConnectionError'
        });
        expect(event.context).toEqual({
            operation: 'connect',
            correlationId: 'corr-error-123'
        });
        expect(event.recoverable).toBe(true);
        expect(event.timestamp).toBeDefined();
        expect(typeof event.timestamp).toBe('string');
        expect(event.metadata.timestamp).toBeUndefined();
    });
});
