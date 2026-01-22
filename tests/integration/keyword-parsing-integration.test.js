
const { describe, test, beforeEach, afterEach, expect } = require('bun:test');
const { restoreAllMocks } = require('../helpers/bun-mock-utils');

const { CommandParser } = require('../../src/chat/commands');
const testClock = require('../helpers/test-clock');

describe('Keyword Parsing Integration', () => {
    let commandParser;
    let mockConfig;

    beforeEach(() => {
        testClock.reset();
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

    afterEach(() => {
        restoreAllMocks();
    });

    describe('Complete Flow - Keyword Parsing Enabled', () => {
        beforeEach(() => {
            mockConfig.general = { keywordParsingEnabled: true };
            commandParser = new CommandParser(mockConfig);
        });

        test('should detect both ! prefix and keyword commands when enabled', () => {
            const prefixResult = commandParser.getVFXConfig('!hello', '!hello everyone!');
            expect(prefixResult).toBeDefined();
            expect(prefixResult.filename).toBe('hello-there');
            expect(prefixResult.command).toBe('!hello');

            const keywordResult = commandParser.getVFXConfig('i', 'I am a mod and I approve this message');
            expect(keywordResult).toBeDefined();
            expect(keywordResult.filename).toBe('im-a-mod');
            expect(keywordResult.keyword).toBe('mod');
        });

        test('should detect farewell commands when enabled', () => {
            const result = commandParser.getMatchingFarewell('!bye everyone!', '!bye');
            expect(result).toBe('!bye');
        });
    });

    describe('Complete Flow - Keyword Parsing Disabled via Config', () => {
        beforeEach(() => {
            mockConfig.general = { keywordParsingEnabled: false };
            commandParser = new CommandParser(mockConfig);
        });

        test('should detect ! prefix commands but not keyword commands when disabled via config', () => {
            const prefixResult = commandParser.getVFXConfig('!hello', '!hello everyone!');
            expect(prefixResult).toBeDefined();
            expect(prefixResult.filename).toBe('hello-there');
            expect(prefixResult.command).toBe('!hello');

            const keywordResult = commandParser.getVFXConfig('i', 'I am a mod and I approve this message');
            expect(keywordResult).toBeNull();
        });

        test('should detect farewell commands but not keywords when disabled via config', () => {
            const commandResult = commandParser.getMatchingFarewell('!bye everyone!', '!bye');
            expect(commandResult).toBe('!bye');

            const keywordResult = commandParser.getMatchingFarewell('Goodbye everyone!', 'goodbye');
            expect(keywordResult).toBeNull();
        });
    });

    describe('Complete Flow - Keyword Parsing Disabled via CLI', () => {
        beforeEach(() => {
            mockConfig.general = { keywordParsingEnabled: true };
            mockConfig.cliArgs = { disableKeywordParsing: true };
            commandParser = new CommandParser(mockConfig);
        });

        test('should prioritize CLI argument over config setting', () => {
            const prefixResult = commandParser.getVFXConfig('!hello', '!hello everyone!');
            expect(prefixResult).toBeDefined();
            expect(prefixResult.filename).toBe('hello-there');
            expect(prefixResult.command).toBe('!hello');

            const keywordResult = commandParser.getVFXConfig('i', 'I am a mod and I approve this message');
            expect(keywordResult).toBeNull();
        });

        test('should behave correctly when CLI overrides config', () => {
            const prefixResult = commandParser.getVFXConfig('!hello', '!hello everyone!');
            expect(prefixResult).toBeDefined();
            expect(prefixResult.filename).toBe('hello-there');
            expect(prefixResult.command).toBe('!hello');

            const keywordResult = commandParser.getVFXConfig('i', 'I am a mod and I approve this message');
            expect(keywordResult).toBeNull();

            const farewellKeywordResult = commandParser.getMatchingFarewell('Goodbye everyone!', 'goodbye');
            expect(farewellKeywordResult).toBeNull();
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

    describe('Performance and Memory', () => {
        test('should not create memory leaks when keyword parsing is disabled', () => {
            mockConfig.general = { keywordParsingEnabled: false };
            commandParser = new CommandParser(mockConfig);

            const initialMemory = process.memoryUsage().heapUsed;

            for (let i = 0; i < 1000; i++) {
                commandParser.getVFXConfig('!hello', '!hello everyone!');
                commandParser.getVFXConfig('i', 'I am a mod and I approve this message');
            }

            const finalMemory = process.memoryUsage().heapUsed;
            const memoryIncrease = finalMemory - initialMemory;

            expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
        });

        test('should maintain performance when keyword parsing is disabled', () => {
            mockConfig.general = { keywordParsingEnabled: false };
            commandParser = new CommandParser(mockConfig);

            const startTime = testClock.now();

            const iterations = 1000;
            for (let i = 0; i < iterations; i++) {
                commandParser.getVFXConfig('!hello', '!hello everyone!');
            }

            testClock.advance(iterations - 1);
            const endTime = testClock.now();
            const duration = endTime - startTime;

            expect(duration).toBeLessThan(1000);
        });
    });

    describe('Real-world Scenarios', () => {
        test('should handle mixed messages correctly when keyword parsing is disabled', () => {
            mockConfig.general = { keywordParsingEnabled: false };
            commandParser = new CommandParser(mockConfig);

            const mixedResult = commandParser.getVFXConfig('!hello', '!hello hehe this is funny');

            expect(mixedResult).toBeDefined();
            expect(mixedResult.filename).toBe('hello-there');
            expect(mixedResult.command).toBe('!hello');
            expect(mixedResult.keyword).toBeNull();
        });

        test('should handle case sensitivity correctly when keyword parsing is disabled', () => {
            mockConfig.general = { keywordParsingEnabled: false };
            commandParser = new CommandParser(mockConfig);

            const upperResult = commandParser.getVFXConfig('!HELLO', '!HELLO everyone!');
            expect(upperResult).toBeDefined();
            expect(upperResult.filename).toBe('hello-there');

            const mixedResult = commandParser.getVFXConfig('!Hello', '!Hello everyone!');
            expect(mixedResult).toBeDefined();
            expect(mixedResult.filename).toBe('hello-there');
        });

        test('should handle edge cases when keyword parsing is disabled', () => {
            mockConfig.general = { keywordParsingEnabled: false };
            commandParser = new CommandParser(mockConfig);

            const emptyResult = commandParser.getVFXConfig('', '');
            expect(emptyResult).toBeNull();

            const nullResult = commandParser.getVFXConfig(null, null);
            expect(nullResult).toBeNull();

            const undefinedResult = commandParser.getVFXConfig(undefined, undefined);
            expect(undefinedResult).toBeNull();
        });
    });
});
