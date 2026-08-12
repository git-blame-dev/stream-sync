import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { restoreAllMocks } from '../../helpers/bun-mock-utils';
import { captureStdout, captureStderr } from '../../helpers/output-capture';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as logging from '../../../src/core/logging.ts';

type LoggingConfig = NonNullable<Parameters<typeof logging.initializeLoggingConfig>[0]['logging']>;

describe('core/logging behavior', () => {
    beforeEach(() => {
        logging.initializeLoggingConfig({
            logging: {
                console: { enabled: false },
                file: { enabled: false, directory: './logs' },
                platforms: { tiktok: { enabled: true }, twitch: { enabled: true }, youtube: { enabled: true } },
                chat: { enabled: false, separateFiles: true, directory: './logs' }
            }
        }, { operatorCaptureEnabled: false });
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

    it('captures operator logs only when explicitly enabled', () => {
        logging.initializeLoggingConfig({ logging: { console: { enabled: true, level: 'info' }, file: { enabled: false } } });
        expect(logging.getOperatorLogSource()).toBeNull();
    });

    it('retains sanitized console-visible entries in the operator source', () => {
        logging.initializeLoggingConfig({ logging: { console: { enabled: true, level: 'info' }, file: { enabled: false } } }, { operatorCaptureEnabled: true });
        const stdoutCapture = captureStdout();
        const logger = logging.getUnifiedLogger();

        try {
            logger.info('hello', 'source', { access_token: 'secret', nested: { value: 'safe' } });

            const entry = logging.getOperatorLogSource()?.history().entries.at(-1);
            expect(entry).toMatchObject({
                id: expect.any(Number), message: 'hello', source: 'source',
                data: { access_token: '[REDACTED]', nested: { value: 'safe' } },
            });
        } finally {
            stdoutCapture.restore();
        }
    });

    it('preserves one operator source while capture is toggled', () => {
        logging.initializeLoggingConfig({ logging: { console: { enabled: true, level: 'info' }, file: { enabled: false } } }, { operatorCaptureEnabled: true });
        const stdoutCapture = captureStdout();
        const logger = logging.getUnifiedLogger();
        try {
            const source = logging.getOperatorLogSource();
            logger.info('before-reconfigure');
            logging.initializeLoggingConfig({ logging: { console: { enabled: true, level: 'info' }, file: { enabled: false } } }, { operatorCaptureEnabled: true });
            expect(logging.getOperatorLogSource()).toBe(source);
            logger.info('after-reconfigure');
            expect(source?.history().entries.map((entry) => entry.message).slice(-2)).toEqual(['before-reconfigure', 'after-reconfigure']);

            logging.initializeLoggingConfig(
                { logging: { console: { enabled: true, level: 'info' }, file: { enabled: false } } },
                { operatorCaptureEnabled: false }
            );
            expect(logging.getOperatorLogSource()).toBeNull();
            logger.info('while-disabled');
            logging.initializeLoggingConfig(
                { logging: { console: { enabled: true, level: 'info' }, file: { enabled: false } } },
                { operatorCaptureEnabled: true }
            );
            expect(logging.getOperatorLogSource()).toBe(source);
            expect(source?.history().entries.some((entry) => entry.message === 'while-disabled')).toBe(false);
        } finally {
            stdoutCapture.restore();
        }
    });

    it('captures only entries passing the console threshold', () => {
        logging.initializeLoggingConfig({ logging: { console: { enabled: true, level: 'warn' }, file: { enabled: false } } }, { operatorCaptureEnabled: true });
        const stdoutCapture = captureStdout();
        const logger = logging.getUnifiedLogger();

        try {
            logger.info('suppressed');
            logger.warn('retained');
            const messages = logging.getOperatorLogSource()?.history().entries.map((entry) => entry.message) ?? [];
            expect(messages).not.toContain('suppressed');
            expect(messages).toContain('retained');
        } finally {
            stdoutCapture.restore();
        }
    });

    it('does not traverse suppressed log data', () => {
        logging.initializeLoggingConfig({ logging: { console: { enabled: true, level: 'warn' }, file: { enabled: false } } }, { operatorCaptureEnabled: true });
        const stdoutCapture = captureStdout();
        const logger = logging.getUnifiedLogger();
        const data = {};
        Object.defineProperty(data, 'throwing', { get() { throw new Error('must not read'); } });

        try {
            expect(() => logger.info('suppressed', 'test', data)).not.toThrow();
            expect(logging.getOperatorLogSource()?.history().entries.at(-1)?.message).not.toBe('suppressed');
        } finally {
            stdoutCapture.restore();
        }
    });

    it('bounds oversized entries retained for operator replay', () => {
        logging.initializeLoggingConfig({ logging: { console: { enabled: true, level: 'info' }, file: { enabled: false } } }, { operatorCaptureEnabled: true });
        const stdoutCapture = captureStdout();
        const logger = logging.getUnifiedLogger();

        try {
            logger.info('large-entry', 'x'.repeat(100_000), { value: 'small' });
            expect(logging.getOperatorLogSource()?.history().entries.at(-1)?.data).toBe('[TRUNCATED]');
        } finally {
            stdoutCapture.restore();
        }
    });

    it('initializes configuration from appConfig.logging', () => {
        const loggingConfig = {
            console: { enabled: true, level: 'info' },
            file: { enabled: false, level: 'error' },
            platforms: {},
            chat: { enabled: true }
        } satisfies LoggingConfig;
        const result = logging.initializeLoggingConfig({ logging: loggingConfig });

        expect(result).toEqual(loggingConfig);
        expect(logging.getLoggingConfig()).toBe(loggingConfig);
    });

    it('parses string and numeric debug mode values predictably', () => {
        logging.setDebugMode('false');
        expect(logging.getDebugMode()).toBe(false);

        logging.setDebugMode('true');
        expect(logging.getDebugMode()).toBe(true);

        logging.setDebugMode(0);
        expect(logging.getDebugMode()).toBe(false);

        logging.setDebugMode(1);
        expect(logging.getDebugMode()).toBe(true);
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
        } satisfies LoggingConfig;

        try {
            logging.initializeLoggingConfig({ logging: loggingConfig });

            const logger = logging.getUnifiedLogger();
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

    it('reconfigures an existing logger instance when logging config changes', () => {
        const stdoutCapture = captureStdout();
        const stderrCapture = captureStderr();

        try {
            const logger = logging.getUnifiedLogger();
            logging.initializeLoggingConfig({ logging: { console: { enabled: false }, file: { enabled: false } } });
            logger.info('test-hidden-before-reconfigure', 'test-source');

            logging.initializeLoggingConfig({ logging: { console: { enabled: true, level: 'info' }, file: { enabled: false } } });
            logger.info('test-visible-after-reconfigure', 'test-source');

            const stdout = stdoutCapture.output.join('');
            expect(stdout).not.toContain('test-hidden-before-reconfigure');
            expect(stdout).toContain('test-visible-after-reconfigure');
            expect(stderrCapture.output.join('')).toBe('');
        } finally {
            stdoutCapture.restore();
            stderrCapture.restore();
        }
    });

    it('treats console output as user-facing output instead of a severity threshold', () => {
        const stdoutCapture = captureStdout();
        const stderrCapture = captureStderr();

        try {
            logging.initializeLoggingConfig({ logging: { console: { enabled: true, level: 'error' }, file: { enabled: false } } });
            const logger = logging.getUnifiedLogger();

            logger.info('test-hidden-info', 'test-source');
            logger.console('test-visible-user-output', 'test-source');

            const stdout = stdoutCapture.output.join('');
            expect(stdout).not.toContain('test-hidden-info');
            expect(stdout).toContain('test-visible-user-output');
            expect(stdout).not.toContain('[CONSOLE]');
            expect(stderrCapture.output.join('')).toBe('');
        } finally {
            stdoutCapture.restore();
            stderrCapture.restore();
        }
    });

    it('redacts sensitive metadata and strips URL query strings at the logging boundary', () => {
        const stdoutCapture = captureStdout();
        const stderrCapture = captureStderr();

        try {
            logging.initializeLoggingConfig({ logging: { console: { enabled: true, level: 'debug' }, file: { enabled: false } } });
            logging.setDebugMode(true);
            const logger = logging.getUnifiedLogger();
            const circular: Record<string, unknown> = { access_token: 'test-access-token' };
            circular.self = circular;

            logger.debug('test-sensitive-payload', 'test-source', {
                access_token: 'test-access-token',
                refreshToken: 'test-refresh-token',
                authorization: 'Bearer test-token',
                reconnect_url: 'wss://eventsub.wss.twitch.tv/ws?token=test-reconnect-token#fragment',
                error: new Error('test-error-with-stack'),
                circular
            });

            const stdout = stdoutCapture.output.join('');
            expect(stdout).toContain('test-sensitive-payload');
            expect(stdout).toContain('[REDACTED]');
            expect(stdout).toContain('wss://eventsub.wss.twitch.tv/ws');
            expect(stdout).not.toContain('test-access-token');
            expect(stdout).not.toContain('test-refresh-token');
            expect(stdout).not.toContain('Bearer test-token');
            expect(stdout).not.toContain('test-reconnect-token');
            expect(stdout).not.toContain('fragment');
            expect(stdout).not.toContain('"stack"');
            expect(stderrCapture.output.join('')).toBe('');
        } finally {
            logging.setDebugMode(false);
            stdoutCapture.restore();
            stderrCapture.restore();
        }
    });
});
