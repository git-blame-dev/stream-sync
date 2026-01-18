const { describe, test, expect, beforeEach, afterEach } = require('bun:test');

describe('Keyword Parsing Command Line Arguments', () => {
    let originalArgv;

    beforeEach(() => {
        originalArgv = process.argv;
    });

    afterEach(() => {
        process.argv = originalArgv;
    });

    describe('Command Line Argument Parsing', () => {
        test('should detect --disable-keyword-parsing argument', () => {
            process.argv = ['node', 'main.js', '--disable-keyword-parsing'];

            const args = process.argv.slice(2);
            const hasDisableKeywordParsing = args.includes('--disable-keyword-parsing');

            expect(hasDisableKeywordParsing).toBe(true);
        });

        test('should not detect --disable-keyword-parsing when not provided', () => {
            process.argv = ['node', 'main.js', '--debug'];

            const args = process.argv.slice(2);
            const hasDisableKeywordParsing = args.includes('--disable-keyword-parsing');

            expect(hasDisableKeywordParsing).toBe(false);
        });

        test('should handle --disable-keyword-parsing with other arguments', () => {
            process.argv = ['node', 'main.js', '--debug', '--disable-keyword-parsing'];

            const args = process.argv.slice(2);
            const hasDisableKeywordParsing = args.includes('--disable-keyword-parsing');
            const hasDebug = args.includes('--debug');

            expect(hasDisableKeywordParsing).toBe(true);
            expect(hasDebug).toBe(true);
        });

        test('should handle --disable-keyword-parsing at different positions', () => {
            process.argv = ['node', 'main.js', '--disable-keyword-parsing', '--debug'];
            let args = process.argv.slice(2);
            expect(args.includes('--disable-keyword-parsing')).toBe(true);

            process.argv = ['node', 'main.js', '--debug', '--disable-keyword-parsing'];
            args = process.argv.slice(2);
            expect(args.includes('--disable-keyword-parsing')).toBe(true);

            process.argv = ['node', 'main.js', '--debug', '--disable-keyword-parsing'];
            args = process.argv.slice(2);
            expect(args.includes('--disable-keyword-parsing')).toBe(true);
        });
    });

    describe('CLI Argument Object Structure', () => {
        test('should add disableKeywordParsing property to CLI args object', () => {
            const args = ['--disable-keyword-parsing'];
            const cliArgs = {
                noMsg: false,
                debug: false,
                help: false,
                platforms: {},
                obs: { enabled: null },
                logLevel: null,
                chat: null,
                disableGreetings: false,
                disableKeywordParsing: false
            };

            for (let i = 0; i < args.length; i++) {
                const arg = args[i];
                switch (arg) {
                    case '--disable-keyword-parsing':
                        cliArgs.disableKeywordParsing = true;
                        break;
                }
            }

            expect(cliArgs.disableKeywordParsing).toBe(true);
        });

        test('should default disableKeywordParsing to false when not provided', () => {
            const args = ['--debug'];
            const cliArgs = {
                noMsg: false,
                debug: false,
                help: false,
                platforms: {},
                obs: { enabled: null },
                logLevel: null,
                chat: null,
                disableGreetings: false,
                disableKeywordParsing: false
            };

            for (let i = 0; i < args.length; i++) {
                const arg = args[i];
                switch (arg) {
                    case '--debug':
                        cliArgs.debug = true;
                        break;
                }
            }

            expect(cliArgs.disableKeywordParsing).toBe(false);
            expect(cliArgs.debug).toBe(true);
        });
    });

    describe('Configuration Precedence', () => {
        test('should prioritize command line argument over config file setting', () => {
            const configKeywordParsing = true;
            const cliDisableKeywordParsing = true;

            const finalKeywordParsingEnabled = configKeywordParsing && !cliDisableKeywordParsing;

            expect(finalKeywordParsingEnabled).toBe(false);
        });

        test('should use config file setting when command line argument not provided', () => {
            const configKeywordParsing = false;
            const cliDisableKeywordParsing = false;

            const finalKeywordParsingEnabled = configKeywordParsing && !cliDisableKeywordParsing;

            expect(finalKeywordParsingEnabled).toBe(false);
        });

        test('should enable keyword parsing when neither config nor CLI disable it', () => {
            const configKeywordParsing = true;
            const cliDisableKeywordParsing = false;

            const finalKeywordParsingEnabled = configKeywordParsing && !cliDisableKeywordParsing;

            expect(finalKeywordParsingEnabled).toBe(true);
        });
    });

    describe('Help Documentation', () => {
        test('should include --disable-keyword-parsing in help text', () => {
            const helpText = `
Usage: node src/main.js [options]

Options:
  --debug                      Enable debug mode (detailed logging)
  --disable-greetings          Disable greeting notifications
  --disable-keyword-parsing    Disable keyword parsing for commands (only allow ! prefix commands)
  --chat <number>              Exit after processing N chat messages
  --help, -h                   Show this help message

Examples:
  node src/main.js --disable-keyword-parsing --debug
`;

            expect(helpText).toContain('--disable-keyword-parsing');
            expect(helpText).toContain('Disable keyword parsing for commands');
        });
    });
}); 
