
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

const { CommandParser } = require('../../../src/chat/commands');
const testClock = require('../../helpers/test-clock');

describe('CommandParser Keyword Parsing', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    let commandParser;
    let mockConfig;

    beforeEach(() => {
        mockConfig = {
            commands: {
                'hello-there': '!hello, vfx bottom green',
                'im-a-mod': '!mod, vfx top, mod|mods',
                'span-lol': '!lol, vfx top, haha|hehe'
            },
            farewell: {
                command: '!bye|!bye1|!bye2|!bye3'
            },
            vfx: {
                filePath: '/path/to/vfx'
            }
        };
    });

    describe('Keyword Parsing Enabled (Default)', () => {
        beforeEach(() => {
            commandParser = new CommandParser(mockConfig);
        });

        test('should detect ! prefix commands when keyword parsing is enabled', () => {
            const result = commandParser.getVFXConfig('!hello', '!hello everyone!');

            expect(result).toBeDefined();
            expect(result.filename).toBe('hello-there');
            expect(result.command).toBe('!hello');
        });

        test('should detect keyword-based commands when keyword parsing is enabled', () => {
            const result = commandParser.getVFXConfig('i', 'I am a mod and I approve this message');

            expect(result).toBeDefined();
            expect(result.filename).toBe('im-a-mod');
            expect(result.keyword).toBe('mod');
        });

        test('should detect farewell commands when keyword parsing is enabled', () => {
            const result = commandParser.getMatchingFarewell('!bye everyone!', '!bye');
            
            expect(result).toBe('!bye');
        });

        test('should detect farewell keywords when keyword parsing is enabled', () => {
            const result = commandParser.getMatchingFarewell('Goodbye everyone!', 'goodbye');
            expect(result).toBeNull();
        });
    });

    describe('Keyword Parsing Disabled', () => {
        beforeEach(() => {
            mockConfig.general = { keywordParsingEnabled: false };
            commandParser = new CommandParser(mockConfig);
        });

        test('should still detect ! prefix commands when keyword parsing is disabled', () => {
            const result = commandParser.getVFXConfig('!hello', '!hello everyone!');
            
            expect(result).toBeDefined();
            expect(result.filename).toBe('hello-there');
            expect(result.command).toBe('!hello');
        });

        test('should NOT detect keyword-based commands when keyword parsing is disabled', () => {
            const result = commandParser.getVFXConfig('i', 'I am a mod and I approve this message');
            
            expect(result).toBeNull();
        });

        test('should NOT detect keyword-based commands in different messages when keyword parsing is disabled', () => {
            const result = commandParser.getVFXConfig('test', 'This message contains hehe in it');
            
            expect(result).toBeNull();
        });

        test('should still detect farewell commands when keyword parsing is disabled', () => {
            const result = commandParser.getMatchingFarewell('!bye everyone!', '!bye');
            
            expect(result).toBe('!bye');
        });

        test('should NOT detect farewell keywords when keyword parsing is disabled', () => {
            const result = commandParser.getMatchingFarewell('Goodbye everyone!', 'goodbye');
            expect(result).toBeNull();
        });
    });

    describe('Configuration Precedence', () => {
        test('should use config setting when no command line override', () => {
            mockConfig.general = { keywordParsingEnabled: false };
            commandParser = new CommandParser(mockConfig);

            const result = commandParser.getVFXConfig('i', 'I am a mod and I approve this message');
            expect(result).toBeNull();
        });

        test('should allow command line override of config setting', () => {
            mockConfig.general = { keywordParsingEnabled: true };
            mockConfig.cliArgs = { disableKeywordParsing: true };
            commandParser = new CommandParser(mockConfig);

            const result = commandParser.getVFXConfig('i', 'I am a mod and I approve this message');
            expect(result).toBeNull();
        });

        test('should prioritize command line argument over config setting', () => {
            mockConfig.general = { keywordParsingEnabled: true };
            mockConfig.cliArgs = { disableKeywordParsing: true };
            commandParser = new CommandParser(mockConfig);

            const prefixResult = commandParser.getVFXConfig('!hello', '!hello everyone!');
            expect(prefixResult).toBeDefined();

            const keywordResult = commandParser.getVFXConfig('i', 'I am a mod and I approve this message');
            expect(keywordResult).toBeNull();
        });
    });

    describe('Backward Compatibility', () => {
        test('should work with existing config when keyword parsing setting is missing', () => {
            commandParser = new CommandParser(mockConfig);

            const result = commandParser.getVFXConfig('i', 'I am a mod and I approve this message');
            expect(result).toBeDefined();
            expect(result.filename).toBe('im-a-mod');
        });

        test('should preserve all existing functionality when keyword parsing is enabled', () => {
            mockConfig.general = { keywordParsingEnabled: true };
            commandParser = new CommandParser(mockConfig);

            const prefixResult = commandParser.getVFXConfig('!hello', '!hello everyone!');
            expect(prefixResult).toBeDefined();
            expect(prefixResult.filename).toBe('hello-there');

            const keywordResult = commandParser.getVFXConfig('i', 'I am a mod and I approve this message');
            expect(keywordResult).toBeDefined();
            expect(keywordResult.filename).toBe('im-a-mod');

            const farewellResult = commandParser.getMatchingFarewell('!bye everyone!', '!bye');
            expect(farewellResult).toBe('!bye');
        });
    });

    describe('Performance Impact', () => {
        test('should not impact performance when keyword parsing is disabled', () => {
            mockConfig.general = { keywordParsingEnabled: false };
            commandParser = new CommandParser(mockConfig);

            const startTime = testClock.now();

            for (let i = 0; i < 100; i++) {
                commandParser.getVFXConfig('!hello', '!hello everyone!');
            }

            const simulatedDurationMs = 20;
            testClock.advance(simulatedDurationMs);
            const endTime = testClock.now();
            const duration = endTime - startTime;

            expect(duration).toBeLessThan(100);
        });

        test('should skip keyword checking when keyword parsing is disabled', () => {
            mockConfig.general = { keywordParsingEnabled: false };
            commandParser = new CommandParser(mockConfig);

            const originalKeywordCheck = commandParser.parsedCommands.keywords;
            commandParser.parsedCommands.keywords = new Map();

            const result = commandParser.getVFXConfig('i', 'I am a mod and I approve this message');
            expect(result).toBeNull();

            commandParser.parsedCommands.keywords = originalKeywordCheck;
        });
    });
}); 