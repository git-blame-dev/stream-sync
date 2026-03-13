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

    test('preserves runs payload for wrapped and direct LiveChatTextMessage forms', () => {
        const wrapped = {
            id: 'LCC.wrapper-002',
            timestamp_usec: '1704067200000001',
            item: {
                type: 'LiveChatTextMessage',
                author: {
                    id: 'UC_TEST_CHANNEL_000002',
                    name: 'WrappedRunsUser'
                },
                message: {
                    runs: [
                        { text: 'hello ' },
                        {
                            emoji: {
                                emoji_id: 'UC_TEST_EMOTE_400/TEST_EMOTE_400',
                                image: [{ url: 'https://yt3.ggpht.example.invalid/test-400=w48-h48-c-k-nd', width: 48 }]
                            }
                        }
                    ]
                }
            }
        };
        const direct = {
            type: 'LiveChatTextMessage',
            author: {
                id: 'UC_TEST_CHANNEL_000003',
                name: 'DirectRunsUser'
            },
            message: {
                runs: [
                    { text: 'hi ' },
                    {
                        emoji: {
                            emoji_id: 'UC_TEST_EMOTE_401/TEST_EMOTE_401',
                            image: [{ url: 'https://yt3.ggpht.example.invalid/test-401=w48-h48-c-k-nd', width: 48 }]
                        }
                    }
                ]
            }
        };

        const wrappedResult = normalizeYouTubeEvent(wrapped);
        const directResult = normalizeYouTubeEvent(direct);

        expect(wrappedResult.normalizedChatItem.item.message.runs).toEqual(wrapped.item.message.runs);
        expect(directResult.normalizedChatItem.item.message.runs).toEqual(direct.message.runs);
    });
});
