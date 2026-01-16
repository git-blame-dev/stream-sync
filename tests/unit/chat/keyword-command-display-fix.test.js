
const { initializeTestLogging, createTestUser, TEST_TIMEOUTS } = require('../../helpers/test-setup');
const { noOpLogger, createMockConfig } = require('../../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');

// Initialize logging first
initializeTestLogging();

// Setup automated cleanup
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    logPerformanceMetrics: true
});

const { CommandParser } = require('../../../src/chat/commands');

describe('CommandParser Keyword vs Command Display Fix', () => {
    let commandParser, mockLogger, mockConfig;

    beforeEach(() => {
        mockLogger = noOpLogger;
        mockConfig = createMockConfig({
            commands: {
                'im-a-mod': '!mod, vfx top, mod|mods',
                'hello-world': '!hello|!hi, vfx center, hello|hi|greetings',
                'boom-effect': '!boom, vfx bottom, boom|explosion|blast'
            }
        });
        
        commandParser = new CommandParser(mockConfig, mockLogger);
    });

    describe('when VFX command is triggered by keyword match', () => {
        it('should return the actual command trigger (!mod) not the keyword (mod)', () => {
            const testUser = createTestUser({ username: 'testuser' });
            const chatData = {
                platform: 'twitch',
                username: testUser.username,
                message: 'I am a mod'
            };

            // Test keyword "mod" matching should return command "!mod"
            const result = commandParser.parse(chatData, false);

            expect(result).not.toBeNull();
            expect(result.type).toBe('vfx');
            expect(result.command).toBe('!mod'); // Should be !mod, not mod
            expect(result.filename).toBe('im-a-mod');
        });

        it('should return the actual command trigger (!hello) when multiple triggers exist', () => {
            const testUser = createTestUser({ username: 'testuser' });
            const chatData = {
                platform: 'youtube',
                username: testUser.username,
                message: 'hello everyone'
            };

            // Test keyword "hello" matching should return first command trigger "!hello"
            const result = commandParser.parse(chatData, false);

            expect(result).not.toBeNull();
            expect(result.type).toBe('vfx');
            expect(result.command).toBe('!hello'); // Should be !hello, not hello
            expect(result.filename).toBe('hello-world');
        });

        it('should return command trigger for keyword match vs direct command', () => {
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

            // Test both direct command and keyword matching return same command
            const directResult = commandParser.parse(directChatData, false);
            const keywordResult = commandParser.parse(keywordChatData, false);

            expect(directResult).not.toBeNull();
            expect(keywordResult).not.toBeNull();
            
            // Both should return the same command trigger
            expect(directResult.command).toBe('!boom');
            expect(keywordResult.command).toBe('!boom'); // Currently fails - returns 'blast'
            
            // Both should have same VFX config
            expect(directResult.filename).toBe(keywordResult.filename);
        });
    });

    describe('when VFX command is triggered by direct command', () => {
        it('should still return the correct command trigger', () => {
            const testUser = createTestUser({ username: 'testuser' });
            const chatData = {
                platform: 'twitch',
                username: testUser.username,
                message: '!mod'
            };

            // Direct command usage should work as before
            const result = commandParser.parse(chatData, false);

            expect(result).not.toBeNull();
            expect(result.type).toBe('vfx');
            expect(result.command).toBe('!mod');
            expect(result.filename).toBe('im-a-mod');
        });
    });

    describe('edge cases', () => {
        it('should handle commands with multiple triggers correctly', () => {
            const testUser = createTestUser({ username: 'testuser' });
            const chatData = {
                platform: 'twitch',
                username: testUser.username,
                message: '!hi'
            };

            // Test second trigger !hi should still return !hello (first trigger)  
            const result = commandParser.parse(chatData, false);

            expect(result).not.toBeNull();
            expect(result.type).toBe('vfx');
            expect(result.command).toBe('!hello'); // Should be first trigger
        });

        it('should handle case where no keywords are defined', () => {
            // Add command with no keywords
            mockConfig = createMockConfig({
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

            expect(result).not.toBeNull();
            expect(result.command).toBe('!simple');
        });
    });
}, TEST_TIMEOUTS.FAST);
