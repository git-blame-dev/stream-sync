const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks, spyOn } = require('../../helpers/bun-mock-utils');
const path = require('path');

const logging = require('../../../src/core/logging');

describe('core/logging behavior', () => {
    beforeEach(() => {
        // Reset to default test validator
        logging.setConfigValidator(() => ({
            console: { enabled: false },
            file: { enabled: false, directory: './logs' },
            debug: { enabled: false },
            platforms: { tiktok: { enabled: true }, twitch: { enabled: true }, youtube: { enabled: true } },
            chat: { enabled: false, separateFiles: true, directory: './logs' }
        }));
    });

    afterEach(() => {
        restoreAllMocks();
    });

    it('auto-initializes with default test config in test environment', () => {
        const config = logging.getLoggingConfig();
        expect(config).toBeDefined();
        expect(config.console).toBeDefined();
        expect(config.file).toBeDefined();
    });

    it('initializes configuration through injected validator', () => {
        const validatedConfig = {
            console: { enabled: true, level: 'info' },
            file: { enabled: false, level: 'error' },
            debug: { enabled: false },
            platforms: {},
            chat: { enabled: true }
        };
        const validator = createMockFn(() => validatedConfig);

        logging.setConfigValidator(validator);
        const result = logging.initializeLoggingConfig({});

        expect(result).toEqual(validatedConfig);
        expect(logging.getLoggingConfig()).toBe(validatedConfig);
    });

    it('writes program logs with timestamp when missing', () => {
        const writes = [];
        const validatedConfig = {
            console: { enabled: true, level: 'info' },
            file: { enabled: true, level: 'error', directory: '/tmp/logs' },
            debug: { enabled: false },
            platforms: {},
            chat: { enabled: false }
        };

        logging.setConfigValidator(() => validatedConfig);
        logging.initializeLoggingConfig({});

        spyOn(require('fs'), 'existsSync').mockReturnValue(true);
        spyOn(require('fs'), 'appendFileSync').mockImplementation((filePath, data) => {
            writes.push({ filePath, data: String(data) });
        });

        logging.logProgram('hello world');

        expect(writes[0].data).toMatch(/^\[\d{2}:\d{2}:\d{2}\] hello world\n$/);
    });

    it('preserves provided timestamped log entries', () => {
        const writes = [];
        const validatedConfig = {
            console: { enabled: true, level: 'info' },
            file: { enabled: true, level: 'error', directory: '/tmp/logs' },
            debug: { enabled: false },
            platforms: {},
            chat: { enabled: false }
        };

        logging.setConfigValidator(() => validatedConfig);
        logging.initializeLoggingConfig({});

        spyOn(require('fs'), 'existsSync').mockReturnValue(true);
        spyOn(require('fs'), 'appendFileSync').mockImplementation((filePath, data) => {
            writes.push({ filePath, data: String(data) });
        });

        logging.logProgram('[2024-01-01T00:00:00.000Z] already stamped');

        expect(writes[0].data).toBe('[2024-01-01T00:00:00.000Z] already stamped\n');
    });

    it('logs chat messages to sanitized platform files', () => {
        const validatedConfig = {
            console: { enabled: false, level: 'error' },
            file: { enabled: true, level: 'error' },
            debug: { enabled: false },
            platforms: {},
            chat: { enabled: true, separateFiles: true, directory: '/tmp/chat-logs' }
        };
        logging.setConfigValidator(() => validatedConfig);
        logging.initializeLoggingConfig({});

        const writes = [];
        spyOn(process, 'cwd').mockReturnValue('/tmp');
        spyOn(require('fs'), 'existsSync').mockReturnValue(false);
        spyOn(require('fs'), 'mkdirSync').mockImplementation(() => {});
        spyOn(require('fs'), 'appendFileSync').mockImplementation((filePath, data) => {
            writes.push({ filePath, data: String(data) });
        });

        logging.logChatMessage('twitch', 'bad/ user', 'Hi there', '2024-01-01T00:00:00Z');

        expect(writes[0].filePath).toBe(path.join('/tmp/chat-logs', 'twitch-chat-bad_user.txt'));
        expect(writes[0].data.trim()).toContain('Hi there');
    });

    it('safely stringifies errors and sanitizes usernames', () => {
        const serialized = logging.safeObjectStringify(new Error('boom'));
        expect(serialized).toContain('boom');

        expect(logging.sanitizeUsername('bad:name/with*chars')).toBe('badnamewithchars');
        expect(logging.sanitizeUsername('')).toBe('');
    });
});
