const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const { restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { captureStdout, captureStderr } = require('../../helpers/output-capture');
const fs = require('fs');
const os = require('os');
const path = require('path');

const logging = require('../../../src/core/logging');

describe('core/logging behavior', () => {
    beforeEach(() => {
        logging.initializeLoggingConfig({
            logging: {
                console: { enabled: false },
                file: { enabled: false, directory: './logs' },
                platforms: { tiktok: { enabled: true }, twitch: { enabled: true }, youtube: { enabled: true } },
                chat: { enabled: false, separateFiles: true, directory: './logs' }
            }
        });
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

    it('initializes configuration from appConfig.logging', () => {
        const loggingConfig = {
            console: { enabled: true, level: 'info' },
            file: { enabled: false, level: 'error' },
            platforms: {},
            chat: { enabled: true }
        };
        const result = logging.initializeLoggingConfig({ logging: loggingConfig });

        expect(result).toEqual(loggingConfig);
        expect(logging.getLoggingConfig()).toBe(loggingConfig);
    });

    it('writes console and file outputs through unified logger', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'test-logs-'));
        const stdoutCapture = captureStdout();
        const stderrCapture = captureStderr();

        const loggingConfig = {
            console: { enabled: true, level: 'info' },
            file: { enabled: true, level: 'info', directory: tempDir },
            platforms: {},
            chat: { enabled: false }
        };

        try {
            logging.initializeLoggingConfig({ logging: loggingConfig });

            const logger = logging.getUnifiedLogger();
            logger.config = loggingConfig;
            logger.outputs.console = new logger.outputs.console.constructor();
            logger.outputs.file = new logger.outputs.file.constructor(loggingConfig.file);
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
