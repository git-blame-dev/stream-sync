import { describe, expect, test } from 'bun:test';
import { NotificationBuilder } from '../../../src/utils/notification-builder';
import { MessageTTSHandler } from '../../../src/utils/message-tts-handler';
import { formatUsername12 } from '../../../src/utils/validation';
import { formatTtsUsername, normalizeTtsText } from '../../../src/utils/tts-text';

describe('shared speech-name behavior', () => {
    test('preserves real scripts and accents while removing emoji sequences and edge decorations', () => {
        for (const name of ['さくらFox', 'José', '界é', 'ليلى', 'O’Neil']) {
            expect(NotificationBuilder.sanitizeUsernameForTts(name)).toBe(name);
        }
        expect(NotificationBuilder.sanitizeUsernameForTts('𖤐 👨‍👩‍👧‍👦 Sample   Name 🏳️‍🌈 𖤐')).toBe('Sample Name');
        expect(NotificationBuilder.sanitizeUsernameForTts('1️⃣Sample🇦🇺')).toBe('Sample');
    });

    test('uses a bounded fallback instead of returning stripped emoji', () => {
        const value = NotificationBuilder.sanitizeUsernameForTts('🌈'.repeat(100), 5);
        expect(value.length).toBeLessThanOrEqual(5);
        expect(value).toMatch(/[A-Za-z]/);
        expect(value).not.toContain('🌈');
    });

    test('routes shares and computed template fields through speech cleanup without changing display identity', () => {
        const username = '🌈Sample🌈';
        const share = NotificationBuilder.build({ type: 'platform:share', platform: 'tiktok', username });
        expect(share?.ttsMessage).toBe('Sample shared the stream');
        expect(share?.username).toBe(username);
        expect(share?.displayMessage).toContain(username);
        const greeting = NotificationBuilder.build({ type: 'greeting', platform: 'tiktok', username, ttsUsername: '🌈Override🌈' });
        expect(greeting?.ttsMessage).toBe('Hi Sample');
    });

    test('speaks the same name regardless of surrounding message whitespace', () => {
        expect(MessageTTSHandler.createMessageTTS('SyntheticNameAB', ' Hello '))
            .toBe(MessageTTSHandler.createMessageTTS('SyntheticNameAB', 'Hello'));
    });

    test('shares the Unicode-preserving policy with the legacy formatter', () => {
        expect(formatUsername12('🌈José_123🌈', true)).toBe('José 1');
        expect(formatUsername12('<b>Sample</b>', true)).toBe('Sample');
    });

    test('never splits a supplementary letter at a speech-name boundary', () => {
        const value = NotificationBuilder.sanitizeUsernameForTts('aaaaaaaaaaa𐐀', 12);
        expect(value).toBe('aaaaaaaaaaa');
        expect(value.length).toBeLessThanOrEqual(12);
    });

    test('normalizes speech idempotently while retaining sentence meaning and punctuation', () => {
        const input = '  Hello!\n<b>Sample</b>\u0000  Are you there? 👨‍👩‍👧‍👦  ';
        const expected = 'Hello! Sample Are you there? 👨‍👩‍👧‍👦';
        expect(normalizeTtsText(input)).toBe(expected);
        expect(normalizeTtsText(expected)).toBe(expected);
        expect(normalizeTtsText(undefined)).toBe('');
        expect(normalizeTtsText('3 < 5 and 8 > 6.')).toBe('3 < 5 and 8 > 6.');
        expect(MessageTTSHandler.createTTSStages({ ttsMessage: '<b> </b>' })).toEqual([]);
    });

    test('bounds cleaned fallbacks and rejects malformed input without losing valid scripts', () => {
        for (const name of ['🌈'.repeat(100), '\ud800', '\u202E', null, undefined, 12]) {
            expect(formatTtsUsername(name, 5, '🌈')).toBe('Unkno');
        }
        expect(formatTtsUsername('𐐀', 1)).toBe('U');
        expect(formatTtsUsername('Sample', 0)).toBe('');
        expect(formatTtsUsername('Sample', 2.9)).toBe('Sa');
        expect(formatTtsUsername('Sample', NaN)).toBe('Sample');
        expect(formatTtsUsername('𖤐𖤐')).toBe('𖤐𖤐');
        expect(formatTtsUsername('Ｊｏｓé_123')).toBe('José 1');
    });

    test('removes compatibility emoji before compatibility-normalizing real letters', () => {
        for (const emoji of ['ℹ️', '™️', '㊗️']) {
            expect(formatTtsUsername(emoji)).toBe('Unknown User');
            expect(formatTtsUsername(`${emoji}Sample`)).toBe('Sample');
        }
    });

    test('never returns punctuation-only names after truncation', () => {
        for (const budget of [12, 50]) {
            expect(formatTtsUsername('-'.repeat(budget) + 'Sample', budget)).toBe('Unknown User');
        }
    });

    test('normalizes edge ornament runs after separators without deleting embedded Bamum letters', () => {
        for (const input of ['_𖤐_Sample_', '𖤐 𖤐 Sample', 'Sample 𖤐 𖤐']) {
            expect(formatTtsUsername(input)).toBe('Sample');
            expect(formatTtsUsername(formatTtsUsername(input))).toBe('Sample');
        }
        expect(formatTtsUsername('𖤐𖤐')).toBe('𖤐𖤐');
        for (const input of ['𖤐 𖤐', '𖤐 🌈 𖤐']) {
            expect(formatTtsUsername(input)).toBe('Unknown User');
            expect(formatTtsUsername(formatTtsUsername(input))).toBe('Unknown User');
        }
        expect(formatTtsUsername('𖤐, 𖤐')).toBe('Unknown User');
        expect(formatTtsUsername('! 𖤐 Sample 𖤐 !')).toBe('Sample');
    });

    test('malformed markup is normalized in one pass', () => {
        const normalized = normalizeTtsText('<b<b>>Hi');
        expect(normalized).toBe('Hi');
        expect(normalizeTtsText(normalized)).toBe(normalized);
    });
});
