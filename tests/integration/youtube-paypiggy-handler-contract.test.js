const { describe, test, expect, afterEach } = require('bun:test');

const EventEmitter = require('events');
const PlatformLifecycleService = require('../../src/services/PlatformLifecycleService');
const { YouTubePlatform } = require('../../src/platforms/youtube');
const { PlatformEvents } = require('../../src/interfaces/PlatformEvents');

const { noOpLogger } = require('../helpers/mock-factories');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { createMockPlatformDependencies } = require('../helpers/test-setup');
const { createYouTubeConfigFixture } = require('../helpers/config-fixture');

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

const createYouTubePlatform = () => {
    const dependencies = createMockPlatformDependencies('youtube', {
        streamDetectionService: {
            detectLiveStreams: createMockFn().mockResolvedValue({
                success: true,
                videoIds: []
            })
        }
    });

    return new YouTubePlatform(
        createYouTubeConfigFixture({
            enabled: true,
            username: 'test-youtube-channel'
        }),
        dependencies
    );
};

describe('YouTube paypiggy handler contract (integration)', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    test('forwards membership chat events through lifecycle default handlers to event bus', async () => {
        const eventBus = createEventBus();
        const lifecycle = new PlatformLifecycleService({
            config: {
                youtube: {
                    enabled: true,
                    username: 'test-youtube-channel'
                }
            },
            eventBus,
            logger: noOpLogger
        });

        try {
            const platform = createYouTubePlatform();
            platform.handlers = lifecycle.createDefaultEventHandlers('youtube');

            const received = [];
            eventBus.on('platform:event', (event) => received.push(event));

            const membershipItem = {
                item: {
                    type: 'LiveChatMembershipItem',
                    id: 'LCC.test-membership-event-bus-001',
                    timestamp_usec: '1704067200000000',
                    author: {
                        id: 'UC_TEST_CHANNEL_001234',
                        name: 'test-member-user'
                    },
                    headerPrimaryText: { text: 'Member' },
                    headerSubtext: { text: 'Welcome to membership' },
                    memberMilestoneDurationInMonths: 2
                }
            };

            await platform.handleChatMessage(membershipItem);
            await new Promise((resolve) => setImmediate(resolve));

            expect(received).toHaveLength(1);
            expect(received[0]).toMatchObject({
                platform: 'youtube',
                type: PlatformEvents.PAYPIGGY,
                data: {
                    username: 'test-member-user',
                    userId: 'UC_TEST_CHANNEL_001234',
                    membershipLevel: 'Member',
                    months: 2,
                    message: 'Welcome to membership',
                    timestamp: '2024-01-01T00:00:00.000Z'
                }
            });
        } finally {
            lifecycle.dispose();
        }
    });
});
