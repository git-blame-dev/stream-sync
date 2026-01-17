const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const {
    logChatMessage,
    logChatMessageDebug,
    logChatMessageSkipped,
    logChatMessageStats,
    getChatLogLevel,
    logChatMessageWithConfig
} = require('../../../src/utils/chat-logger');

describe('chat-logger', () => {
    let mockLogger;

    beforeEach(() => {
        mockLogger = {
            warn: createMockFn(),
            console: createMockFn(),
            debug: createMockFn(),
            info: createMockFn()
        };
    });

    afterEach(() => {
        restoreAllMocks();
    });

    describe('logChatMessage', () => {
        it('returns early when platform or data missing', () => {
            logChatMessage(null, null, {}, { logger: mockLogger });

            expect(mockLogger.console).not.toHaveBeenCalled();
        });

        it('truncates long messages', () => {
            const longMessage = 'x'.repeat(210);

            logChatMessage('twitch', { username: 'User', userId: 'u1', message: longMessage }, { maxMessageLength: 50 }, { logger: mockLogger });

            expect(mockLogger.console).toHaveBeenCalled();
            const logged = mockLogger.console.mock.calls[0][0];
            expect(logged.endsWith('...')).toBe(true);
        });

        it('includes userId when configured', () => {
            logChatMessage('youtube', { username: 'User', userId: '123', message: 'hi' }, { includeUserId: true, truncateMessage: false }, { logger: mockLogger });

            expect(mockLogger.console).toHaveBeenCalledWith('[youtube] User (123): hi', 'chat-logger');
        });
    });

    describe('logChatMessageDebug', () => {
        it('skips when platform or data missing', () => {
            logChatMessageDebug(null, null, '', { logger: mockLogger });

            expect(mockLogger.debug).not.toHaveBeenCalled();
        });

        it('logs debug message with context when provided', () => {
            logChatMessageDebug('tiktok', { username: 'User', userId: 'abc', message: 'hello' }, 'context', { logger: mockLogger });

            expect(mockLogger.debug).toHaveBeenCalledWith('[tiktok Debug] context: User (abc) - hello', 'chat-logger');
        });
    });

    describe('logChatMessageSkipped', () => {
        it('logs skip reason when all params present', () => {
            logChatMessageSkipped('twitch', { username: 'User', userId: 'u1' }, 'empty', { logger: mockLogger });

            expect(mockLogger.debug).toHaveBeenCalledWith('[twitch] Skipping message from User (u1): empty', 'chat-logger');
        });

        it('returns when required params missing', () => {
            logChatMessageSkipped(null, null, null, { logger: mockLogger });

            expect(mockLogger.debug).not.toHaveBeenCalled();
        });
    });

    describe('logChatMessageStats', () => {
        it('logs stats when platform and stats provided', () => {
            logChatMessageStats('youtube', { total: 10, processed: 8, skipped: 2, commands: 1 }, { logger: mockLogger });

            expect(mockLogger.info).toHaveBeenCalledWith('[youtube] Chat Stats - Total: 10, Processed: 8, Skipped: 2, Commands: 1', 'chat-logger');
        });

        it('returns when platform or stats missing', () => {
            logChatMessageStats(null, null, { logger: mockLogger });

            expect(mockLogger.info).not.toHaveBeenCalled();
        });
    });

    describe('getChatLogLevel', () => {
        it('returns debug when config absent or logging disabled globally', () => {
            expect(getChatLogLevel(null, 'twitch')).toBe('debug');
            expect(getChatLogLevel({ general: { logChatMessages: false } }, 'twitch')).toBe('debug');
        });

        it('returns debug when platform logging disabled', () => {
            expect(getChatLogLevel({ twitch: { logChatMessages: false } }, 'twitch')).toBe('debug');
        });

        it('returns console when logging enabled', () => {
            expect(getChatLogLevel({ general: { logChatMessages: true } }, 'twitch')).toBe('console');
        });
    });

    describe('logChatMessageWithConfig', () => {
        it('logs to console when config permits', () => {
            logChatMessageWithConfig('twitch', { username: 'User', userId: 'u1', message: 'hello' }, { general: { logChatMessages: true } }, {}, { logger: mockLogger });

            expect(mockLogger.console).toHaveBeenCalled();
        });

        it('skips console when logging disabled', () => {
            logChatMessageWithConfig('twitch', { username: 'User', userId: 'u1', message: 'hello' }, { general: { logChatMessages: false } }, {}, { logger: mockLogger });

            expect(mockLogger.console).not.toHaveBeenCalled();
        });
    });
});
