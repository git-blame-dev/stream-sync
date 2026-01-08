
const { getSyntheticFixture } = require('../../helpers/platform-test-data');

const realChatMessage = getSyntheticFixture('youtube', 'chat-message');
const realChatNoAtPrefix = getSyntheticFixture('youtube', 'chat-no-at-prefix');
const realSuperSticker = getSyntheticFixture('youtube', 'supersticker');
const realSuperChat = getSyntheticFixture('youtube', 'superchat');
const giftPurchaseHeaderOnly = getSyntheticFixture('youtube', 'gift-purchase-header');

describe('YouTube Author Extraction - Modern (Production Data)', () => {
    let YouTubeAuthorExtractor;

    beforeEach(() => {
        // Fresh require each test to avoid state pollution
        jest.resetModules();
        YouTubeAuthorExtractor = require('../../../src/utils/youtube-author-extractor');
    });

    describe('Real Chat Message Format', () => {
        it('extracts author from chat message with @ prefix in name', () => {
            const author = YouTubeAuthorExtractor.extractAuthor(realChatMessage);

            // User-visible outcome: correct author data extracted
            expect(author.id).toBe('UC1234567890ABCDE1234567');
            expect(author.name).toBe('TestUser'); // @ prefix stripped
            expect(author.thumbnailUrl).toContain('yt-user-64.jpg');
            expect(author.isModerator).toBe(false);
            expect(author.isVerified).toBe(false);
        });

        it('extracts author from chat message without @ prefix in name', () => {
            const author = YouTubeAuthorExtractor.extractAuthor(realChatNoAtPrefix);

            // User-visible outcome: handles names without @ prefix
            expect(author.id).toBe('UC7654321098ZYXWVUTSRQ10');
            expect(author.name).toBe('UserWithoutAtPrefix');
            expect(author.thumbnailUrl).toContain('yt-user-no-at-64.jpg');
        });

        it('does NOT create fake displayName field', () => {
            const author = YouTubeAuthorExtractor.extractAuthor(realChatMessage);

            // User-visible outcome: NO fake fields in output
            expect(author).not.toHaveProperty('displayName');
            expect(Object.keys(author)).not.toContain('displayName');
        });

        it('extracts badges array', () => {
            const author = YouTubeAuthorExtractor.extractAuthor(realChatMessage);

            // User-visible outcome: badges preserved
            expect(Array.isArray(author.badges)).toBe(true);
            expect(author.badges).toEqual([]);
        });
    });

    describe('Real SuperSticker Format', () => {
        it('extracts author from SuperSticker event', () => {
            const author = YouTubeAuthorExtractor.extractAuthor(realSuperSticker);

            // User-visible outcome: donor information extracted
            expect(author.id).toBe('UC1234567890ABCDE1234567');
            expect(author.name).toBe('StickerSupporter');
            expect(author.thumbnailUrl).toContain('yt-sticker-64.jpg');
        });

        it('extracts member badge from SuperSticker donor', () => {
            const author = YouTubeAuthorExtractor.extractAuthor(realSuperSticker);

            // User-visible outcome: member badge present
            expect(Array.isArray(author.badges)).toBe(true);
            expect(author.badges.length).toBe(1);
            expect(author.badges[0].tooltip).toBe('New member');
        });

        it('reads snake_case fields from YouTube API correctly', () => {
            const author = YouTubeAuthorExtractor.extractAuthor(realSuperSticker);

            // User-visible outcome: API's snake_case fields converted to camelCase
            expect(author.isModerator).toBe(false); // from is_moderator
            expect(author.isVerified).toBe(false);   // from is_verified
        });
    });

    describe('Real SuperChat Format', () => {
        it('extracts author from SuperChat event', () => {
            const author = YouTubeAuthorExtractor.extractAuthor(realSuperChat);

            // User-visible outcome: SuperChat donor extracted
            expect(author.id).toBe('UC1234567890ABCDE1234567');
            expect(author.name).toBe('SuperChatDonor');
            expect(author.thumbnailUrl).toContain('yt-donor-64.jpg');
        });
    });

    describe('Error Handling - User Experience', () => {
        it('returns null for null input', () => {
            const author = YouTubeAuthorExtractor.extractAuthor(null);

            // User-visible outcome: missing authors are rejected
            expect(author).toBeNull();
        });

        it('returns null for undefined input', () => {
            const author = YouTubeAuthorExtractor.extractAuthor(undefined);

            // User-visible outcome: missing authors are rejected
            expect(author).toBeNull();
        });

        it('returns null for invalid object', () => {
            const author = YouTubeAuthorExtractor.extractAuthor({});

            // User-visible outcome: handles empty objects
            expect(author).toBeNull();
        });

        it('returns null for malformed item', () => {
            const malformed = {
                type: 'AddChatItemAction',
                item: {
                    type: 'LiveChatTextMessage',
                    // Missing author field
                    message: { text: 'test' }
                }
            };

            const author = YouTubeAuthorExtractor.extractAuthor(malformed);

            // User-visible outcome: graceful degradation
            expect(author).toBeNull();
        });

        it('returns null when author lacks canonical id', () => {
            const malformed = {
                item: {
                    author: {
                        channelId: 'UC-FAKE-ALIAS-123',
                        name: 'AliasUser',
                        thumbnails: [{ url: 'https://example.com/alias-user.jpg' }]
                    }
                }
            };

            const author = YouTubeAuthorExtractor.extractAuthor(malformed);

            expect(author).toBeNull();
        });

        it('returns null when item.author is missing even if header data exists', () => {
            const headerOnly = {
                ...giftPurchaseHeaderOnly,
                item: {
                    ...giftPurchaseHeaderOnly.item,
                    author: undefined
                }
            };
            const author = YouTubeAuthorExtractor.extractAuthor(headerOnly);

            expect(author).toBeNull();
        });
    });

    describe('Output Structure - Consistency', () => {
        it('always returns consistent field structure', () => {
            const author = YouTubeAuthorExtractor.extractAuthor(realChatMessage);

            // User-visible outcome: predictable output shape
            expect(author).toMatchObject({
                id: expect.any(String),
                name: expect.any(String),
                thumbnailUrl: expect.any(String),
                badges: expect.any(Array),
                isModerator: expect.any(Boolean),
                isVerified: expect.any(Boolean)
            });
        });

        it('does NOT include debugging metadata in output', () => {
            const author = YouTubeAuthorExtractor.extractAuthor(realChatMessage);

            // User-visible outcome: clean output, no internal metadata
            expect(author).not.toHaveProperty('source');
            expect(author).not.toHaveProperty('format');
            expect(author).not.toHaveProperty('isAnonymous');
        });
    });
});
