const { validateLoggingConfig } = require('../../../src/core/config');

describe('logging config behavior', () => {
    it('forces log directories and chat logging when file logging enabled', () => {
        const config = validateLoggingConfig({
            logging: {
                consoleLevel: 'warn',
                fileLevel: 'error',
                fileLoggingEnabled: true
            }
        });

        expect(config.console.level).toBe('warn');
        expect(config.file.level).toBe('error');
        expect(config.file.enabled).toBe(true);
        expect(config.file.directory).toBe('./logs');
        expect(config.chat.enabled).toBe(true);
        expect(config.chat.separateFiles).toBe(true);
        expect(config.chat.directory).toBe('./logs');
    });

    it('disables chat logging when file logging is disabled', () => {
        const config = validateLoggingConfig({
            logging: {
                fileLoggingEnabled: false
            }
        });

        expect(config.file.enabled).toBe(false);
        expect(config.chat.enabled).toBe(false);
        expect(config.chat.separateFiles).toBe(true);
        expect(config.file.directory).toBe('./logs');
        expect(config.chat.directory).toBe('./logs');
    });
});
