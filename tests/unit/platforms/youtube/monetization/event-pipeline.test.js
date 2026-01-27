
const { describe, test, expect, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../../../helpers/bun-mock-utils');

const { YouTubePlatform } = require('../../../../../src/platforms/youtube');
const { createYouTubeSuperChatEvent } = require('../../../../helpers/youtube-test-data');
const { createMockPlatformDependencies, createConfigFixture } = require('../../../../helpers/test-setup');

describe('YouTube monetized event pipeline', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    const baseConfig = createConfigFixture('youtube', {
        enabled: true,
        username: 'notification-test',
        apiKey: 'notification-key'
    });

    const createPlatform = () => new YouTubePlatform(baseConfig, {
        ...createMockPlatformDependencies('youtube'),
        streamDetectionService: {
            detectLiveStreams: createMockFn().mockResolvedValue({ success: true, videoIds: [] })
        }
    });

    test('emits a single gift event for SuperChats through the unified pipeline', async () => {
        const youtubePlatform = createPlatform();
        const giftEvents = [];
        youtubePlatform.handlers = {
            ...youtubePlatform.handlers,
            onGift: (event) => giftEvents.push(event)
        };

        const superChat = createYouTubeSuperChatEvent(10, 'USD', {
            item: {
                author: {
                    id: 'youtube-user-1',
                    name: 'SuperChatUser'
                },
                message: {
                    runs: [{ text: 'Thanks for the amazing content! Keep it up!' }]
                }
            }
        });

        await youtubePlatform.handleChatMessage(superChat);
        await new Promise((resolve) => setImmediate(resolve));

        expect(giftEvents).toHaveLength(1);
        expect(giftEvents[0]).toMatchObject({
            platform: 'youtube',
            type: 'platform:gift',
            username: 'SuperChatUser',
            giftType: 'Super Chat',
            giftCount: 1,
            amount: 10,
            currency: 'USD'
        });
        expect(giftEvents[0].message).toBe('Thanks for the amazing content! Keep it up!');
        expect(giftEvents[0].userId).toBeTruthy();
        expect(giftEvents[0].id).toBeTruthy();
    });

    test('emits membership events for LiveChatMembershipItem payloads', async () => {
        const youtubePlatform = createPlatform();
        const membershipEvents = [];
        youtubePlatform.handlers = {
            ...youtubePlatform.handlers,
            onMembership: (event) => membershipEvents.push(event)
        };

        const membershipItem = {
            item: {
                type: 'LiveChatMembershipItem',
                id: 'LCC.test-membership-001',
                timestamp_usec: '1704067200000000',
                author: {
                    id: 'UC_TEST_CHANNEL_00999',
                    name: 'MemberUser'
                },
                headerPrimaryText: { text: 'Gold Member' },
                headerSubtext: { text: 'Welcome to the membership' },
                memberMilestoneDurationInMonths: 3
            }
        };

        await youtubePlatform.handleChatMessage(membershipItem);
        await new Promise((resolve) => setImmediate(resolve));

        expect(membershipEvents).toHaveLength(1);
        expect(membershipEvents[0]).toMatchObject({
            platform: 'youtube',
            type: 'platform:paypiggy',
            username: 'MemberUser',
            userId: 'UC_TEST_CHANNEL_00999',
            membershipLevel: 'Gold Member',
            message: 'Welcome to the membership',
            months: 3
        });
        expect(membershipEvents[0].timestamp).toBe(new Date(1704067200000).toISOString());
    });

});
