const { describe, test, expect } = require('bun:test');

const { normalizeTikTokGiftEvent } = require('../../../../../src/platforms/tiktok/events/event-normalizer');

const baseGiftPayload = {
    user: {
        userId: 'test-user-id-1',
        uniqueId: 'test-user-1',
        nickname: 'test-user-one'
    },
    giftDetails: {
        giftName: 'Rose',
        diamondCount: 1,
        giftType: 0
    },
    gift: {
        giftPictureUrl: 'https://example.invalid/tiktok/gifts/rose.webp'
    },
    repeatCount: 1,
    common: {
        msgId: 'test-msg-1',
        createTime: Date.parse('2025-01-20T12:00:00.000Z')
    }
};

const normalizerOptions = {
    getTimestamp: (payload) => new Date(payload.common.createTime).toISOString(),
    getPlatformMessageId: (payload) => payload.common.msgId
};

describe('normalizeTikTokGiftEvent', () => {
    test('maps avatarUrl from user.profilePictureUrl', () => {
        const payload = {
            ...baseGiftPayload,
            user: {
                ...baseGiftPayload.user,
                profilePictureUrl: 'https://example.invalid/tiktok-avatar-direct.jpg'
            }
        };

        const event = normalizeTikTokGiftEvent(payload, normalizerOptions);

        expect(event.avatarUrl).toBe('https://example.invalid/tiktok-avatar-direct.jpg');
    });

    test('maps avatarUrl from first user.profilePicture.url entry', () => {
        const payload = {
            ...baseGiftPayload,
            user: {
                ...baseGiftPayload.user,
                profilePicture: {
                    url: ['https://example.invalid/tiktok-avatar-array.jpg']
                }
            }
        };

        const event = normalizeTikTokGiftEvent(payload, normalizerOptions);

        expect(event.avatarUrl).toBe('https://example.invalid/tiktok-avatar-array.jpg');
    });

    test('maps giftImageUrl from gift image payload fields', () => {
        const event = normalizeTikTokGiftEvent(baseGiftPayload, normalizerOptions);

        expect(event.giftImageUrl).toBe('https://example.invalid/tiktok/gifts/rose.webp');
    });
});
