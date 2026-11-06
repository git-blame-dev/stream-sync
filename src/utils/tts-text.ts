import { wordBudgetPrefix } from './utf16-budget-prefix';

// Bun supports Unicode string properties, including complete flags/keycaps/ZWJ sequences.
const EMOJI_SEQUENCE = new RegExp('\\p{RGI_Emoji}', 'gv');
const DEFAULT_NAME = 'Unknown User';
export const TTS_USERNAME_LIMIT = 50;

/** Preserve sentence punctuation and emoji; remove markup/control noise and normalize spacing. */
export function normalizeTtsText(value: unknown): string {
    if (typeof value !== 'string') return '';
    return value
        .replace(/<\/?[A-Za-z][^>]*>+/g, ' ')
        .replace(/[\p{Cc}\u200B\u200E\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/gu, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\s+([,.;:!?])/g, '$1')
        .trim();
}

function cleanName(value: unknown): string {
    if (typeof value !== 'string') return '';
    return normalizeTtsText(value.replace(EMOJI_SEQUENCE, ' ').normalize('NFKC'))
        .replace(/[_\.@]+/g, ' ')
        .replace(/[^\p{L}\p{M}\p{N}\s'’\-]/gu, ' ')
        .replace(/\d+/g, digits => digits[0] ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        // Filter punctuation first so it cannot expose new ornaments on another pass.
        // Keep this letter within words so actual Bamum names remain valid.
        .replace(/^(?:𖤐(?:\s+|$))+|(?:\s+𖤐)+$/gu, ' ')
        .trim();
}

/** Speech-only name policy; callers supply configuration rather than this module loading it. */
export function formatTtsUsername(value: unknown, maxLength = TTS_USERNAME_LIMIT, fallback: unknown = DEFAULT_NAME): string {
    const limit = Number.isFinite(maxLength) && maxLength >= 0 ? Math.floor(maxLength) : TTS_USERNAME_LIMIT;
    if (limit === 0) return '';
    for (const candidate of [value, fallback, DEFAULT_NAME]) {
        const name = cleanName(candidate);
        if (!/[\p{L}\p{N}]/u.test(name)) continue;
        const shortened = wordBudgetPrefix(name, limit);
        if (/[\p{L}\p{N}]/u.test(shortened)) return shortened;
    }
    return '';
}
