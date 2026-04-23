import { describe, test, afterEach, expect } from 'bun:test';
import { createRequire } from 'node:module';

const load = createRequire(__filename);
const EventEmitter = load('events');
const NotificationManager = load('../../src/notifications/NotificationManager');
const { PlatformEventRouter } = load('../../src/services/PlatformEventRouter.js');
const { YouTubePlatform } = load('../../src/platforms/youtube');
const { PlatformEvents } = load('../../src/interfaces/PlatformEvents');
const { createTextProcessingManager } = load('../../src/utils/text-processing');
const { createConfigFixture } = load('../helpers/config-fixture');
const { createMockDisplayQueue, noOpLogger } = load('../helpers/mock-factories');
const { createMockFn, restoreAllMocks } = load('../helpers/bun-mock-utils');
const { expectNoTechnicalArtifacts } = load('../helpers/assertion-helpers');
const coreConstants = load('../../src/core/constants');

const createEventBus = () => {
    const emitter = new EventEmitter();
    return {
        emit: (event: string, payload: unknown) => emitter.emit(event, payload),
        subscribe: (event: string, handler: (...args: unknown[]) => void) => {
            emitter.on(event, handler);
            return () => emitter.off(event, handler);
        }
    };
};

const assertNonEmptyString = (value: unknown) => {
    expect(typeof value).toBe('string');
    expect((value as string).trim()).not.toBe('');
};

describe('YouTube GiftMessageView pipeline (smoke E2E)', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    test('routes raw GiftMessageView jewels input into a queued gift notification without fabricating identity', async () => {
        const eventBus = createEventBus();
        const logger = noOpLogger;
        const displayQueue = createMockDisplayQueue();
        const textProcessing = createTextProcessingManager({ logger });
        const config = createConfigFixture({
            general: {
                giftsEnabled: true
            },
            youtube: {
                enabled: true,
                username: 'test-youtube-channel'
            },
            obs: { enabled: false }
        });
        const notificationManager = new NotificationManager({
            displayQueue,
            logger,
            eventBus,
            config,
            constants: coreConstants,
            textProcessing,
            obsGoals: { processDonationGoal: createMockFn() },
            vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) },
            userTrackingService: { isFirstMessage: createMockFn().mockResolvedValue(false) }
        });
        const runtime = {
            handleGiftNotification: async (platform: string, _username: string, payload: Record<string, unknown>) =>
                notificationManager.handleNotification(payload.type, platform, payload)
        };

        const router = new PlatformEventRouter({
            eventBus,
            runtime,
            notificationManager,
            config,
            logger
        });

        const platform = new YouTubePlatform(config.youtube, {
            logger,
            streamDetectionService: {
                detectLiveStreams: createMockFn().mockResolvedValue({
                    success: true,
                    videoIds: [],
                    detectionMethod: 'test'
                })
            },
            notificationManager: {
                emit: createMockFn(),
                on: createMockFn(),
                removeListener: createMockFn()
            },
            ChatFileLoggingService: class { logRawPlatformData() {} },
            USER_AGENTS: ['test-agent']
        });

        platform.handlers = {
            onGift: (payload: Record<string, unknown>) => {
                eventBus.emit('platform:event', {
                    platform: 'youtube',
                    type: PlatformEvents.GIFT,
                    data: payload
                });
            }
        };

        try {
            await platform.handleChatMessage({
                item: {
                    type: 'GiftMessageView',
                    id: 'ChwKGkNNRHAzZmpKNVpNREZkM0N3Z1FkQUpZWmNn',
                    timestamp_usec: '1704067200000000',
                    text: {
                        content: 'sent Girl power for 300 Jewels'
                    },
                    authorName: {
                        content: '@test-smoke-jewels-user '
                    }
                }
            });

            await new Promise(setImmediate);

            expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
            const queued = displayQueue.addItem.mock.calls[0][0];
            expect(queued.type).toBe('platform:gift');
            expect(queued.platform).toBe('youtube');
            expect(queued.data.username).toBe('test-smoke-jewels-user');
            expect(queued.data.userId).toBeUndefined();
            expect(queued.data.giftType).toBe('Girl power');
            expect(queued.data.giftCount).toBe(1);
            expect(queued.data.amount).toBe(300);
            expect(queued.data.currency).toBe('jewels');
            expect(queued.data.giftImageUrl).toBeUndefined();

            assertNonEmptyString(queued.data.displayMessage);
            assertNonEmptyString(queued.data.ttsMessage);
            assertNonEmptyString(queued.data.logMessage);
            expectNoTechnicalArtifacts(queued.data.displayMessage);
            expectNoTechnicalArtifacts(queued.data.ttsMessage);
            expectNoTechnicalArtifacts(queued.data.logMessage);
            expect(queued.data.displayMessage.toLowerCase()).toContain('jewels');
            expect(queued.data.ttsMessage.toLowerCase()).toContain('jewels');
            expect(queued.data.logMessage.toLowerCase()).toContain('jewels');
        } finally {
            router.dispose();
            await platform.cleanup();
        }
    });
});
