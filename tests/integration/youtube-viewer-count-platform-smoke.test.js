const { describe, test, afterEach, expect } = require('bun:test');
const EventEmitter = require('events');
const PlatformLifecycleService = require('../../src/services/PlatformLifecycleService');
const NotificationManager = require('../../src/notifications/NotificationManager');
const { YouTubePlatform } = require('../../src/platforms/youtube');
const { createTestAppRuntime } = require('../helpers/runtime-test-harness');
const { createMockDisplayQueue, noOpLogger } = require('../helpers/mock-factories');
const { createTextProcessingManager } = require('../../src/utils/text-processing');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { createConfigFixture, createYouTubeConfigFixture } = require('../helpers/config-fixture');

const createEventBus = () => {
    const emitter = new EventEmitter();
    return {
        emit: emitter.emit.bind(emitter),
        on: emitter.on.bind(emitter),
        subscribe: (event, handler) => {
            emitter.on(event, handler);
            return () => emitter.off(event, handler);
        }
    };
};

describe('YouTube viewer count platform flow (smoke)', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    test('routes viewer count updates from platform to runtime', async () => {
        const eventBus = createEventBus();
        const logger = noOpLogger;
        const displayQueue = createMockDisplayQueue();
        const textProcessing = createTextProcessingManager({ logger });
        const configOverrides = {
            general: {},
            youtube: {
                enabled: true,
                viewerCountEnabled: true,
                username: 'test-channel'
            },
            obs: { enabled: false }
        };
        const config = createConfigFixture(configOverrides);
        const notificationManager = new NotificationManager({
            displayQueue,
            logger,
            eventBus,
            config,
            constants: require('../../src/core/constants'),
            textProcessing,
            obsGoals: { processDonationGoal: createMockFn() },
            vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) },
            userTrackingService: { isFirstMessage: createMockFn().mockResolvedValue(false) }
        });

        const platformLifecycleService = new PlatformLifecycleService({
            config: { youtube: { enabled: true, username: 'test-channel' } },
            eventBus,
            logger
        });

        const { runtime } = createTestAppRuntime(configOverrides, {
            eventBus,
            notificationManager,
            displayQueue,
            logger,
            platformLifecycleService
        });

        const platform = new YouTubePlatform(
            createYouTubeConfigFixture({ enabled: true, username: 'test-channel' }),
            {
                logger,
                USER_AGENTS: ['test-agent'],
                streamDetectionService: {
                    detectLiveStreams: createMockFn().mockResolvedValue({ success: true, videoIds: [] })
                }
            }
        );
        platform.handlers = platformLifecycleService.createDefaultEventHandlers('youtube');

        const updates = [];
        runtime.viewerCountSystem.addObserver({
            getObserverId: () => 'test-viewer-count-observer',
            onViewerCountUpdate: (update) => {
                updates.push(update);
            }
        });

        try {
            platform.updateViewerCountForStream('test-stream-1', 321);

            await new Promise(setImmediate);

            expect(updates).toHaveLength(1);
            expect(updates[0].platform).toBe('youtube');
            expect(updates[0].count).toBe(321);
            expect(updates[0].previousCount).toBe(0);
        } finally {
            runtime.platformEventRouter?.dispose();
            platformLifecycleService.dispose();
        }
    });
});
