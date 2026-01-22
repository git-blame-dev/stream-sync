const { describe, test, expect } = require('bun:test');
const { noOpLogger } = require('../../../../helpers/mock-factories');
const { getSyntheticFixture } = require('../../../../helpers/platform-test-data');
const { createYouTubeMonetizationParser } = require('../../../../../src/platforms/youtube/monetization/monetization-parser');

describe('YouTube monetization parser', () => {
    test('parses numeric purchase_amount with explicit currency', () => {
        const parser = createYouTubeMonetizationParser({ logger: noOpLogger });
        const fixture = getSyntheticFixture('youtube', 'superchat');
        const chatItem = {
            ...fixture,
            item: {
                ...fixture.item,
                purchase_amount: 25,
                purchase_currency: 'usd'
            }
        };

        const result = parser.parseSuperChat(chatItem);

        expect(result.amount).toBe(25);
        expect(result.currency).toBe('USD');
        expect(result.giftType).toBe('Super Chat');
    });

    test('coerces giftMembershipsCount numeric strings', () => {
        const parser = createYouTubeMonetizationParser({ logger: noOpLogger });
        const fixture = getSyntheticFixture('youtube', 'gift-purchase-header');
        const chatItem = {
            ...fixture,
            item: {
                ...fixture.item,
                giftMembershipsCount: '7'
            }
        };

        const result = parser.parseGiftPurchase(chatItem);

        expect(result.giftCount).toBe(7);
    });

    test('accepts timestamp_usec for membership timestamps', () => {
        const parser = createYouTubeMonetizationParser({ logger: noOpLogger });
        const chatItem = {
            item: {
                type: 'LiveChatMembershipItem',
                id: 'LCC.membership-001',
                timestamp_usec: '1704067200000000',
                author: {
                    id: 'UC_TEST_CHANNEL_000010',
                    name: 'MemberUser'
                },
                headerPrimaryText: { text: 'Member' },
                headerSubtext: { text: 'Welcome' }
            }
        };

        const result = parser.parseMembership(chatItem);

        expect(result.timestamp).toBe(new Date(1704067200000).toISOString());
    });

    test('throws when timestamp is blank', () => {
        const parser = createYouTubeMonetizationParser({ logger: noOpLogger });
        const chatItem = {
            item: {
                type: 'LiveChatPaidMessage',
                id: 'LCC.superchat-blank-ts',
                timestamp: '   ',
                purchase_amount: 5,
                purchase_currency: 'USD',
                author: {
                    id: 'UC_TEST_CHANNEL_000020',
                    name: 'BlankTsUser'
                },
                message: { text: 'Hello' }
            }
        };

        expect(() => parser.parseSuperChat(chatItem)).toThrow('requires timestamp');
    });

    test('converts microsecond timestamps when provided in timestamp field', () => {
        const parser = createYouTubeMonetizationParser({ logger: noOpLogger });
        const chatItem = {
            item: {
                timestamp: '1704067200000000'
            }
        };

        const result = parser.resolveTimestamp(chatItem, 'YouTube Super Chat');

        expect(result).toBe(new Date(1704067200000).toISOString());
    });

    test('uses sticker label when name and altText are missing', () => {
        const parser = createYouTubeMonetizationParser({ logger: noOpLogger });
        const chatItem = {
            item: {
                type: 'LiveChatPaidSticker',
                id: 'LCC.sticker-001',
                timestamp_usec: '1704067200000000',
                purchase_amount: 2,
                purchase_currency: 'USD',
                sticker: {
                    label: { runs: [{ text: 'Nice sticker' }] }
                }
            }
        };

        const result = parser.parseSuperSticker(chatItem);

        expect(result.message).toBe('Nice sticker');
    });
});
