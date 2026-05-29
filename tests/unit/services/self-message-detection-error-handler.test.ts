import { describe, it, expect } from "bun:test";
import { createMockFn } from "../../helpers/bun-mock-utils";
import { logger as appLogger } from "../../../src/core/logging";
import { SelfMessageDetectionService } from "../../../src/services/SelfMessageDetectionService.ts";

type SelfMessageConfig = {
  twitch?: { ignoreSelfMessages: boolean };
  youtube?: { ignoreSelfMessages: boolean };
  tiktok?: { ignoreSelfMessages: boolean };
};

const createPlainConfig = ({ twitch, youtube, tiktok }: SelfMessageConfig = {}) => ({
  twitch: twitch || { ignoreSelfMessages: false },
  youtube: youtube || { ignoreSelfMessages: false },
  tiktok: tiktok || { ignoreSelfMessages: false },
});

type LoggerMock = typeof appLogger & {
  error: ReturnType<typeof createMockFn>;
};

const createLoggerMock = (): LoggerMock => ({
  config: {},
  outputs: {
    console: { write() {} },
    file: { config: {}, fileLogger: null, write() {} },
  },
  reconfigure() {},
  log() {},
  shouldOutput: () => false,
  debug: createMockFn(),
  info: createMockFn(),
  warn: createMockFn(),
  error: createMockFn(),
  emergency() {},
  console() {},
});

describe("SelfMessageDetectionService error handler integration", () => {
  it("routes unknown platform warning through error handler", () => {
    const mockLogger = createLoggerMock();
    const config = createPlainConfig();
    const service = new SelfMessageDetectionService(config, {
      logger: mockLogger,
    });

    service.isSelfMessage("unknownPlatform", { username: "test-user" }, {});

    expect(mockLogger.error).toHaveBeenCalled();
    const errorCall = mockLogger.error.mock.calls[0];
    if (errorCall === undefined) {
      throw new Error("Expected error logger call");
    }
    expect(errorCall[0]).toContain("Unknown platform");
  });
});
