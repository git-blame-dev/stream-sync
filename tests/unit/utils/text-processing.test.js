
const { initializeTestLogging } = require('../../helpers/test-setup');
const { noOpLogger } = require('../../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');
const {
    TextProcessingManager,
    createTextProcessingManager,
    formatTimestampCompact
} = require('../../../src/utils/text-processing');

initializeTestLogging();

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

describe('Text Processing', () => {
    let textProcessing;
    let mockLogger;
    let mockConstants;
    let mockConfig;

    beforeEach(() => {
        mockLogger = noOpLogger;
        mockConstants = {
            MAX_USERNAME_LENGTH: 12,
            MAX_MESSAGE_LENGTH: 500,
            DEFAULT_CURRENCY: 'USD'
        };
        mockConfig = {
            textProcessing: {
                maxUsernameLength: 12,
                maxMessageLength: 500,
                enableEmojis: true
            }
        };

        textProcessing = createTextProcessingManager({ logger: mockLogger });
    });

    describe('when extracting message text', () => {
        it('should extract text from YouTube message array', () => {
            const messageParts = [
                { text: 'Hello' },
                { emojiText: '😊' },
                { text: ' world!' }
            ];

            const extracted = textProcessing.extractMessageText(messageParts, 'youtube');

            expect(extracted).toBe('Hello😊 world!');
        });

        it('should extract text from Twitch message array', () => {
            const messageParts = [
                { text: 'Hello' },
                { emojiText: 'Kappa' },
                { text: ' world!' }
            ];

            const extracted = textProcessing.extractMessageText(messageParts, 'twitch');

            expect(extracted).toBe('HelloKappa world!');
        });

        it('should handle string messages', () => {
            const message = 'Simple string message';
            const extracted = textProcessing.extractMessageText(message, 'tiktok');

            expect(extracted).toBe('Simple string message');
        });

        it('should handle empty message parts', () => {
            expect(textProcessing.extractMessageText(null, 'youtube')).toBe('');
            expect(textProcessing.extractMessageText(undefined, 'twitch')).toBe('');
            expect(textProcessing.extractMessageText([], 'tiktok')).toBe('');
        });

        it('should handle mixed message part types', () => {
            const messageParts = [
                'Hello',
                { text: ' world' },
                { emojiText: '😊' },
                '!'
            ];

            const extracted = textProcessing.extractMessageText(messageParts, 'youtube');

            expect(extracted).toBe('Hello world😊!');
        });

        it('returns empty string for non-array payloads on youtube branch', () => {
            const extracted = textProcessing.extractMessageText({ text: 'ignored' }, 'youtube');

            expect(extracted).toBe('');
        });

        it('stringifies unexpected payloads for non-youtube platforms', () => {
            const extracted = textProcessing.extractMessageText({ text: 'payload' }, 'twitch');

            expect(extracted).toBe('[object Object]');
        });

        it('should trim whitespace from string messages', () => {
            const message = '  Hello world!  ';
            const extracted = textProcessing.extractMessageText(message, 'twitch');

            expect(extracted).toBe('Hello world!');
        });
    });

    describe('sanitizeUsername hardening', () => {
        it('removes HTML/JS while preserving readable text and emoji', () => {
            const manager = new TextProcessingManager({ logger: mockLogger });

            const result = manager.sanitizeUsername('<b>Alice</b><script>javascript:alert(1)</script> 😃');

            expect(result).toBe('Alicealert(1) 😃');
        });

        it('returns empty when all content is unsafe', () => {
            const manager = new TextProcessingManager({ logger: mockLogger });

            const result = manager.sanitizeUsername('<script></script>');

            expect(result).toBe('');
        });

        it('decodes entities and url encoding while stripping control characters', () => {
            const manager = new TextProcessingManager({ logger: mockLogger });

            const result = manager.sanitizeUsername('Bob%20&amp;Co\n');

            expect(result).toBe('Bob &Co');
        });

        it('returns empty for non-string input', () => {
            const manager = new TextProcessingManager({ logger: mockLogger });

            expect(manager.sanitizeUsername(null)).toBe('');
            expect(manager.sanitizeUsername(123)).toBe('');
        });
    });

    describe('smartTruncateUsername behavior', () => {
        it('truncates repetitive usernames aggressively', () => {
            const manager = new TextProcessingManager({ logger: mockLogger });

            const result = manager.smartTruncateUsername('AAAAAAAAAAAA', 5);

            expect(result).toBe('AAAAA');
        });

        it('preserves international usernames even when longer than maxLength', () => {
            const manager = new TextProcessingManager({ logger: mockLogger });
            const username = 'こんにちは世界こんにちは世界';

            const result = manager.smartTruncateUsername(username, 5);

            expect(result).toBe(username);
        });

        it('truncates extremely long international usernames above hard cap', () => {
            const manager = new TextProcessingManager({ logger: mockLogger });
            const username = 'こんにちは世界'.repeat(15); // length > 60

            const result = manager.smartTruncateUsername(username, 20);

            expect(result.length).toBe(20);
        });
    });

    describe('determineGiftName behavior', () => {
        let manager;

        beforeEach(() => {
            manager = new TextProcessingManager({ logger: mockLogger });
        });

        it('returns provided giftType when present', () => {
            expect(manager.determineGiftName({ giftType: 'Custom Gift' }, 'youtube', 'platform:gift')).toBe('Custom Gift');
        });

        it('falls back to generic gift or unknown when no mapping exists', () => {
            expect(manager.determineGiftName({}, 'tiktok', 'platform:gift')).toBe('gift');
            expect(manager.determineGiftName({}, 'twitch', 'platform:paypiggy')).toBe('unknown');
        });
    });

    describe('truncate/slug edge cases', () => {
        it('truncates very long text with ellipsis preserving words', () => {
            const longText = 'word '.repeat(200);
            const truncated = textProcessing.truncateText(longText, 50, true);

            expect(truncated.length).toBeLessThanOrEqual(50);
            expect(truncated.endsWith('...')).toBe(true);
        });

        it('generates slug with mixed emoji/HTML/JS removed', () => {
            const slug = textProcessing.toSlug('Hello <b>World</b> 😀 javascript:alert(1)');

            expect(slug).toContain('hello');
            expect(slug).not.toContain('<');
            expect(slug).not.toContain('javascript:');
        });

        it('wraps text while normalizing whitespace', () => {
            const wrapped = textProcessing.wrapText('Line1   Line2\tLine3', 6);

            const lines = wrapped.split('\n');
            expect(lines.length).toBeGreaterThan(1);
            expect(lines[0].trim()).toBe('Line1');
        });

        it('returns empty string when wrapping non-string input', () => {
            expect(textProcessing.wrapText(null, 10)).toBe('');
            expect(textProcessing.wrapText(12345, 10)).toBe('');
        });

        it('keeps unbreakable long words on single line when exceeding limit', () => {
            const longWord = 'Supercalifragilisticexpialidocious';
            const wrapped = textProcessing.wrapText(longWord, 10);

            expect(wrapped).toBe(longWord);
        });

        it('extracts hashtags while ignoring URLs and HTML/script fragments', () => {
            const hashtags = textProcessing.extractHashtags('#fun https://example.com <b>#tag</b> javascript:alert(1) #safe');

            expect(hashtags).toEqual(['#fun', '#tag', '#safe']);
        });

        it('creates slugs that drop URLs and emoji while collapsing punctuation', () => {
            const slug = textProcessing.toSlug('Hello!!! https://example.com 😀 script:alert(1)');

            expect(slug).toBe('hello-httpsexamplecom-scriptalert1');
        });

        it('trims leading/trailing hyphens after cleaning punctuation', () => {
            const slug = textProcessing.toSlug('---Hello World---');

            expect(slug).toBe('hello-world');
        });

        it('extracts hashtags and ignores emoji plus javascript urls', () => {
            const hashtags = textProcessing.extractHashtags('#wow 🚀 #cool javascript:alert(1) #end');

            expect(hashtags).toEqual(['#wow', '#cool', '#end']);
        });

        it('normalizes whitespace to single spaces before slugging', () => {
            const slug = textProcessing.toSlug('Hello\t\tWorld\nNew Line');

            expect(slug).toBe('hello-world-new-line');
        });

        it('formats viewer count to 0 for invalid inputs', () => {
            expect(textProcessing.formatViewerCount(NaN)).toBe('0');
            expect(textProcessing.formatViewerCount(undefined)).toBe('0');
            expect(textProcessing.formatViewerCount(-10)).toBe('0');
        });

        it('returns ellipsis when preserveWords cannot fit any word', () => {
            const truncated = textProcessing.truncateText('Supercalifragilisticexpialidocious', 5, true);

            expect(truncated).toBe('...');
        });

        it('returns empty string for non-string title casing', () => {
            expect(textProcessing.toTitleCase(123)).toBe('');
        });

        it('normalizes whitespace in cleanText and strips tabs/newlines', () => {
            const cleaned = textProcessing.cleanText('\tHello   World\nNew\tLine  ');

            expect(cleaned).toBe('Hello World New Line');
        });

        it('keeps underscores in slugs while collapsing whitespace', () => {
            const slug = textProcessing.toSlug('Hello   _World_  Test');

            expect(slug).toBe('hello-_world_-test');
        });

        it('truncates long text without preserving words and preserves emoji safely', () => {
            const truncated = textProcessing.truncateText('😀Emoji start with verylongwordthatexceedslimit', 10, false);

            expect(truncated).toBe('😀Emoji...');
        });

        it('returns empty slug for non-string inputs', () => {
            expect(textProcessing.toSlug(null)).toBe('');
            expect(textProcessing.toSlug(undefined)).toBe('');
            expect(textProcessing.toSlug(123)).toBe('');
        });

        it('returns empty slug when all content is stripped', () => {
            expect(textProcessing.toSlug('😀!!! ###')).toBe('');
        });

        it('ignores malformed hashtag fragments and scripts', () => {
            expect(textProcessing.extractHashtags('# <script>#bad</script>')).toEqual(['#bad']);
        });

        it('normalizes non-breaking spaces when slugging', () => {
            const slug = textProcessing.toSlug('Hello\u00a0World');

            expect(slug).toBe('hello-world');
        });

        it('collapses multiple hyphens after cleaning punctuation', () => {
            const slug = textProcessing.toSlug('Hello---World!!!');

            expect(slug).toBe('hello-world');
        });
    });

    describe('text cleaning and extraction edge cases', () => {
        it('normalizes whitespace and strips HTML/JS safely', () => {
            const cleaned = textProcessing.cleanText(' Hello <b>World</b>\n\n<script>alert(1)</script> &amp; \t tabs ');

            expect(cleaned).toBe('Hello World alert(1) & tabs');
        });

        it('returns empty string for whitespace-only input', () => {
            expect(textProcessing.cleanText('   \n\t  ')).toBe('');
        });

        it('handles non-string input in cleanText gracefully', () => {
            expect(textProcessing.cleanText(null)).toBe('');
            expect(textProcessing.cleanText(1234)).toBe('');
        });

        it('extracts hashtags while ignoring emoji and javascript fragments', () => {
            const hashtags = textProcessing.extractHashtags('#fun 🚀 #rocket-launch <b>#html</b> javascript:alert(1) #ok');

            expect(hashtags).toEqual(['#fun', '#rocket', '#html', '#ok']);
        });

        it('creates slugs that drop emoji and strip script markup', () => {
            const slug = textProcessing.toSlug('😀 Fun Time <script>alert(1)</script> https://example.com/path');

            expect(slug).toBe('fun-time-scriptalert1script-httpsexamplecompath');
            expect(slug).not.toContain('😀');
        });
    });

    describe('when formatting coin amounts', () => {
        it('should format coin amounts correctly', () => {
            expect(textProcessing.formatCoinAmount(100)).toBe('100 coins');
            expect(textProcessing.formatCoinAmount(1)).toBe('1 coin');
            expect(textProcessing.formatCoinAmount(4.5)).toBe('4.5 coins');
        });

        it('returns empty string when coin amount is missing', () => {
            expect(textProcessing.formatCoinAmount(null)).toBe('');
            expect(textProcessing.formatCoinAmount(undefined)).toBe('');
        });

        it('should handle zero values', () => {
            expect(textProcessing.formatCoinAmount(0)).toBe('');
        });

        it('should handle large numbers', () => {
            expect(textProcessing.formatCoinAmount(100000)).toBe('100000 coins');
            expect(textProcessing.formatCoinAmount(999999)).toBe('999999 coins');
        });
    });

    describe('when formatting chat messages', () => {
        it('should format basic chat message', () => {
            const formatted = textProcessing.formatChatMessage('chat', 'testuser', 'Hello world!');

            expect(formatted).toContain('testuser');
            expect(formatted).toContain('Hello world!');
        });

        it('should truncate long usernames', () => {
            const longUsername = 'verylongusername123';
            const formatted = textProcessing.formatChatMessage('chat', longUsername, 'Message');

            expect(formatted).toContain('verylonguser');
            expect(formatted).not.toContain('verylongusername123');
        });

        it('should handle different message types', () => {
            const giftFormatted = textProcessing.formatChatMessage('gift', 'gifter', 'Rose');
            const followFormatted = textProcessing.formatChatMessage('follow', 'follower', '');

            expect(giftFormatted).toContain('gift');
            expect(followFormatted).toContain('follow');
        });

        it('should handle empty messages', () => {
            const formatted = textProcessing.formatChatMessage('chat', 'testuser', '');

            expect(formatted).toContain('testuser');
            expect(formatted).not.toContain('undefined');
        });

        it('returns null when username is missing', () => {
            const formatted = textProcessing.formatChatMessage('alert', '', 'Alert message');

            expect(formatted).toBeNull();
        });

        it('should truncate usernames for TTS contexts when truncateUsername is true', () => {
            const longUsername = 'verylongusername123';
            const formatted = textProcessing.formatChatMessage('chat', longUsername, 'Hello world!', {}, true);

            expect(formatted).toContain('verylonguser'); // 12-character limit
            expect(formatted).not.toContain('verylongusername123');
            expect(formatted).toContain('Hello world!');
        });

        it('should preserve full usernames for display contexts when truncateUsername is false', () => {
            const longUsername = 'verylongusername123';
            const formatted = textProcessing.formatChatMessage('chat', longUsername, 'Hello world!', {}, false);

            expect(formatted).toContain('verylongusername123'); // Full username preserved
            expect(formatted).toBe('verylongusername123: Hello world!'); // Exact match - full username
            expect(formatted).toContain('Hello world!');
        });

        it('should default to truncation for backward compatibility when truncateUsername not specified', () => {
            const longUsername = 'verylongusername123';
            const formatted = textProcessing.formatChatMessage('chat', longUsername, 'Hello world!');

            expect(formatted).toContain('verylonguser'); // Should default to truncated
            expect(formatted).not.toContain('verylongusername123');
        });

        it('should handle short usernames correctly regardless of truncateUsername setting', () => {
            const shortUsername = 'user';
            const formattedTTS = textProcessing.formatChatMessage('chat', shortUsername, 'Hello!', {}, true);
            const formattedDisplay = textProcessing.formatChatMessage('chat', shortUsername, 'Hello!', {}, false);

            expect(formattedTTS).toContain('user');
            expect(formattedDisplay).toContain('user');
            expect(formattedTTS).toBe(formattedDisplay); // Should be identical for short usernames
        });

        it('should work with different message types and truncation settings', () => {
            const longUsername = 'verylongusername123';
            
            const giftTTS = textProcessing.formatChatMessage('gift', longUsername, 'Rose', {}, true);
            const giftDisplay = textProcessing.formatChatMessage('gift', longUsername, 'Rose', {}, false);
            const notificationTTS = textProcessing.formatChatMessage('notification', longUsername, 'alert', {}, true);
            const notificationDisplay = textProcessing.formatChatMessage('notification', longUsername, 'alert', {}, false);
            
            expect(giftTTS).toBe('verylonguser: Rose'); // TTS truncated - colon format (default)
            expect(giftDisplay).toBe('verylongusername123: Rose'); // Display full - colon format (default)
            expect(notificationTTS).toBe('[verylonguser] alert'); // TTS truncated - bracket format
            expect(notificationDisplay).toBe('[verylongusername123] alert'); // Display full - bracket format
        });
    });

    describe('when formatting durations', () => {
        it('should format milliseconds to readable duration', () => {
            expect(textProcessing.formatDuration(1000)).toBe('1s');
            expect(textProcessing.formatDuration(60000)).toBe('1m');
            expect(textProcessing.formatDuration(3600000)).toBe('1h');
            expect(textProcessing.formatDuration(3661000)).toBe('1h 1m 1s');
        });

        it('should handle zero duration', () => {
            expect(textProcessing.formatDuration(0)).toBe('0s');
        });

        it('should clamp negative or falsy durations to zero seconds', () => {
            expect(textProcessing.formatDuration(-500)).toBe('0s');
            expect(textProcessing.formatDuration(null)).toBe('0s');
        });

        it('should handle very long durations', () => {
            expect(textProcessing.formatDuration(86400000)).toBe('24h');
            expect(textProcessing.formatDuration(90061000)).toBe('25h 1m 1s');
        });

        it('should handle decimal values', () => {
            expect(textProcessing.formatDuration(1500)).toBe('1.5s');
            expect(textProcessing.formatDuration(30500)).toBe('30.5s');
        });
    });

    describe('when formatting numbers', () => {
        it('should format numbers with default decimals', () => {
            expect(textProcessing.formatNumber(1234.5678)).toBe('1,234.6');
            expect(textProcessing.formatNumber(1000000)).toBe('1,000,000.0');
        });

        it('should format numbers with custom decimals', () => {
            expect(textProcessing.formatNumber(1234.5678, 2)).toBe('1,234.57');
            expect(textProcessing.formatNumber(1234.5678, 0)).toBe('1,235');
        });

        it('should handle zero and negative numbers', () => {
            expect(textProcessing.formatNumber(0)).toBe('0.0');
            expect(textProcessing.formatNumber(-1234.56)).toBe('-1,234.6');
        });

        it('should handle very large numbers', () => {
            expect(textProcessing.formatNumber(999999999)).toBe('999,999,999.0');
            expect(textProcessing.formatNumber(1000000000)).toBe('1,000,000,000.0');
        });

        it('returns fallback for non-numeric strings', () => {
            expect(textProcessing.formatNumber('not-a-number')).toBe('0.0');
        });
    });

    describe('when truncating text', () => {
        it('should truncate text to specified length', () => {
            const longText = 'This is a very long text that needs to be truncated';
            const truncated = textProcessing.truncateText(longText, 20);

            expect(truncated.length).toBeLessThanOrEqual(20);
            expect(truncated).toContain('...');
        });

        it('should preserve words when specified', () => {
            const text = 'This is a sentence with words';
            const truncated = textProcessing.truncateText(text, 15, true);

            expect(truncated).toBe('This is a...');
        });

        it('should not truncate short text', () => {
            const shortText = 'Short text';
            const result = textProcessing.truncateText(shortText, 20);

            expect(result).toBe(shortText);
        });

        it('should handle empty text', () => {
            expect(textProcessing.truncateText('', 10)).toBe('');
            expect(textProcessing.truncateText(null, 10)).toBe('');
        });

        it('should return ellipsis when maxLength too small to include content', () => {
            const truncated = textProcessing.truncateText('abcdef', 3, false);

            expect(truncated).toBe('...');
        });

        it('should return ellipsis when preserveWords cannot fit the first word', () => {
            const truncated = textProcessing.truncateText('supercalifragilisticexpialidocious', 10, true);

            expect(truncated).toBe('...');
        });
    });

    describe('when converting to title case', () => {
        it('should convert text to title case', () => {
            expect(textProcessing.toTitleCase('hello world')).toBe('Hello World');
            expect(textProcessing.toTitleCase('THE QUICK BROWN FOX')).toBe('The Quick Brown Fox');
        });

        it('should handle single words', () => {
            expect(textProcessing.toTitleCase('hello')).toBe('Hello');
            expect(textProcessing.toTitleCase('WORLD')).toBe('World');
        });

        it('should handle empty text', () => {
            expect(textProcessing.toTitleCase('')).toBe('');
            expect(textProcessing.toTitleCase(null)).toBe('');
        });

        it('should handle special characters', () => {
            expect(textProcessing.toTitleCase('hello-world')).toBe('Hello-World');
            expect(textProcessing.toTitleCase('hello_world')).toBe('Hello_World');
        });
    });

    describe('when cleaning text', () => {
        it('should remove HTML tags', () => {
            expect(textProcessing.cleanText('<b>Hello</b> world')).toBe('Hello world');
            expect(textProcessing.cleanText('<script>alert("xss")</script>')).toBe('alert("xss")');
        });

        it('should normalize whitespace', () => {
            expect(textProcessing.cleanText('  Hello   world  ')).toBe('Hello world');
            expect(textProcessing.cleanText('Hello\n\tworld')).toBe('Hello world');
        });

        it('should handle special characters', () => {
            expect(textProcessing.cleanText('Hello &amp; world')).toBe('Hello & world');
            expect(textProcessing.cleanText('Hello&#39;s world')).toBe('Hello\'s world');
        });

        it('decodes HTML entities and strips resulting tags safely', () => {
            const cleaned = textProcessing.cleanText('Hello &lt;script&gt;alert(1)&lt;/script&gt; &quot;World&quot;');

            expect(cleaned).toBe('Hello alert(1) \"World\"');
        });

        it('should handle empty text', () => {
            expect(textProcessing.cleanText('')).toBe('');
            expect(textProcessing.cleanText(null)).toBe('');
        });
    });

    describe('when extracting hashtags', () => {
        it('should extract hashtags from text', () => {
            const text = 'Hello #world #test #hashtag';
            const hashtags = textProcessing.extractHashtags(text);

            expect(hashtags).toEqual(['#world', '#test', '#hashtag']);
        });

        it('should handle text without hashtags', () => {
            const text = 'Hello world without hashtags';
            const hashtags = textProcessing.extractHashtags(text);

            expect(hashtags).toEqual([]);
        });

        it('should handle empty text', () => {
            expect(textProcessing.extractHashtags('')).toEqual([]);
            expect(textProcessing.extractHashtags(null)).toEqual([]);
        });

        it('should handle hashtags with numbers', () => {
            const text = 'Hello #test123 #world2023';
            const hashtags = textProcessing.extractHashtags(text);

            expect(hashtags).toEqual(['#test123', '#world2023']);
        });

        it('should strip trailing punctuation from hashtags', () => {
            const hashtags = textProcessing.extractHashtags('Testing #hash! and #cool?');

            expect(hashtags).toEqual(['#hash', '#cool']);
        });

        it('should ignore hashtags inside URLs and HTML', () => {
            const hashtags = textProcessing.extractHashtags('Visit https://example.com/#fragment and <b>#html</b>');

            expect(hashtags).toEqual(['#html']);
        });

        it('should ignore hashtags that are part of javascript urls', () => {
            const hashtags = textProcessing.extractHashtags('Click javascript:alert(1)#bad then #good');

            expect(hashtags).toEqual(['#good']);
        });

        it('should keep emoji-adjacent hashtags after stripping html and script-like urls', () => {
            const hashtags = textProcessing.extractHashtags('🔥#fire🔥 <span>#hidden</span> javascript:alert(1)#bad #ok');

            expect(hashtags).toEqual(['#fire', '#hidden', '#ok']);
        });
    });

    describe('when extracting mentions', () => {
        it('should extract mentions from text', () => {
            const text = 'Hello @user1 @user2 @testuser';
            const mentions = textProcessing.extractMentions(text);

            expect(mentions).toEqual(['@user1', '@user2', '@testuser']);
        });

        it('should handle text without mentions', () => {
            const text = 'Hello world without mentions';
            const mentions = textProcessing.extractMentions(text);

            expect(mentions).toEqual([]);
        });

        it('should handle empty text', () => {
            expect(textProcessing.extractMentions('')).toEqual([]);
            expect(textProcessing.extractMentions(null)).toEqual([]);
        });

        it('should ignore emails and punctuation around mentions', () => {
            const mentions = textProcessing.extractMentions('Contact @user, email test@example.com and @admin.');

            expect(mentions).toEqual(['@user', '@admin']);
        });

        it('should handle mentions with underscores', () => {
            const text = 'Hello @test_user @user_123';
            const mentions = textProcessing.extractMentions(text);

            expect(mentions).toEqual(['@test_user', '@user_123']);
        });
    });

    describe('when converting to slug', () => {
        it('should convert text to URL-friendly slug', () => {
            expect(textProcessing.toSlug('Hello World')).toBe('hello-world');
            expect(textProcessing.toSlug('The Quick Brown Fox')).toBe('the-quick-brown-fox');
        });

        it('should handle special characters', () => {
            expect(textProcessing.toSlug('Hello & World')).toBe('hello-world');
            expect(textProcessing.toSlug('Test@123')).toBe('test123');
        });

        it('should handle multiple spaces and dashes', () => {
            expect(textProcessing.toSlug('Hello   World')).toBe('hello-world');
            expect(textProcessing.toSlug('Hello---World')).toBe('hello-world');
        });

        it('should handle empty text', () => {
            expect(textProcessing.toSlug('')).toBe('');
            expect(textProcessing.toSlug(null)).toBe('');
        });

        it('strips emoji and collapses punctuation into a stable slug', () => {
            expect(textProcessing.toSlug('Emoji 😊 Mix--Case & Stuff')).toBe('emoji-mix-case-stuff');
        });
    });

    describe('when wrapping text', () => {
        it('should wrap text to specified line length', () => {
            const longText = 'This is a very long text that needs to be wrapped to multiple lines for better readability';
            const wrapped = textProcessing.wrapText(longText, 20);

            expect(wrapped).toContain('\n');
            expect(wrapped.split('\n').every(line => line.length <= 20)).toBe(true);
        });

        it('should handle text shorter than line length', () => {
            const shortText = 'Short text';
            const wrapped = textProcessing.wrapText(shortText, 20);

            expect(wrapped).toBe(shortText);
        });

        it('should handle empty text', () => {
            expect(textProcessing.wrapText('', 20)).toBe('');
            expect(textProcessing.wrapText(null, 20)).toBe('');
        });

        it('should respect word boundaries', () => {
            const text = 'This is a test of word boundary wrapping';
            const wrapped = textProcessing.wrapText(text, 10);

            expect(wrapped.split('\n').every(line => {
                const words = line.trim().split(' ');
                return words.every(word => word.length <= 10);
            })).toBe(true);
        });

        it('places unbreakable long words on their own line without truncation', () => {
            const longWord = 'supercalifragilisticexpialidocious';
            const wrapped = textProcessing.wrapText(longWord, 10);

            expect(wrapped).toBe(longWord);
        });
    });

    describe('when generating log filenames', () => {
        it('should generate valid log filenames', () => {
            const filename = textProcessing.generateLogFilename('twitch', 'testuser');

            expect(filename).toMatch(/twitch-testuser-\d{4}-\d{2}-\d{2}\.txt$/);
        });

        it('should sanitize usernames in filenames', () => {
            const filename = textProcessing.generateLogFilename('youtube', 'user@#$%^&*()');

            expect(filename).toMatch(/youtube-user-\d{4}-\d{2}-\d{2}\.txt$/);
        });

        it('should handle different platforms', () => {
            const twitchFilename = textProcessing.generateLogFilename('twitch', 'user');
            const youtubeFilename = textProcessing.generateLogFilename('youtube', 'user');

            expect(twitchFilename).toContain('twitch');
            expect(youtubeFilename).toContain('youtube');
        });

        it('returns null when username is missing', () => {
            const filename = textProcessing.generateLogFilename('tiktok', '');

            expect(filename).toBeNull();
        });
    });

    describe('when formatting viewer counts', () => {
        it('should format small viewer counts', () => {
            expect(textProcessing.formatViewerCount(0)).toBe('0');
            expect(textProcessing.formatViewerCount(123)).toBe('123');
            expect(textProcessing.formatViewerCount(999)).toBe('999');
        });

        it('should format thousands with K suffix', () => {
            expect(textProcessing.formatViewerCount(1000)).toBe('1K');
            expect(textProcessing.formatViewerCount(1500)).toBe('1.5K');
            expect(textProcessing.formatViewerCount(9999)).toBe('10K');
        });

        it('should format millions with M suffix', () => {
            expect(textProcessing.formatViewerCount(1000000)).toBe('1M');
            expect(textProcessing.formatViewerCount(1500000)).toBe('1.5M');
            expect(textProcessing.formatViewerCount(9999999)).toBe('10M');
        });

        it('should handle very large numbers', () => {
            expect(textProcessing.formatViewerCount(1000000000)).toBe('1B');
            expect(textProcessing.formatViewerCount(1500000000)).toBe('1.5B');
        });

        it('should format numeric strings by coercing to numbers', () => {
            expect(textProcessing.formatViewerCount('1500')).toBe('1.5K');
        });
    });

    describe('when formatting log entries', () => {
        it('should format log entry correctly', () => {
            const timestamp = new Date('2023-01-01T12:00:00Z');
            const entry = textProcessing.formatLogEntry(timestamp, 'testuser', 'Hello world', 'twitch');

            expect(entry).toContain('2023-01-01');
            expect(entry).toContain('testuser');
            expect(entry).toContain('Hello world');
            expect(entry).toContain('twitch');
        });

        it('should handle different platforms', () => {
            const timestamp = new Date();
            const twitchEntry = textProcessing.formatLogEntry(timestamp, 'user', 'msg', 'twitch');
            const youtubeEntry = textProcessing.formatLogEntry(timestamp, 'user', 'msg', 'youtube');

            expect(twitchEntry).toContain('twitch');
            expect(youtubeEntry).toContain('youtube');
        });

        it('formats Date timestamps using date-only ISO segment', () => {
            const entry = textProcessing.formatLogEntry(
                new Date('2024-01-02T03:04:05Z'),
                'User',
                'Hello',
                'YouTube'
            );

            expect(entry.startsWith('[2024-01-02]')).toBe(true);
            expect(entry).toContain('[YouTube]');
            expect(entry).toContain('User: Hello');
            expect(entry).not.toContain('03:04:05');
        });

        it('preserves string timestamps as provided', () => {
            const entry = textProcessing.formatLogEntry('12:34:56', 'User', 'Hi', 'TikTok');

            expect(entry.startsWith('[12:34:56]')).toBe(true);
        });
    });

    describe('when formatting timestamps', () => {
        it('should format timestamp in compact HH:MM:SS format', () => {
            const timestamp = new Date('2023-01-01T12:30:45Z');
            const formatted = formatTimestampCompact(timestamp);

            expect(formatted).toMatch(/^\d{2}:\d{2}:\d{2}$/);
        });

        it('should handle different times', () => {
            const morning = new Date('2023-01-01T09:05:30Z');
            const evening = new Date('2023-01-01T23:59:59Z');

            expect(formatTimestampCompact(morning)).toBe('09:05:30');
            expect(formatTimestampCompact(evening)).toBe('23:59:59');
        });

        it('formats numeric timestamps using UTC with leading zeros', () => {
            const date = Date.UTC(2024, 0, 1, 5, 4, 3);

            expect(formatTimestampCompact(date)).toBe('05:04:03');
        });
    });

    describe('edge cases and error handling', () => {
        it('should handle very long messages', () => {
            const longMessage = 'A'.repeat(10000);
            const extracted = textProcessing.extractMessageText(longMessage, 'twitch');

            expect(extracted).toBe(longMessage);
        });

        it('should handle special characters in usernames', () => {
            const specialUsername = 'user@#$%^&*()_+-=[]{}|\\:";\'<>?,./';
            const formatted = textProcessing.formatChatMessage('chat', specialUsername, 'message');

            expect(formatted).toContain('user');
        });

        it('should handle unicode characters', () => {
            const unicodeText = 'こんにちは世界！🌟🎉';
            const extracted = textProcessing.extractMessageText(unicodeText, 'youtube');

            expect(extracted).toBe(unicodeText);
        });

        it('should handle null and undefined gracefully', () => {
            expect(textProcessing.extractMessageText(null, 'twitch')).toBe('');
            expect(textProcessing.extractMessageText(undefined, 'youtube')).toBe('');
            expect(textProcessing.formatNumber(null)).toBe('0.0');
            expect(textProcessing.cleanText(null)).toBe('');
        });

        it('handles invalid timestamps gracefully when formatting compact time', () => {
            const formatted = formatTimestampCompact('not-a-date');

            expect(formatted).toBe('00:00:00');
        });
    });

});
