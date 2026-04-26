import { describe, expect, test } from 'bun:test';

import { getSyntheticFixture } from '../../../../helpers/platform-test-data';
import { normalizeYouTubeEvent } from '../../../../../src/platforms/youtube/events/event-normalizer';

type UnknownRecord = Record<string, unknown>;

const assertRecord = (value: unknown, label: string): UnknownRecord => {
    if (!value || typeof value !== 'object') {
        throw new Error(`${label} must be an object`);
    }

    return value as UnknownRecord;
};

describe('normalizeYouTubeEvent', () => {
    test('hydrates gift purchase author from header fields', () => {
        const fixture = getSyntheticFixture('youtube', 'gift-purchase-header');
        const fixtureRecord = assertRecord(fixture, 'fixture');
        const fixtureItem = assertRecord(fixtureRecord.item, 'fixture.item');
        const headerOnly = {
            ...fixtureRecord,
            item: {
                ...fixtureItem,
                author: undefined
            }
        };

        const result = normalizeYouTubeEvent(headerOnly);
        const normalizedChatItem = assertRecord(result.normalizedChatItem, 'result.normalizedChatItem');
        const normalizedItem = assertRecord(normalizedChatItem.item, 'result.normalizedChatItem.item');
        const normalizedAuthor = assertRecord(normalizedItem.author, 'result.normalizedChatItem.item.author');
        const header = assertRecord(fixtureItem.header, 'fixture.item.header');
        const headerAuthorName = assertRecord(header.author_name, 'fixture.item.header.author_name');

        expect(result.eventType).toBe('LiveChatSponsorshipsGiftPurchaseAnnouncement');
        expect(normalizedAuthor).toMatchObject({
            id: fixtureItem.author_external_channel_id,
            name: headerAuthorName.text
        });
    });

    test('returns missing author metadata for gift purchase without header author', () => {
        const fixture = getSyntheticFixture('youtube', 'gift-purchase-header');
        const fixtureRecord = assertRecord(fixture, 'fixture');
        const fixtureItem = assertRecord(fixtureRecord.item, 'fixture.item');
        const header = assertRecord(fixtureItem.header, 'fixture.item.header');
        const headerOnly = {
            ...fixtureRecord,
            item: {
                ...fixtureItem,
                author: undefined,
                author_external_channel_id: undefined,
                header: {
                    ...header,
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
        const normalizedChatItem = assertRecord(result.normalizedChatItem, 'result.normalizedChatItem');
        const normalizedItem = assertRecord(normalizedChatItem.item, 'result.normalizedChatItem.item');

        expect(result.eventType).toBe('LiveChatTextMessage');
        expect(normalizedItem.id).toBe('LCC.wrapper-001');
        expect(normalizedItem.timestamp_usec).toBe('1704067200000000');
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
        const wrappedNormalizedChatItem = assertRecord(wrappedResult.normalizedChatItem, 'wrappedResult.normalizedChatItem');
        const wrappedItem = assertRecord(wrappedNormalizedChatItem.item, 'wrappedResult.normalizedChatItem.item');
        const wrappedMessage = assertRecord(wrappedItem.message, 'wrappedResult.normalizedChatItem.item.message');
        const directNormalizedChatItem = assertRecord(directResult.normalizedChatItem, 'directResult.normalizedChatItem');
        const directItem = assertRecord(directNormalizedChatItem.item, 'directResult.normalizedChatItem.item');
        const directMessage = assertRecord(directItem.message, 'directResult.normalizedChatItem.item.message');

        expect(wrappedMessage.runs).toEqual(wrapped.item.message.runs);
        expect(directMessage.runs).toEqual(direct.message.runs);
    });

    test('keeps direct items with empty type as unrecognized structures', () => {
        const result = normalizeYouTubeEvent({ type: '' });

        expect(result.normalizedChatItem).toBeNull();
        expect(result.debugMetadata).toMatchObject({
            reason: 'unrecognized_structure',
            hasType: false,
            keys: ['type']
        });
    });
});
