import { describe, test, expect } from "bun:test";
import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";
import { ViewerCountSystem } from "../../../src/utils/viewer-count";

describe("ViewerCountSystem polling interval validation", () => {
  for (const interval of [0, -5000, -10000, -30]) {
    test(`does not start polling for configured interval ${interval}`, async () => {
      const system = new ViewerCountSystem({ platforms: {}, logger: noOpLogger,
        config: createConfigFixture({ general: { viewerCountPollingIntervalMs: interval, envFileReadEnabled: false, envFileWriteEnabled: false, logChatMessages: false }, logging: { fileLoggingEnabled: false } }),
      });
      try {
        system.startPolling();
        expect(system.isPolling).toBe(false);
        expect(system.pollingHandles).toEqual({});
      } finally { await system.cleanup(); }
    });
  }
});
