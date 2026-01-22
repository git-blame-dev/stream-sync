const { describe, test, expect } = require('bun:test');

const { normalizeYouTubeEvent } = require('../../../../../src/platforms/youtube/events/event-normalizer');
const { getSyntheticFixture } = require('../../../../helpers/platform-test-data');

describe('normalizeYouTubeEvent', () => {
    test('hydrates gift purchase author from header fields', () => {
        const fixture = getSyntheticFixture('youtube', 'gift-purchase-header');
        const headerOnly = {
            ...fixture,
            item: {
                ...fixture.item,
                author: undefined
            }
        };

        const result = normalizeYouTubeEvent(headerOnly);

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

        const result = normalizeYouTubeEvent(headerOnly);

        expect(result.normalizedChatItem).toBeNull();
        expect(result.debugMetadata).toMatchObject({
            reason: 'missing_gift_purchase_author',
            eventType: 'LiveChatSponsorshipsGiftPurchaseAnnouncement'
        });
    });

    test('hydrates wrapper id and timestamp_usec into chat item', () => {
        const chatItem = {
            id: 'LCC.wrapper-001',
            timestamp_usec: '1704067200000000',
            item: {
                type: 'LiveChatTextMessage',
                author: {
                    id: 'UC_TEST_CHANNEL_000001',
                    name: 'WrapperUser'
                },
                message: { text: 'Hello' }
            }
        };

        const result = normalizeYouTubeEvent(chatItem);

        expect(result.eventType).toBe('LiveChatTextMessage');
        expect(result.normalizedChatItem).not.toBeNull();
        expect(result.normalizedChatItem.item.id).toBe('LCC.wrapper-001');
        expect(result.normalizedChatItem.item.timestamp_usec).toBe('1704067200000000');
    });
});
