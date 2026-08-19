import { describe, expect, it } from 'bun:test';
import {
    normalizeRowEffects,
    normalizeRowSpriteUrl,
    normalizeRowTheme
} from '../../../src/core/row-presentation';

describe('row presentation validation', () => {
    it('normalizes themes and ordered effects without accepting partial malformed lists', () => {
        expect(normalizeRowTheme(' RED ')).toBe('red');
        expect(normalizeRowEffects(['particles', 'sheen', 'particles'])).toEqual(['particles', 'sheen']);
        expect(normalizeRowEffects([])).toEqual([]);
        expect(normalizeRowEffects(['sheen', 'glow'])).toBeUndefined();
    });

    it('returns only canonical bounded HTTPS sprite URLs', () => {
        expect(normalizeRowSpriteUrl(' https://EXAMPLE.invalid/member sprite.gif '))
            .toBe('https://example.invalid/member%20sprite.gif');
        expect(normalizeRowSpriteUrl('https://user:pass@example.invalid/member.gif#fragment')).toBeUndefined();
        expect(normalizeRowSpriteUrl(`https://example.invalid/${'é'.repeat(700)}`)).toBeUndefined();
    });
});
