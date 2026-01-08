
const { getSyntheticFixture } = require('../../helpers/platform-test-data');

const realChatMessage = getSyntheticFixture('youtube', 'chat-message');
const realSuperChat = getSyntheticFixture('youtube', 'superchat');
const realSuperSticker = getSyntheticFixture('youtube', 'supersticker');

describe('YouTube Message Extraction - Modern (Production Data)', () => {
    let YouTubeMessageExtractor;

    beforeEach(() => {
        jest.resetModules();
        YouTubeMessageExtractor = require('../../../src/utils/youtube-message-extractor');
    });

    describe('Chat Message Text Extraction', () => {
        it('extracts plain text from chat message', () => {
            const text = YouTubeMessageExtractor.extractMessageText(realChatMessage.item.message);

            // User-visible outcome: message text extracted
            expect(text).toBe('Test chat message');
        });

        it('handles message with runs array', () => {
            const message = {
                text: 'Full message text',
                runs: [
                    { text: 'Full message text', bold: false }
                ]
            };

            const text = YouTubeMessageExtractor.extractMessageText(message);

            // User-visible outcome: text from runs
            expect(text).toBe('Full message text');
        });

        it('concatenates multiple runs', () => {
            const message = {
                runs: [
                    { text: 'Hello ' },
                    { text: 'world', bold: true },
                    { text: '!' }
                ]
            };

            const text = YouTubeMessageExtractor.extractMessageText(message);

            // User-visible outcome: all runs combined
            expect(text).toBe('Hello world!');
        });
    });

    describe('SuperChat Message Extraction', () => {
        it('extracts message from SuperChat', () => {
            const text = YouTubeMessageExtractor.extractMessageText(realSuperChat.item.message);

            // User-visible outcome: SuperChat message extracted
            expect(text).toBe('Thanks for the stream!');
        });
    });

    describe('SuperSticker Handling', () => {
        it('returns empty string for SuperSticker (no message field)', () => {
            // SuperStickers don't have messages in real YouTube API
            const text = YouTubeMessageExtractor.extractMessageText(realSuperSticker.item.message);

            // User-visible outcome: no message for stickers
            expect(text).toBe('');
        });

        it('handles undefined message gracefully', () => {
            const text = YouTubeMessageExtractor.extractMessageText(undefined);

            // User-visible outcome: graceful fallback
            expect(text).toBe('');
        });

        it('handles null message gracefully', () => {
            const text = YouTubeMessageExtractor.extractMessageText(null);

            // User-visible outcome: graceful fallback
            expect(text).toBe('');
        });
    });

    describe('Edge Cases - User Experience', () => {
        it('handles empty runs array', () => {
            const message = {
                text: '',
                runs: []
            };

            const text = YouTubeMessageExtractor.extractMessageText(message);

            // User-visible outcome: empty string
            expect(text).toBe('');
        });

        it('handles message with only whitespace', () => {
            const message = {
                text: '   ',
                runs: [{ text: '   ' }]
            };

            const text = YouTubeMessageExtractor.extractMessageText(message);

            // User-visible outcome: whitespace preserved (YouTube's choice)
            expect(text).toBe('   ');
        });

        it('handles missing text property', () => {
            const message = {
                runs: [
                    { bold: true }  // No text property
                ]
            };

            const text = YouTubeMessageExtractor.extractMessageText(message);

            // User-visible outcome: empty when no text
            expect(text).toBe('');
        });
    });

    describe('Performance', () => {
        it('extracts message in under 50ms', () => {
            const start = Date.now();

            for (let i = 0; i < 1000; i++) {
                YouTubeMessageExtractor.extractMessageText(realChatMessage.item.message);
            }

            const duration = Date.now() - start;

            // User-visible outcome: fast extraction
            expect(duration).toBeLessThan(50);
        });
    });
});
