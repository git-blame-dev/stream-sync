const { PlatformEvents } = require('../../../../../src/interfaces/PlatformEvents');

describe('TikTok event factory behavior', () => {
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
