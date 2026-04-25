const TEST_TIMESTAMP_ISO = '2024-01-01T00:00:00.000Z';
const TEST_TIMESTAMP_USEC = '1704067200000000';

const createTikTokSocialNotificationFixture = (interactionType: 'share' | 'follow' = 'share') => {
    const isShare = interactionType === 'share';
    return {
        user: {
            userId: 'test-tiktok-social-user-id',
            uniqueId: 'test-tiktok-social-user',
            nickname: 'TestTikTokSocialUser',
            profilePicture: {
                url: ['https://example.invalid/tiktok/test-social-avatar.webp']
            }
        },
        common: {
            msgId: `test-tiktok-social-${interactionType}-msg-id`,
            createTime: Date.parse(TEST_TIMESTAMP_ISO),
            displayText: {
                displayType: isShare ? 'pm_mt_guidance_share' : 'pm_main_follow_message_viewer_2',
                defaultPattern: isShare
                    ? '{0:user} shared the LIVE'
                    : '{0:user} followed the LIVE creator'
            }
        }
    };
};

const createTikTokGiftNotificationFixture = () => ({
    user: {
        userId: 'test-tiktok-gift-user-id',
        uniqueId: 'test-tiktok-gift-user',
        nickname: 'TestTikTokGiftUser',
        profilePicture: {
            url: ['https://example.invalid/tiktok/test-gift-avatar.webp']
        }
    },
    giftDetails: {
        giftName: 'Rose',
        diamondCount: 1,
        giftType: 0
    },
    repeatCount: 1,
    common: {
        msgId: 'test-tiktok-gift-msg-id',
        createTime: Date.parse(TEST_TIMESTAMP_ISO)
    }
});

const createYouTubeAuthorThumbnailFixture = (itemType: 'LiveChatPaidMessage' | 'LiveChatMembershipItem') => ({
    item: {
        type: itemType,
        id: `LCC.test-youtube-${itemType.toLowerCase()}-avatar`,
        timestamp_usec: TEST_TIMESTAMP_USEC,
        author: {
            id: 'UC_TEST_CHANNEL_AVATAR_001',
            name: 'TestYouTubeAvatarUser',
            thumbnails: [
                {
                    url: 'https://example.invalid/youtube/test-author-avatar.jpg',
                    width: 64,
                    height: 64
                }
            ]
        },
        purchase_amount: '$5.00',
        giftMembershipsCount: 5,
        message: {
            text: 'test-message'
        },
        headerPrimaryText: { text: 'Member for 3 months' },
        headerSubtext: { text: 'Welcome to Gold' },
        memberMilestoneDurationInMonths: 3
    }
});

const createYouTubeGiftPurchaseHeaderOnlyFixture = () => ({
    item: {
        type: 'LiveChatSponsorshipsGiftPurchaseAnnouncement',
        id: 'LCC.test-youtube-gift-purchase-header-only',
        timestamp_usec: TEST_TIMESTAMP_USEC,
        author_external_channel_id: 'UC_TEST_CHANNEL_GIFTPURCHASE_001',
        header: {
            author_name: {
                text: '@TestGiftPurchaseUser'
            },
            author_photo: [
                {
                    url: 'https://example.invalid/youtube/test-giftpurchase-avatar.jpg',
                    width: 64,
                    height: 64
                }
            ],
            author_badges: []
        },
        giftMembershipsCount: 5,
        message: {
            text: ''
        }
    }
});

const createYouTubeGiftMessageViewFixture = () => ({
    item: {
        type: 'GiftMessageView',
        id: 'LCC.test-youtube-giftmessageview-001',
        timestamp_usec: TEST_TIMESTAMP_USEC,
        text: {
            content: 'sent Girl power for 300 Jewels'
        },
        author_name: {
            content: '@test-youtube-gifter'
        }
    }
});

const createTwitchNotificationPayload = (
    eventType: 'paypiggy' | 'giftpaypiggy' | 'raid' | 'gift',
    overrides: Record<string, unknown> = {}
) => {
    const basePayloadByType: Record<string, Record<string, unknown>> = {
        paypiggy: {
            username: 'test-twitch-paypiggy-user',
            userId: 'test-twitch-paypiggy-user-id',
            tier: '1000',
            months: 1,
            timestamp: TEST_TIMESTAMP_ISO
        },
        giftpaypiggy: {
            username: 'test-twitch-giftpaypiggy-user',
            userId: 'test-twitch-giftpaypiggy-user-id',
            giftCount: 3,
            tier: '1000',
            timestamp: TEST_TIMESTAMP_ISO
        },
        raid: {
            username: 'test-twitch-raider-user',
            userId: 'test-twitch-raider-user-id',
            viewerCount: 50,
            timestamp: TEST_TIMESTAMP_ISO
        },
        gift: {
            username: 'test-twitch-gift-user',
            userId: 'test-twitch-gift-user-id',
            giftType: 'bits',
            giftCount: 100,
            amount: 100,
            currency: 'bits',
            timestamp: TEST_TIMESTAMP_ISO
        }
    };

    return {
        ...(basePayloadByType[eventType] || {}),
        ...overrides
    };
};

export {
    createTikTokSocialNotificationFixture,
    createTikTokGiftNotificationFixture,
    createYouTubeAuthorThumbnailFixture,
    createYouTubeGiftPurchaseHeaderOnlyFixture,
    createYouTubeGiftMessageViewFixture,
    createTwitchNotificationPayload
};
