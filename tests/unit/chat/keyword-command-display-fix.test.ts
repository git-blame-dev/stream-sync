import { beforeEach, describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);

const { initializeTestLogging, createTestUser, TEST_TIMEOUTS } = nodeRequire('../../helpers/test-setup') as {
    initializeTestLogging: () => void;
    createTestUser: (overrides?: { username?: string }) => { username: string };
    TEST_TIMEOUTS: { FAST: number };
};
const { noOpLogger } = nodeRequire('../../helpers/mock-factories') as {
    noOpLogger: {
        debug: (...args: unknown[]) => void;
        info: (...args: unknown[]) => void;
        warn: (...args: unknown[]) => void;
        error: (...args: unknown[]) => void;
    };
};
const { createConfigFixture } = nodeRequire('../../helpers/config-fixture') as {
    createConfigFixture: (overrides?: Record<string, unknown>) => Record<string, unknown>;
};

type CleanupOptions = {
    clearCallsBeforeEach?: boolean;
    logPerformanceMetrics?: boolean;
};

const { setupAutomatedCleanup } = nodeRequire('../../helpers/mock-lifecycle') as {
    setupAutomatedCleanup: (options?: CleanupOptions) => void;
};

initializeTestLogging();

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    logPerformanceMetrics: true
});

type CommandParseResult = {
    type: string;
    command: string;
    filename?: string;
} | null;

type CommandParserConfig = ReturnType<typeof createConfigFixture>;

type CommandParserInstance = {
    parse: (
        chatData: { platform: string; username: string; message: string },
        isFirst: boolean
    ) => CommandParseResult;
};

const { CommandParser } = nodeRequire('../../../src/chat/commands') as {
    CommandParser: new (config: CommandParserConfig, logger: typeof noOpLogger) => CommandParserInstance;
};

const requireParsedResult = (result: CommandParseResult): Exclude<CommandParseResult, null> => {
    expect(result).not.toBeNull();
    if (!result) {
        throw new Error('Expected parsed command result');
    }
    return result;
};

const itFast = (name: string, fn: () => void | Promise<void>) => {
    it(name, fn, { timeout: TEST_TIMEOUTS.FAST });
};

describe('CommandParser Keyword vs Command Display Fix', () => {
    let commandParser: InstanceType<typeof CommandParser>;
    let mockLogger: typeof noOpLogger;
    let mockConfig: CommandParserConfig;

    beforeEach(() => {
        mockLogger = noOpLogger;
        mockConfig = createConfigFixture({
            commands: {
                'im-a-mod': '!mod, vfx top, mod|mods',
                'hello-world': '!hello|!hi, vfx center, hello|hi|greetings',
                'boom-effect': '!boom, vfx bottom, boom|explosion|blast'
            }
        });

        commandParser = new CommandParser(mockConfig, mockLogger);
    });

    describe('when VFX command is triggered by keyword match', () => {
        itFast('should return the actual command trigger (!mod) not the keyword (mod)', () => {
            const testUser = createTestUser({ username: 'testuser' });
            const chatData = {
                platform: 'twitch',
                username: testUser.username,
                message: 'I am a mod'
            };

            const result = commandParser.parse(chatData, false);
            const parsed = requireParsedResult(result);

            expect(parsed.type).toBe('vfx');
            expect(parsed.command).toBe('!mod');
            expect(parsed.filename).toBe('im-a-mod');
        });

        itFast('should return the actual command trigger (!hello) when multiple triggers exist', () => {
            const testUser = createTestUser({ username: 'testuser' });
            const chatData = {
                platform: 'youtube',
                username: testUser.username,
                message: 'hello everyone'
            };

            const result = commandParser.parse(chatData, false);
            const parsed = requireParsedResult(result);

            expect(parsed.type).toBe('vfx');
            expect(parsed.command).toBe('!hello');
            expect(parsed.filename).toBe('hello-world');
        });

        itFast('should return command trigger for keyword match vs direct command', () => {
            const testUser = createTestUser({ username: 'testuser' });
            const directChatData = {
                platform: 'tiktok',
                username: testUser.username,
                message: '!boom'
            };
            const keywordChatData = {
                platform: 'tiktok',
                username: testUser.username,
                message: 'that was a blast'
            };

            const directResult = commandParser.parse(directChatData, false);
            const keywordResult = commandParser.parse(keywordChatData, false);
            const parsedDirectResult = requireParsedResult(directResult);
            const parsedKeywordResult = requireParsedResult(keywordResult);

            expect(parsedDirectResult.command).toBe('!boom');
            expect(parsedKeywordResult.command).toBe('!boom');
            expect(parsedDirectResult.filename).toBe(parsedKeywordResult.filename);
        });
    });

    describe('when VFX command is triggered by direct command', () => {
        itFast('should still return the correct command trigger', () => {
            const testUser = createTestUser({ username: 'testuser' });
            const chatData = {
                platform: 'twitch',
                username: testUser.username,
                message: '!mod'
            };

            const result = commandParser.parse(chatData, false);
            const parsed = requireParsedResult(result);

            expect(parsed.type).toBe('vfx');
            expect(parsed.command).toBe('!mod');
            expect(parsed.filename).toBe('im-a-mod');
        });
    });

    describe('edge cases', () => {
        itFast('should handle commands with multiple triggers correctly', () => {
            const testUser = createTestUser({ username: 'testuser' });
            const chatData = {
                platform: 'twitch',
                username: testUser.username,
                message: '!hi'
            };

            const result = commandParser.parse(chatData, false);
            const parsed = requireParsedResult(result);

            expect(parsed.type).toBe('vfx');
            expect(parsed.command).toBe('!hello');
        });

        itFast('should handle case where no keywords are defined', () => {
            mockConfig = createConfigFixture({
                commands: {
                    'simple-command': '!simple, vfx center'
                }
            });
            commandParser = new CommandParser(mockConfig, mockLogger);

            const testUser = createTestUser({ username: 'testuser' });
            const chatData = {
                platform: 'twitch',
                username: testUser.username,
                message: '!simple'
            };

            const result = commandParser.parse(chatData, false);
            const parsed = requireParsedResult(result);

            expect(parsed.command).toBe('!simple');
        });
    });
});
