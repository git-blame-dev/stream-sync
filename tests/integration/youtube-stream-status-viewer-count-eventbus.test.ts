const { describe, test, afterEach, expect } = require('bun:test');
const EventEmitter = require('events');
const PlatformLifecycleService = require('../../src/services/PlatformLifecycleService.js');
const { YouTubePlatform } = require('../../src/platforms/youtube');
const { PlatformEvents } = require('../../src/interfaces/PlatformEvents');
const { createYouTubeConfigFixture } = require('../helpers/config-fixture');
const { noOpLogger } = require('../helpers/mock-factories');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');

const createEventBus = () => {
    const emitter = new EventEmitter();
    return {
        emit: emitter.emit.bind(emitter),
        subscribe: (event, handler) => {
            emitter.on(event, handler);
            return () => emitter.off(event, handler);
        }
    };
};

const waitForPlatformEvent = (eventBus) => new Promise((resolve) => {
    const unsubscribe = eventBus.subscribe('platform:event', (event) => {
        unsubscribe();
        resolve(event);
    });
});

const createPlatform = () => new YouTubePlatform(
    createYouTubeConfigFixture({ enabled: true, username: 'test-channel' }),
    {
        logger: noOpLogger,
        USER_AGENTS: ['test-agent'],
        streamDetectionService: {
            detectLiveStreams: createMockFn().mockResolvedValue({ success: true, videoIds: [] })
        }
    }
);

describe('YouTube stream status + viewer count event bus (integration)', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    test('emits viewer-count events through lifecycle handlers', async () => {
        const eventBus = createEventBus();
        const lifecycle = new PlatformLifecycleService({
            config: { youtube: { enabled: true, username: 'test-channel' } },
            eventBus,
            logger: noOpLogger
        });
        const platform = createPlatform();
        platform.handlers = lifecycle.createDefaultEventHandlers('youtube');

        const eventPromise = waitForPlatformEvent(eventBus);

        try {
            platform.updateViewerCountForStream('test-stream-1', 123);

            const event = await eventPromise;

            expect(event.type).toBe(PlatformEvents.VIEWER_COUNT);
            expect(event.platform).toBe('youtube');
            expect(event.data.count).toBe(123);
            expect(event.data.streamId).toBe('test-stream-1');
            expect(Number.isNaN(Date.parse(event.data.timestamp))).toBe(false);
        } finally {
            lifecycle.dispose();
        }
    });

    test('emits stream-status events through lifecycle handlers', async () => {
        const eventBus = createEventBus();
        const lifecycle = new PlatformLifecycleService({
            config: { youtube: { enabled: true, username: 'test-channel' } },
            eventBus,
            logger: noOpLogger
        });
        const platform = createPlatform();
        platform.handlers = lifecycle.createDefaultEventHandlers('youtube');
        platform.connectionManager.connections.set('test-stream-1', {
            connection: null,
            state: 'connected',
            metadata: {}
        });

        const eventPromise = waitForPlatformEvent(eventBus);

        try {
            await platform.disconnectFromYouTubeStream('test-stream-1', 'test-disconnect');

            const event = await eventPromise;

            expect(event.type).toBe(PlatformEvents.STREAM_STATUS);
            expect(event.platform).toBe('youtube');
            expect(event.data.isLive).toBe(false);
            expect(Number.isNaN(Date.parse(event.data.timestamp))).toBe(false);
        } finally {
            lifecycle.dispose();
        }
    });
});
