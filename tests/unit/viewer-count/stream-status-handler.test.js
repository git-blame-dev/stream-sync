const wireStreamStatusHandlers = require('../../../src/viewer-count/stream-status-handler');

function createEventBus() {
    const handlers = {};
    return {
        subscribe(eventType, handler) {
            handlers[eventType] = handler;
            return () => {
                delete handlers[eventType];
            };
        },
        async emit(eventType, payload) {
            const handler = handlers[eventType];
            if (handler) {
                await handler(payload);
            }
        }
    };
}

function createViewerCountSystem() {
    const updates = [];
    return {
        updates,
        async updateStreamStatus(platform, isLive) {
            updates.push({ platform, isLive });
        }
    };
}

describe('stream-status-handler', () => {
    it('updates viewer count on stream status events with boolean isLive', async () => {
        const eventBus = createEventBus();
        const viewerCountSystem = createViewerCountSystem();

        wireStreamStatusHandlers({ eventBus, viewerCountSystem });

        await eventBus.emit('platform:event', {
            platform: 'twitch',
            type: 'platform:stream-status',
            data: { isLive: true, timestamp: new Date().toISOString() }
        });
        await eventBus.emit('platform:event', {
            platform: 'youtube',
            type: 'platform:stream-status',
            data: { isLive: false, timestamp: new Date().toISOString() }
        });

        expect(viewerCountSystem.updates).toEqual([
            { platform: 'twitch', isLive: true },
            { platform: 'youtube', isLive: false }
        ]);
    });

    it('ignores stream status events without boolean isLive', async () => {
        const eventBus = createEventBus();
        const viewerCountSystem = createViewerCountSystem();

        wireStreamStatusHandlers({ eventBus, viewerCountSystem });

        await eventBus.emit('platform:event', {
            platform: 'twitch',
            type: 'platform:stream-status',
            data: { isLive: 'maybe', timestamp: new Date().toISOString() }
        });
        await eventBus.emit('platform:event', { type: 'platform:stream-status', data: { timestamp: new Date().toISOString() } });

        expect(viewerCountSystem.updates).toEqual([]);
    });

    it('logs and continues when viewer count update fails', async () => {
        const eventBus = createEventBus();
        const warnings = [];
        const viewerCountSystem = {
            async updateStreamStatus() {
                throw new Error('boom');
            }
        };

        wireStreamStatusHandlers({
            eventBus,
            viewerCountSystem,
            logger: { warn: (message) => warnings.push(message) }
        });

        await eventBus.emit('platform:event', {
            platform: 'twitch',
            type: 'platform:stream-status',
            data: { isLive: true, timestamp: new Date().toISOString() }
        });

        expect(warnings.length).toBeGreaterThan(0);
    });

    it('skips updates when viewer count disabled for platform', async () => {
        const eventBus = createEventBus();
        const viewerCountSystem = createViewerCountSystem();

        wireStreamStatusHandlers({
            eventBus,
            viewerCountSystem,
            isViewerCountEnabled: (platform) => platform !== 'youtube'
        });

        await eventBus.emit('platform:event', {
            platform: 'youtube',
            type: 'platform:stream-status',
            data: { isLive: true, timestamp: new Date().toISOString() }
        });
        await eventBus.emit('platform:event', {
            platform: 'twitch',
            type: 'platform:stream-status',
            data: { isLive: true, timestamp: new Date().toISOString() }
        });

        expect(viewerCountSystem.updates).toEqual([
            { platform: 'twitch', isLive: true }
        ]);
    });

    it('ignores events without platform', async () => {
        const eventBus = createEventBus();
        const viewerCountSystem = createViewerCountSystem();

        wireStreamStatusHandlers({ eventBus, viewerCountSystem });

        await eventBus.emit('platform:event', { type: 'platform:stream-status', data: { isLive: true, timestamp: new Date().toISOString() } });

        expect(viewerCountSystem.updates).toEqual([]);
    });

    it('ignores null or undefined stream status payloads safely', async () => {
        const eventBus = createEventBus();
        const viewerCountSystem = createViewerCountSystem();

        wireStreamStatusHandlers({ eventBus, viewerCountSystem });

        await eventBus.emit('platform:event');
        await eventBus.emit('platform:event', null);

        expect(viewerCountSystem.updates).toEqual([]);
    });

    it('ignores non-object payloads for stream status events', async () => {
        const eventBus = createEventBus();
        const viewerCountSystem = createViewerCountSystem();

        wireStreamStatusHandlers({ eventBus, viewerCountSystem });

        await eventBus.emit('platform:event', 'online');
        await eventBus.emit('platform:event', ['offline']);

        expect(viewerCountSystem.updates).toEqual([]);
    });

    it('no-ops safely when viewer count system is missing', async () => {
        const eventBus = createEventBus();
        const unsubscribe = wireStreamStatusHandlers({ eventBus, viewerCountSystem: null });

        await expect(eventBus.emit('platform:event', {
            platform: 'twitch',
            type: 'platform:stream-status',
            data: { isLive: true, timestamp: new Date().toISOString() }
        })).resolves.toBeUndefined();
        expect(typeof unsubscribe).toBe('function');
        expect(() => unsubscribe()).not.toThrow();
    });

    it('skips updates when viewer count system lacks updateStreamStatus', async () => {
        const eventBus = createEventBus();
        const viewerCountSystem = {};

        wireStreamStatusHandlers({ eventBus, viewerCountSystem });

        await eventBus.emit('platform:event', {
            platform: 'twitch',
            type: 'platform:stream-status',
            data: { isLive: true, timestamp: new Date().toISOString() }
        });

        expect(viewerCountSystem.updates).toBeUndefined();
    });

    it('logs warning when isViewerCountEnabled throws and still updates', async () => {
        const eventBus = createEventBus();
        const viewerCountSystem = createViewerCountSystem();
        const warnings = [];

        wireStreamStatusHandlers({
            eventBus,
            viewerCountSystem,
            isViewerCountEnabled: () => {
                throw new Error('predicate error');
            },
            logger: { warn: (msg) => warnings.push(msg) }
        });

        await eventBus.emit('platform:event', {
            platform: 'twitch',
            type: 'platform:stream-status',
            data: { isLive: true, timestamp: new Date().toISOString() }
        });

        expect(viewerCountSystem.updates).toEqual([{ platform: 'twitch', isLive: true }]);
        expect(warnings.some((msg) => msg.includes('isViewerCountEnabled'))).toBe(true);
    });
});
