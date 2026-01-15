const { describe, test, beforeEach, afterEach, expect } = require('bun:test');

const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const wireStreamStatusHandlers = require('../../src/viewer-count/stream-status-handler');
const { ViewerCountSystem } = require('../../src/utils/viewer-count');

const createEventBus = () => {
    const listeners = new Map();
    return {
        subscribe(event, handler) {
            const existing = listeners.get(event) || [];
            existing.push(handler);
            listeners.set(event, existing);
            return () => {
                listeners.set(event, (listeners.get(event) || []).filter((fn) => fn !== handler));
            };
        },
        async emit(event, payload) {
            const handlers = listeners.get(event) || [];
            await Promise.all(handlers.map((handler) => handler(payload)));
        }
    };
};

describe('YouTube stream-status viewer count integration (smoke)', () => {
    afterEach(async () => {
        restoreAllMocks();
        if (viewerCountSystem) {
            viewerCountSystem.stopPolling();
            await viewerCountSystem.cleanup();
        }
    });

    let viewerCountSystem;
    let eventBus;
    let platforms;

    beforeEach(async () => {
        platforms = {
            youtube: {
                getViewerCount: createMockFn().mockResolvedValue(42)
            }
        };

        eventBus = createEventBus();
        viewerCountSystem = new ViewerCountSystem({
            platformProvider: () => platforms
        });

        await viewerCountSystem.initialize();
        viewerCountSystem.startPolling(); // YouTube starts as offline, so no polling yet

        wireStreamStatusHandlers({
            eventBus,
            viewerCountSystem
        });
    });

    test('starts polling YouTube when stream status is live and records viewer count', async () => {
        await eventBus.emit('platform:event', {
            platform: 'youtube',
            type: 'platform:stream-status',
            data: { isLive: true, timestamp: new Date().toISOString() }
        });

        expect(platforms.youtube.getViewerCount).toHaveBeenCalled();
        expect(viewerCountSystem.counts.youtube).toBe(42);
        expect(viewerCountSystem.isStreamLive('youtube')).toBe(true);
        expect(viewerCountSystem.pollingHandles.youtube).toBeDefined();
    });
});
