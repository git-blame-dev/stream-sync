import { describe, expect, it, spyOn } from 'bun:test';
import { createLogger } from '../../../src/core/logging';
import { captureStdout, captureStderr } from '../../helpers/output-capture';

describe('independent logging policy', () => {
    it('captures info and user output independently of disabled console and file outputs', () => {
        const logger = createLogger({}, { operatorCaptureEnabled: true });
        logger.debug('synthetic debug');
        logger.info('synthetic info');
        logger.warn('synthetic warning');
        logger.error('synthetic error');
        logger.emergency('synthetic emergency');
        logger.console('synthetic chat');
        expect(logger.getOperatorLogSource()?.history().entries.map(entry => entry.message)).toEqual([
            'synthetic info', 'synthetic warning', 'synthetic error', 'synthetic emergency', 'synthetic chat',
        ]);
    });

    it('captures debug only when an enabled output explicitly accepts it', () => {
        const capture = captureStdout();
        try {
            const logger = createLogger({ console: { enabled: true, level: 'debug' } }, { operatorCaptureEnabled: true });
            logger.debug('synthetic visible debug');
            logger.reconfigure({ console: { enabled: false, level: 'debug' } });
            logger.debug('synthetic hidden debug');
            expect(logger.getOperatorLogSource()?.history().entries.map(entry => entry.message)).toEqual(['synthetic visible debug']);
        } finally { capture.restore(); }
    });

    it('never traverses inputs when all outputs reject the call', () => {
        const logger = createLogger({ console: { enabled: true, level: 'warn' } });
        let visits = 0;
        const hostile = new Proxy({}, { getPrototypeOf() { visits++; throw new Error('synthetic trap'); }, ownKeys() { visits++; return []; } });
        logger.info(hostile, 'fixture', hostile);
        expect(visits).toBe(0);
        expect(logger.getOperatorLogSource()).toBeNull();
    });

    it('sanitizes metadata once and retains the same safe data for operator replay', () => {
        const capture = captureStdout();
        try {
            const logger = createLogger({ console: { enabled: true } }, { operatorCaptureEnabled: true });
            let reads = 0;
            const data = { get summary() { reads++; return 'synthetic summary'; }, password: 'synthetic secret' };
            logger.info('failed https://synthetic-user:synthetic-password@example.invalid/?opaque=synthetic-token', 'fixture', data);
            expect(reads).toBe(1);
            const entry = logger.getOperatorLogSource()?.history().entries[0];
            expect(entry?.data).toEqual({ password: '[REDACTED]', summary: 'synthetic summary' });
            expect(capture.output.join('')).toContain(JSON.stringify(entry?.data));
            expect(capture.output.join('')).not.toContain('synthetic secret');
            expect(entry?.message).toBe('failed https://example.invalid/');
        } finally { capture.restore(); }
    });

    it('isolates a throwing stdout and broken fallback stderr from operator capture', () => {
        const stdout = spyOn(process.stdout, 'write').mockImplementation(() => { throw new Error('synthetic stdout'); });
        const stderr = spyOn(process.stderr, 'write').mockImplementation(() => { throw new Error('synthetic stderr'); });
        try {
            const logger = createLogger({ console: { enabled: true } }, { operatorCaptureEnabled: true });
            expect(() => logger.info('synthetic survivor')).not.toThrow();
            expect(logger.getOperatorLogSource()?.history().entries[0]?.message).toBe('synthetic survivor');
            expect(stderr).toHaveBeenCalledTimes(1);
        } finally { stdout.mockRestore(); stderr.mockRestore(); }
    });

    it('keeps fallback diagnostics bounded and excludes thrown exception text', () => {
        const capture = captureStderr();
        const stdout = spyOn(process.stdout, 'write').mockImplementation(() => { throw new Error('synthetic hidden exception'); });
        try {
            createLogger({ console: { enabled: true } }).info('x'.repeat(100_000));
            expect(capture.output.join('').length).toBeLessThanOrEqual(8193);
            expect(capture.output.join('')).toContain('Console output failed');
            expect(capture.output.join('')).not.toContain('synthetic hidden exception');
        } finally { stdout.mockRestore(); capture.restore(); }
    });

    it('bounds record text and data before operator retention', () => {
        const logger = createLogger({}, { operatorCaptureEnabled: true });
        logger.info('x'.repeat(100_000), '\u0001'.repeat(100_000), { values: Array.from({ length: 100 }, () => 'x'.repeat(4096)) });
        const entry = logger.getOperatorLogSource()?.history().entries[0];
        expect(entry?.message.length).toBeLessThanOrEqual(4099);
        expect(entry?.source.length).toBeLessThanOrEqual(4099);
        expect(entry?.data).toBe('[TRUNCATED]');
    });

    it('retains the operator source across capture toggles and isolates instances', () => {
        const logger = createLogger({}, { operatorCaptureEnabled: true });
        const source = logger.getOperatorLogSource();
        logger.info('synthetic before');
        logger.setOperatorCaptureEnabled(false);
        logger.info('synthetic hidden');
        logger.setOperatorCaptureEnabled(true);
        expect(logger.getOperatorLogSource()).toBe(source);
        expect(source?.history().entries.map(entry => entry.message)).toEqual(['synthetic before']);
        expect(createLogger({}, { operatorCaptureEnabled: true }).getOperatorLogSource()?.history().entries).toEqual([]);
    });
});
