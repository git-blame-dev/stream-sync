const { describe, it, expect } = require('bun:test');

const {
    getMessagePartsFromPayload,
    isValidMessagePart,
    getValidMessageParts,
    normalizeBadgeImages
} = require('../../../src/utils/message-parts.ts');

export {};

describe('message parts utility', () => {
    it('reads canonical message.parts only', () => {
        const payload = {
            message: {
                parts: [{ type: 'text', text: 'canonical' }]
            }
        };

        const parts = getMessagePartsFromPayload(payload);

        expect(parts).toEqual([{ type: 'text', text: 'canonical' }]);
    });

    it('returns empty array when canonical message.parts is missing', () => {
        const payload = {
            message: {
                text: 'hello'
            }
        };

        const parts = getMessagePartsFromPayload(payload);

        expect(parts).toEqual([]);
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

    it('normalizes badge images by deduping trimmed urls in stable order', () => {
        const badges = normalizeBadgeImages([
            { imageUrl: ' https://example.invalid/badge-1.png ', source: ' twitch ', label: 'mod' },
            { imageUrl: 'https://example.invalid/badge-1.png', source: 'youtube', label: 'dupe' },
            { imageUrl: 'https://example.invalid/badge-2.png', source: ' youtube ', label: 'member' }
        ]);

        expect(badges).toEqual([
            { imageUrl: 'https://example.invalid/badge-1.png', source: 'twitch', label: 'mod' },
            { imageUrl: 'https://example.invalid/badge-2.png', source: 'youtube', label: 'member' }
        ]);
    });

    it('drops invalid badge entries and returns empty list when nothing usable exists', () => {
        expect(normalizeBadgeImages(null)).toEqual([]);
        expect(normalizeBadgeImages([
            null,
            undefined,
            '',
            {},
            { imageUrl: '   ' },
            { imageUrl: 42 },
            { imageUrl: 'https://example.invalid/badge-1.png' }
        ])).toEqual([
            { imageUrl: 'https://example.invalid/badge-1.png', source: '', label: '' }
        ]);
    });

    it('normalizes non-string label values to an empty string', () => {
        const badges = normalizeBadgeImages([
            { imageUrl: 'https://example.invalid/badge-1.png', source: 'twitch', label: { text: 'mod' } }
        ]);

        expect(badges).toEqual([
            { imageUrl: 'https://example.invalid/badge-1.png', source: 'twitch', label: '' }
        ]);
    });
});
