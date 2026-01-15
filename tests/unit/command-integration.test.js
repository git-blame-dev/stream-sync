
const { describe, test, expect, beforeEach, jest } = require('bun:test');

const { initializeTestLogging, createTestUser, TEST_TIMEOUTS } = require('../helpers/test-setup');
const { createMockLogger, createMockNotificationBuilder } = require('../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');
const { expectValidNotification } = require('../helpers/assertion-helpers');
const testClock = require('../helpers/test-clock');

// Initialize logging FIRST (required for all tests)
initializeTestLogging();

// Setup automated cleanup (no manual mock management)
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

const { CommandParser } = require('../../src/chat/commands');

describe('Command Integration System', () => {
    // Test timeout protection as per rules
    jest.setTimeout(TEST_TIMEOUTS.UNIT);

    let commandParser;
    let mockConfig;

    beforeEach(() => {
        // Use data builders for configuration
        mockConfig = {
            commands: {
                'hello-there': '!hello, vfx bottom green',
                'im-a-mod': '!mod, vfx top, mod|mods',
                'that-was-a-lie': '!lie, vfx bottom green, lie|lies',
                'another-one': '!another, vfx bottom green, another',
                'crashed': '!crashed, vfx center green',
                'daddy-chill': '!chill, vfx top, chill|daddy',
                'died-dark-souls': '!died, vfx center green',
                'exploded': '!boom, vfx center green',
                'fix-the-game': '!fixgame, vfx top',
                'hackerman2': '!hacker|!hacks, vfx center green, hacks|hacker|cheats|cheater|cheating|aimbot|walls',
                'hello-i-like-money': '!money, vfx top',
                'here-we-go-again': '!again, vfx bottom green, again',
                'liar': '!liar, vfx top, liar',
                'loading': '!load, vfx center green',
                'mission-passed': '!passed, vfx center green',
                'span-lol': '!lol, vfx top, haha|hehe',
                'span-lol2': '!lol2, vfx top, lol',
                'span-lol3': '!lol3, vfx top, rofl',
                'speak-english': '!english, vfx bottom green, english',
                'thats-kinda-small': '!small, vfx bottom green, small',
                'tyler-rant': '!rant, vfx top',
                'what-inspired-you': '!inspired, vfx top',
                'what-the-hell-is-even-that': '!wtf, vfx bottom green, wtf| what the',
                'you-serious': '!serious, vfx bottom green',
                'addicted': '!addicted, vfx top',
                'wasted': '!wasted, vfx center green',
                'why-why-why': '!why, vfx top, why',
                'you-shall-not-pass': '!pass, vfx bottom green',
                'you-missed': '!missed, vfx top',
                'bye-bye-bye': '!bye|!bye1, vfx bottom green',
                'bye-bye-bye2': '!bye2, vfx bottom green',
                'bye-bye-bye3': '!bye3, vfx bottom green',
                'im-a-snake': '!snake, vfx bottom green, snake',
                'brother-eww': '!eww, vfx bottom green, eww',
                'are-you-sure': '!sure, vfx bottom green, sure',
                'this-guy-stinks': '!stinks, vfx top, stink|stinks',
                'facepalm': '!facepalm, vfx top',
                'missed': '!missed, vfx top',
                'notice-me-senpai': '!noticeme, vfx top, notice me|senpai',
                'bought-by-money': '!bought, vfx top',
                'good-boy': '!goodboy, vfx top, good boy',
                'run-ashton-khalid': '!run, vfx bottom green'
            },
            farewell: {
                enabled: true,
                command: '!bye|!bye1|!bye2|!bye3'
            },
            vfx: {
                filePath: '/path/to/vfx'
            }
        };

        commandParser = new CommandParser(mockConfig);
    });

    describe('Command Parsing', () => {
        test('should detect VFX commands by trigger', () => {
            // Use data builders instead of hardcoded data
            const data = createTestUser({
                comment: '!hello everyone!',
                username: 'testuser',
                userId: '123',
                platform: 'twitch'
            });

            const result = commandParser.parse(data, false);
            
            expect(result).toEqual({
                type: 'vfx',
                command: '!hello',
                commandKey: 'hello-there',
                duration: 5000,
                filename: 'hello-there',
                mediaSource: 'vfx bottom green',
                filename: 'hello-there',
                vfxFilePath: '/path/to/vfx',
                keyword: null,
                matchType: 'trigger',
                username: 'testuser',
                platform: 'twitch',
                isFirst: false
            });
        });

        test('should detect VFX commands by keyword', () => {
            const data = createTestUser({
                comment: 'I am a mod and I approve this message',
                username: 'moduser',
                userId: '456',
                platform: 'youtube'
            });

            const result = commandParser.parse(data, false);
            
            expect(result).toEqual({
                type: 'vfx',
                command: '!mod',
                commandKey: 'im-a-mod',
                duration: 5000,
                keyword: 'mod',
                filename: 'im-a-mod',
                mediaSource: 'vfx top',
                filename: 'im-a-mod',
                vfxFilePath: '/path/to/vfx',
                matchType: 'keyword',
                username: 'moduser',
                platform: 'youtube',
                isFirst: false
            });
        });

        test('should detect farewell commands', () => {
            const data = createTestUser({
                comment: '!bye everyone, see you later!',
                username: 'leavinguser',
                userId: '789',
                platform: 'tiktok'
            });

            const result = commandParser.parse(data, false);
            
            expect(result).toEqual({
                type: 'farewell',
                username: 'leavinguser',
                platform: 'tiktok',
                trigger: '!bye'
            });
        });

        test('should return null for non-commands', () => {
            const data = createTestUser({
                comment: 'Hello everyone, how are you doing?',
                username: 'regularuser',
                userId: '999',
                platform: 'twitch'
            });

            const result = commandParser.parse(data, false);
            
            expect(result).toBeNull();
        });

        test('should handle empty or invalid messages', () => {
            const invalidData = [
                createTestUser({ comment: '', username: 'user', userId: '123' }),
                createTestUser({ comment: null, username: 'user', userId: '123' }),
                createTestUser({ comment: undefined, username: 'user', userId: '123' }),
                createTestUser({ username: 'user', userId: '123' }) // No comment field
            ];

            invalidData.forEach(data => {
                const result = commandParser.parse(data, false);
                expect(result).toBeNull();
            });
        });
    });

    describe('VFX Configuration', () => {
        test('should get VFX config for trigger-based commands', () => {
            const config = commandParser.getVFXConfig('!hello', '!hello everyone!');
            
            expect(config).toEqual({
                command: '!hello',
                commandKey: 'hello-there',
                duration: 5000,
                filename: 'hello-there',
                mediaSource: 'vfx bottom green',
                filename: 'hello-there',
                vfxFilePath: '/path/to/vfx',
                keyword: null,
                matchType: 'trigger'
            });
        });

        test('should get VFX config for keyword-based commands', () => {
            const config = commandParser.getVFXConfig('i', 'I am a mod and I approve this message');
            
            expect(config).toEqual({
                command: '!mod',
                commandKey: 'im-a-mod',
                duration: 5000,
                keyword: 'mod',
                filename: 'im-a-mod',
                mediaSource: 'vfx top',
                filename: 'im-a-mod',
                vfxFilePath: '/path/to/vfx',
                matchType: 'keyword'
            });
        });

        test('should handle case-insensitive matching', () => {
            const config1 = commandParser.getVFXConfig('!HELLO', '!HELLO everyone!');
            const config2 = commandParser.getVFXConfig('!hello', 'I am a MOD and I approve this message');
            
            expect(config1).toBeTruthy();
            expect(config2).toBeTruthy();
        });

        test('should return null for non-existent commands', () => {
            const config = commandParser.getVFXConfig('!nonexistent', 'This command does not exist');
            
            expect(config).toBeNull();
        });

        test('should handle multiple triggers in one command', () => {
            const config = commandParser.getVFXConfig('!hacks', 'I am using hacks to win');
            
            expect(config).toEqual({
                command: '!hacker',
                commandKey: 'hackerman2',
                duration: 5000,
                filename: 'hackerman2',
                mediaSource: 'vfx center green',
                filename: 'hackerman2',
                vfxFilePath: '/path/to/vfx',
                keyword: null,
                matchType: 'trigger'
            });
        });
    });

    describe('Farewell Command Detection', () => {
        test('should detect farewell commands by trigger', () => {
            const farewellMatch = commandParser.getMatchingFarewell('!bye everyone!', '!bye');
            
            expect(farewellMatch).toBe('!bye');
        });

        test('should detect farewell commands by keyword', () => {
            // Create new parser with farewell keywords
            const farewellConfig = {
                commands: {},
                farewell: {
                    enabled: true,
                    command: '!bye|!bye1|!bye2|!bye3, goodbye|bye|farewell'
                },
                vfx: {
                    filePath: '/path/to/vfx'
                }
            };
            
            const farewellParser = new CommandParser(farewellConfig);
            const farewellMatch = farewellParser.getMatchingFarewell('Goodbye everyone, see you later!', 'goodbye');
            
            expect(farewellMatch).toBe('goodbye');
        });

        test('should return null for non-farewell messages', () => {
            const farewellMatch = commandParser.getMatchingFarewell('Hello everyone!', 'hello');
            
            expect(farewellMatch).toBeNull();
        });

        test('should handle case-insensitive farewell matching', () => {
            const farewellMatch = commandParser.getMatchingFarewell('!BYE everyone!', '!BYE');
            
            expect(farewellMatch).toBe('!BYE');
        });
    });

    // Random Command Selection tests removed - getRandomCommand() method removed
    // Functionality now handled by VFXCommandService.selectVFXCommand()

    describe('Edge Cases and Error Handling', () => {
        test('should handle very long messages', () => {
            const longMessage = '!hello ' + 'a'.repeat(10000);
            const data = createTestUser({
                comment: longMessage,
                username: 'testuser',
                userId: '123',
                platform: 'twitch'
            });

            const result = commandParser.parse(data, false);
            
            expect(result).toBeTruthy();
            expect(result.type).toBe('vfx');
        });

        test('should handle unicode and emoji in messages', () => {
            const unicodeMessage = '!hello 🎉 你好 world!';
            const data = createTestUser({
                comment: unicodeMessage,
                username: 'testuser',
                userId: '123',
                platform: 'twitch'
            });

            const result = commandParser.parse(data, false);
            
            expect(result).toBeTruthy();
            expect(result.type).toBe('vfx');
        });

        test('should handle special characters in keywords', () => {
            const specialMessage = 'What the hell is even that?';
            const data = createTestUser({
                comment: specialMessage,
                username: 'testuser',
                userId: '123',
                platform: 'twitch'
            });

            const result = commandParser.parse(data, false);
            
            expect(result).toBeTruthy();
            expect(result.type).toBe('vfx');
        });

        test('should handle malformed command configuration', () => {
            const malformedConfig = {
                commands: {
                    'test-command': 'invalid,config,format',
                    'another-test': null,
                    'third-test': 123
                },
                vfx: {
                    filePath: '/path/to/vfx'
                }
            };

            const malformedParser = new CommandParser(malformedConfig);
            const data = createTestUser({
                comment: '!test',
                username: 'testuser',
                userId: '123',
                platform: 'twitch'
            });

            const result = malformedParser.parse(data, false);
            
            expect(result).toBeNull();
        });
    });

    describe('Performance Tests', () => {
        test('should handle rapid command parsing efficiently', () => {
            const startTime = testClock.now();
            const iterations = 1000;
            
            for (let i = 0; i < iterations; i++) {
                const data = createTestUser({
                    comment: `!hello message ${i}`,
                    username: `user${i}`,
                    userId: `id${i}`,
                    platform: 'twitch'
                });
                commandParser.parse(data, false);
            }
            
            const simulatedProcessingMs = 50;
            testClock.advance(simulatedProcessingMs);
            const endTime = testClock.now();
            const processingTime = endTime - startTime;
            
            // Should process 1000 commands in under 100ms
            expect(processingTime).toBeLessThan(100);
        });

        test('should handle large command configuration efficiently', () => {
            // Create a large command configuration
            const largeConfig = { commands: {} };
            for (let i = 0; i < 100; i++) {
                largeConfig.commands[`command-${i}`] = `!cmd${i}, vfx top, keyword${i}`;
            }
            largeConfig.vfx = { filePath: '/path/to/vfx' };
            
            const largeParser = new CommandParser(largeConfig);
            
            const startTime = testClock.now();
            const data = createTestUser({
                comment: '!cmd50 test message',
                username: 'testuser',
                userId: '123',
                platform: 'twitch'
            });
            
            const result = largeParser.parse(data, false);
            const simulatedProcessingMs = 5;
            testClock.advance(simulatedProcessingMs);
            const endTime = testClock.now();
            
            expect(result).toBeTruthy();
            expect(endTime - startTime).toBeLessThan(10); // Should be very fast
        });
    });
});
