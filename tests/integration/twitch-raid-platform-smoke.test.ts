const { describe, test, afterEach, expect } = require('bun:test');
const EventEmitter = require('events');
const PlatformLifecycleService = require('../../src/services/PlatformLifecycleService.ts');
const NotificationManager = require('../../src/notifications/NotificationManager');
const { TwitchPlatform } = require('../../src/platforms/twitch');
const { createTestAppRuntime } = require('../helpers/runtime-test-harness');
const { createMockDisplayQueue, noOpLogger } = require('../helpers/mock-factories');
const { createTextProcessingManager } = require('../../src/utils/text-processing');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { createConfigFixture, createTwitchConfigFixture } = require('../helpers/config-fixture');
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

const assertUserFacingOutput = (data, { username, viewerCount }) => {
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
    if (viewerCount !== undefined) {
        const countText = String(viewerCount);
        fields.forEach((field) => {
            expect(data[field]).toContain(countText);
        });
    }
};

describe('Twitch raid platform flow (smoke)', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    test('routes raid through lifecycle, router, and display queue', async () => {
        const eventBus = createEventBus();
        const logger = noOpLogger;
        const displayQueue = createMockDisplayQueue();
        const textProcessing = createTextProcessingManager({ logger });
        const configOverrides = {
            general: {
                raidsEnabled: true
            },
            twitch: {
                enabled: true,
                raidsEnabled: true
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
            config: { twitch: { enabled: true } },
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

        const platform = new TwitchPlatform(createTwitchConfigFixture({ enabled: true }), {
            logger,
            twitchAuth: {
                isReady: () => true,
                getUserId: () => 'test-user-id'
            }
        });
        platform.handlers = platformLifecycleService.createDefaultEventHandlers('twitch');

        try {
            await platform.handleRaidEvent({
                username: 'test-user-raider',
                userId: 'test-user-id-raider',
                viewerCount: 42,
                timestamp: '2024-01-01T00:00:00.000Z'
            });

            await new Promise(setImmediate);

            expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
            const queued = displayQueue.addItem.mock.calls[0][0];
            expect(queued.type).toBe('platform:raid');
            expect(queued.platform).toBe('twitch');
            expect(queued.data.username).toBe('test-user-raider');
            expect(queued.data.viewerCount).toBe(42);
            assertUserFacingOutput(queued.data, { username: 'test-user-raider', viewerCount: 42 });
        } finally {
            runtime.platformEventRouter?.dispose();
            platformLifecycleService.dispose();
        }
    });
});
