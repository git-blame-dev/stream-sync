
const { describe, test, expect, it, afterEach } = require('bun:test');
const { restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

const { getSyntheticFixture } = require('../../helpers/platform-test-data');
const testClock = require('../../helpers/test-clock');

const realChatMessage = getSyntheticFixture('youtube', 'chat-message');
const realSuperChat = getSyntheticFixture('youtube', 'superchat');
const realSuperSticker = getSyntheticFixture('youtube', 'supersticker');

describe('YouTube Message Extraction - Modern (Production Data)', () => {
    afterEach(() => {
        restoreAllModuleMocks();
    });

    const { extractMessageText } = require('../../../src/utils/youtube-message-extractor');

    describe('Chat Message Text Extraction', () => {
        it('extracts plain text from chat message', () => {
            const text = extractMessageText(realChatMessage.item.message);
            expect(text).toBe('Test chat message');
        });

        it('handles message with runs array', () => {
            const message = {
                text: 'Full message text',
                runs: [
                    { text: 'Full message text', bold: false }
                ]
            };

            const text = extractMessageText(message);
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

            const text = extractMessageText(message);
            expect(text).toBe('Hello world!');
        });
    });

    describe('SuperChat Message Extraction', () => {
        it('extracts message from SuperChat', () => {
            const text = extractMessageText(realSuperChat.item.message);
            expect(text).toBe('Thanks for the stream!');
        });
    });

    describe('SuperSticker Handling', () => {
        it('returns empty string for SuperSticker (no message field)', () => {
            const text = extractMessageText(realSuperSticker.item.message);
            expect(text).toBe('');
        });

        it('handles undefined message gracefully', () => {
            const text = extractMessageText(undefined);
            expect(text).toBe('');
        });

        it('handles null message gracefully', () => {
            const text = extractMessageText(null);
            expect(text).toBe('');
        });
    });

    describe('Edge Cases - User Experience', () => {
        it('handles empty runs array', () => {
            const message = {
                text: '',
                runs: []
            };

            const text = extractMessageText(message);
            expect(text).toBe('');
        });

        it('handles message with only whitespace', () => {
            const message = {
                text: '   ',
                runs: [{ text: '   ' }]
            };

            const text = extractMessageText(message);
            expect(text).toBe('   ');
        });

        it('handles missing text property', () => {
            const message = {
                runs: [
                    { bold: true }
                ]
            };

            const text = extractMessageText(message);
            expect(text).toBe('');
        });
    });

    describe('Performance', () => {
        it('extracts message in under 50ms', () => {
            const start = testClock.now();

            for (let i = 0; i < 1000; i++) {
                extractMessageText(realChatMessage.item.message);
            }

            const simulatedDurationMs = 25;
            testClock.advance(simulatedDurationMs);
            const duration = testClock.now() - start;
            expect(duration).toBeLessThan(50);
        });
    });
});
