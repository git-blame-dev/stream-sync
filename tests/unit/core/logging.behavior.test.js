const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks, spyOn } = require('../../helpers/bun-mock-utils');
const { resetModules, unmockModule } = require('../../helpers/bun-module-mocks');
const path = require('path');

unmockModule('../../../src/core/logging');

describe('core/logging behavior', () => {
    let logging;

    beforeEach(() => {
        resetModules();
        unmockModule('../../../src/core/logging');
        logging = require('../../../src/core/logging');
    });

    afterEach(() => {
        restoreAllMocks();
    });

    it('requires a config validator before reading config', () => {
        expect(() => logging.getLoggingConfig()).toThrow('Logging config validator not set');
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
            file: { enabled: false, level: 'error' },
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
