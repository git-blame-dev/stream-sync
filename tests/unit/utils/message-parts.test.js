const { describe, it, expect } = require('bun:test');

const {
    getMessagePartsFromPayload,
    isValidMessagePart,
    getValidMessageParts
} = require('../../../src/utils/message-parts');

describe('message parts utility', () => {
    it('prefers canonical message.parts over fallback sources', () => {
        const payload = {
            message: {
                parts: [{ type: 'text', text: 'canonical' }]
            },
            messageParts: [{ type: 'text', text: 'top-level' }],
            metadata: {
                messageParts: [{ type: 'text', text: 'metadata' }]
            }
        };

        const parts = getMessagePartsFromPayload(payload);

        expect(parts).toEqual([{ type: 'text', text: 'canonical' }]);
    });

    it('uses top-level messageParts when canonical message.parts is missing', () => {
        const payload = {
            messageParts: [{ type: 'text', text: 'top-level' }],
            metadata: {
                messageParts: [{ type: 'text', text: 'metadata' }]
            }
        };

        const parts = getMessagePartsFromPayload(payload);

        expect(parts).toEqual([{ type: 'text', text: 'top-level' }]);
    });

    it('validates emote and text parts with strict defaults', () => {
        expect(isValidMessagePart({ type: 'emote', emoteId: '1234', imageUrl: 'https://example.invalid/e.webp' })).toBe(true);
        expect(isValidMessagePart({ type: 'emote', emoteId: '   ', imageUrl: 'https://example.invalid/e.webp' })).toBe(false);
        expect(isValidMessagePart({ type: 'text', text: ' hello ' })).toBe(true);
        expect(isValidMessagePart({ type: 'text', text: '   ' })).toBe(false);
    });

    it('allows whitespace-only text parts when explicitly enabled', () => {
        expect(isValidMessagePart({ type: 'text', text: '   ' }, { allowWhitespaceText: true })).toBe(true);
    });

    it('filters invalid entries from payload part arrays', () => {
        const payload = {
            message: {
                parts: [
                    { type: 'emote', emoteId: '1234', imageUrl: 'https://example.invalid/e.webp' },
                    { type: 'emote', emoteId: '', imageUrl: 'https://example.invalid/invalid.webp' },
                    { type: 'text', text: 'hello' },
                    { type: 'text', text: '   ' }
                ]
            }
        };

        const parts = getValidMessageParts(payload);

        expect(parts).toEqual([
            { type: 'emote', emoteId: '1234', imageUrl: 'https://example.invalid/e.webp' },
            { type: 'text', text: 'hello' }
        ]);
    });
});
