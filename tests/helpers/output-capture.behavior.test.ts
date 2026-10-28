import { describe, expect, it } from 'bun:test';

import { captureStderr, captureStdout } from './output-capture';

describe('output-capture behavior', () => {
    it('supports both write callback signatures and idempotent restoration', () => {
        const originalWrite = process.stdout.write;
        const capture = captureStdout();
        let callbacks = 0;
        try {
            expect(process.stdout.write('first', () => { callbacks += 1; })).toBe(true);
            expect(process.stdout.write('second', 'utf8', () => { callbacks += 1; })).toBe(true);
            expect(callbacks).toBe(2);
            expect(capture.output).toEqual(['first', 'second']);
        } finally {
            capture.restore();
        }
        const secondCapture = captureStdout();
        const secondWriter = process.stdout.write;
        try {
            capture.restore();
            expect(process.stdout.write).toBe(secondWriter);
        } finally {
            secondCapture.restore();
        }
        expect(process.stdout.write).toBe(originalWrite);
    });

    it('can restore after a write callback throws', () => {
        const originalWrite = process.stderr.write;
        const capture = captureStderr();
        try {
            expect(() => process.stderr.write('synthetic failure', () => {
                throw new Error('synthetic callback failure');
            })).toThrow('synthetic callback failure');
        } finally {
            capture.restore();
        }
        expect(process.stderr.write).toBe(originalWrite);
    });
    it('captures stdout writes and restores original writer', () => {
        const originalWrite = process.stdout.write;
        const capture = captureStdout();

        try {
            process.stdout.write('stdout-behavior-test');
        } finally {
            capture.restore();
        }

        expect(capture.output).toContain('stdout-behavior-test');
        expect(process.stdout.write).toBe(originalWrite);
    });

    it('captures stderr writes and restores original writer', () => {
        const originalWrite = process.stderr.write;
        const capture = captureStderr();

        try {
            process.stderr.write('stderr-behavior-test');
        } finally {
            capture.restore();
        }

        expect(capture.output).toContain('stderr-behavior-test');
        expect(process.stderr.write).toBe(originalWrite);
    });
});
