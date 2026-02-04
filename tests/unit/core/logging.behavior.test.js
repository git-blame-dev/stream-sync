const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks, spyOn } = require('../../helpers/bun-mock-utils');
const fs = require('fs');
const os = require('os');
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

    it('writes console and file outputs through unified logger', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-logs-'));
        const stdoutWrites = [];
        const stderrWrites = [];
        const originalStdoutWrite = process.stdout.write;
        const originalStderrWrite = process.stderr.write;

        process.stdout.write = (chunk) => {
            stdoutWrites.push(String(chunk));
            return true;
        };
        process.stderr.write = (chunk) => {
            stderrWrites.push(String(chunk));
            return true;
        };

        const validatedConfig = {
            console: { enabled: true, level: 'info' },
            file: { enabled: true, level: 'info', directory: tempDir },
            debug: { enabled: false },
            platforms: {},
            chat: { enabled: false }
        };

        try {
            logging.setConfigValidator(() => validatedConfig);
            logging.initializeLoggingConfig({});

            const logger = logging.initializeUnifiedLogger(validatedConfig);
            logger.config = validatedConfig;
            logger.outputs.console = new logger.outputs.console.constructor();
            logger.outputs.file = new logger.outputs.file.constructor(validatedConfig.file);
            logger.info('test-info', 'test-source');
            logger.error('test-error', 'test-source');

            const logPath = path.join(tempDir, 'runtime.log');
            const logContent = fs.readFileSync(logPath, 'utf8');

            expect(stdoutWrites.join('')).toContain('test-info');
            expect(stderrWrites.join('')).toContain('test-error');
            expect(logContent).toContain('test-info');
            expect(logContent).toContain('test-error');
        } finally {
            process.stdout.write = originalStdoutWrite;
            process.stderr.write = originalStderrWrite;
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
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

        const chatWrite = writes.find((write) => write.filePath.includes('twitch-chat-bad_user.txt'));
        expect(chatWrite).toBeDefined();
        expect(chatWrite.filePath).toBe(path.join('/tmp/chat-logs', 'twitch-chat-bad_user.txt'));
        expect(chatWrite.data.trim()).toContain('Hi there');
    });

    it('stringifies primitives and handles circular references safely', () => {
        const circular = {};
        circular.self = circular;

        expect(logging.safeObjectStringify(null)).toBe('null');
        expect(logging.safeObjectStringify(undefined)).toBe('undefined');
        expect(logging.safeObjectStringify('hello')).toBe('hello');
        expect(logging.safeObjectStringify(42)).toBe('42');
        expect(logging.safeObjectStringify(true)).toBe('true');
        expect(logging.safeObjectStringify(circular)).toContain('stringify failed');
    });

    it('safely stringifies errors and sanitizes usernames', () => {
        const serialized = logging.safeObjectStringify(new Error('boom'));
        expect(serialized).toContain('boom');

        expect(logging.sanitizeUsername('bad:name/with*chars')).toBe('badnamewithchars');
        expect(logging.sanitizeUsername('')).toBe('');
    });
});
