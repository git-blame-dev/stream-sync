const { describe, test, afterEach, expect } = require('bun:test');
const EventEmitter = require('events');
const PlatformLifecycleService = require('../../src/services/PlatformLifecycleService');
const NotificationManager = require('../../src/notifications/NotificationManager');
const { TikTokPlatform } = require('../../src/platforms/tiktok');
const { createTestAppRuntime } = require('../helpers/runtime-test-harness');
const { createMockDisplayQueue, createMockTikTokPlatformDependencies, noOpLogger } = require('../helpers/mock-factories');
const { createTextProcessingManager } = require('../../src/utils/text-processing');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { createConfigFixture, createTikTokConfigFixture } = require('../helpers/config-fixture');
const { createTikTokShareEvent } = require('../helpers/tiktok-test-data');
const { expectNoTechnicalArtifacts } = require('../helpers/assertion-helpers');

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

const assertUserFacingOutput = (data, { username }) => {
    const fields = ['displayMessage', 'ttsMessage', 'logMessage'];
    fields.forEach((field) => {
        expect(typeof data[field]).toBe('string');
        expect(data[field].trim()).not.toBe('');
        expectNoTechnicalArtifacts(data[field]);
    });
    if (username) {
        fields.forEach((field) => {
            expect(data[field]).toContain(username);
        });
    }
};

describe('TikTok share platform flow (smoke)', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    test('routes share through lifecycle, router, and display queue', async () => {
        const eventBus = createEventBus();
        const logger = noOpLogger;
        const displayQueue = createMockDisplayQueue();
        const textProcessing = createTextProcessingManager({ logger });
        const configOverrides = {
            general: {
                sharesEnabled: true
            },
            tiktok: {
                enabled: true,
                sharesEnabled: true
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
            config: { tiktok: { enabled: true } },
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

        const platform = new TikTokPlatform(
            createTikTokConfigFixture({ enabled: true }),
            createMockTikTokPlatformDependencies()
        );
        platform.handlers = platformLifecycleService.createDefaultEventHandlers('tiktok');

        const eventTimestampMs = Date.parse('2025-01-20T12:00:00.000Z');
        const shareEvent = createTikTokShareEvent({
            user: { uniqueId: 'test-user-share', nickname: 'test-user-share' },
            common: { createTime: eventTimestampMs }
        });

        try {
            await platform.handleTikTokSocial(shareEvent);

            await new Promise(setImmediate);

            expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
            const queued = displayQueue.addItem.mock.calls[0][0];
            expect(queued.type).toBe('platform:share');
            expect(queued.platform).toBe('tiktok');
            expect(queued.data.username).toBe('test-user-share');
            assertUserFacingOutput(queued.data, { username: 'test-user-share' });
        } finally {
            runtime.platformEventRouter?.dispose();
            platformLifecycleService.dispose();
        }
    });
});
