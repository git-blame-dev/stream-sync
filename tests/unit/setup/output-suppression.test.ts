import { describe, it, expect } from "bun:test";
import { captureStdout, captureStderr } from "../../helpers/output-capture";

type TestGlobal = typeof globalThis & {
  __SUPPRESSED_STDOUT_WRITE__: typeof process.stdout.write;
  __SUPPRESSED_STDERR_WRITE__: typeof process.stderr.write;
};

describe("test output suppression", () => {
  it("acknowledges both write callback overloads without emitting chunks", () => {
    const testGlobal = globalThis as TestGlobal;
    for (const write of [testGlobal.__SUPPRESSED_STDOUT_WRITE__, testGlobal.__SUPPRESSED_STDERR_WRITE__]) {
      let callbacks = 0;
      expect(write("synthetic suppressed output", () => { callbacks += 1; })).toBe(true);
      expect(write("synthetic suppressed output", "utf8", () => { callbacks += 1; })).toBe(true);
      expect(callbacks).toBe(2);
    }
  });
  it("suppresses stdout and stderr by default with opt-in local capture", () => {
    const testGlobal = globalThis as TestGlobal;
    const suppressedStdout = testGlobal.__SUPPRESSED_STDOUT_WRITE__;
    const suppressedStderr = testGlobal.__SUPPRESSED_STDERR_WRITE__;

    expect(process.stdout.write).toBe(suppressedStdout);
    expect(process.stderr.write).toBe(suppressedStderr);

    const stdoutCapture = captureStdout();
    try {
      process.stdout.write("test-stdout");
      expect(stdoutCapture.output).toEqual(["test-stdout"]);
    } finally {
      stdoutCapture.restore();
    }
    expect(process.stdout.write).toBe(suppressedStdout);

    const stderrCapture = captureStderr();
    try {
      process.stderr.write("test-stderr");
      expect(stderrCapture.output).toEqual(["test-stderr"]);
    } finally {
      stderrCapture.restore();
    }
    expect(process.stderr.write).toBe(suppressedStderr);
  });
  it("restores captured writers when the capture scope fails", () => {
    for (const [stream, capture] of [[process.stdout, captureStdout], [process.stderr, captureStderr]] as const) {
      const original = stream.write;
      const failure = new Error("synthetic capture scope failure");
      expect(() => {
        const captured = capture();
        try {
          stream.write("synthetic captured output");
          throw failure;
        } finally {
          captured.restore();
        }
      }).toThrow(failure);
      expect(stream.write).toBe(original);
    }
  });
});
