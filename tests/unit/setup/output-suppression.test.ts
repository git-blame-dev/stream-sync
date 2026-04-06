import { describe, it, expect } from 'bun:test';
const { captureStdout, captureStderr } = require('../../helpers/output-capture');

describe('test output suppression', () => {
    it('suppresses stdout and stderr by default with opt-in local capture', () => {
        const suppressedStdout = global.__SUPPRESSED_STDOUT_WRITE__;
        const suppressedStderr = global.__SUPPRESSED_STDERR_WRITE__;

        expect(process.stdout.write).toBe(suppressedStdout);
        expect(process.stderr.write).toBe(suppressedStderr);

        const stdoutCapture = captureStdout();
        process.stdout.write('test-stdout');
        expect(stdoutCapture.output).toEqual(['test-stdout']);
        stdoutCapture.restore();
        expect(process.stdout.write).toBe(suppressedStdout);

        const stderrCapture = captureStderr();
        process.stderr.write('test-stderr');
        expect(stderrCapture.output).toEqual(['test-stderr']);
        stderrCapture.restore();
        expect(process.stderr.write).toBe(suppressedStderr);
    });
});
