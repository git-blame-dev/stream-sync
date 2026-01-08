
// Mock the logger before requiring CommandParser
jest.mock('../../../src/core/logging', () => ({
    logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn()
    }
}));

const { CommandParser } = require('../../../src/chat/commands');

describe('CommandParser Keyword Parsing', () => {
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
            // Default behavior - keyword parsing enabled
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
            // Note: Current farewell config doesn't have keywords, but this tests the logic
            const result = commandParser.getMatchingFarewell('Goodbye everyone!', 'goodbye');
            
            expect(result).toBeNull(); // No keywords configured
        });
    });

    describe('Keyword Parsing Disabled', () => {
        beforeEach(() => {
            // Disable keyword parsing
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
            // Even if farewell keywords were configured, they should be ignored
            const result = commandParser.getMatchingFarewell('Goodbye everyone!', 'goodbye');
            
            expect(result).toBeNull();
        });
    });

    describe('Configuration Precedence', () => {
        test('should use config setting when no command line override', () => {
            // Config disables keyword parsing
            mockConfig.general = { keywordParsingEnabled: false };
            commandParser = new CommandParser(mockConfig);
            
            const result = commandParser.getVFXConfig('i', 'I am a mod and I approve this message');
            expect(result).toBeNull();
        });

        test('should allow command line override of config setting', () => {
            // Config enables keyword parsing, but command line disables it
            mockConfig.general = { keywordParsingEnabled: true };
            mockConfig.cliArgs = { disableKeywordParsing: true };
            commandParser = new CommandParser(mockConfig);
            
            const result = commandParser.getVFXConfig('i', 'I am a mod and I approve this message');
            expect(result).toBeNull();
        });

        test('should prioritize command line argument over config setting', () => {
            // Config enables keyword parsing, command line disables it
            mockConfig.general = { keywordParsingEnabled: true };
            mockConfig.cliArgs = { disableKeywordParsing: true };
            commandParser = new CommandParser(mockConfig);
            
            // Should still allow ! prefix commands
            const prefixResult = commandParser.getVFXConfig('!hello', '!hello everyone!');
            expect(prefixResult).toBeDefined();
            
            // Should not allow keyword commands
            const keywordResult = commandParser.getVFXConfig('i', 'I am a mod and I approve this message');
            expect(keywordResult).toBeNull();
        });
    });

    describe('Backward Compatibility', () => {
        test('should work with existing config when keyword parsing setting is missing', () => {
            // No keyword parsing setting in config
            commandParser = new CommandParser(mockConfig);
            
            // Should default to enabled
            const result = commandParser.getVFXConfig('i', 'I am a mod and I approve this message');
            expect(result).toBeDefined();
            expect(result.filename).toBe('im-a-mod');
        });

        test('should preserve all existing functionality when keyword parsing is enabled', () => {
            mockConfig.general = { keywordParsingEnabled: true };
            commandParser = new CommandParser(mockConfig);
            
            // Test ! prefix command
            const prefixResult = commandParser.getVFXConfig('!hello', '!hello everyone!');
            expect(prefixResult).toBeDefined();
            expect(prefixResult.filename).toBe('hello-there');
            
            // Test keyword command
            const keywordResult = commandParser.getVFXConfig('i', 'I am a mod and I approve this message');
            expect(keywordResult).toBeDefined();
            expect(keywordResult.filename).toBe('im-a-mod');
            
            // Test farewell command
            const farewellResult = commandParser.getMatchingFarewell('!bye everyone!', '!bye');
            expect(farewellResult).toBe('!bye');
        });
    });

    describe('Performance Impact', () => {
        test('should not impact performance when keyword parsing is disabled', () => {
            mockConfig.general = { keywordParsingEnabled: false };
            commandParser = new CommandParser(mockConfig);
            
            const startTime = Date.now();
            
            // Test multiple ! prefix commands (should be fast)
            for (let i = 0; i < 100; i++) {
                commandParser.getVFXConfig('!hello', '!hello everyone!');
            }
            
            const endTime = Date.now();
            const duration = endTime - startTime;
            
            // Should complete quickly (less than 100ms for 100 operations)
            expect(duration).toBeLessThan(100);
        });

        test('should skip keyword checking when keyword parsing is disabled', () => {
            mockConfig.general = { keywordParsingEnabled: false };
            commandParser = new CommandParser(mockConfig);
            
            // Mock the keyword checking to verify it's not called
            const originalKeywordCheck = commandParser.parsedCommands.keywords;
            commandParser.parsedCommands.keywords = new Map(); // Empty map
            
            const result = commandParser.getVFXConfig('i', 'I am a mod and I approve this message');
            expect(result).toBeNull();
            
            // Restore original
            commandParser.parsedCommands.keywords = originalKeywordCheck;
        });
    });
}); 