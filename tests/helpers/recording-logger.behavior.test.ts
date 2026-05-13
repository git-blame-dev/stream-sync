import { describe, expect, it } from "bun:test";

import type { AppLogger } from "../../src/core/logger/types";
import { captureStderr, captureStdout } from "./output-capture";
import { createRecordingLogger } from "./recording-logger";

describe("recording logger behavior", () => {
  it("records canonical logger entries without emitting stdout or stderr", () => {
    const stdout = captureStdout();
    const stderr = captureStderr();

    try {
      const logger: AppLogger & ReturnType<typeof createRecordingLogger> = createRecordingLogger();
      const data = { feature: "test-logging-foundation" };

      logger.info("test-ready", "test-source", data);
      logger.warn("test-warning", "test-source");

      expect(stdout.output.join("")).toBe("");
      expect(stderr.output.join("")).toBe("");
      expect(logger.entries).toEqual([
        {
          level: "info",
          message: "test-ready",
          source: "test-source",
          data,
        },
        {
          level: "warn",
          message: "test-warning",
          source: "test-source",
          data: undefined,
        },
      ]);
    } finally {
      stdout.restore();
      stderr.restore();
    }
  });
});
