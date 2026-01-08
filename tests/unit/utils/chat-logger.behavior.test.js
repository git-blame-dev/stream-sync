
jest.mock('../../../src/core/logging', () => ({
    logger: {
        warn: jest.fn(),
        console: jest.fn(),
        debug: jest.fn(),
        info: jest.fn()
    }
}));

const { logger } = require('../../../src/core/logging');
const {
    logChatMessage,
    logChatMessageDebug,
    logChatMessageSkipped,
    logChatMessageStats,
    getChatLogLevel,
    logChatMessageWithConfig
} = require('../../../src/utils/chat-logger');

describe('chat-logger', () => {
    beforeEach(() => {
        logger.warn = logger.warn || jest.fn();
        logger.console = logger.console || jest.fn();
        logger.debug = logger.debug || jest.fn();
        logger.info = logger.info || jest.fn();
        jest.clearAllMocks();
    });

    describe('logChatMessage', () => {
        it('warns and returns when platform or data missing', () => {
            logChatMessage(null, null);

            expect(logger.warn).toHaveBeenCalled();
            expect(logger.console).not.toHaveBeenCalled();
        });

        it('uses username and truncates long messages', () => {
            const longMessage = 'x'.repeat(210);

            logChatMessage('twitch', { username: 'User', userId: 'u1', message: longMessage }, { maxMessageLength: 50 });

            expect(logger.console).toHaveBeenCalledWith(expect.stringContaining('[twitch] User:'), 'chat-logger');
            const logged = logger.console.mock.calls[0][0];
            expect(logged.endsWith('...')).toBe(true);
        });

        it('includes userId when configured', () => {
            logChatMessage('youtube', { username: 'User', userId: '123', message: 'hi' }, { includeUserId: true, truncateMessage: false });

            expect(logger.console).toHaveBeenCalledWith('[youtube] User (123): hi', 'chat-logger');
        });
    });

    describe('logChatMessageDebug', () => {
        it('skips when platform or data missing', () => {
            logChatMessageDebug(null, null);

            expect(logger.debug).not.toHaveBeenCalled();
        });

        it('logs debug message with context when provided', () => {
            logChatMessageDebug('tiktok', { username: 'User', userId: 'abc', message: 'hello' }, 'context');

            expect(logger.debug).toHaveBeenCalledWith('[tiktok Debug] context: User (abc) - hello', 'chat-logger');
        });
    });

    describe('logChatMessageSkipped', () => {
        it('logs skip reason when all params present', () => {
            logChatMessageSkipped('twitch', { username: 'User', userId: 'u1' }, 'empty');

            expect(logger.debug).toHaveBeenCalledWith('[twitch] Skipping message from User (u1): empty', 'chat-logger');
        });

        it('returns when required params missing', () => {
            logChatMessageSkipped(null, null, null);

            expect(logger.debug).not.toHaveBeenCalled();
        });
    });

    describe('logChatMessageStats', () => {
        it('logs stats when platform and stats provided', () => {
            logChatMessageStats('youtube', { total: 10, processed: 8, skipped: 2, commands: 1 });

            expect(logger.info).toHaveBeenCalledWith('[youtube] Chat Stats - Total: 10, Processed: 8, Skipped: 2, Commands: 1', 'chat-logger');
        });

        it('returns when platform or stats missing', () => {
            logChatMessageStats(null, null);

            expect(logger.info).not.toHaveBeenCalled();
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
            logChatMessageWithConfig('twitch', { username: 'User', userId: 'u1', message: 'hello' }, { general: { logChatMessages: true } });

            expect(logger.console).toHaveBeenCalled();
            expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Chat message logged from twitch'), 'chat-logger', expect.any(Object));
        });

        it('logs debug when console logging disabled', () => {
            logChatMessageWithConfig('twitch', { username: 'User', userId: 'u1', message: 'hello' }, { general: { logChatMessages: false } });

            expect(logger.console).not.toHaveBeenCalled();
            expect(logger.debug).toHaveBeenCalledWith('[twitch Debug] console logging disabled: User (u1) - hello', 'chat-logger');
        });
    });
});
