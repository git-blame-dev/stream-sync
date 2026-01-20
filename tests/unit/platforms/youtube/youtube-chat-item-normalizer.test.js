const { describe, test, expect } = require('bun:test');

const { normalizeYouTubeChatItem } = require('../../../../src/platforms/youtube/events/youtube-chat-item-normalizer');
const { getSyntheticFixture } = require('../../../helpers/platform-test-data');

describe('normalizeYouTubeChatItem', () => {
    test('hydrates gift purchase author from header fields', () => {
        const fixture = getSyntheticFixture('youtube', 'gift-purchase-header');
        const headerOnly = {
            ...fixture,
            item: {
                ...fixture.item,
                author: undefined
            }
        };

        const result = normalizeYouTubeChatItem(headerOnly);

        expect(result.eventType).toBe('LiveChatSponsorshipsGiftPurchaseAnnouncement');
        expect(result.normalizedChatItem).not.toBeNull();
        expect(result.normalizedChatItem.item.author).toMatchObject({
            id: fixture.item.author_external_channel_id,
            name: fixture.item.header.author_name.text
        });
    });

    test('returns missing author metadata for gift purchase without header author', () => {
        const fixture = getSyntheticFixture('youtube', 'gift-purchase-header');
        const headerOnly = {
            ...fixture,
            item: {
                ...fixture.item,
                author: undefined,
                author_external_channel_id: undefined,
                header: {
                    ...fixture.item.header,
                    author_name: undefined
                }
            }
        };

        const result = normalizeYouTubeChatItem(headerOnly);

        expect(result.normalizedChatItem).toBeNull();
        expect(result.debugMetadata).toMatchObject({
            reason: 'missing_gift_purchase_author',
            eventType: 'LiveChatSponsorshipsGiftPurchaseAnnouncement'
        });
    });
});
