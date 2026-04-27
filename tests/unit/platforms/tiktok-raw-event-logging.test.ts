import { describe, it, expect, afterEach } from "bun:test";
import { restoreAllMocks } from "../../helpers/bun-mock-utils";
import { createMockTikTokPlatformDependencies } from "../../helpers/mock-factories";

import { TikTokPlatform } from "../../../src/platforms/tiktok";

describe("TikTokPlatform raw event logging", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  const createPlatform = (configOverrides = {}) => {
    const config = {
      enabled: true,
      username: "testDataLogger",
      dataLoggingEnabled: false,
      ...configOverrides,
    };
    const dependencies = createMockTikTokPlatformDependencies();
    return new TikTokPlatform(config, dependencies);
  };

  it("completes without error when data logging is enabled", async () => {
    const platform = createPlatform({ dataLoggingEnabled: true });
    const eventData = { type: "gift", giftId: "test-gift-1" };

    await expect(
      platform.logRawPlatformData("gift", eventData),
    ).resolves.toBeUndefined();
  });

  it("completes without error when data logging is disabled", async () => {
    const platform = createPlatform({ dataLoggingEnabled: false });
    const eventData = { type: "gift", giftId: "test-gift-1" };

    await expect(
      platform.logRawPlatformData("gift", eventData),
    ).resolves.toBeUndefined();
  });
});
