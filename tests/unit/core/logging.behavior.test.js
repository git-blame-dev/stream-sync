const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const { restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { captureStdout, captureStderr } = require('../../helpers/output-capture');
const fs = require('fs');
const os = require('os');
const path = require('path');

const logging = require('../../../src/core/logging');

describe('core/logging behavior', () => {
    beforeEach(() => {
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
        logging.setConfigValidator(() => validatedConfig);
        const result = logging.initializeLoggingConfig({});

        expect(result).toEqual(validatedConfig);
        expect(logging.getLoggingConfig()).toBe(validatedConfig);
    });

    it('writes console and file outputs through unified logger', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-logs-'));
        const stdoutCapture = captureStdout();
        const stderrCapture = captureStderr();

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

            const logger = logging.getUnifiedLogger();
            logger.config = validatedConfig;
            logger.outputs.console = new logger.outputs.console.constructor();
            logger.outputs.file = new logger.outputs.file.constructor(validatedConfig.file);
            logger.info('test-info', 'test-source');
            logger.error('test-error', 'test-source');

            const logPath = path.join(tempDir, 'runtime.log');
            const logContent = fs.readFileSync(logPath, 'utf8');

            expect(stdoutCapture.output.join('')).toContain('test-info');
            expect(stderrCapture.output.join('')).toContain('test-error');
            expect(logContent).toContain('test-info');
            expect(logContent).toContain('test-error');
        } finally {
            stdoutCapture.restore();
            stderrCapture.restore();
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });
});
