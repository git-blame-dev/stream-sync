import { describe, expect, it } from 'bun:test';

import { captureStderr, captureStdout } from './output-capture';

describe('output-capture behavior', () => {
    it('captures stdout writes and restores original writer', () => {
        const originalWrite = process.stdout.write;
        const capture = captureStdout();

        process.stdout.write('stdout-behavior-test');

        capture.restore();

        expect(capture.output).toContain('stdout-behavior-test');
        expect(process.stdout.write).toBe(originalWrite);
    });

    it('captures stderr writes and restores original writer', () => {
        const originalWrite = process.stderr.write;
        const capture = captureStderr();

        process.stderr.write('stderr-behavior-test');

        capture.restore();

        expect(capture.output).toContain('stderr-behavior-test');
        expect(process.stderr.write).toBe(originalWrite);
    });
});
