
const { describe, test, expect, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../../../helpers/bun-mock-utils');

const { YouTubePlatform } = require('../../../../../src/platforms/youtube');
const { createYouTubeSuperChatEvent } = require('../../../../helpers/youtube-test-data');
const { createMockPlatformDependencies } = require('../../../../helpers/test-setup');
const { createYouTubeConfigFixture } = require('../../../../helpers/config-fixture');

describe('YouTube monetized event pipeline', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    const baseConfig = createYouTubeConfigFixture({
        enabled: true,
        username: 'notification-test'
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

    test('emits paypiggy events for LiveChatMembershipItem payloads', async () => {
        const youtubePlatform = createPlatform();
        const membershipEvents = [];
        youtubePlatform.handlers = {
            ...youtubePlatform.handlers,
            onPaypiggy: (event) => membershipEvents.push(event)
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

    test('emits renewal paypiggy events for real snake_case YouTube membership milestone payloads', async () => {
        const youtubePlatform = createPlatform();
        const membershipEvents = [];
        youtubePlatform.handlers = {
            ...youtubePlatform.handlers,
            onPaypiggy: (event) => membershipEvents.push(event)
        };

        const membershipItem = {
            item: {
                type: 'LiveChatMembershipItem',
                id: 'LCC.test-membership-snake-001',
                timestamp_usec: '1773660646737554',
                author: {
                    id: 'UC_TEST_CHANNEL_01000',
                    name: '@MilestoneUser',
                    thumbnails: [
                        {
                            url: 'https://example.invalid/youtube-membership-avatar.png',
                            width: 64,
                            height: 64
                        }
                    ]
                },
                header_primary_text: {
                    text: 'Member for 10 months',
                    runs: [
                        { text: 'Member for ' },
                        { text: '10' },
                        { text: ' months' }
                    ]
                },
                header_subtext: {
                    text: 'Member',
                    rtl: false
                },
                message: {
                    text: 'Thanks for the membership!',
                    runs: [{ text: 'Thanks for the membership!' }]
                }
            }
        };

        await youtubePlatform.handleChatMessage(membershipItem);
        await new Promise((resolve) => setImmediate(resolve));

        expect(membershipEvents).toHaveLength(1);
        expect(membershipEvents[0]).toMatchObject({
            platform: 'youtube',
            type: 'platform:paypiggy',
            username: 'MilestoneUser',
            userId: 'UC_TEST_CHANNEL_01000',
            avatarUrl: 'https://example.invalid/youtube-membership-avatar.png',
            months: 10,
            message: 'Thanks for the membership!'
        });
        expect(membershipEvents[0].timestamp).toBe(new Date(1773660646737).toISOString());
    });

});
