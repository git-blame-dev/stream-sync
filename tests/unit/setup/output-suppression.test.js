const { describe, it, expect } = require('bun:test');

describe('test output suppression', () => {
    it('suppresses stdout and stderr by default with opt-in local capture', () => {
        const suppressedStdout = global.__SUPPRESSED_STDOUT_WRITE__;
        const suppressedStderr = global.__SUPPRESSED_STDERR_WRITE__;

        expect(process.stdout.write).toBe(suppressedStdout);
        expect(process.stderr.write).toBe(suppressedStderr);

        const stdoutCapture = [];
        const originalStdout = process.stdout.write;
        process.stdout.write = (chunk) => {
            stdoutCapture.push(String(chunk));
            return true;
        };
        process.stdout.write('test-stdout');
        expect(stdoutCapture).toEqual(['test-stdout']);
        process.stdout.write = originalStdout;
        expect(process.stdout.write).toBe(suppressedStdout);

        const stderrCapture = [];
        const originalStderr = process.stderr.write;
        process.stderr.write = (chunk) => {
            stderrCapture.push(String(chunk));
            return true;
        };
        process.stderr.write('test-stderr');
        expect(stderrCapture).toEqual(['test-stderr']);
        process.stderr.write = originalStderr;
        expect(process.stderr.write).toBe(suppressedStderr);
    });
});
